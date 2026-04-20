import { forwardRef, Inject, Injectable } from '@nestjs/common';

import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User } from '../schemas/user.schema';
import { AuthService } from '../auth/auth.service';
import { SorobanService } from '../soroban/soroban.service';
import { PendingWithdrawal } from '../schemas/pending-withdrawal.schema';
import { EncryptedNote } from '../schemas/encrypted-note.schema';
import { SpendableNote } from '../schemas/spendable-note.schema';
import { Swap } from '../schemas/swap.schema';
import { Asset, Horizon, Keypair, Networks, TransactionBuilder, Operation } from '@stellar/stellar-sdk';
import * as nacl from 'tweetnacl';
import * as naclUtil from 'tweetnacl-util';
import { computeCommitment, type NoteFields } from '../zk/commitment';
import { ProofService } from '../zk/proof.service';
import { MerkleTreeService } from '../zk/merkle-tree.service';
import { isMainnetContext, getContractAddress, getHorizonUrl } from '../network.context';
import { MetricsService } from '../ops/metrics.service';
import { OpsService } from '../ops/ops.service';
import { AppLoggerService } from '../common/logging/app-logger.service';
import { SendPreviewDto, SponsorshipPreviewDto, WalletAsset } from '../common/dto/wallet.dto';
import { SponsorshipService } from '../sponsorship/sponsorship.service';
import { TransactionAuditService } from '../transactions/transaction-audit.service';

