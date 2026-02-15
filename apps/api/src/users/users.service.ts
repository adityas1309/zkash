import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User } from '../schemas/user.schema';
import { AuthService } from '../auth/auth.service';
import { SorobanService } from '../soroban/soroban.service';
import { PendingWithdrawal } from '../schemas/pending-withdrawal.schema';
import { EncryptedNote } from '../schemas/encrypted-note.schema';
import { SpendableNote } from '../schemas/spendable-note.schema';
import { Asset, Horizon, Keypair, Networks, TransactionBuilder, Operation } from '@stellar/stellar-sdk';
import * as nacl from 'tweetnacl';
import * as naclUtil from 'tweetnacl-util';
import { computeCommitment, type NoteFields } from '../zk/commitment';
import { ProofService } from '../zk/proof.service';
import { MerkleTreeService } from '../zk/merkle-tree.service';

@Injectable()
export class UsersService {
  private server: Horizon.Server;
  // ShieldedPool transfers a variable amount per deposit/withdraw.
  // We use 7 decimals for calculations (1 unit = 10_000_000 stroops).
  private static readonly DECIMAL_PRECISION = 7;
  private static readonly SCALE_FACTOR = 10_000_000n;

  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(PendingWithdrawal.name) private pendingWithdrawalModel: Model<PendingWithdrawal>,
    @InjectModel(EncryptedNote.name) private encryptedNoteModel: Model<EncryptedNote>,
    @InjectModel(SpendableNote.name) private spendableNoteModel: Model<SpendableNote>,
    @Inject(forwardRef(() => AuthService)) private authService: AuthService,
    private sorobanService: SorobanService,
    private proofService: ProofService,
    private merkleTree: MerkleTreeService,
  ) {
    // Ensure we use the proper Horizon endpoint, not the RPC endpoint
    const rpcUrl = process.env.RPC_URL || '';
    // If RPC_URL is a Soroban RPC (often ends in .org with no path or /), we shouldn't use it for Horizon
    // We default to the standard public Horizon testnet URL if the env var doesn't look like Horizon
    const horizonUrl = rpcUrl.includes('horizon') ? rpcUrl : 'https://horizon-testnet.stellar.org';

    console.log(`[UsersService] Using Horizon URL: ${horizonUrl}`);
    this.server = new Horizon.Server(horizonUrl);
  }

  async findById(id: string): Promise<User | null> {
    return this.userModel.findById(id).exec();
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.userModel.findOne({ username }).exec();
  }

  async findByStellarPublicKey(publicKey: string): Promise<User | null> {
    return this.userModel.findOne({ stellarPublicKey: publicKey }).exec();
  }

  async getBalances(userId: string): Promise<{ xlm: string; usdc: string }> {
    const user = await this.findById(userId);
    if (!user) throw new Error('User not found');

    try {
      console.log(`[UsersService] Fetching balances for ${user.stellarPublicKey}`);
      const account = await this.server.loadAccount(user.stellarPublicKey);
      const xlm = account.balances.find((b: any) => b.asset_type === 'native')?.balance ?? '0';
      const usdc = account.balances.find(
        (b: any) =>
          (b.asset_type === 'credit_alphanum4' || b.asset_type === 'credit_alphanum12') &&
          b.asset_code === 'USDC'
      )?.balance ?? '0';

      console.log(`[UsersService] Balances - XLM: ${xlm}, USDC: ${usdc}`);
      return { xlm, usdc };
    } catch (e) {
      console.error(`[UsersService] Failed to load account:`, e);
      // Account might not be created yet on ledger
      return { xlm: '0', usdc: '0' };
    }
  }

  async addTrustline(userId: string): Promise<string> {
    const user = await this.findById(userId);
    if (!user) throw new Error('User not found');
    if (!user.googleId) throw new Error('Google ID required for decryption');

    // Decrypt keys
    const encryptionKey = this.authService.getDecryptionKeyForUser(user, user.googleId, user.email);
    const secretKey = this.authService.decrypt(user.stellarSecretKeyEncrypted, encryptionKey);
    const keypair = Keypair.fromSecret(secretKey);

    try {
      const account = await this.server.loadAccount(user.stellarPublicKey);

      // USDC Issuer on Testnet (Circle)
      // Source: https://developers.circle.com/stablecoins/docs/usdc-on-stellar
      const usdcIssuer = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
      const usdcAsset = new Asset('USDC', usdcIssuer);

      const tx = new TransactionBuilder(account, {
        fee: '100',
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(Operation.changeTrust({ asset: usdcAsset, limit: '1000000' }))
        .setTimeout(30)
        .build();

      tx.sign(keypair);

      const res = await this.server.submitTransaction(tx);
      return res.hash;
    } catch (e) {
      console.error('Add Trustline Error:', e);
      throw new Error((e as Error).message);
    }
  }

  async sendPayment(senderId: string, recipientIdentifier: string, assetCode: 'USDC' | 'XLM', amount: string): Promise<string> {
    const sender = await this.findById(senderId);
    if (!sender) throw new Error('Sender not found');
    if (!sender.googleId) throw new Error('Sender Google ID required');

    // Resolve recipient
    let destinationPublicKey = recipientIdentifier;
    // Check if it's a username (doesn't look like a public key)
    if (!recipientIdentifier.startsWith('G') || recipientIdentifier.length !== 56) {
      const recipientUser = await this.findByUsername(recipientIdentifier);
      if (!recipientUser) throw new Error('Recipient user not found');
      destinationPublicKey = recipientUser.stellarPublicKey;
    }

    // Decrypt sender's secret key
    const encryptionKey = this.authService.getDecryptionKeyForUser(sender, sender.googleId, sender.email);
    const secretKey = this.authService.decrypt(sender.stellarSecretKeyEncrypted, encryptionKey);
    const keypair = Keypair.fromSecret(secretKey);

    try {
      const account = await this.server.loadAccount(sender.stellarPublicKey);

      let asset: Asset;
      if (assetCode === 'USDC') {
        const usdcIssuer = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
        asset = new Asset('USDC', usdcIssuer);
      } else {
        asset = Asset.native();
      }

      const tx = new TransactionBuilder(account, {
        fee: '100',
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(Operation.payment({
          destination: destinationPublicKey,
          asset: asset,
          amount: amount,
        }))
        .setTimeout(30)
        .build();

      tx.sign(keypair);

      const res = await this.server.submitTransaction(tx);
      return res.hash;
    } catch (e) {
      console.error('[UsersService] Send Payment Error:', e);
      // Improve error message
      const msg = (e as any)?.response?.data?.extras?.result_codes?.operations?.[0] || (e as Error).message;
      throw new Error(`Payment failed: ${msg}`);
    }
  }

  /**
   * Private balance calculation:
   * 1. Sum of all UNSPENT SpendableNotes (funds currently held in private notes).
   * 2. Sum of all PENDING Withdrawals (funds received but not yet withdrawn to public).
   *
   * This accurately reflects "total private capability" - what you can spend further (notes)
   * plus what you have received and just need to claim (withdrawals).
   */
  async getPrivateBalance(userId: string): Promise<{ xlm: string; usdc: string }> {
    const user = await this.findById(userId);
    if (!user || !user.googleId) return { xlm: '0', usdc: '0' };

    // 1. Sum up SpendableNotes (unspent)
    const spendableNotes = await this.spendableNoteModel
      .find({ userId: user._id, spent: false })
      .exec();

    let usdcNotes = 0;
    let xlmNotes = 0;

    for (const note of spendableNotes) {
      try {
        // Decrypt note to get value (though usually it is 1 for now)
        const encKey = this.authService.getDecryptionKeyForUser(user, user.googleId, user.email);
        const combined = Buffer.from(note.ciphertext, 'base64');
        const nonce = combined.slice(0, nacl.secretbox.nonceLength);
        const ciphertext = combined.slice(nacl.secretbox.nonceLength);
        const decrypted = nacl.secretbox.open(
          new Uint8Array(ciphertext),
          new Uint8Array(nonce),
          encKey,
        );

        if (decrypted) {
          const obj = JSON.parse(naclUtil.encodeUTF8(decrypted));
          const val = Number(obj.value || 0); // Should be 10_000_000n usually, but stored as string in schema?
          // Schema says 'ciphertext' string. The decrypted obj.value is number or string.
          // NoteFields uses bigint.
          // Let's assume standard unit (1) for now if the value is big (10^7).
          // If value > 1000, it's likely stroops. If <= 1000, it's units.
          // ShieldedPool FIXED_AMOUNT = 10_000_000 (1 unit).
          // We want to return display units (1).

          // value: noteFields.value.toString() -> "10000000"
          // So we should divide by 10_000_000 to get display units.
          const rawVal = Number(obj.value);
          const displayVal = rawVal / Number(UsersService.SCALE_FACTOR);

          if (note.asset === 'USDC') usdcNotes += displayVal;
          if (note.asset === 'XLM') xlmNotes += displayVal;
        }
      } catch (e) {
        console.warn('[getPrivateBalance] Failed to decrypt a note:', e);
      }
    }

    // 2. Sum up PendingWithdrawals (unprocessed)
    const pendingWithdrawals = await this.pendingWithdrawalModel
      .find({ recipientId: user._id, processed: false })
      .exec();

    let usdcPending = 0;
    let xlmPending = 0;

    for (const pw of pendingWithdrawals) {
      const val = Number(pw.amount); // This is usually '1' from sendPrivate logic
      if (pw.asset === 'USDC') usdcPending += val;
      if (pw.asset === 'XLM') xlmPending += val;
    }

    return {
      usdc: String(usdcNotes + usdcPending),
      xlm: String(xlmNotes + xlmPending),
    };
  }

  /** Private send: generate proof from sender's spendable note, create pending withdrawal for recipient. */
  async sendPrivate(
    senderId: string,
    recipientIdentifier: string,
    asset: 'USDC' | 'XLM',
    amount: string,
  ): Promise<{ success: boolean; error?: string }> {
    console.log(`[sendPrivate] START senderId=${senderId}, recipient=${recipientIdentifier}, asset=${asset}, amount=${amount}`);
    const recipient = await this.findByUsername(recipientIdentifier) ?? await this.findByStellarPublicKey(recipientIdentifier);
    if (!recipient || !recipient.googleId) {
      console.log('[sendPrivate] FAIL: Recipient not found');
      return { success: false, error: 'Recipient not found' };
    }

    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      console.log('[sendPrivate] FAIL: Invalid amount');
      return { success: false, error: 'Invalid amount' };
    }

    // Scale amount to BigInt stroops
    const amountBigInt = BigInt(Math.round(amountNum * Number(UsersService.SCALE_FACTOR)));

    const poolAddress =
      asset === 'USDC'
        ? (process.env.SHIELDED_POOL_ADDRESS ?? '')
        : (process.env.SHIELDED_POOL_XLM_ADDRESS ?? process.env.SHIELDED_POOL_ADDRESS ?? '');
    if (!poolAddress) {
      console.log('[sendPrivate] FAIL: Pool not configured');
      return { success: false, error: 'Pool not configured for this asset' };
    }
    console.log(`[sendPrivate] poolAddress=${poolAddress}`);

    // For sendPrivate (transfer), we need a note of EXACT amount.
    // TODO: Implement splitting/merging to handle arbitrary amounts from larger notes.
    const notes = await this.getSpendableNotes(senderId, asset, amountBigInt);
    const matchingNote = notes.find(n => n.value === amountBigInt);

    if (!matchingNote) {
      return { success: false, error: `No spendable private note of exact amount ${amount} found. Splitting not yet supported.` };
    }

    const notesToUse = [matchingNote]; // Use the matching note
    console.log(`[sendPrivate] spendable notes found: ${notes.length}`);
    if (notes.length === 0) return { success: false, error: 'No spendable private balance. Deposit first.' };

    // Get sender's public key for the contract call
    const sender = await this.findById(senderId);
    if (!sender) return { success: false, error: 'Sender not found' };

    const note = notesToUse[0];
    console.log(`[sendPrivate] note commitment: ${note.commitment}`);
    const stateRoot = await this.sorobanService.getMerkleRoot(poolAddress, sender.stellarPublicKey);
    console.log(`[sendPrivate] stateRoot: ${Buffer.from(stateRoot).toString('hex').slice(0, 32)}...`);

    const leaves = await this.sorobanService.getCommitments(poolAddress, sender.stellarPublicKey);
    console.log(`[sendPrivate] on-chain leaves: ${leaves.length}`);
    const commitmentBytes = new Uint8Array(Buffer.from(note.commitment, 'hex'));
    const stateIndex = leaves.findIndex((l) => Buffer.from(l).equals(Buffer.from(commitmentBytes)));
    console.log(`[sendPrivate] stateIndex: ${stateIndex}`);
    if (stateIndex < 0) {
      console.log('[sendPrivate] FAIL: commitment not found on-chain');
      if (leaves.length > 0) {
        console.log(`[sendPrivate] first leaf hex: ${Buffer.from(leaves[0]).toString('hex').slice(0, 32)}...`);
        console.log(`[sendPrivate] seeking commitment: ${note.commitment.slice(0, 32)}...`);
      }
      return { success: false, error: 'Deposit not indexed on-chain yet. Wait and retry.' };
    }
    const stateSiblings = await this.merkleTree.computeSiblingsForIndex(leaves, stateIndex, 20);
    console.log(`[sendPrivate] computed ${stateSiblings.length} siblings, generating proof...`);

    try {
      const { proofBytes, pubSignalsBytes, nullifierHash, nullifierSecret } = await this.proofService.generateProof(
        { label: note.label, value: note.value, nullifier: note.nullifier, secret: note.secret },
        stateRoot,
        amountBigInt,
        { commitmentBytes, stateIndex, stateSiblings },
      );
      console.warn(`[sendPrivate] proofBytes HEX: ${Buffer.from(proofBytes).toString('hex')}`);
      console.warn(`[sendPrivate] pubSignalsBytes HEX: ${Buffer.from(pubSignalsBytes).toString('hex')}`);
      console.log(`[sendPrivate] proof generated, nullifierHash: ${nullifierHash.slice(0, 16)}...`);

      // Store 'nullifierHash' in PendingWithdrawal because the recipient interacts with the contract
      // using this hash.
      await this.pendingWithdrawalModel.create({
        recipientId: recipient._id,
        poolAddress,
        proofBytes: Buffer.from(proofBytes).toString('base64'),
        pubSignalsBytes: Buffer.from(pubSignalsBytes).toString('base64'),
        nullifier: nullifierHash, // Use HASH for contract
        amount,
        asset,
      });

      try {
        const recipientEncKey = this.authService.getDecryptionKeyForUser(recipient, recipient.googleId, recipient.email);
        const recipientViewKeyHex = this.authService.decrypt(recipient.zkViewKeyEncrypted, recipientEncKey);
        const recipientViewKey = new Uint8Array(Buffer.from(recipientViewKeyHex, 'hex'));
        const payload = JSON.stringify({ value: amountNum, asset });
        const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
        const ciphertext = nacl.secretbox(naclUtil.decodeUTF8(payload), nonce, recipientViewKey);
        const combined = Buffer.concat([Buffer.from(nonce), Buffer.from(ciphertext)]);
        await this.encryptedNoteModel.create({
          commitment: '',
          ciphertext: Buffer.from(combined).toString('base64'),
          recipientId: recipient._id,
          asset,
          txHash: 'pending',
          poolAddress,
        });
      } catch (e) {
        console.error('[UsersService] sendPrivate: failed to create EncryptedNote:', e);
      }

      // Mark note spent using SECRET nullifier (database index)
      await this.markNoteSpent(senderId, nullifierSecret);
      console.log('[sendPrivate] SUCCESS');
      return { success: true };
    } catch (proofErr: any) {
      console.error('[sendPrivate] PROOF/WITHDRAWAL ERROR:', proofErr.message || proofErr);
      return { success: false, error: proofErr.message || String(proofErr) };
    }
  }

  /**
   * Withdraw specific amount from private notes to self (public account).
   * Consumes SpendableNotes and calls contract withdraw immediately.
   */
  async withdrawSelf(userId: string, asset: 'USDC' | 'XLM', amount: number): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const user = await this.findById(userId);
    if (!user || !user.googleId) return { success: false, error: 'User not found' };

    const poolAddress =
      asset === 'USDC'
        ? (process.env.SHIELDED_POOL_ADDRESS ?? '')
        : (process.env.SHIELDED_POOL_XLM_ADDRESS ?? process.env.SHIELDED_POOL_ADDRESS ?? '');
    if (!poolAddress) return { success: false, error: 'Pool not configured' };

    // 1. Pick notes to spend.
    const scaledAmount = BigInt(Math.round(amount * Number(UsersService.SCALE_FACTOR)));

    const notes = await this.getSpendableNotes(userId, asset, scaledAmount);
    // Find exact match
    const note = notes.find(n => n.value === scaledAmount);

    if (!note) {
      const availableAmounts = notes.map(n => Number(n.value) / Number(UsersService.SCALE_FACTOR)).join(', ');
      return {
        success: false,
        error: `No spendable note of exact amount ${amount} found. Partial unshielding from a single note is not supported yet. Available note amounts: [${availableAmounts}]`
      };
    }

    // 2. Generate Proof targeting USER'S own public key
    // Retry loop to ensure Merkle root and leaves are consistent
    let stateRoot: Uint8Array | undefined;
    let commitmentBytes: Uint8Array | undefined;
    let stateIndex: number | undefined;
    let stateSiblings: Uint8Array[] | undefined;

    let retries = 20;
    while (retries > 0) {
      try {
        const root = await this.sorobanService.getMerkleRoot(poolAddress, user.stellarPublicKey);
        const leaves = await this.sorobanService.getCommitments(poolAddress, user.stellarPublicKey);

        // Sanity check: Compute root from leaves to ensure consistency
        const computedRoot = await this.merkleTree.computeRootFromLeaves(leaves, 20);
        if (!Buffer.from(computedRoot).equals(Buffer.from(root))) {
          console.warn(`[withdrawSelf] Root mismatch (OnChain vs Computed). Retrying (${retries} left)...`);
          await new Promise(r => setTimeout(r, 2000));
          retries--;
          continue;
        }

        const comm = new Uint8Array(Buffer.from(note.commitment, 'hex'));
        const idx = leaves.findIndex((l) => Buffer.from(l).equals(Buffer.from(comm)));

        if (idx < 0) {
          console.warn(`[withdrawSelf] Note commitment not found on-chain. Retrying (${retries} left)...`);
          await new Promise(r => setTimeout(r, 1000));
          retries--;
          continue;
        }

        stateRoot = root;
        commitmentBytes = comm;
        stateIndex = idx;
        stateSiblings = await this.merkleTree.computeSiblingsForIndex(leaves, idx, 20);
        break; // Consistent!
      } catch (e) {
        console.warn(`[withdrawSelf] Error fetching state (${retries} left):`, e);
        retries--;
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    if (!stateRoot || !commitmentBytes || stateIndex === undefined || !stateSiblings) {
      return { success: false, error: 'Failed to fetch consistent Merkle state after retries' };
    }

    try {
      const { proofBytes, pubSignalsBytes, nullifierHash, nullifierSecret } = await this.proofService.generateProof(
        { label: note.label, value: note.value, nullifier: note.nullifier, secret: note.secret },
        stateRoot,
        note.value,
        { commitmentBytes, stateIndex, stateSiblings },
      );

      // 3. Submit withdrawal to contract immediately
      const encKey = this.authService.getDecryptionKeyForUser(user, user.googleId, user.email);
      const secretKey = this.authService.decrypt(user.stellarSecretKeyEncrypted, encKey);

      const txHash = await this.sorobanService.invokeShieldedPoolWithdraw(
        poolAddress,
        secretKey,
        user.stellarPublicKey, // Withdraw to self
        new Uint8Array(proofBytes),
        new Uint8Array(pubSignalsBytes),
        new Uint8Array(Buffer.from(nullifierHash, 'hex')),
      );

      // 4. Mark note spent
      await this.markNoteSpent(userId, nullifierSecret);

      return { success: true, txHash };

    } catch (e: any) {
      console.error('[withdrawSelf] error:', e);
      const msg = e.message || String(e);

      // Handle Contract Error #1: NullifierUsed
      // This means the note was already spent on-chain. We should mark it as spent locally.
      if (msg.includes('Error(Contract, #1)')) {
        console.warn(`[withdrawSelf] Note ${note.label} already spent on-chain (NullifierUsed). Marking as spent.`);
        try {
          // We can't use nullifierSecret here easily as it's not in scope if we didn't get return
          // But we have 'note' object from step 1
          await this.markNoteSpent(userId, note.nullifier.toString(16));
          return { success: false, error: 'Note was already spent. Local state updated.' };
        } catch (markErr) {
          console.error('[withdrawSelf] Failed to mark spent note:', markErr);
        }
      }

      // Handle Contract Error #3: InsufficientBalance
      if (msg.includes('Error(Contract, #3)')) {
        return { success: false, error: `Pool Underfunded: Contract balance is lower than withdrawal amount ${amount}. This may be due to storage rent or state mismatch.` };
      }

      return { success: false, error: msg };
    }
  }

  /** Process pending withdrawals for the current user (submit withdraw txs to ShieldedPool). */
  async processPendingWithdrawals(userId: string): Promise<{ processed: number; txHashes: string[] }> {
    const user = await this.findById(userId);
    if (!user || !user.googleId) throw new Error('User not found');

    const encKey = this.authService.getDecryptionKeyForUser(user, user.googleId, user.email);
    const secretKey = this.authService.decrypt(user.stellarSecretKeyEncrypted, encKey);

    const pending = await this.pendingWithdrawalModel.find({ recipientId: new Types.ObjectId(userId), processed: false }).exec();
    const txHashes: string[] = [];

    for (const p of pending) {
      try {
        const poolAddressForPending =
          p.poolAddress ||
          (p.asset === 'USDC'
            ? (process.env.SHIELDED_POOL_ADDRESS ?? '')
            : (process.env.SHIELDED_POOL_XLM_ADDRESS ?? process.env.SHIELDED_POOL_ADDRESS ?? ''));
        if (!poolAddressForPending) {
          throw new Error('Pool address not configured for pending withdrawal asset');
        }

        const proofBytes = Buffer.from(p.proofBytes, 'base64');
        const pubSignalsBytes = Buffer.from(p.pubSignalsBytes, 'base64');

        // Robustness fix: Extract nullifierHash from public signals (index 0).
        // publicSignals = [nullifierHash, withdrawnValue, stateRoot, associationRoot]
        // Each is 32 bytes.
        // Even if p.nullifier stored the SECRET (old bug), this extracts the HASH required by contract.
        const nullifierHashFromSignals = pubSignalsBytes.subarray(0, 32);

        // Log if mismatch (just for debug)
        const storedNullifier = Buffer.from(p.nullifier, 'hex');
        if (!storedNullifier.equals(nullifierHashFromSignals)) {
          console.warn(`[processPendingWithdrawals] Correcting nullifier for withdrawal ${p._id}. Stored: ${p.nullifier}, Actual Hash: ${nullifierHashFromSignals.toString('hex')}`);
        }

        const hash = await this.sorobanService.invokeShieldedPoolWithdraw(
          poolAddressForPending,
          secretKey,
          user.stellarPublicKey,
          new Uint8Array(proofBytes),
          new Uint8Array(pubSignalsBytes),
          new Uint8Array(nullifierHashFromSignals),
        );
        txHashes.push(hash);
        p.processed = true;
        p.txHash = hash;
        await p.save();
      } catch (e) {
        console.error('[UsersService] processPendingWithdrawals error:', e);
      }
    }
    return { processed: txHashes.length, txHashes };
  }

  /**
   * Run a promise with a timeout. Rejects with a clear error if the promise doesn't settle in time.
   */
  private async withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    let timeoutId: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      clearTimeout(timeoutId!);
    }
  }

  /** Deposit to shielded pool: create spendable note, call contract, store note encrypted. */
  async deposit(userId: string, asset: 'USDC' | 'XLM', amount: number): Promise<{ txHash: string; error?: string }> {
    const DEPOSIT_TIMEOUT_MS = 120_000; // 2 min for RPC/sendTransaction on testnet

    try {
      const user = await this.findById(userId);
      if (!user || !user.googleId) return { txHash: '', error: 'User not found' };

      const poolAddress =
        asset === 'USDC'
          ? (process.env.SHIELDED_POOL_ADDRESS ?? '')
          : (process.env.SHIELDED_POOL_XLM_ADDRESS ?? process.env.SHIELDED_POOL_ADDRESS ?? '');
      if (!poolAddress) return { txHash: '', error: 'Pool not configured for this asset' };

      const encKey = this.authService.getDecryptionKeyForUser(user, user.googleId, user.email);
      const secretKey = this.authService.decrypt(user.stellarSecretKeyEncrypted, encKey);

      const randomBigInt = (): bigint => {
        const buf = Buffer.from(nacl.randomBytes(31));
        return BigInt('0x' + buf.toString('hex'));
      };

      const scaledAmount = BigInt(Math.round(amount * Number(UsersService.SCALE_FACTOR)));

      const noteFields: NoteFields = {
        value: scaledAmount,
        label: randomBigInt(),
        nullifier: randomBigInt(),
        secret: randomBigInt(),
      };

      const { commitmentBytes } = await computeCommitment(noteFields);

      // Compute the new merkle root (poseidon, depth 20) from on-chain commitments list + this commitment.
      const existingLeaves = await this.withTimeout(
        this.sorobanService.getCommitments(poolAddress, user.stellarPublicKey),
        DEPOSIT_TIMEOUT_MS,
        'getCommitments',
      );
      const newLeaves = [...existingLeaves, commitmentBytes];
      const newRootBytes = await this.merkleTree.computeRootFromLeaves(newLeaves, 20);

      const txHash = await this.withTimeout(
        this.sorobanService.invokeShieldedPoolDeposit(
          poolAddress,
          secretKey,
          commitmentBytes,
          newRootBytes,
          scaledAmount.toString(),
        ),
        DEPOSIT_TIMEOUT_MS,
        'invokeShieldedPoolDeposit',
      );

      const notePayload = {
        label: noteFields.label.toString(),
        value: noteFields.value.toString(),
        nullifier: noteFields.nullifier.toString(),
        secret: noteFields.secret.toString(),
        commitment: Buffer.from(commitmentBytes).toString('hex'),
      };
      const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
      const ciphertext = nacl.secretbox(
        naclUtil.decodeUTF8(JSON.stringify(notePayload)),
        nonce,
        encKey,
      );
      const combined = Buffer.concat([Buffer.from(nonce), Buffer.from(ciphertext)]);

      await this.spendableNoteModel.create({
        userId: user._id,
        ciphertext: combined.toString('base64'),
        poolAddress,
        asset,
        spent: false,
      });

      try {
        const viewKeyHex = this.authService.decrypt(user.zkViewKeyEncrypted, encKey);
        const viewKey = new Uint8Array(Buffer.from(viewKeyHex, 'hex'));
        const payload = JSON.stringify({ value: amount, asset });
        const noteNonce = nacl.randomBytes(nacl.secretbox.nonceLength);
        const noteCiphertext = nacl.secretbox(
          naclUtil.decodeUTF8(payload),
          noteNonce,
          viewKey,
        );
        const noteCombined = Buffer.concat([Buffer.from(noteNonce), Buffer.from(noteCiphertext)]);
        await this.encryptedNoteModel.create({
          commitment: '',
          ciphertext: Buffer.from(noteCombined).toString('base64'),
          recipientId: user._id,
          asset,
          txHash: txHash,
          poolAddress,
        });
      } catch (e) {
        console.error('[UsersService] deposit: failed to create EncryptedNote for private balance:', e);
      }

      return { txHash };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error('[UsersService] deposit error:', e);
      return { txHash: '', error: message };
    }
  }

  /**
   * Helper for SwapService: Generate a random note for a user without saving it yet.
   * Returns the NoteFields and commitment.
   */
  async generateNote(userId: string, amount: number): Promise<{ noteFields: NoteFields; commitmentBytes: Uint8Array }> {
    const randomBigInt = (): bigint => {
      const buf = Buffer.from(nacl.randomBytes(31));
      return BigInt('0x' + buf.toString('hex'));
    };

    const scaledAmount = BigInt(Math.round(amount * Number(UsersService.SCALE_FACTOR)));

    const noteFields: NoteFields = {
      value: scaledAmount,
      label: randomBigInt(),
      nullifier: randomBigInt(),
      secret: randomBigInt(),
    };

    const { commitmentBytes } = await computeCommitment(noteFields);
    return { noteFields, commitmentBytes };
  }

  /**
   * Helper for SwapService: Save a note to DB after successful Swap execution.
   */
  async saveNote(
    userId: string,
    asset: 'USDC' | 'XLM',
    poolAddress: string,
    noteFields: NoteFields,
    commitmentBytes: Uint8Array,
    txHash: string
  ): Promise<void> {
    const user = await this.findById(userId);
    if (!user || !user.googleId) throw new Error('User not found for saving note');

    const encKey = this.authService.getDecryptionKeyForUser(user, user.googleId, user.email);

    // 1. Save SpendableNote
    const notePayload = {
      label: noteFields.label.toString(),
      value: noteFields.value.toString(),
      nullifier: noteFields.nullifier.toString(),
      secret: noteFields.secret.toString(),
      commitment: Buffer.from(commitmentBytes).toString('hex'),
    };
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
    const ciphertext = nacl.secretbox(
      naclUtil.decodeUTF8(JSON.stringify(notePayload)),
      nonce,
      encKey,
    );
    const combined = Buffer.concat([Buffer.from(nonce), Buffer.from(ciphertext)]);

    await this.spendableNoteModel.create({
      userId: user._id,
      ciphertext: combined.toString('base64'),
      poolAddress,
      asset,
      spent: false,
    });

    // 2. Save EncryptedNote (for history/UI)
    try {
      const viewKeyHex = this.authService.decrypt(user.zkViewKeyEncrypted, encKey);
      const viewKey = new Uint8Array(Buffer.from(viewKeyHex, 'hex'));
      const payload = JSON.stringify({ value: 1, asset });
      const noteNonce = nacl.randomBytes(nacl.secretbox.nonceLength);
      const noteCiphertext = nacl.secretbox(
        naclUtil.decodeUTF8(payload),
        noteNonce,
        viewKey,
      );
      const noteCombined = Buffer.concat([Buffer.from(noteNonce), Buffer.from(noteCiphertext)]);
      await this.encryptedNoteModel.create({
        commitment: '',
        ciphertext: Buffer.from(noteCombined).toString('base64'),
        recipientId: user._id,
        asset,
        txHash: txHash,
        poolAddress,
      });
    } catch (e) {
      console.error('[UsersService] saveNote: failed to create EncryptedNote:', e);
    }
  }

  /** Get spendable notes for the user (decrypted). Used by proof generation. */
  async getSpendableNotes(
    userId: string,
    asset: 'USDC' | 'XLM',
    minValue?: bigint,
  ): Promise<Array<{ label: bigint; value: bigint; nullifier: bigint; secret: bigint; commitment: string }>> {
    const user = await this.findById(userId);
    if (!user || !user.googleId) return [];

    const poolAddress =
      asset === 'USDC'
        ? (process.env.SHIELDED_POOL_ADDRESS ?? '')
        : (process.env.SHIELDED_POOL_XLM_ADDRESS ?? process.env.SHIELDED_POOL_ADDRESS ?? '');
    if (!poolAddress) return [];

    const encKey = this.authService.getDecryptionKeyForUser(user, user.googleId, user.email);
    const notes = await this.spendableNoteModel
      .find({ userId: user._id, asset, poolAddress, spent: false })
      .exec();

    const out: Array<{ label: bigint; value: bigint; nullifier: bigint; secret: bigint; commitment: string }> = [];
    for (const note of notes) {
      try {
        const combined = Buffer.from(note.ciphertext, 'base64');
        const nonce = combined.slice(0, nacl.secretbox.nonceLength);
        const ciphertext = combined.slice(nacl.secretbox.nonceLength);
        const decrypted = nacl.secretbox.open(
          new Uint8Array(ciphertext),
          new Uint8Array(nonce),
          encKey,
        );
        if (!decrypted) continue;
        const obj = JSON.parse(naclUtil.encodeUTF8(decrypted)) as {
          label: string;
          value: string;
          nullifier: string;
          secret: string;
          commitment: string;
        };
        const value = BigInt(obj.value);
        if (minValue !== undefined && value < minValue) continue;
        out.push({
          label: BigInt(obj.label),
          value,
          nullifier: BigInt(obj.nullifier),
          secret: BigInt(obj.secret),
          commitment: obj.commitment,
        });
      } catch {
        // skip
      }
    }
    return out;
  }

  /** Mark a spendable note as spent (by nullifier secret OR nullifier hash). */
  async markNoteSpent(userId: string, nullifierHex: string): Promise<void> {
    // Fix: Ensure userId is an ObjectId
    const notes = await this.spendableNoteModel
      .find({ userId: new Types.ObjectId(userId), spent: false })
      .exec();

    const targetHex = nullifierHex.replace(/^0x/, '').toLowerCase().padStart(64, '0');

    for (const note of notes) {
      try {
        const combined = Buffer.from(note.ciphertext, 'base64');
        const nonce = combined.slice(0, nacl.secretbox.nonceLength);
        const ciphertext = combined.slice(nacl.secretbox.nonceLength);
        const user = await this.findById(userId);
        if (!user?.googleId) continue;
        const encKey = this.authService.getDecryptionKeyForUser(user, user.googleId, user.email);
        const decrypted = nacl.secretbox.open(
          new Uint8Array(ciphertext),
          new Uint8Array(nonce),
          encKey,
        );
        if (!decrypted) continue;

        const obj = JSON.parse(naclUtil.encodeUTF8(decrypted)) as {
          nullifier: string;
          secret: string;
          value: string;
          label: string;
        };

        // 1. Check against Nullifier Secret (legacy/direct way)
        const secretNullifier = BigInt(obj.nullifier);
        const noteNullifierHex = secretNullifier.toString(16).padStart(64, '0');
        if (noteNullifierHex === targetHex) {
          console.log(`[markNoteSpent] Marked note ${note._id} as spent (matched secret)`);
          note.spent = true;
          await note.save();
          return;
        }

        // 2. Check against Nullifier Hash (public logic)
        // Re-derive hash from the secret nullifier
        const noteFields: NoteFields = {
          value: BigInt(obj.value),
          label: BigInt(obj.label),
          nullifier: BigInt(obj.nullifier),
          secret: BigInt(obj.secret),
        };
        const { nullifierHash } = await computeCommitment(noteFields);
        const hashHex = nullifierHash.toString(16).padStart(64, '0');

        // Debug logging
        console.log(`[markNoteSpent] Checking note ${note._id}: ComputedHash=${hashHex} vs Target=${targetHex}`);

        if (hashHex === targetHex) {
          console.log(`[markNoteSpent] Marked note ${note._id} as spent (matched hash)`);
          note.spent = true;
          await note.save();
          return;
        }
      } catch (e) {
        console.warn(`[markNoteSpent] Error processing note ${note._id}:`, e);
      }
    }
    console.warn(`[markNoteSpent] No note found for nullifier ${nullifierHex}. Checked ${notes.length} notes.`);
  }

  /**
   * Split a note by withdrawing it to public and re-depositing the exact required amount.
   * The change remains in the public balance.
   */
  async splitNote(userId: string, asset: 'USDC' | 'XLM', amount: number): Promise<{ success: boolean; error?: string }> {
    const user = await this.findById(userId);
    if (!user || !user.googleId) return { success: false, error: 'User not found' };

    const targetAmount = BigInt(Math.round(amount * Number(UsersService.SCALE_FACTOR)));

    // 1. Find a note larger than amount
    const notes = await this.getSpendableNotes(user._id.toString(), asset);
    const largerNote = notes.find(n => n.value > targetAmount);

    if (!largerNote) {
      // Try merging: check if total balance is enough
      const total = notes.reduce((sum, n) => sum + n.value, 0n);
      if (total < targetAmount) {
        return { success: false, error: `Insufficient private balance. Total: ${Number(total) / Number(UsersService.SCALE_FACTOR)}` };
      }

      // Merge strategy: Withdraw ALL notes, then deposit target amount.
      // For simplicity/speed, we just withdraw the first few notes that sum up to > target.
      let currentSum = 0n;
      const notesToWithdraw: typeof notes = [];
      for (const n of notes) {
        notesToWithdraw.push(n);
        currentSum += n.value;
        if (currentSum >= targetAmount) break;
      }

      console.log(`[splitNote] Merging ${notesToWithdraw.length} notes to get ${amount}`);
      for (const n of notesToWithdraw) {
        const floatVal = Number(n.value) / Number(UsersService.SCALE_FACTOR);
        const wRes = await this.withdrawSelf(userId, asset, floatVal);
        if (!wRes.success) return { success: false, error: `Failed to withdraw note during merge: ${wRes.error}` };
      }
    } else {
      // 2. Withdraw the larger note
      console.log(`[splitNote] Found larger note ${largerNote.value}, withdrawing to split...`);
      const floatVal = Number(largerNote.value) / Number(UsersService.SCALE_FACTOR);
      const wRes = await this.withdrawSelf(userId, asset, floatVal);
      if (!wRes.success) return { success: false, error: `Withdraw failed: ${wRes.error}` };
    }

    // 3. Wait a bit for ledger confirmation (simple delay for now, ideally watch event)
    await new Promise(r => setTimeout(r, 6000));

    // 4. Deposit the EXACT amount
    console.log(`[splitNote] Re-depositing exact amount ${amount}...`);
    const dRes = await this.deposit(userId, asset, amount);
    if (dRes.error) return { success: false, error: `Deposit failed: ${dRes.error}` };

    return { success: true };
  }

  async getHistory(userId: string) {
    const encNotes = await this.encryptedNoteModel.find({ recipientId: userId }).sort({ createdAt: -1 }).exec();
    const withdrawals = await this.pendingWithdrawalModel.find({ recipientId: userId }).sort({ createdAt: -1 }).exec();

    const history: any[] = [];

    // Incoming Transfers / Deposits
    for (const n of encNotes) {
      history.push({
        type: n.txHash === 'pending' ? 'pending_transfer' : 'deposit_or_transfer',
        asset: n.asset,
        amount: '?', // Encrypted
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        date: (n as any).createdAt,
        txHash: n.txHash,
        id: n._id
      });
    }

    // Withdrawals
    for (const w of withdrawals) {
      history.push({
        type: 'withdrawal',
        asset: w.asset,
        amount: w.amount,
        status: w.processed ? 'completed' : 'pending',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        date: (w as any).createdAt,
        txHash: w.txHash,
        id: w._id
      });
    }

    return history.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }
}