@Injectable()
export class UsersService {
  get server(): Horizon.Server {
    const horizonUrl = getHorizonUrl();
    return new Horizon.Server(horizonUrl);
  }
  // ShieldedPool transfers a variable amount per deposit/withdraw.
  // We use 7 decimals for calculations (1 unit = 10_000_000 stroops).
  private static readonly DECIMAL_PRECISION = 7;
  private static readonly SCALE_FACTOR = 10_000_000n;

  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(PendingWithdrawal.name) private pendingWithdrawalModel: Model<PendingWithdrawal>,
    @InjectModel(EncryptedNote.name) private encryptedNoteModel: Model<EncryptedNote>,
    @InjectModel(SpendableNote.name) private spendableNoteModel: Model<SpendableNote>,
    @InjectModel(Swap.name) private swapModel: Model<Swap>,
    @Inject(forwardRef(() => AuthService)) private authService: AuthService,
    private sorobanService: SorobanService,
    private proofService: ProofService,
    private merkleTree: MerkleTreeService,
    private metrics: MetricsService,
    private opsService: OpsService,
    private logger: AppLoggerService,
    private sponsorshipService: SponsorshipService,
    private transactionAuditService: TransactionAuditService,
  ) { }

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

      const isMainnet = isMainnetContext();
      const usdcIssuer = process.env.USDC_ISSUER || (isMainnet
        ? 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
        : 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5');
      const usdcAsset = new Asset('USDC', usdcIssuer);

      const tx = new TransactionBuilder(account, {
        fee: '100',
        networkPassphrase: isMainnet ? Networks.PUBLIC : Networks.TESTNET,
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

  async sendPayment(
    senderId: string,
    recipientIdentifier: string,
    assetCode: 'USDC' | 'XLM',
    amount: string,
  ): Promise<{ txHash: string; sponsored: boolean; sponsorshipDetail: string }> {
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
        const isMainnet = isMainnetContext();
        const usdcIssuer = process.env.USDC_ISSUER || (isMainnet
          ? 'GA5ZSEJYB37JRC5EAOIRFPMQ6TAD5JIUGKWEAOSH4QALIQAMZOBEB7OA'
          : 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5');
        asset = new Asset('USDC', usdcIssuer);
      } else {
        asset = Asset.native();
      }

      const isMainnet = isMainnetContext();
      const tx = new TransactionBuilder(account, {
        fee: '100',
        networkPassphrase: isMainnet ? Networks.PUBLIC : Networks.TESTNET,
      })
        .addOperation(Operation.payment({
          destination: destinationPublicKey,
          asset: asset,
          amount: amount,
        }))
        .setTimeout(30)
        .build();

      tx.sign(keypair);

      const sponsorSecret = process.env.SPONSOR_SECRET_KEY;
      const shouldSponsor = this.sponsorshipService.shouldSponsor({
        operation: 'public_send',
        asset: assetCode,
        amount: Number(amount),
        recipient: recipientIdentifier,
      });

      let res: { hash: string };
      let sponsored = false;
      let sponsorshipDetail = 'Sponsorship unavailable; transaction submitted with the sender paying the fee.';

      if (shouldSponsor && sponsorSecret) {
        const sponsorKeypair = Keypair.fromSecret(sponsorSecret);
        const feeBump = TransactionBuilder.buildFeeBumpTransaction(
          sponsorKeypair,
          '1000',
          tx,
          isMainnet ? Networks.PUBLIC : Networks.TESTNET,
        );
        feeBump.sign(sponsorKeypair);
        const result = await this.server.submitTransaction(feeBump);
        res = { hash: result.hash };
        sponsored = true;
        sponsorshipDetail = 'Fee sponsorship applied through a fee-bump envelope.';
        this.metrics.increment('wallet', 'public_send_sponsored');
      } else {
        const result = await this.server.submitTransaction(tx);
        res = { hash: result.hash };
      }

      this.metrics.increment('wallet', 'public_send_success');
      this.logger.logEvent('wallet', 'public_send_success', {
        senderId,
        recipientIdentifier,
        assetCode,
        amount,
        txHash: res.hash,
        sponsored,
      });
      return { txHash: res.hash, sponsored, sponsorshipDetail };
    } catch (e) {
      this.metrics.incrementError('wallet', 'public_send_failure');
      this.logger.errorEvent('wallet', 'public_send_failure', e, {
        senderId,
        recipientIdentifier,
        assetCode,
        amount,
      });
      // Improve error message
      const msg = (e as any)?.response?.data?.extras?.result_codes?.operations?.[0] || (e as Error).message;
      throw new Error(`Payment failed: ${msg}`);
    }
  }

  async sendPublic(userId: string, destination: string, amount: string, assetCode: string = 'XLM'): Promise<string> {
    const user = await this.findById(userId);
    if (!user) throw new Error('User not found');
    if (!user.googleId) throw new Error('Google ID required for decryption');

    const encryptionKey = this.authService.getDecryptionKeyForUser(user, user.googleId, user.email);
    const secretKey = this.authService.decrypt(user.stellarSecretKeyEncrypted, encryptionKey);
    const keypair = Keypair.fromSecret(secretKey);

    try {
      const account = await this.server.loadAccount(user.stellarPublicKey);
      let asset = Asset.native();
      if (assetCode !== 'XLM' && assetCode !== 'native') {
        const isMainnet = isMainnetContext();
        const usdcIssuer = process.env.USDC_ISSUER || (isMainnet
          ? 'GA5ZSEJYB37JRC5EAOIRFPMQ6TAD5JIUGKWEAOSH4QALIQAMZOBEB7OA'
          : 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5');
        asset = new Asset('USDC', usdcIssuer);
      }

      const isMainnet = isMainnetContext();
      const tx = new TransactionBuilder(account, {
        fee: '100',
        networkPassphrase: isMainnet ? Networks.PUBLIC : Networks.TESTNET,
      })
        .addOperation(Operation.payment({
          destination: destination,
          asset: asset,
          amount: amount,
        }))
        .setTimeout(30)
        .build();

      tx.sign(keypair);
      const res = await this.server.submitTransaction(tx);
      return res.hash;
    } catch (e: any) {
      console.error('[UsersService] sendPublic Error:', e);
      const msg = e?.response?.data?.extras?.result_codes?.operations?.[0] || e.message;
      throw new Error(`Public Transfer failed: ${msg}`);
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
        ? (getContractAddress('SHIELDED_POOL_ADDRESS') ?? '')
        : (getContractAddress('SHIELDED_POOL_XLM_ADDRESS') ?? getContractAddress('SHIELDED_POOL_ADDRESS') ?? '');
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
      this.metrics.increment('wallet', 'private_send_success');
      this.logger.logEvent('wallet', 'private_send_success', {
        senderId,
        recipientIdentifier,
        asset,
        amount,
      });
      console.log('[sendPrivate] SUCCESS');
      return { success: true };
    } catch (proofErr: any) {
      this.metrics.incrementError('wallet', 'private_send_failure');
      this.logger.errorEvent('wallet', 'private_send_failure', proofErr, {
        senderId,
        recipientIdentifier,
        asset,
        amount,
      });
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
        ? (getContractAddress('SHIELDED_POOL_ADDRESS') ?? '')
        : (getContractAddress('SHIELDED_POOL_XLM_ADDRESS') ?? getContractAddress('SHIELDED_POOL_ADDRESS') ?? '');
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

    let retries = 60; // Increased from 20 to 60 to allow more time for indexing
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
      this.metrics.increment('wallet', 'withdraw_success');
      this.logger.logEvent('wallet', 'withdraw_success', {
        userId,
        asset,
        amount,
        txHash,
      });

      return { success: true, txHash };

    } catch (e: any) {
      this.metrics.incrementError('wallet', 'withdraw_failure');
      this.logger.errorEvent('wallet', 'withdraw_failure', e, { userId, asset, amount });
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
            ? (getContractAddress('SHIELDED_POOL_ADDRESS') ?? '')
            : (getContractAddress('SHIELDED_POOL_XLM_ADDRESS') ?? getContractAddress('SHIELDED_POOL_ADDRESS') ?? ''));
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
        this.metrics.increment('wallet', 'pending_withdrawal_processed');
      } catch (e) {
        this.metrics.incrementError('wallet', 'pending_withdrawal_failure');
        this.logger.errorEvent('wallet', 'pending_withdrawal_failure', e, {
          userId,
          pendingWithdrawalId: String(p._id),
        });
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
          ? (getContractAddress('SHIELDED_POOL_ADDRESS') ?? '')
          : (getContractAddress('SHIELDED_POOL_XLM_ADDRESS') ?? getContractAddress('SHIELDED_POOL_ADDRESS') ?? '');
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

      this.metrics.increment('wallet', 'deposit_success');
      this.logger.logEvent('wallet', 'deposit_success', {
        userId,
        asset,
        amount,
        txHash,
      });
      return { txHash };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.metrics.incrementError('wallet', 'deposit_failure');
      this.logger.errorEvent('wallet', 'deposit_failure', e, { userId, asset, amount });
      console.error('[UsersService] deposit error:', e);
      return { txHash: '', error: message };
    }
  }

  async previewSponsorship(userId: string, body: SponsorshipPreviewDto) {
    const user = await this.findById(userId);
    if (!user) {
      return {
        supported: false,
        sponsored: false,
        reason: 'User not found.',
      };
    }

    return {
      ...this.sponsorshipService.evaluate({
        operation: body.operation as any,
        asset: body.asset,
        amount: body.amount,
        recipient: body.recipient,
      }),
      asset: body.asset,
    };
  }

  async getSendWorkspace(userId: string) {
    const user = await this.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    const [balances, privateBalances, history] = await Promise.all([
      this.getBalances(userId),
      this.getPrivateBalance(userId),
      this.getHistory(userId),
    ]);

    const privateNotesByAsset = await Promise.all(
      (['USDC', 'XLM'] as const).map(async (asset) => {
        const notes = await this.getSpendableNotes(userId, asset);
        const sorted = notes
          .map((note) => Number(note.value) / Number(UsersService.SCALE_FACTOR))
          .sort((left, right) => right - left);
        return [
          asset,
          {
            count: notes.length,
            largest: sorted[0] ?? 0,
            exactFriendly: sorted.slice(0, 4),
          },
        ] as const;
      }),
    );

    const counterparties = new Map<
      string,
      {
        label: string;
        interactions: number;
        privateFlows: number;
        latestAt?: string;
      }
    >();

    for (const entry of history) {
      const key = entry.participants?.counterparty;
      if (!key) {
        continue;
      }
      const existing = counterparties.get(key) ?? {
        label: key,
        interactions: 0,
        privateFlows: 0,
        latestAt: typeof entry.date === 'string' ? entry.date : undefined,
      };
      existing.interactions += 1;
      existing.privateFlows += entry.privateFlow ? 1 : 0;
      const candidateDate = typeof entry.date === 'string' ? entry.date : undefined;
      existing.latestAt =
        existing.latestAt && candidateDate && new Date(existing.latestAt).getTime() > new Date(candidateDate).getTime()
          ? existing.latestAt
          : candidateDate ?? existing.latestAt;
      counterparties.set(key, existing);
    }

    const sponsorshipMatrix = await Promise.all(
      (['USDC', 'XLM'] as const).flatMap((asset) =>
        (['public_send', 'private_send'] as const).map(async (operation) => {
          const preview = await this.previewSponsorship(userId, {
            asset: asset as WalletAsset,
            operation,
            amount: 1,
            recipient: operation === 'public_send' ? user.stellarPublicKey : undefined,
          });
          return [`${asset}:${operation}`, preview] as const;
        }),
      ),
    );

    return {
      user: {
        username: user.username,
        stellarPublicKey: user.stellarPublicKey,
        reputation: user.reputation,
      },
      balances: {
        public: balances,
        private: privateBalances,
      },
      privateNotes: Object.fromEntries(privateNotesByAsset),
      sponsorship: Object.fromEntries(sponsorshipMatrix),
      recentCounterparties: Array.from(counterparties.values())
        .sort((left, right) => right.interactions - left.interactions)
        .slice(0, 6),
      guidance: [
        Number(privateBalances.usdc) > 0 || Number(privateBalances.xlm) > 0
          ? 'Private send works best when you already hold an exact-value note or a larger note that can be split first.'
          : 'Private send will require a deposit into the shielded pool before an exact note can be prepared.',
        Number(balances.xlm) > 0
          ? 'Public sends are ready for XLM as long as the visible balance covers the requested amount and network fee.'
          : 'Public XLM sends still need visible testnet funding before they can execute.',
        Number(balances.usdc) > 0
          ? 'USDC public sends can move immediately because the wallet already has visible USDC liquidity.'
          : 'USDC public sends may still require trustline setup or top-up liquidity in the public wallet.',
      ],
    };
  }

  async previewSend(userId: string, body: SendPreviewDto) {
    const user = await this.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    const amount = Number(body.amount);
    const [balances, privateBalances, recipientPreview, history] = await Promise.all([
      this.getBalances(userId),
      this.getPrivateBalance(userId),
      this.resolveRecipientPreview(body.recipient),
      this.getHistory(userId),
    ]);

    const amountBigInt = BigInt(Math.round(amount * Number(UsersService.SCALE_FACTOR)));
    const spendableNotes = await this.getSpendableNotes(userId, body.asset);
    const exactNote = spendableNotes.find((note) => note.value === amountBigInt);
    const largerNote = spendableNotes.find((note) => note.value > amountBigInt);
    const totalPrivate = spendableNotes.reduce((sum, note) => sum + note.value, 0n);
    const totalPrivateDisplay = Number(totalPrivate) / Number(UsersService.SCALE_FACTOR);
    const publicBalance = Number(body.asset === 'USDC' ? balances.usdc : balances.xlm);
    const privateBalance = Number(body.asset === 'USDC' ? privateBalances.usdc : privateBalances.xlm);
    const recentCounterpartyTouch = history.find(
      (entry) => entry.participants?.counterparty?.toLowerCase() === recipientPreview.username?.toLowerCase(),
    );

    const publicSponsorship = await this.previewSponsorship(userId, {
      asset: body.asset,
      operation: 'public_send',
      amount,
      recipient: body.recipient,
    });
    const privateSponsorship = await this.previewSponsorship(userId, {
      asset: body.asset,
      operation: 'private_send',
      amount,
      recipient: body.recipient,
    });

    const publicRoute = {
      mode: 'public',
      available: publicBalance >= amount,
      ready: publicBalance >= amount,
      balance: publicBalance,
      missingAmount: publicBalance >= amount ? 0 : Number((amount - publicBalance).toFixed(7)),
      summary:
        publicBalance >= amount
          ? 'Visible balance is sufficient for a direct public send.'
          : 'Public balance is lower than the requested amount, so this route needs a top-up first.',
      sponsorship: publicSponsorship,
      nextAction: publicBalance >= amount ? 'Send directly from the public wallet.' : `Fund ${body.asset} publicly before sending.`,
    };

    const privateRoute = {
      mode: 'private',
      available: privateBalance >= amount,
      ready: !!exactNote,
      exactNoteAvailable: !!exactNote,
      canSplit: !!largerNote,
      totalPrivateBalance: Number(totalPrivateDisplay.toFixed(7)),
      noteCount: spendableNotes.length,
      summary: exactNote
        ? 'An exact private note is already available for proof generation.'
        : largerNote
          ? 'A larger private note exists, so the app can split it into the exact amount before sending.'
          : totalPrivateDisplay >= amount
            ? 'Private balance exists, but no single exact or larger note is ready. A merge or split flow may be required.'
            : 'Private balance is lower than the requested amount, so a deposit is required first.',
      sponsorship: privateSponsorship,
      nextAction: exactNote
        ? 'Generate the proof and submit the private send.'
        : largerNote
          ? 'Split the larger note, then retry the private send.'
          : totalPrivateDisplay >= amount
            ? 'Re-shape private notes before attempting the send.'
            : `Deposit ${body.asset} into the shielded pool before attempting this route.`,
    };

    const recommendedMode =
      privateRoute.ready
        ? 'private'
        : publicRoute.ready
          ? 'public'
          : privateRoute.canSplit
            ? 'private'
            : 'public';

    return {
      recipient: recipientPreview,
      amount,
      asset: body.asset,
      recentRelationship: recentCounterpartyTouch
        ? {
            title: recentCounterpartyTouch.title,
            privateFlow: recentCounterpartyTouch.privateFlow,
            date: recentCounterpartyTouch.date,
          }
        : null,
      recommendedMode,
      routes: {
        public: publicRoute,
        private: privateRoute,
      },
      guidance: [
        recipientPreview.resolved
          ? `Recipient resolves to ${recipientPreview.displayLabel}.`
          : 'Recipient does not currently resolve to a known username, so the send will rely on the raw Stellar address if valid.',
        recommendedMode === 'private'
          ? 'Private mode is the stronger fit because note readiness already exists or can be achieved locally.'
          : 'Public mode is currently the cleaner path because visible balance is more ready than note preparation.',
        recentCounterpartyTouch
          ? 'This recipient already appears in your recent activity, which lowers lookup uncertainty.'
          : 'This recipient has not appeared in your recent activity yet, so double-check the identifier before sending.',
      ],
    };
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
        ? (getContractAddress('SHIELDED_POOL_ADDRESS') ?? '')
        : (getContractAddress('SHIELDED_POOL_XLM_ADDRESS') ?? getContractAddress('SHIELDED_POOL_ADDRESS') ?? '');
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

  async getWalletWorkspace(userId: string) {
    const user = await this.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    const [balances, privateBalances, pendingWithdrawals, recentHistory, withdrawalSponsorship] = await Promise.all([
      this.getBalances(userId),
      this.getPrivateBalance(userId),
      this.pendingWithdrawalModel
        .find({ recipientId: new Types.ObjectId(userId), processed: false })
        .sort({ createdAt: -1 })
        .limit(12)
        .lean()
        .exec(),
      this.getHistory(userId),
      Promise.all(
        (['USDC', 'XLM'] as const).map(async (asset) => {
          const preview = await this.previewSponsorship(userId, {
            asset: asset as WalletAsset,
            operation: 'withdraw_self',
          });
          return [asset, preview] as const;
        }),
      ),
    ]);

    const totalPendingByAsset = pendingWithdrawals.reduce(
      (accumulator, item: any) => {
        const numeric = Number(item.amount || 0);
        if (item.asset === 'USDC') {
          accumulator.usdc += numeric;
        }
        if (item.asset === 'XLM') {
          accumulator.xlm += numeric;
        }
        return accumulator;
      },
      { usdc: 0, xlm: 0 },
    );

    const privateActions = [
      {
        action: 'withdraw_usdc',
        enabled: Number(privateBalances.usdc) > 0,
        asset: 'USDC',
        availableAmount: privateBalances.usdc,
        sponsorship: Object.fromEntries(withdrawalSponsorship).USDC,
      },
      {
        action: 'withdraw_xlm',
        enabled: Number(privateBalances.xlm) > 0,
        asset: 'XLM',
        availableAmount: privateBalances.xlm,
        sponsorship: Object.fromEntries(withdrawalSponsorship).XLM,
      },
      {
        action: 'process_pending_withdrawals',
        enabled: pendingWithdrawals.length > 0,
        asset: null,
        availableAmount: String(pendingWithdrawals.length),
        sponsorship: {
          supported: false,
          sponsored: false,
          reason: pendingWithdrawals.length > 0
            ? 'Pending withdrawals will process with the existing proof queue.'
            : 'No pending withdrawals waiting for processing.',
        },
      },
    ];

    const privateShareUsdc = Number(balances.usdc) + Number(privateBalances.usdc) > 0
      ? Number(
          (
            (Number(privateBalances.usdc) / (Number(balances.usdc) + Number(privateBalances.usdc))) *
            100
          ).toFixed(1),
        )
      : 0;
    const privateShareXlm = Number(balances.xlm) + Number(privateBalances.xlm) > 0
      ? Number(
          (
            (Number(privateBalances.xlm) / (Number(balances.xlm) + Number(privateBalances.xlm))) *
            100
          ).toFixed(1),
        )
      : 0;

    return {
      user: {
        username: user.username,
        stellarPublicKey: user.stellarPublicKey,
        reputation: user.reputation,
      },
      balances: {
        public: balances,
        private: privateBalances,
        composition: {
          usdcPrivateShare: privateShareUsdc,
          xlmPrivateShare: privateShareXlm,
        },
      },
      pending: {
        count: pendingWithdrawals.length,
        byAsset: {
          usdc: totalPendingByAsset.usdc.toFixed(7).replace(/\.?0+$/, ''),
          xlm: totalPendingByAsset.xlm.toFixed(7).replace(/\.?0+$/, ''),
        },
        items: pendingWithdrawals.map((item: any) => ({
          id: item._id.toString(),
          asset: item.asset,
          amount: item.amount,
          processed: item.processed,
          txHash: item.txHash,
          createdAt: item.createdAt,
        })),
      },
      sponsorship: {
        withdrawSelf: Object.fromEntries(withdrawalSponsorship),
      },
      privateActions,
      recentHistory: recentHistory.slice(0, 8),
      workspaceGuidance: [
        Number(privateBalances.usdc) > 0 || Number(privateBalances.xlm) > 0
          ? 'Private balances are available. Withdraw only when you need public settlement or public spending.'
          : 'Your private balances are empty right now, so deposits or private transfers will be the next way to populate them.',
        pendingWithdrawals.length > 0
          ? `There are ${pendingWithdrawals.length} pending withdrawals still waiting on processing or retries.`
          : 'No pending withdrawals are queued right now.',
        Number(privateBalances.usdc) > Number(balances.usdc) || Number(privateBalances.xlm) > Number(balances.xlm)
          ? 'A larger share of your holdings currently sits in private notes than in the public wallet.'
          : 'Your public wallet currently carries at least as much visible balance as your private pool.',
      ],
    };
  }

  async getHistory(userId: string) {
    const objectId = new Types.ObjectId(userId);
    const [audits, encNotes, withdrawals, swaps] = await Promise.all([
      this.transactionAuditService.listRecentForUser(userId, 40),
      this.encryptedNoteModel.find({ recipientId: objectId }).sort({ createdAt: -1 }).limit(20).lean().exec(),
      this.pendingWithdrawalModel.find({ recipientId: objectId }).sort({ createdAt: -1 }).limit(20).lean().exec(),
      this.swapModel
        .find({ $or: [{ aliceId: objectId }, { bobId: objectId }] })
        .sort({ updatedAt: -1, createdAt: -1 })
        .limit(20)
        .populate('aliceId', 'username')
        .populate('bobId', 'username')
        .lean()
        .exec(),
    ]);

    const timeline: Array<{
      id: string;
      source: 'audit' | 'encrypted_note' | 'withdrawal' | 'swap';
      category: 'wallet' | 'private' | 'swap' | 'system';
      operation: string;
      title: string;
      detail: string;
      state: 'success' | 'pending' | 'failed' | 'retryable' | 'queued';
      asset?: string;
      amount?: string;
      amountDisplay: string;
      txHash?: string;
      sponsorship: {
        attempted: boolean;
        sponsored: boolean;
        detail?: string;
      };
      indexing?: {
        status?: string;
        detail?: string;
      };
      participants?: {
        role?: 'alice' | 'bob';
        counterparty?: string;
      };
      privateFlow: boolean;
      date: string | Date | undefined;
      statusLabel: string;
    }> = [];

    for (const audit of audits as any[]) {
      const metadata = (audit.metadata ?? {}) as Record<string, unknown>;
      const operation = String(audit.operation ?? 'activity');
      const swapId = typeof metadata.swapId === 'string' ? metadata.swapId : undefined;
      const swapMatch = swapId ? swaps.find((swap: any) => swap._id?.toString() === swapId) : undefined;
      const participantRole = swapMatch
        ? (swapMatch.aliceId as any)?.toString?.() === userId || (swapMatch.aliceId as any)?._id?.toString?.() === userId
          ? 'alice'
          : 'bob'
        : undefined;
      const counterparty =
        swapMatch && participantRole
          ? participantRole === 'alice'
            ? (swapMatch.bobId as any)?.username
            : (swapMatch.aliceId as any)?.username
          : undefined;

      timeline.push({
        id: `audit:${audit._id}`,
        source: 'audit',
        category: operation.startsWith('swap') ? 'swap' : operation.includes('private') || operation.includes('deposit') || operation.includes('withdraw') ? 'private' : 'wallet',
        operation,
        title: this.describeAuditTitle(operation),
        detail:
          audit.error ||
          audit.indexingDetail ||
          (operation.startsWith('swap')
            ? 'Tracked from the transaction audit stream so you can see proof, execution, and fallback state.'
            : 'Tracked from the transaction audit stream so you can see status, sponsorship, and indexing state.'),
        state: audit.state,
        asset: audit.asset,
        amount: audit.amount,
        amountDisplay: audit.amount || (operation.includes('private') ? 'Private amount' : 'Not available'),
        txHash: audit.txHash,
        sponsorship: {
          attempted: !!audit.sponsorshipAttempted,
          sponsored: !!audit.sponsored,
          detail: audit.sponsorshipDetail,
        },
        indexing: {
          status: audit.indexingStatus,
          detail: audit.indexingDetail,
        },
        participants: {
          role: participantRole,
          counterparty,
        },
        privateFlow:
          operation.includes('private') ||
          operation.includes('deposit') ||
          operation.includes('withdraw') ||
          operation.includes('swap'),
        date: audit.updatedAt ?? audit.createdAt,
        statusLabel: this.describeAuditState(audit.state),
      });
    }

    for (const note of encNotes as any[]) {
      timeline.push({
        id: `note:${note._id}`,
        source: 'encrypted_note',
        category: 'private',
        operation: note.txHash === 'pending' ? 'pending_private_transfer' : 'encrypted_note_credit',
        title: note.txHash === 'pending' ? 'Pending private transfer received' : 'Private balance note received',
        detail:
          note.txHash === 'pending'
            ? 'A private note was created for you, but the matching withdrawal or indexer confirmation has not completed yet.'
            : 'A private note reached your account history. This usually corresponds to a deposit, private transfer, or private swap output.',
        state: note.txHash === 'pending' ? 'pending' : 'success',
        asset: note.asset,
        amountDisplay: 'Encrypted amount',
        txHash: note.txHash === 'pending' ? undefined : note.txHash,
        sponsorship: {
          attempted: false,
          sponsored: false,
        },
        indexing: {
          status: note.txHash === 'pending' ? 'pending' : 'tracked',
          detail:
            note.txHash === 'pending'
              ? 'The private note exists locally but is still waiting on the rest of the transfer flow.'
              : 'The note is already attached to a confirmed transaction hash.',
        },
        privateFlow: true,
        date: note.createdAt,
        statusLabel: note.txHash === 'pending' ? 'Waiting on chain follow-up' : 'Private note stored',
      });
    }

    for (const withdrawal of withdrawals as any[]) {
      timeline.push({
        id: `withdrawal:${withdrawal._id}`,
        source: 'withdrawal',
        category: 'private',
        operation: 'pending_withdrawal',
        title: withdrawal.processed ? 'Private withdrawal completed' : 'Private withdrawal queued',
        detail: withdrawal.processed
          ? 'The withdrawal proof has already been processed into a public-balance transaction.'
          : 'This withdrawal is still waiting to be processed or retried into a public-balance transaction.',
        state: withdrawal.processed ? 'success' : 'pending',
        asset: withdrawal.asset,
        amount: withdrawal.amount,
        amountDisplay: withdrawal.amount,
        txHash: withdrawal.txHash,
        sponsorship: {
          attempted: false,
          sponsored: false,
        },
        indexing: {
          status: withdrawal.processed ? 'tracked' : 'pending',
          detail: withdrawal.processed
            ? 'The public balance should reflect this withdrawal after normal chain confirmation.'
            : 'The withdrawal is waiting for processing or a successful retry.',
        },
        privateFlow: true,
        date: withdrawal.createdAt,
        statusLabel: withdrawal.processed ? 'Withdrawal confirmed' : 'Queued for processing',
      });
    }

    const knownSwapIds = new Set(
      timeline
        .filter((entry) => entry.source === 'audit')
        .map((entry) => {
          const candidate = entry.id.startsWith('audit:') ? entry.id : '';
          return candidate;
        }),
    );

    for (const swap of swaps as any[]) {
      const swapId = swap._id?.toString?.() ?? String(swap._id);
      const role =
        swap.aliceId?.toString?.() === userId || swap.aliceId?._id?.toString?.() === userId ? 'alice' : 'bob';
      const counterparty = role === 'alice' ? swap.bobId?.username : swap.aliceId?.username;
      const hasAudit = audits.some((audit: any) => String(audit.metadata?.swapId ?? '') === swapId);
      if (hasAudit || knownSwapIds.has(`swap:${swapId}`)) {
        continue;
      }

      timeline.push({
        id: `swap:${swapId}`,
        source: 'swap',
        category: 'swap',
        operation: 'swap_lifecycle',
        title: role === 'alice' ? 'Swap requested or updated' : 'Swap sale updated',
        detail: `Swap state is ${swap.status}. Proof state is ${swap.proofStatus}, and execution state is ${swap.executionStatus}.`,
        state:
          swap.status === 'completed'
            ? 'success'
            : swap.status === 'failed'
              ? 'failed'
              : swap.status === 'requested' || swap.status === 'executing'
                ? 'pending'
                : 'queued',
        amountDisplay: `${swap.amountIn} XLM / ${swap.amountOut} USDC`,
        txHash: swap.txHash,
        sponsorship: {
          attempted: false,
          sponsored: false,
        },
        indexing: {
          status: swap.status === 'completed' ? 'tracked' : 'pending',
          detail:
            swap.status === 'completed'
              ? 'Swap execution completed and now contributes to account history.'
              : 'Swap has started but still depends on acceptance, proof collection, or execution.',
        },
        participants: {
          role,
          counterparty,
        },
        privateFlow: swap.proofStatus === 'ready' || swap.status === 'proofs_pending' || swap.status === 'proofs_ready' || swap.status === 'executing',
        date: swap.updatedAt ?? swap.createdAt,
        statusLabel: this.describeSwapState(swap.status, swap.executionStatus),
      });
    }

    return timeline
      .sort((left, right) => new Date(right.date ?? 0).getTime() - new Date(left.date ?? 0).getTime())
      .slice(0, 60);
  }

  async getHistoryWorkspace(userId: string) {
    const user = await this.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    const [timeline, walletWorkspace] = await Promise.all([
      this.getHistory(userId),
      this.getWalletWorkspace(userId),
    ]);

    const latestEntries = timeline.slice(0, 12);
    const completed = timeline.filter((item) => item.state === 'success');
    const pending = timeline.filter((item) => item.state === 'pending' || item.state === 'queued');
    const failed = timeline.filter((item) => item.state === 'failed' || item.state === 'retryable');
    const privateEntries = timeline.filter((item) => item.privateFlow);
    const sponsored = timeline.filter((item) => item.sponsorship?.sponsored);

    const categoryBreakdown = ['wallet', 'private', 'swap', 'system'].map((category) => {
      const entries = timeline.filter((item) => item.category === category);
      return {
        category,
        count: entries.length,
        completed: entries.filter((item) => item.state === 'success').length,
        pending: entries.filter((item) => item.state === 'pending' || item.state === 'queued').length,
        failed: entries.filter((item) => item.state === 'failed' || item.state === 'retryable').length,
        latestAt: entries[0]?.date,
      };
    });

    const failureBucketsMap = new Map<
      string,
      {
        key: string;
        label: string;
        count: number;
        entries: typeof latestEntries;
      }
    >();

    for (const entry of failed) {
      const key = this.classifyHistoryFailure(entry);
      const label = this.describeFailureBucket(key);
      if (!failureBucketsMap.has(key)) {
        failureBucketsMap.set(key, {
          key,
          label,
          count: 0,
          entries: [],
        });
      }
      const bucket = failureBucketsMap.get(key)!;
      bucket.count += 1;
      bucket.entries.push(entry as any);
    }

    const counterpartiesMap = new Map<
      string,
      {
        counterparty: string;
        interactions: number;
        privateFlows: number;
        swapFlows: number;
        latestAt?: string | Date;
      }
    >();

    for (const entry of timeline) {
      const counterparty = entry.participants?.counterparty;
      if (!counterparty) {
        continue;
      }
      const existing = counterpartiesMap.get(counterparty) ?? {
        counterparty,
        interactions: 0,
        privateFlows: 0,
        swapFlows: 0,
        latestAt: entry.date,
      };
      existing.interactions += 1;
      existing.privateFlows += entry.privateFlow ? 1 : 0;
      existing.swapFlows += entry.category === 'swap' ? 1 : 0;
      const currentLatest = existing.latestAt ? new Date(existing.latestAt).getTime() : 0;
      const candidateLatest = entry.date ? new Date(entry.date).getTime() : 0;
      existing.latestAt = currentLatest > candidateLatest ? existing.latestAt : entry.date;
      counterpartiesMap.set(counterparty, existing);
    }

    const actionQueue = [
      pending.find((item) => item.operation === 'pending_withdrawal'),
      pending.find((item) => item.operation === 'swap_lifecycle' || item.operation.startsWith('swap_')),
      failed.find((item) => item.state === 'retryable'),
      pending.find((item) => item.indexing?.status === 'pending' || item.indexing?.status === 'lagging'),
      !walletWorkspace.balances.private.usdc && !walletWorkspace.balances.private.xlm
        ? {
            id: 'synthetic:first_private_deposit',
            source: 'audit',
            category: 'private',
            operation: 'first_private_deposit',
            title: 'Seed the first private balance',
            detail: 'No private balance activity is present yet, so the first deposit will unlock the full shielded history trail.',
            state: 'queued',
            amountDisplay: 'Not started',
            sponsorship: { attempted: false, sponsored: false },
            privateFlow: true,
            date: new Date().toISOString(),
            statusLabel: 'Suggested next action',
          } as any
        : undefined,
    ]
      .filter(Boolean)
      .slice(0, 4)
      .map((item: any) => ({
        id: item.id,
        operation: item.operation,
        title: item.title,
        detail: item.detail,
        state: item.state,
        category: item.category,
      }));

    const velocity = this.computeHistoryVelocity(timeline);

    return {
      user: {
        username: user.username,
        stellarPublicKey: user.stellarPublicKey,
        reputation: user.reputation,
      },
      summary: {
        total: timeline.length,
        completed: completed.length,
        pending: pending.length,
        failed: failed.length,
        privateFlows: privateEntries.length,
        sponsored: sponsored.length,
      },
      velocity,
      categoryBreakdown,
      failureBuckets: Array.from(failureBucketsMap.values())
        .sort((left, right) => right.count - left.count)
        .map((bucket) => ({
          key: bucket.key,
          label: bucket.label,
          count: bucket.count,
          latestEntry: bucket.entries[0]
            ? {
                id: bucket.entries[0].id,
                title: bucket.entries[0].title,
                detail: bucket.entries[0].detail,
                date: bucket.entries[0].date,
              }
            : undefined,
        })),
      counterparties: Array.from(counterpartiesMap.values())
        .sort((left, right) => right.interactions - left.interactions)
        .slice(0, 6),
      actionQueue,
      walletSignals: {
        pendingWithdrawals: walletWorkspace.pending.count,
        privateUsdc: walletWorkspace.balances.private.usdc,
        privateXlm: walletWorkspace.balances.private.xlm,
        publicUsdc: walletWorkspace.balances.public.usdc,
        publicXlm: walletWorkspace.balances.public.xlm,
      },
      latestEntries,
      timeline,
    };
  }

  async getActionCenterWorkspace(userId: string) {
    const [user, walletWorkspace, historyWorkspace, authWorkspace, readiness, recentSwaps, audits] = await Promise.all([
      this.findById(userId),
      this.getWalletWorkspace(userId),
      this.getHistoryWorkspace(userId),
      this.authService.getAuthWorkspace(userId),
      this.opsService.getReadiness(),
      this.swapModel
        .find({ $or: [{ aliceId: new Types.ObjectId(userId) }, { bobId: new Types.ObjectId(userId) }] })
        .populate('aliceId', 'username')
        .populate('bobId', 'username')
        .sort({ updatedAt: -1, createdAt: -1 })
        .limit(24)
        .lean()
        .exec(),
      this.transactionAuditService.listRecentForUser(userId, 24),
    ]);

    if (!user) {
      throw new Error('User not found');
    }

    const priorities: Array<{
      id: string;
      severity: 'critical' | 'caution' | 'info';
      lane: 'wallet' | 'private' | 'market' | 'ops' | 'history';
      label: string;
      detail: string;
      href: string;
      cta: string;
      status: string;
    }> = [];

    if (!authWorkspace.wallet.public.hasXlm) {
      priorities.push({
        id: 'fund-xlm',
        severity: 'critical',
        lane: 'wallet',
        label: 'Fund visible XLM before doing anything else',
        detail:
          'The public wallet still has no XLM, which means trustline setup, public sends, deposits, and recovery actions all stay fee-blocked.',
        href: '/wallet/fund',
        cta: 'Open funding desk',
        status: 'missing_xlm',
      });
    }

    if (!authWorkspace.wallet.public.hasUsdcTrustline) {
      priorities.push({
        id: 'trustline',
        severity: authWorkspace.wallet.public.hasXlm ? 'caution' : 'info',
        lane: 'wallet',
        label: 'Enable the USDC trustline',
        detail:
          'Stablecoin routes remain fragile until the public wallet can actually hold USDC. This is the main setup step after XLM funding.',
        href: '/wallet/fund',
        cta: 'Prepare trustline',
        status: 'missing_trustline',
      });
    }

    if (!authWorkspace.wallet.private.hasShieldedBalance) {
      priorities.push({
        id: 'private-seed',
        severity: authWorkspace.wallet.public.hasXlm || authWorkspace.wallet.public.hasUsdcTrustline ? 'caution' : 'info',
        lane: 'private',
        label: 'Seed the first private balance',
        detail:
          'Private sends, note splitting, and shielded swap execution all feel blocked until at least one deposit has created a real shielded note.',
        href: '/wallet/fund',
        cta: 'Plan first deposit',
        status: 'private_unseeded',
      });
    }

    if (walletWorkspace.pending.count > 0) {
      priorities.push({
        id: 'pending-withdrawals',
        severity: walletWorkspace.pending.count >= 3 ? 'critical' : 'caution',
        lane: 'private',
        label: 'Clear the pending withdrawal queue',
        detail: `${walletWorkspace.pending.count} withdrawal items are still waiting to be surfaced publicly, which makes balances and history feel stale.`,
        href: '/wallet',
        cta: 'Process queue',
        status: 'pending_withdrawals',
      });
    }

    if (readiness.status !== 'ready') {
      priorities.push({
        id: 'ops-lag',
        severity: readiness.lagging.length > 1 ? 'critical' : 'caution',
        lane: 'ops',
        label: 'Operational lag is affecting freshness',
        detail:
          readiness.lagging.length > 0
            ? `${readiness.lagging.length} tracked pool lanes are degraded, so note visibility, audit freshness, or private readiness can take longer than expected.`
            : 'The readiness surface is degraded even though no lagging lane summary was returned.',
        href: '/status',
        cta: 'Inspect status',
        status: 'ops_degraded',
      });
    }

    const topFailureBucket = historyWorkspace.failureBuckets[0];
    if (topFailureBucket?.count) {
      priorities.push({
        id: `failure-${topFailureBucket.key}`,
        severity: topFailureBucket.count >= 3 ? 'critical' : 'caution',
        lane: 'history',
        label: 'Review repeated blockers in recent history',
        detail: `${topFailureBucket.label} has appeared ${topFailureBucket.count} time(s), so it is now one of the main sources of friction in the current session history.`,
        href: '/history',
        cta: 'Open history desk',
        status: topFailureBucket.key,
      });
    }

    const swapSummaries = recentSwaps.map((swap: any) => {
      const participantRole =
        String(swap.aliceId?._id ?? swap.aliceId) === userId
          ? 'alice'
          : String(swap.bobId?._id ?? swap.bobId) === userId
            ? 'bob'
            : 'observer';
      const counterparty =
        participantRole === 'alice'
          ? swap.bobId?.username
          : participantRole === 'bob'
            ? swap.aliceId?.username
            : undefined;

      let action: string;
      let urgency: 'critical' | 'caution' | 'info';
      let detail: string;
      let href = `/swap/${swap._id}`;

      if (swap.status === 'requested' && participantRole === 'bob') {
        action = 'Accept buyer request';
        urgency = 'caution';
        detail = 'A buyer has already requested this swap and it still needs seller acceptance before any proof or settlement work can begin.';
      } else if (swap.status === 'proofs_pending' && swap.proofStatus === 'awaiting_bob' && participantRole === 'bob') {
        action = 'Prepare seller proof';
        urgency = 'critical';
        detail = 'The buyer side is already waiting on the seller proof, so this private swap cannot progress until an exact-value note is prepared.';
      } else if (swap.status === 'proofs_pending' && swap.proofStatus === 'awaiting_alice' && participantRole === 'alice') {
        action = 'Prepare buyer proof';
        urgency = 'critical';
        detail = 'The seller side is already waiting on the buyer proof, so this private swap still needs the initiating side to finish note preparation.';
      } else if (swap.status === 'proofs_ready') {
        action = 'Execute private swap';
        urgency = 'critical';
        detail = 'Both proofs are ready, so this swap is now blocked on someone actually finalizing private execution.';
      } else if (swap.status === 'executing') {
        action = 'Watch active execution';
        urgency = 'info';
        detail = 'This swap is already in execution, so the right next step is status monitoring rather than another user action.';
      } else if (swap.status === 'failed') {
        action = 'Review failed swap';
        urgency = 'critical';
        detail = swap.lastError || 'A recent swap failed and should be reviewed before more market flow is accepted.';
      } else {
        action = 'Inspect swap lifecycle';
        urgency = 'info';
        detail = 'This swap has meaningful lifecycle signal, but no immediate intervention is required.';
      }

      return {
        id: String(swap._id),
        participantRole,
        counterparty,
        status: swap.status,
        proofStatus: swap.proofStatus,
        executionStatus: swap.executionStatus,
        amountIn: Number(swap.amountIn) || 0,
        amountOut: Number(swap.amountOut) || 0,
        action,
        urgency,
        detail,
        href,
        updatedAt: swap.updatedAt ? new Date(swap.updatedAt).toISOString() : undefined,
      };
    });

    const urgentSwapItems = swapSummaries.filter((swap) => swap.urgency !== 'info').slice(0, 3);
    for (const swap of urgentSwapItems) {
      priorities.push({
        id: `swap-${swap.id}`,
        severity: swap.urgency,
        lane: 'market',
        label: swap.action,
        detail: swap.detail,
        href: swap.href,
        cta: 'Open swap',
        status: swap.status,
      });
    }

    const orderedPriorities = priorities.sort((left, right) => {
      const severityRank = { critical: 0, caution: 1, info: 2 };
      return severityRank[left.severity] - severityRank[right.severity];
    });

    const quickWins = [
      !authWorkspace.wallet.public.hasXlm ? 'Use Friendbot to fund visible XLM before trying trustlines or deposits.' : undefined,
      !authWorkspace.wallet.public.hasUsdcTrustline && authWorkspace.wallet.public.hasXlm
        ? 'Add the USDC trustline so stablecoin funding and swap routes stop failing at the wallet layer.'
        : undefined,
      walletWorkspace.pending.count > 0 ? 'Process queued withdrawals to get delayed private funds back into visible balances.' : undefined,
      !authWorkspace.wallet.private.hasShieldedBalance && (authWorkspace.wallet.public.hasXlm || authWorkspace.wallet.public.hasUsdcTrustline)
        ? 'Make the first deposit into the shielded pool so private send and private swap routes become realistic.'
        : undefined,
      topFailureBucket ? `Review ${topFailureBucket.label.toLowerCase()} in history before repeating the same action path.` : undefined,
      readiness.status !== 'ready' ? 'Check status before assuming a balance or note issue is your fault instead of an indexing delay.' : undefined,
    ].filter(Boolean);

    const routeCards = [
      {
        id: 'funding',
        label: 'Funding desk',
        href: '/wallet/fund',
        readiness: !authWorkspace.wallet.public.hasXlm ? 'critical' : !authWorkspace.wallet.public.hasUsdcTrustline ? 'caution' : 'ready',
        detail: 'Handle faucet funding, trustline preparation, and the first private-balance seeding plan.',
      },
      {
        id: 'wallet',
        label: 'Wallet workspace',
        href: '/wallet',
        readiness: walletWorkspace.pending.count > 0 ? 'caution' : 'ready',
        detail: 'Process pending withdrawals, inspect sponsorship, and manage public/private balances directly.',
      },
      {
        id: 'send',
        label: 'Send planner',
        href: '/wallet/send',
        readiness: authWorkspace.wallet.public.hasXlm || authWorkspace.wallet.private.hasShieldedBalance ? 'ready' : 'caution',
        detail: 'Preflight public or private transfers with route guidance instead of trial-and-error submissions.',
      },
      {
        id: 'swap',
        label: 'Swap desk',
        href: '/swap/my',
        readiness: urgentSwapItems.length > 0 ? 'critical' : swapSummaries.length > 0 ? 'caution' : 'info',
        detail: 'Handle requests, proofs, private execution, and failed market flows that are still waiting on action.',
      },
      {
        id: 'history',
        label: 'History desk',
        href: '/history',
        readiness: historyWorkspace.summary.failed > 0 ? 'caution' : 'ready',
        detail: 'Use the timeline and failure buckets when the same issue is starting to repeat across recent actions.',
      },
      {
        id: 'status',
        label: 'Status workspace',
        href: '/status',
        readiness: readiness.status === 'ready' ? 'ready' : 'critical',
        detail: 'Inspect lagging pools and operational freshness before blaming the wallet or market layer.',
      },
      {
        id: 'account',
        label: 'Account center',
        href: '/account',
        readiness: 'info',
        detail: 'Review identity, session state, and guarded account controls without leaving the workspace flow.',
      },
    ];

    const blockerFeed = [
      ...historyWorkspace.actionQueue.map((item: any) => ({
        id: item.id,
        title: item.title,
        detail: item.detail,
        lane: item.category,
        state: item.state,
        href:
          item.category === 'swap'
            ? '/swap/my'
            : item.category === 'private'
              ? '/wallet'
              : '/history',
      })),
      ...swapSummaries
        .filter((swap) => swap.urgency !== 'info')
        .slice(0, 4)
        .map((swap) => ({
          id: `swap-blocker-${swap.id}`,
          title: swap.action,
          detail: swap.detail,
          lane: 'market',
          state: swap.status,
          href: swap.href,
        })),
      ...audits
        .filter((audit: any) => audit.state === 'failed' || audit.state === 'retryable')
        .slice(0, 4)
        .map((audit: any) => ({
          id: `audit-${audit._id}`,
          title: this.describeAuditTitle(String(audit.operation ?? 'activity')),
          detail: audit.error || audit.indexingDetail || 'This audit record still needs follow-up.',
          lane: String(audit.operation ?? '').startsWith('swap') ? 'market' : 'history',
          state: audit.state,
          href: String(audit.operation ?? '').startsWith('swap') ? '/swap/my' : '/history',
        })),
    ].slice(0, 12);

    const marketSummary = {
      total: swapSummaries.length,
      requested: swapSummaries.filter((swap) => swap.status === 'requested').length,
      proofsPending: swapSummaries.filter((swap) => swap.status === 'proofs_pending').length,
      proofsReady: swapSummaries.filter((swap) => swap.status === 'proofs_ready').length,
      executing: swapSummaries.filter((swap) => swap.status === 'executing').length,
      failed: swapSummaries.filter((swap) => swap.status === 'failed').length,
      completed: swapSummaries.filter((swap) => swap.status === 'completed').length,
    };

    return {
      user: {
        username: user.username,
        stellarPublicKey: user.stellarPublicKey,
        reputation: user.reputation,
      },
      summary: {
        totalPriorities: orderedPriorities.length,
        critical: orderedPriorities.filter((item) => item.severity === 'critical').length,
        caution: orderedPriorities.filter((item) => item.severity === 'caution').length,
        quickWins: quickWins.length,
      },
      lanes: {
        wallet: {
          publicXlm: walletWorkspace.balances.public.xlm,
          publicUsdc: walletWorkspace.balances.public.usdc,
          privateXlm: walletWorkspace.balances.private.xlm,
          privateUsdc: walletWorkspace.balances.private.usdc,
          pendingWithdrawals: walletWorkspace.pending.count,
          hasUsdcTrustline: authWorkspace.wallet.public.hasUsdcTrustline,
          hasPrivateBalance: authWorkspace.wallet.private.hasShieldedBalance,
        },
        activity: {
          total: historyWorkspace.summary.total,
          pending: historyWorkspace.summary.pending,
          failed: historyWorkspace.summary.failed,
          privateFlows: historyWorkspace.summary.privateFlows,
          sponsored: historyWorkspace.summary.sponsored,
          momentum: historyWorkspace.velocity.momentum,
        },
        market: marketSummary,
        ops: {
          status: readiness.status,
          trackedPools: readiness.counts.trackedPools,
          laggingPools: readiness.lagging.length,
          laggingPoolAddresses: readiness.lagging.map((item: any) => item.poolAddress),
        },
      },
      priorities: orderedPriorities.slice(0, 8),
      quickWins,
      routeCards,
      swapQueue: swapSummaries.slice(0, 10),
      blockerFeed,
      latestTitles: historyWorkspace.latestEntries.slice(0, 6).map((entry: any) => entry.title),
      updatedAt: new Date().toISOString(),
    };
  }

  async getContactsWorkspace(userId: string) {
    const [user, historyWorkspace, sendWorkspace, walletWorkspace, authWorkspace] = await Promise.all([
      this.findById(userId),
      this.getHistoryWorkspace(userId),
      this.getSendWorkspace(userId),
      this.getWalletWorkspace(userId),
      this.authService.getAuthWorkspace(userId),
    ]);

    if (!user) {
      throw new Error('User not found');
    }

    const counterpartiesMap = new Map<
      string,
      {
        counterparty: string;
        interactions: number;
        privateFlows: number;
        swapFlows: number;
        latestAt?: string | Date;
        latestTitle?: string;
        categories: Set<string>;
        pendingTouches: number;
        failedTouches: number;
        sponsoredTouches: number;
      }
    >();

    for (const entry of historyWorkspace.timeline as any[]) {
      const counterparty = entry.participants?.counterparty;
      if (!counterparty) {
        continue;
      }
      const existing = counterpartiesMap.get(counterparty) ?? {
        counterparty,
        interactions: 0,
        privateFlows: 0,
        swapFlows: 0,
        latestAt: entry.date,
        latestTitle: entry.title,
        categories: new Set<string>(),
        pendingTouches: 0,
        failedTouches: 0,
        sponsoredTouches: 0,
      };
      existing.interactions += 1;
      existing.privateFlows += entry.privateFlow ? 1 : 0;
      existing.swapFlows += entry.category === 'swap' ? 1 : 0;
      existing.categories.add(entry.category);
      existing.pendingTouches += entry.state === 'pending' || entry.state === 'queued' ? 1 : 0;
      existing.failedTouches += entry.state === 'failed' || entry.state === 'retryable' ? 1 : 0;
      existing.sponsoredTouches += entry.sponsorship?.sponsored ? 1 : 0;
      const currentLatest = existing.latestAt ? new Date(existing.latestAt).getTime() : 0;
      const candidateLatest = entry.date ? new Date(entry.date).getTime() : 0;
      if (candidateLatest >= currentLatest) {
        existing.latestAt = entry.date;
        existing.latestTitle = entry.title;
      }
      counterpartiesMap.set(counterparty, existing);
    }

    const contactCards = await Promise.all(
      Array.from(counterpartiesMap.values())
        .sort((left, right) => right.interactions - left.interactions)
        .slice(0, 18)
        .map(async (contact) => {
          const userRecord = await this.findByUsername(contact.counterparty);
          const publicKey = userRecord?.stellarPublicKey;
          const preferredAsset =
            contact.privateFlows >= contact.swapFlows && Number(walletWorkspace.balances.private.usdc || 0) > 0
              ? 'USDC'
              : Number(walletWorkspace.balances.public.xlm || 0) > 0
                ? 'XLM'
                : 'USDC';
          const preview = await this.previewSend(userId, {
            recipient: publicKey ?? contact.counterparty,
            asset: preferredAsset as WalletAsset,
            amount: 1,
          }).catch(() => null);

          const trustScore = Math.max(
            5,
            Math.min(
              99,
              Math.round(
                contact.interactions * 8 +
                  contact.privateFlows * 6 +
                  contact.swapFlows * 7 -
                  contact.failedTouches * 10 -
                  contact.pendingTouches * 4 +
                  contact.sponsoredTouches * 3,
              ),
            ),
          );

          const recommendedRoute =
            preview?.recommendedMode ??
            (contact.privateFlows > contact.interactions / 2 && authWorkspace.wallet.private.hasShieldedBalance
              ? 'private'
              : 'public');

          const routeReadiness =
            recommendedRoute === 'private'
              ? preview?.routes?.private?.ready
                ? 'ready'
                : preview?.routes?.private?.available
                  ? 'attention'
                  : 'blocked'
              : preview?.routes?.public?.ready
                ? 'ready'
                : preview?.routes?.public?.available
                  ? 'attention'
                  : 'blocked';

          const notes = [
            contact.privateFlows > 0
              ? `${contact.privateFlows} prior private interaction(s) make shielded routing less surprising with this counterparty.`
              : 'No private interactions are on record with this counterparty yet.',
            contact.swapFlows > 0
              ? `${contact.swapFlows} swap interaction(s) already exist, which gives this relationship richer market history than a plain send-only contact.`
              : 'This relationship is mostly wallet-flow activity rather than market activity.',
            contact.failedTouches > 0
              ? `${contact.failedTouches} failure or retry touch(es) are in the history, so be careful repeating the same route blindly.`
              : 'No failure-heavy pattern is visible in the tracked relationship history.',
          ];

          return {
            counterparty: contact.counterparty,
            username: userRecord?.username ?? contact.counterparty,
            reputation: userRecord?.reputation ?? null,
            stellarPublicKey: publicKey,
            interactions: contact.interactions,
            privateFlows: contact.privateFlows,
            swapFlows: contact.swapFlows,
            pendingTouches: contact.pendingTouches,
            failedTouches: contact.failedTouches,
            sponsoredTouches: contact.sponsoredTouches,
            trustScore,
            preferredAsset,
            recommendedRoute,
            routeReadiness,
            categories: Array.from(contact.categories.values()),
            latestAt: contact.latestAt,
            latestTitle: contact.latestTitle,
            notes,
            routeSummary: preview
              ? {
                  public: preview.routes.public.summary,
                  private: preview.routes.private.summary,
                }
              : {
                  public: 'Public route summary is not available yet for this contact.',
                  private: 'Private route summary is not available yet for this contact.',
                },
          };
        }),
    );

    const routeBreakdown = {
      publicPreferred: contactCards.filter((contact) => contact.recommendedRoute === 'public').length,
      privatePreferred: contactCards.filter((contact) => contact.recommendedRoute === 'private').length,
      blocked: contactCards.filter((contact) => contact.routeReadiness === 'blocked').length,
      attention: contactCards.filter((contact) => contact.routeReadiness === 'attention').length,
    };

    const actionBoard = [
      !authWorkspace.wallet.public.hasXlm
        ? {
            id: 'contacts-fund-xlm',
            severity: 'critical',
            title: 'Fund visible XLM before using contacts as a send list',
            detail: 'Most contact relationships will still fail on public sends or route planning until the visible wallet can pay fees.',
            href: '/wallet/fund',
          }
        : undefined,
      !authWorkspace.wallet.private.hasShieldedBalance
        ? {
            id: 'contacts-seed-private',
            severity: 'warning',
            title: 'Seed a private balance before leaning on shielded contacts',
            detail: 'Several counterparties are good candidates for private routing, but the wallet still needs an actual private balance first.',
            href: '/wallet/fund',
          }
        : undefined,
      routeBreakdown.blocked > 0
        ? {
            id: 'contacts-unblock-routes',
            severity: 'warning',
            title: 'Unblock counterparties with route issues',
            detail: `${routeBreakdown.blocked} contact route(s) still look blocked by funding, trustline, or private-balance gaps.`,
            href: '/actions',
          }
        : undefined,
      historyWorkspace.failureBuckets[0]
        ? {
            id: 'contacts-review-failures',
            severity: 'info',
            title: 'Review relationship-heavy failure patterns',
            detail: `${historyWorkspace.failureBuckets[0].label} is still the top recent blocker category, so it may affect repeat sends to familiar counterparties too.`,
            href: '/history',
          }
        : undefined,
    ].filter(Boolean);

    const highlights = [
      contactCards[0]
        ? `@${contactCards[0].username} is currently your most active counterparty with ${contactCards[0].interactions} tracked touches.`
        : 'No counterparties are established yet.',
      routeBreakdown.privatePreferred > 0
        ? `${routeBreakdown.privatePreferred} contact(s) look better suited to private routing than public sends right now.`
        : 'No contact currently has a strong private-route bias.',
      routeBreakdown.blocked > 0
        ? `${routeBreakdown.blocked} contact route(s) still look blocked and should not be treated as ready send paths yet.`
        : 'The current contact set does not show hard route blockers.',
      walletWorkspace.pending.count > 0
        ? `Pending withdrawals are still present, so some relationship balances may feel fresher after queue processing.`
        : 'No pending withdrawal backlog is currently distorting relationship freshness.',
    ];

    return {
      user: {
        username: user.username,
        stellarPublicKey: user.stellarPublicKey,
        reputation: user.reputation,
      },
      summary: {
        contacts: contactCards.length,
        privatePreferred: routeBreakdown.privatePreferred,
        publicPreferred: routeBreakdown.publicPreferred,
        blocked: routeBreakdown.blocked,
        attention: routeBreakdown.attention,
      },
      routeBreakdown,
      highlights,
      actionBoard,
      contacts: contactCards,
      recentCounterparties: sendWorkspace.recentCounterparties,
      updatedAt: new Date().toISOString(),
    };
  }

  async getPortfolioWorkspace(userId: string) {
    const [user, walletWorkspace, historyWorkspace, actionWorkspace, contactsWorkspace, authWorkspace] = await Promise.all([
      this.findById(userId),
      this.getWalletWorkspace(userId),
      this.getHistoryWorkspace(userId),
      this.getActionCenterWorkspace(userId),
      this.getContactsWorkspace(userId),
      this.authService.getAuthWorkspace(userId),
    ]);

    if (!user) {
      throw new Error('User not found');
    }

    const publicUsdc = Number(walletWorkspace.balances.public.usdc || 0);
    const publicXlm = Number(walletWorkspace.balances.public.xlm || 0);
    const privateUsdc = Number(walletWorkspace.balances.private.usdc || 0);
    const privateXlm = Number(walletWorkspace.balances.private.xlm || 0);

    const totalUsdc = publicUsdc + privateUsdc;
    const totalXlm = publicXlm + privateXlm;
    const totalExposure = totalUsdc + totalXlm;
    const privateExposure = privateUsdc + privateXlm;
    const publicExposure = publicUsdc + publicXlm;

    const allocation = [
      {
        id: 'public_usdc',
        label: 'Public USDC',
        amount: Number(totalUsdc ? publicUsdc.toFixed(4) : publicUsdc.toFixed(4)),
        share: totalExposure > 0 ? Number(((publicUsdc / totalExposure) * 100).toFixed(1)) : 0,
        lane: 'public',
        asset: 'USDC',
      },
      {
        id: 'private_usdc',
        label: 'Private USDC',
        amount: Number(privateUsdc.toFixed(4)),
        share: totalExposure > 0 ? Number(((privateUsdc / totalExposure) * 100).toFixed(1)) : 0,
        lane: 'private',
        asset: 'USDC',
      },
      {
        id: 'public_xlm',
        label: 'Public XLM',
        amount: Number(publicXlm.toFixed(4)),
        share: totalExposure > 0 ? Number(((publicXlm / totalExposure) * 100).toFixed(1)) : 0,
        lane: 'public',
        asset: 'XLM',
      },
      {
        id: 'private_xlm',
        label: 'Private XLM',
        amount: Number(privateXlm.toFixed(4)),
        share: totalExposure > 0 ? Number(((privateXlm / totalExposure) * 100).toFixed(1)) : 0,
        lane: 'private',
        asset: 'XLM',
      },
    ];

    const categoryCounts = historyWorkspace.categoryBreakdown.reduce<Record<string, number>>((acc, item: any) => {
      acc[item.category] = item.count;
      return acc;
    }, {});

    const momentumScore = Math.max(
      5,
      Math.min(
        99,
        Math.round(
          historyWorkspace.velocity.last24h.total * 6 +
            historyWorkspace.velocity.last7d.dailyAverage * 8 +
            historyWorkspace.summary.sponsored * 3 -
            historyWorkspace.summary.failed * 4,
        ),
      ),
    );

    const routeRisk = [
      {
        id: 'public_send',
        label: 'Public send readiness',
        tone: publicXlm > 0 || publicUsdc > 0 ? 'ready' : 'blocked',
        detail:
          publicXlm > 0 || publicUsdc > 0
            ? 'Visible balance exists, so public routing can be attempted without first creating a private note.'
            : 'Public routing is still fragile because the visible wallet lacks enough liquidity to act as a dependable source.',
      },
      {
        id: 'private_send',
        label: 'Private send readiness',
        tone: privateExposure > 0 ? 'ready' : publicExposure > 0 ? 'attention' : 'blocked',
        detail:
          privateExposure > 0
            ? 'Shielded balances already exist, so private route preparation is materially easier.'
            : publicExposure > 0
              ? 'A private route is reachable, but only after a first deposit or note-shaping step.'
              : 'Private routing is still blocked by missing visible liquidity and no shielded seed balance.',
      },
      {
        id: 'market_readiness',
        label: 'Swap and market posture',
        tone:
          actionWorkspace.lanes.market.proofsReady > 0 || actionWorkspace.lanes.market.requested > 0
            ? 'attention'
            : actionWorkspace.lanes.market.total > 0
              ? 'ready'
              : 'info',
        detail:
          actionWorkspace.lanes.market.total > 0
            ? 'Market history exists, but some swaps may still be waiting on proofs or seller-side execution.'
            : 'No meaningful market flow is in the portfolio yet, so risk comes more from setup than from live swap backlog.',
      },
      {
        id: 'ops_freshness',
        label: 'Operational freshness',
        tone: actionWorkspace.lanes.ops.status === 'ready' ? 'ready' : 'attention',
        detail:
          actionWorkspace.lanes.ops.status === 'ready'
            ? 'Indexer freshness is currently healthy enough that portfolio surfaces should feel current.'
            : 'Lagging pool lanes can distort how fresh balances, history, and note visibility feel inside the portfolio.',
      },
    ];

    const rebalanceIdeas = [
      publicExposure === 0
        ? 'Add visible liquidity first so the portfolio can support direct sends, trustlines, and safer recovery actions.'
        : undefined,
      privateExposure === 0 && publicExposure > 0
        ? 'Move a first slice of visible balance into the shielded pool to diversify route options beyond public-only execution.'
        : undefined,
      walletWorkspace.pending.count > 0
        ? `Process ${walletWorkspace.pending.count} queued withdrawals so public and private exposure stop drifting apart.`
        : undefined,
      totalUsdc === 0 && authWorkspace.wallet.public.hasUsdcTrustline
        ? 'USDC trustline exists, but the portfolio still lacks stablecoin exposure. Seed USDC if you want better swap and fiat flexibility.'
        : undefined,
      contactsWorkspace.summary.privatePreferred > contactsWorkspace.summary.publicPreferred && privateExposure === 0
        ? 'Your relationship graph is skewing toward private-friendly counterparties, but the wallet still lacks shielded capital to use that advantage.'
        : undefined,
      historyWorkspace.summary.failed > 0
        ? 'Review the failure buckets before adding more exposure to the same route that is already causing churn.'
        : undefined,
    ].filter(Boolean);

    const exposureSignals = [
      {
        id: 'public_share',
        label: 'Public share',
        value: totalExposure > 0 ? Number(((publicExposure / totalExposure) * 100).toFixed(1)) : 0,
        detail:
          publicExposure > 0
            ? 'Visible balances improve recovery and public routing, but they reduce privacy posture.'
            : 'No visible exposure is currently available for direct wallet use.',
      },
      {
        id: 'private_share',
        label: 'Private share',
        value: totalExposure > 0 ? Number(((privateExposure / totalExposure) * 100).toFixed(1)) : 0,
        detail:
          privateExposure > 0
            ? 'Shielded balances expand private routing and protected market execution.'
            : 'Private exposure is still zero, so the wallet cannot take advantage of its privacy-first product surface yet.',
      },
      {
        id: 'counterparty_strength',
        label: 'Counterparty strength',
        value:
          contactsWorkspace.contacts.length > 0
            ? Number(
                (
                  contactsWorkspace.contacts.reduce((sum: number, item: any) => sum + item.trustScore, 0) /
                  contactsWorkspace.contacts.length
                ).toFixed(1),
              )
            : 0,
        detail:
          contactsWorkspace.contacts.length > 0
            ? 'A higher relationship score means the portfolio can lean on known counterparties instead of cold routes.'
            : 'No strong counterparty layer has formed yet, so every route behaves more like a cold start.',
      },
      {
        id: 'momentum_score',
        label: 'Momentum score',
        value: momentumScore,
        detail:
          momentumScore >= 70
            ? 'The portfolio is actively exercised across recent history and route surfaces.'
            : momentumScore >= 40
              ? 'The portfolio has useful recent signal, but it is not yet dense enough to feel battle-tested.'
              : 'The portfolio is still light on recent usage signal, so readiness is driven more by setup than by exercised flow.',
      },
    ];

    const flowMix = [
      {
        label: 'Wallet',
        count: categoryCounts.wallet ?? 0,
      },
      {
        label: 'Private',
        count: categoryCounts.private ?? 0,
      },
      {
        label: 'Swap',
        count: categoryCounts.swap ?? 0,
      },
      {
        label: 'System',
        count: categoryCounts.system ?? 0,
      },
    ];

    const actionLinks = [
      {
        id: 'funding',
        label: 'Funding desk',
        href: '/wallet/fund',
        tone: !authWorkspace.wallet.public.hasXlm ? 'critical' : !authWorkspace.wallet.private.hasShieldedBalance ? 'warning' : 'info',
        detail: 'Use this when the portfolio still needs XLM, trustline preparation, or a first shielded deposit.',
      },
      {
        id: 'wallet',
        label: 'Wallet workspace',
        href: '/wallet',
        tone: walletWorkspace.pending.count > 0 ? 'warning' : 'info',
        detail: 'Best place to process pending withdrawals and correct public/private balance drift.',
      },
      {
        id: 'actions',
        label: 'Action center',
        href: '/actions',
        tone: actionWorkspace.summary.critical > 0 ? 'critical' : actionWorkspace.summary.caution > 0 ? 'warning' : 'info',
        detail: 'Use this when route blockers, proof queues, or readiness issues are already waiting in line.',
      },
      {
        id: 'contacts',
        label: 'Contacts workspace',
        href: '/contacts',
        tone: contactsWorkspace.summary.blocked > 0 ? 'warning' : 'info',
        detail: 'Use this when the portfolio should lean on known counterparties instead of cold routing.',
      },
    ];

    return {
      user: {
        username: user.username,
        stellarPublicKey: user.stellarPublicKey,
        reputation: user.reputation,
      },
      summary: {
        totalExposure: Number(totalExposure.toFixed(4)),
        publicExposure: Number(publicExposure.toFixed(4)),
        privateExposure: Number(privateExposure.toFixed(4)),
        totalUsdc: Number(totalUsdc.toFixed(4)),
        totalXlm: Number(totalXlm.toFixed(4)),
      },
      allocation,
      exposureSignals,
      routeRisk,
      rebalanceIdeas,
      flowMix,
      actionLinks,
      portfolioHealth: {
        tone:
          !authWorkspace.wallet.public.hasXlm
            ? 'blocked'
            : historyWorkspace.summary.failed > historyWorkspace.summary.completed
              ? 'attention'
              : actionWorkspace.lanes.ops.status !== 'ready'
                ? 'attention'
                : 'ready',
        headline:
          !authWorkspace.wallet.public.hasXlm
            ? 'Portfolio still needs visible funding before it can act like a real operating wallet.'
            : privateExposure === 0
              ? 'Portfolio is usable, but it is still overly dependent on visible balances.'
              : 'Portfolio is diversified across visible and shielded balance surfaces.',
      },
      recentTitles: historyWorkspace.latestEntries.slice(0, 8).map((entry: any) => entry.title),
      updatedAt: new Date().toISOString(),
    };
  }

  private describeAuditTitle(operation: string) {
    switch (operation) {
      case 'public_send':
        return 'Public payment';
      case 'private_send':
        return 'Private payment';
      case 'deposit':
        return 'Private deposit';
      case 'withdraw_self':
        return 'Self withdrawal';
      case 'split_note':
        return 'Note split';
      case 'swap_request':
        return 'Swap request created';
      case 'swap_accept':
        return 'Swap request accepted';
      case 'swap_prepare_proof':
        return 'Swap proof prepared';
      case 'swap_submit_proof':
        return 'Swap proof submitted';
      case 'swap_execute_public':
        return 'Public swap execution';
      case 'swap_execute_private':
        return 'Private swap execution';
      case 'swap_complete':
        return 'Swap marked complete';
      default:
        return operation.replaceAll('_', ' ');
    }
  }

  private describeAuditState(state: string) {
    switch (state) {
      case 'success':
        return 'Completed successfully';
      case 'failed':
        return 'Failed';
      case 'retryable':
        return 'Needs retry';
      case 'queued':
        return 'Queued';
      default:
        return 'In progress';
    }
  }

  private describeSwapState(status: string, executionStatus?: string) {
    if (status === 'completed') {
      return 'Swap completed';
    }
    if (status === 'failed') {
      return executionStatus === 'failed' ? 'Execution failed' : 'Swap failed';
    }
    if (status === 'requested') {
      return 'Waiting for acceptance';
    }
    if (status === 'proofs_pending') {
      return 'Collecting proofs';
    }
    if (status === 'proofs_ready') {
      return 'Ready for execution';
    }
    if (status === 'executing') {
      return 'Executing on-chain';
    }
    return 'Swap updated';
  }

  private async resolveRecipientPreview(recipientIdentifier: string) {
    const looksLikePublicKey = recipientIdentifier.startsWith('G') && recipientIdentifier.length === 56;
    const byUsername = looksLikePublicKey ? null : await this.findByUsername(recipientIdentifier);
    const byPublicKey = looksLikePublicKey ? await this.findByStellarPublicKey(recipientIdentifier) : null;
    const resolvedUser = byUsername ?? byPublicKey;

    return {
      identifier: recipientIdentifier,
      resolved: !!resolvedUser || looksLikePublicKey,
      type: resolvedUser ? 'user' : looksLikePublicKey ? 'public_key' : 'unknown',
      username: resolvedUser?.username,
      stellarPublicKey: resolvedUser?.stellarPublicKey ?? (looksLikePublicKey ? recipientIdentifier : undefined),
      reputation: resolvedUser?.reputation ?? null,
      displayLabel: resolvedUser?.username
        ? `@${resolvedUser.username}`
        : looksLikePublicKey
          ? `${recipientIdentifier.slice(0, 6)}...${recipientIdentifier.slice(-6)}`
          : recipientIdentifier,
    };
  }

  private classifyHistoryFailure(entry: {
    operation: string;
    detail: string;
    indexing?: { status?: string; detail?: string };
    state: string;
  }) {
    const detail = `${entry.detail} ${entry.indexing?.detail ?? ''}`.toLowerCase();
    if (detail.includes('index') || entry.indexing?.status === 'pending' || entry.indexing?.status === 'lagging') {
      return 'indexing_delay';
    }
    if (detail.includes('proof')) {
      return 'proof_readiness';
    }
    if (detail.includes('trustline') || detail.includes('balance') || detail.includes('fee')) {
      return 'wallet_readiness';
    }
    if (entry.operation.startsWith('swap')) {
      return 'swap_execution';
    }
    return 'transaction_failure';
  }

  private describeFailureBucket(bucket: string) {
    switch (bucket) {
      case 'indexing_delay':
        return 'Waiting on indexing or chain follow-up';
      case 'proof_readiness':
        return 'Proof preparation or note-shape blockers';
      case 'wallet_readiness':
        return 'Wallet readiness blockers';
      case 'swap_execution':
        return 'Swap execution blockers';
      default:
        return 'General transaction failures';
    }
  }

  private computeHistoryVelocity(timeline: Array<{ date: string | Date | undefined; state: string }>) {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const recent24h = timeline.filter((item) => {
      const timestamp = new Date(item.date ?? 0).getTime();
      return now - timestamp <= dayMs;
    });
    const recent7d = timeline.filter((item) => {
      const timestamp = new Date(item.date ?? 0).getTime();
      return now - timestamp <= 7 * dayMs;
    });

    const successful24h = recent24h.filter((item) => item.state === 'success').length;
    const successful7d = recent7d.filter((item) => item.state === 'success').length;

    return {
      last24h: {
        total: recent24h.length,
        successful: successful24h,
        pending: recent24h.filter((item) => item.state === 'pending' || item.state === 'queued').length,
      },
      last7d: {
        total: recent7d.length,
        successful: successful7d,
        dailyAverage: Number((recent7d.length / 7).toFixed(2)),
      },
      momentum:
        recent24h.length >= 8
          ? 'high'
          : recent24h.length >= 3
            ? 'moderate'
            : 'light',
    };
  }
}
