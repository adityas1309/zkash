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
import {
  Asset,
  Horizon,
  Keypair,
  Networks,
  TransactionBuilder,
  Operation,
} from '@stellar/stellar-sdk';
import * as nacl from 'tweetnacl';
import * as naclUtil from 'tweetnacl-util';
import { computeCommitment, type NoteFields } from '../zk/commitment';
import { ProofService, recipientBindingFromAddress } from '../zk/proof.service';
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
  ) {}

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
      const usdc =
        account.balances.find(
          (b: any) =>
            (b.asset_type === 'credit_alphanum4' || b.asset_type === 'credit_alphanum12') &&
            b.asset_code === 'USDC',
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
      const usdcIssuer =
        process.env.USDC_ISSUER ||
        (isMainnet
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
    const encryptionKey = this.authService.getDecryptionKeyForUser(
      sender,
      sender.googleId,
      sender.email,
    );
    const secretKey = this.authService.decrypt(sender.stellarSecretKeyEncrypted, encryptionKey);
    const keypair = Keypair.fromSecret(secretKey);

    try {
      const account = await this.server.loadAccount(sender.stellarPublicKey);

      let asset: Asset;
      if (assetCode === 'USDC') {
        const isMainnet = isMainnetContext();
        const usdcIssuer =
          process.env.USDC_ISSUER ||
          (isMainnet
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
        .addOperation(
          Operation.payment({
            destination: destinationPublicKey,
            asset: asset,
            amount: amount,
          }),
        )
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
      let sponsorshipDetail =
        'Sponsorship unavailable; transaction submitted with the sender paying the fee.';

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
      const msg =
        (e as any)?.response?.data?.extras?.result_codes?.operations?.[0] || (e as Error).message;
      throw new Error(`Payment failed: ${msg}`);
    }
  }

  async sendPublic(
    userId: string,
    destination: string,
    amount: string,
    assetCode: string = 'XLM',
  ): Promise<string> {
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
        const usdcIssuer =
          process.env.USDC_ISSUER ||
          (isMainnet
            ? 'GA5ZSEJYB37JRC5EAOIRFPMQ6TAD5JIUGKWEAOSH4QALIQAMZOBEB7OA'
            : 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5');
        asset = new Asset('USDC', usdcIssuer);
      }

      const isMainnet = isMainnetContext();
      const tx = new TransactionBuilder(account, {
        fee: '100',
        networkPassphrase: isMainnet ? Networks.PUBLIC : Networks.TESTNET,
      })
        .addOperation(
          Operation.payment({
            destination: destination,
            asset: asset,
            amount: amount,
          }),
        )
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
    console.log(
      `[sendPrivate] START senderId=${senderId}, recipient=${recipientIdentifier}, asset=${asset}, amount=${amount}`,
    );
    const recipient =
      (await this.findByUsername(recipientIdentifier)) ??
      (await this.findByStellarPublicKey(recipientIdentifier));
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
        : (getContractAddress('SHIELDED_POOL_XLM_ADDRESS') ??
          getContractAddress('SHIELDED_POOL_ADDRESS') ??
          '');
    if (!poolAddress) {
      console.log('[sendPrivate] FAIL: Pool not configured');
      return { success: false, error: 'Pool not configured for this asset' };
    }
    console.log(`[sendPrivate] poolAddress=${poolAddress}`);

    // For sendPrivate (transfer), we need a note of EXACT amount.
    // TODO: Implement splitting/merging to handle arbitrary amounts from larger notes.
    const notes = await this.getSpendableNotes(senderId, asset, amountBigInt);
    const matchingNote = notes.find((n) => n.value === amountBigInt);

    if (!matchingNote) {
      return {
        success: false,
        error: `No spendable private note of exact amount ${amount} found. Splitting not yet supported.`,
      };
    }

    const notesToUse = [matchingNote]; // Use the matching note
    console.log(`[sendPrivate] spendable notes found: ${notes.length}`);
    if (notes.length === 0)
      return { success: false, error: 'No spendable private balance. Deposit first.' };

    // Get sender's public key for the contract call
    const sender = await this.findById(senderId);
    if (!sender) return { success: false, error: 'Sender not found' };

    const note = notesToUse[0];
    console.log(`[sendPrivate] note commitment: ${note.commitment}`);
    const stateRoot = await this.sorobanService.getMerkleRoot(poolAddress, sender.stellarPublicKey);
    console.log(
      `[sendPrivate] stateRoot: ${Buffer.from(stateRoot).toString('hex').slice(0, 32)}...`,
    );

    const leaves = await this.sorobanService.getCommitments(poolAddress, sender.stellarPublicKey);
    console.log(`[sendPrivate] on-chain leaves: ${leaves.length}`);
    const commitmentBytes = new Uint8Array(Buffer.from(note.commitment, 'hex'));
    const stateIndex = leaves.findIndex((l) => Buffer.from(l).equals(Buffer.from(commitmentBytes)));
    console.log(`[sendPrivate] stateIndex: ${stateIndex}`);
    if (stateIndex < 0) {
      console.log('[sendPrivate] FAIL: commitment not found on-chain');
      if (leaves.length > 0) {
        console.log(
          `[sendPrivate] first leaf hex: ${Buffer.from(leaves[0]).toString('hex').slice(0, 32)}...`,
        );
        console.log(`[sendPrivate] seeking commitment: ${note.commitment.slice(0, 32)}...`);
      }
      return { success: false, error: 'Deposit not indexed on-chain yet. Wait and retry.' };
    }
    const stateSiblings = await this.merkleTree.computeSiblingsForIndex(leaves, stateIndex, 20);
    console.log(`[sendPrivate] computed ${stateSiblings.length} siblings, generating proof...`);

    try {
      const { proofBytes, pubSignalsBytes, nullifierHash, nullifierSecret } =
        await this.proofService.generateProof(
          { label: note.label, value: note.value, nullifier: note.nullifier, secret: note.secret },
          stateRoot,
          amountBigInt,
          {
            commitmentBytes,
            stateIndex,
            stateSiblings,
            publicBinding: recipientBindingFromAddress(recipient.stellarPublicKey),
          },
        );
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
        const recipientEncKey = this.authService.getDecryptionKeyForUser(
          recipient,
          recipient.googleId,
          recipient.email,
        );
        const recipientViewKeyHex = this.authService.decrypt(
          recipient.zkViewKeyEncrypted,
          recipientEncKey,
        );
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
  async withdrawSelf(
    userId: string,
    asset: 'USDC' | 'XLM',
    amount: number,
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const user = await this.findById(userId);
    if (!user || !user.googleId) return { success: false, error: 'User not found' };

    const poolAddress =
      asset === 'USDC'
        ? (getContractAddress('SHIELDED_POOL_ADDRESS') ?? '')
        : (getContractAddress('SHIELDED_POOL_XLM_ADDRESS') ??
          getContractAddress('SHIELDED_POOL_ADDRESS') ??
          '');
    if (!poolAddress) return { success: false, error: 'Pool not configured' };

    // 1. Pick notes to spend.
    const scaledAmount = BigInt(Math.round(amount * Number(UsersService.SCALE_FACTOR)));

    const notes = await this.getSpendableNotes(userId, asset, scaledAmount);
    // Find exact match
    const note = notes.find((n) => n.value === scaledAmount);

    if (!note) {
      const availableAmounts = notes
        .map((n) => Number(n.value) / Number(UsersService.SCALE_FACTOR))
        .join(', ');
      return {
        success: false,
        error: `No spendable note of exact amount ${amount} found. Partial unshielding from a single note is not supported yet. Available note amounts: [${availableAmounts}]`,
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
          console.warn(
            `[withdrawSelf] Root mismatch (OnChain vs Computed). Retrying (${retries} left)...`,
          );
          await new Promise((r) => setTimeout(r, 2000));
          retries--;
          continue;
        }

        const comm = new Uint8Array(Buffer.from(note.commitment, 'hex'));
        const idx = leaves.findIndex((l) => Buffer.from(l).equals(Buffer.from(comm)));

        if (idx < 0) {
          console.warn(
            `[withdrawSelf] Note commitment not found on-chain. Retrying (${retries} left)...`,
          );
          await new Promise((r) => setTimeout(r, 1000));
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
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    if (!stateRoot || !commitmentBytes || stateIndex === undefined || !stateSiblings) {
      return { success: false, error: 'Failed to fetch consistent Merkle state after retries' };
    }

    try {
      const { proofBytes, pubSignalsBytes, nullifierHash, nullifierSecret } =
        await this.proofService.generateProof(
          { label: note.label, value: note.value, nullifier: note.nullifier, secret: note.secret },
          stateRoot,
          note.value,
          {
            commitmentBytes,
            stateIndex,
            stateSiblings,
            publicBinding: recipientBindingFromAddress(user.stellarPublicKey),
          },
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
        console.warn(
          `[withdrawSelf] Note ${note.label} already spent on-chain (NullifierUsed). Marking as spent.`,
        );
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
        return {
          success: false,
          error: `Pool Underfunded: Contract balance is lower than withdrawal amount ${amount}. This may be due to storage rent or state mismatch.`,
        };
      }

      return { success: false, error: msg };
    }
  }

  /** Process pending withdrawals for the current user (submit withdraw txs to ShieldedPool). */
  async processPendingWithdrawals(
    userId: string,
  ): Promise<{ processed: number; txHashes: string[] }> {
    const user = await this.findById(userId);
    if (!user || !user.googleId) throw new Error('User not found');

    const encKey = this.authService.getDecryptionKeyForUser(user, user.googleId, user.email);
    const secretKey = this.authService.decrypt(user.stellarSecretKeyEncrypted, encKey);

    const pending = await this.pendingWithdrawalModel
      .find({ recipientId: new Types.ObjectId(userId), processed: false })
      .exec();
    const txHashes: string[] = [];

    for (const p of pending) {
      try {
        const poolAddressForPending =
          p.poolAddress ||
          (p.asset === 'USDC'
            ? (getContractAddress('SHIELDED_POOL_ADDRESS') ?? '')
            : (getContractAddress('SHIELDED_POOL_XLM_ADDRESS') ??
              getContractAddress('SHIELDED_POOL_ADDRESS') ??
              ''));
        if (!poolAddressForPending) {
          throw new Error('Pool address not configured for pending withdrawal asset');
        }

        const proofBytes = Buffer.from(p.proofBytes, 'base64');
        const pubSignalsBytes = Buffer.from(p.pubSignalsBytes, 'base64');

        // Robustness fix: Extract nullifierHash from public signals (index 0).
        // publicSignals = [nullifierHash, withdrawnValue, stateRoot, associationRoot, binding]
        // Each is 32 bytes.
        // Even if p.nullifier stored the SECRET (old bug), this extracts the HASH required by contract.
        const nullifierHashFromSignals = pubSignalsBytes.subarray(0, 32);

        // Log if mismatch (just for debug)
        const storedNullifier = Buffer.from(p.nullifier, 'hex');
        if (!storedNullifier.equals(nullifierHashFromSignals)) {
          console.warn(
            `[processPendingWithdrawals] Correcting nullifier for withdrawal ${p._id}. Stored: ${p.nullifier}, Actual Hash: ${nullifierHashFromSignals.toString('hex')}`,
          );
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
  async deposit(
    userId: string,
    asset: 'USDC' | 'XLM',
    amount: number,
  ): Promise<{ txHash: string; error?: string }> {
    const DEPOSIT_TIMEOUT_MS = 120_000; // 2 min for RPC/sendTransaction on testnet

    try {
      const user = await this.findById(userId);
      if (!user || !user.googleId) return { txHash: '', error: 'User not found' };

      const poolAddress =
        asset === 'USDC'
          ? (getContractAddress('SHIELDED_POOL_ADDRESS') ?? '')
          : (getContractAddress('SHIELDED_POOL_XLM_ADDRESS') ??
            getContractAddress('SHIELDED_POOL_ADDRESS') ??
            '');
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
      const currentRootBytes = await this.withTimeout(
        this.sorobanService.getMerkleRoot(poolAddress, user.stellarPublicKey),
        DEPOSIT_TIMEOUT_MS,
        'getMerkleRoot',
      );
      const existingLeaves = await this.withTimeout(
        this.sorobanService.getCommitments(poolAddress, user.stellarPublicKey),
        DEPOSIT_TIMEOUT_MS,
        'getCommitments',
      );
      const computedCurrentRoot = await this.merkleTree.computeRootFromLeaves(existingLeaves, 20);
      if (!Buffer.from(computedCurrentRoot).equals(Buffer.from(currentRootBytes))) {
        throw new Error('Pool root changed while preparing deposit. Please retry.');
      }
      const newLeaves = [...existingLeaves, commitmentBytes];
      const newRootBytes = await this.merkleTree.computeRootFromLeaves(newLeaves, 20);

      const txHash = await this.withTimeout(
        this.sorobanService.invokeShieldedPoolDeposit(
          poolAddress,
          secretKey,
          commitmentBytes,
          currentRootBytes,
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
        const noteCiphertext = nacl.secretbox(naclUtil.decodeUTF8(payload), noteNonce, viewKey);
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
        console.error(
          '[UsersService] deposit: failed to create EncryptedNote for private balance:',
          e,
        );
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
        existing.latestAt &&
        candidateDate &&
        new Date(existing.latestAt).getTime() > new Date(candidateDate).getTime()
          ? existing.latestAt
          : (candidateDate ?? existing.latestAt);
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
    const privateBalance = Number(
      body.asset === 'USDC' ? privateBalances.usdc : privateBalances.xlm,
    );
    const recentCounterpartyTouch = history.find(
      (entry) =>
        entry.participants?.counterparty?.toLowerCase() ===
        recipientPreview.username?.toLowerCase(),
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
      nextAction:
        publicBalance >= amount
          ? 'Send directly from the public wallet.'
          : `Fund ${body.asset} publicly before sending.`,
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

    const recommendedMode = privateRoute.ready
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
  async generateNote(
    userId: string,
    amount: number,
  ): Promise<{ noteFields: NoteFields; commitmentBytes: Uint8Array }> {
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
    txHash: string,
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
      const noteCiphertext = nacl.secretbox(naclUtil.decodeUTF8(payload), noteNonce, viewKey);
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
  ): Promise<
    Array<{ label: bigint; value: bigint; nullifier: bigint; secret: bigint; commitment: string }>
  > {
    const user = await this.findById(userId);
    if (!user || !user.googleId) return [];

    const poolAddress =
      asset === 'USDC'
        ? (getContractAddress('SHIELDED_POOL_ADDRESS') ?? '')
        : (getContractAddress('SHIELDED_POOL_XLM_ADDRESS') ??
          getContractAddress('SHIELDED_POOL_ADDRESS') ??
          '');
    if (!poolAddress) return [];

    const encKey = this.authService.getDecryptionKeyForUser(user, user.googleId, user.email);
    const notes = await this.spendableNoteModel
      .find({ userId: user._id, asset, poolAddress, spent: false })
      .exec();

    const out: Array<{
      label: bigint;
      value: bigint;
      nullifier: bigint;
      secret: bigint;
      commitment: string;
    }> = [];
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
        console.log(
          `[markNoteSpent] Checking note ${note._id}: ComputedHash=${hashHex} vs Target=${targetHex}`,
        );

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
    console.warn(
      `[markNoteSpent] No note found for nullifier ${nullifierHex}. Checked ${notes.length} notes.`,
    );
  }

  /**
   * Split a note by withdrawing it to public and re-depositing the exact required amount.
   * The change remains in the public balance.
   */
  async splitNote(
    userId: string,
    asset: 'USDC' | 'XLM',
    amount: number,
  ): Promise<{ success: boolean; error?: string }> {
    const user = await this.findById(userId);
    if (!user || !user.googleId) return { success: false, error: 'User not found' };

    const targetAmount = BigInt(Math.round(amount * Number(UsersService.SCALE_FACTOR)));

    // 1. Find a note larger than amount
    const notes = await this.getSpendableNotes(user._id.toString(), asset);
    const largerNote = notes.find((n) => n.value > targetAmount);

    if (!largerNote) {
      // Try merging: check if total balance is enough
      const total = notes.reduce((sum, n) => sum + n.value, 0n);
      if (total < targetAmount) {
        return {
          success: false,
          error: `Insufficient private balance. Total: ${Number(total) / Number(UsersService.SCALE_FACTOR)}`,
        };
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
        if (!wRes.success)
          return { success: false, error: `Failed to withdraw note during merge: ${wRes.error}` };
      }
    } else {
      // 2. Withdraw the larger note
      console.log(`[splitNote] Found larger note ${largerNote.value}, withdrawing to split...`);
      const floatVal = Number(largerNote.value) / Number(UsersService.SCALE_FACTOR);
      const wRes = await this.withdrawSelf(userId, asset, floatVal);
      if (!wRes.success) return { success: false, error: `Withdraw failed: ${wRes.error}` };
    }

    // 3. Wait a bit for ledger confirmation (simple delay for now, ideally watch event)
    await new Promise((r) => setTimeout(r, 6000));

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

    const [balances, privateBalances, pendingWithdrawals, recentHistory, withdrawalSponsorship] =
      await Promise.all([
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
          reason:
            pendingWithdrawals.length > 0
              ? 'Pending withdrawals will process with the existing proof queue.'
              : 'No pending withdrawals waiting for processing.',
        },
      },
    ];

    const privateShareUsdc =
      Number(balances.usdc) + Number(privateBalances.usdc) > 0
        ? Number(
            (
              (Number(privateBalances.usdc) /
                (Number(balances.usdc) + Number(privateBalances.usdc))) *
              100
            ).toFixed(1),
          )
        : 0;
    const privateShareXlm =
      Number(balances.xlm) + Number(privateBalances.xlm) > 0
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
        Number(privateBalances.usdc) > Number(balances.usdc) ||
        Number(privateBalances.xlm) > Number(balances.xlm)
          ? 'A larger share of your holdings currently sits in private notes than in the public wallet.'
          : 'Your public wallet currently carries at least as much visible balance as your private pool.',
      ],
    };
  }

  async getHistory(userId: string) {
    const objectId = new Types.ObjectId(userId);
    const [audits, encNotes, withdrawals, swaps] = await Promise.all([
      this.transactionAuditService.listRecentForUser(userId, 40),
      this.encryptedNoteModel
        .find({ recipientId: objectId })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean()
        .exec(),
      this.pendingWithdrawalModel
        .find({ recipientId: objectId })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean()
        .exec(),
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
      const swapMatch = swapId
        ? swaps.find((swap: any) => swap._id?.toString() === swapId)
        : undefined;
      const participantRole = swapMatch
        ? (swapMatch.aliceId as any)?.toString?.() === userId ||
          (swapMatch.aliceId as any)?._id?.toString?.() === userId
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
        category: operation.startsWith('swap')
          ? 'swap'
          : operation.includes('private') ||
              operation.includes('deposit') ||
              operation.includes('withdraw')
            ? 'private'
            : 'wallet',
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
        amountDisplay:
          audit.amount || (operation.includes('private') ? 'Private amount' : 'Not available'),
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
        title:
          note.txHash === 'pending'
            ? 'Pending private transfer received'
            : 'Private balance note received',
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
        statusLabel:
          note.txHash === 'pending' ? 'Waiting on chain follow-up' : 'Private note stored',
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
        swap.aliceId?.toString?.() === userId || swap.aliceId?._id?.toString?.() === userId
          ? 'alice'
          : 'bob';
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
        privateFlow:
          swap.proofStatus === 'ready' ||
          swap.status === 'proofs_pending' ||
          swap.status === 'proofs_ready' ||
          swap.status === 'executing',
        date: swap.updatedAt ?? swap.createdAt,
        statusLabel: this.describeSwapState(swap.status, swap.executionStatus),
      });
    }

    return timeline
      .sort(
        (left, right) => new Date(right.date ?? 0).getTime() - new Date(left.date ?? 0).getTime(),
      )
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
        pending: entries.filter((item) => item.state === 'pending' || item.state === 'queued')
          .length,
        failed: entries.filter((item) => item.state === 'failed' || item.state === 'retryable')
          .length,
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
      pending.find(
        (item) => item.operation === 'swap_lifecycle' || item.operation.startsWith('swap_'),
      ),
      failed.find((item) => item.state === 'retryable'),
      pending.find(
        (item) => item.indexing?.status === 'pending' || item.indexing?.status === 'lagging',
      ),
      !walletWorkspace.balances.private.usdc && !walletWorkspace.balances.private.xlm
        ? ({
            id: 'synthetic:first_private_deposit',
            source: 'audit',
            category: 'private',
            operation: 'first_private_deposit',
            title: 'Seed the first private balance',
            detail:
              'No private balance activity is present yet, so the first deposit will unlock the full shielded history trail.',
            state: 'queued',
            amountDisplay: 'Not started',
            sponsorship: { attempted: false, sponsored: false },
            privateFlow: true,
            date: new Date().toISOString(),
            statusLabel: 'Suggested next action',
          } as any)
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
    const [user, walletWorkspace, historyWorkspace, authWorkspace, readiness, recentSwaps, audits] =
      await Promise.all([
        this.findById(userId),
        this.getWalletWorkspace(userId),
        this.getHistoryWorkspace(userId),
        this.authService.getAuthWorkspace(userId),
        this.opsService.getReadiness(),
        this.swapModel
          .find({
            $or: [{ aliceId: new Types.ObjectId(userId) }, { bobId: new Types.ObjectId(userId) }],
          })
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
        severity:
          authWorkspace.wallet.public.hasXlm || authWorkspace.wallet.public.hasUsdcTrustline
            ? 'caution'
            : 'info',
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
        detail =
          'A buyer has already requested this swap and it still needs seller acceptance before any proof or settlement work can begin.';
      } else if (
        swap.status === 'proofs_pending' &&
        swap.proofStatus === 'awaiting_bob' &&
        participantRole === 'bob'
      ) {
        action = 'Prepare seller proof';
        urgency = 'critical';
        detail =
          'The buyer side is already waiting on the seller proof, so this private swap cannot progress until an exact-value note is prepared.';
      } else if (
        swap.status === 'proofs_pending' &&
        swap.proofStatus === 'awaiting_alice' &&
        participantRole === 'alice'
      ) {
        action = 'Prepare buyer proof';
        urgency = 'critical';
        detail =
          'The seller side is already waiting on the buyer proof, so this private swap still needs the initiating side to finish note preparation.';
      } else if (swap.status === 'proofs_ready') {
        action = 'Execute private swap';
        urgency = 'critical';
        detail =
          'Both proofs are ready, so this swap is now blocked on someone actually finalizing private execution.';
      } else if (swap.status === 'executing') {
        action = 'Watch active execution';
        urgency = 'info';
        detail =
          'This swap is already in execution, so the right next step is status monitoring rather than another user action.';
      } else if (swap.status === 'failed') {
        action = 'Review failed swap';
        urgency = 'critical';
        detail =
          swap.lastError ||
          'A recent swap failed and should be reviewed before more market flow is accepted.';
      } else {
        action = 'Inspect swap lifecycle';
        urgency = 'info';
        detail =
          'This swap has meaningful lifecycle signal, but no immediate intervention is required.';
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
      !authWorkspace.wallet.public.hasXlm
        ? 'Use Friendbot to fund visible XLM before trying trustlines or deposits.'
        : undefined,
      !authWorkspace.wallet.public.hasUsdcTrustline && authWorkspace.wallet.public.hasXlm
        ? 'Add the USDC trustline so stablecoin funding and swap routes stop failing at the wallet layer.'
        : undefined,
      walletWorkspace.pending.count > 0
        ? 'Process queued withdrawals to get delayed private funds back into visible balances.'
        : undefined,
      !authWorkspace.wallet.private.hasShieldedBalance &&
      (authWorkspace.wallet.public.hasXlm || authWorkspace.wallet.public.hasUsdcTrustline)
        ? 'Make the first deposit into the shielded pool so private send and private swap routes become realistic.'
        : undefined,
      topFailureBucket
        ? `Review ${topFailureBucket.label.toLowerCase()} in history before repeating the same action path.`
        : undefined,
      readiness.status !== 'ready'
        ? 'Check status before assuming a balance or note issue is your fault instead of an indexing delay.'
        : undefined,
    ].filter(Boolean);

    const routeCards = [
      {
        id: 'funding',
        label: 'Funding desk',
        href: '/wallet/fund',
        readiness: !authWorkspace.wallet.public.hasXlm
          ? 'critical'
          : !authWorkspace.wallet.public.hasUsdcTrustline
            ? 'caution'
            : 'ready',
        detail:
          'Handle faucet funding, trustline preparation, and the first private-balance seeding plan.',
      },
      {
        id: 'wallet',
        label: 'Wallet workspace',
        href: '/wallet',
        readiness: walletWorkspace.pending.count > 0 ? 'caution' : 'ready',
        detail:
          'Process pending withdrawals, inspect sponsorship, and manage public/private balances directly.',
      },
      {
        id: 'send',
        label: 'Send planner',
        href: '/wallet/send',
        readiness:
          authWorkspace.wallet.public.hasXlm || authWorkspace.wallet.private.hasShieldedBalance
            ? 'ready'
            : 'caution',
        detail:
          'Preflight public or private transfers with route guidance instead of trial-and-error submissions.',
      },
      {
        id: 'swap',
        label: 'Swap desk',
        href: '/swap/my',
        readiness:
          urgentSwapItems.length > 0 ? 'critical' : swapSummaries.length > 0 ? 'caution' : 'info',
        detail:
          'Handle requests, proofs, private execution, and failed market flows that are still waiting on action.',
      },
      {
        id: 'history',
        label: 'History desk',
        href: '/history',
        readiness: historyWorkspace.summary.failed > 0 ? 'caution' : 'ready',
        detail:
          'Use the timeline and failure buckets when the same issue is starting to repeat across recent actions.',
      },
      {
        id: 'status',
        label: 'Status workspace',
        href: '/status',
        readiness: readiness.status === 'ready' ? 'ready' : 'critical',
        detail:
          'Inspect lagging pools and operational freshness before blaming the wallet or market layer.',
      },
      {
        id: 'account',
        label: 'Account center',
        href: '/account',
        readiness: 'info',
        detail:
          'Review identity, session state, and guarded account controls without leaving the workspace flow.',
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
    const [user, historyWorkspace, sendWorkspace, walletWorkspace, authWorkspace] =
      await Promise.all([
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
            contact.privateFlows >= contact.swapFlows &&
            Number(walletWorkspace.balances.private.usdc || 0) > 0
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
            (contact.privateFlows > contact.interactions / 2 &&
            authWorkspace.wallet.private.hasShieldedBalance
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
      publicPreferred: contactCards.filter((contact) => contact.recommendedRoute === 'public')
        .length,
      privatePreferred: contactCards.filter((contact) => contact.recommendedRoute === 'private')
        .length,
      blocked: contactCards.filter((contact) => contact.routeReadiness === 'blocked').length,
      attention: contactCards.filter((contact) => contact.routeReadiness === 'attention').length,
    };

    const actionBoard = [
      !authWorkspace.wallet.public.hasXlm
        ? {
            id: 'contacts-fund-xlm',
            severity: 'critical',
            title: 'Fund visible XLM before using contacts as a send list',
            detail:
              'Most contact relationships will still fail on public sends or route planning until the visible wallet can pay fees.',
            href: '/wallet/fund',
          }
        : undefined,
      !authWorkspace.wallet.private.hasShieldedBalance
        ? {
            id: 'contacts-seed-private',
            severity: 'warning',
            title: 'Seed a private balance before leaning on shielded contacts',
            detail:
              'Several counterparties are good candidates for private routing, but the wallet still needs an actual private balance first.',
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
    const [
      user,
      walletWorkspace,
      historyWorkspace,
      actionWorkspace,
      contactsWorkspace,
      authWorkspace,
    ] = await Promise.all([
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

    const categoryCounts = historyWorkspace.categoryBreakdown.reduce<Record<string, number>>(
      (acc, item: any) => {
        acc[item.category] = item.count;
        return acc;
      },
      {},
    );

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
      contactsWorkspace.summary.privatePreferred > contactsWorkspace.summary.publicPreferred &&
      privateExposure === 0
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
                  contactsWorkspace.contacts.reduce(
                    (sum: number, item: any) => sum + item.trustScore,
                    0,
                  ) / contactsWorkspace.contacts.length
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
        tone: !authWorkspace.wallet.public.hasXlm
          ? 'critical'
          : !authWorkspace.wallet.private.hasShieldedBalance
            ? 'warning'
            : 'info',
        detail:
          'Use this when the portfolio still needs XLM, trustline preparation, or a first shielded deposit.',
      },
      {
        id: 'wallet',
        label: 'Wallet workspace',
        href: '/wallet',
        tone: walletWorkspace.pending.count > 0 ? 'warning' : 'info',
        detail:
          'Best place to process pending withdrawals and correct public/private balance drift.',
      },
      {
        id: 'actions',
        label: 'Action center',
        href: '/actions',
        tone:
          actionWorkspace.summary.critical > 0
            ? 'critical'
            : actionWorkspace.summary.caution > 0
              ? 'warning'
              : 'info',
        detail:
          'Use this when route blockers, proof queues, or readiness issues are already waiting in line.',
      },
      {
        id: 'contacts',
        label: 'Contacts workspace',
        href: '/contacts',
        tone: contactsWorkspace.summary.blocked > 0 ? 'warning' : 'info',
        detail:
          'Use this when the portfolio should lean on known counterparties instead of cold routing.',
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
        tone: !authWorkspace.wallet.public.hasXlm
          ? 'blocked'
          : historyWorkspace.summary.failed > historyWorkspace.summary.completed
            ? 'attention'
            : actionWorkspace.lanes.ops.status !== 'ready'
              ? 'attention'
              : 'ready',
        headline: !authWorkspace.wallet.public.hasXlm
          ? 'Portfolio still needs visible funding before it can act like a real operating wallet.'
          : privateExposure === 0
            ? 'Portfolio is usable, but it is still overly dependent on visible balances.'
            : 'Portfolio is diversified across visible and shielded balance surfaces.',
      },
      recentTitles: historyWorkspace.latestEntries.slice(0, 8).map((entry: any) => entry.title),
      updatedAt: new Date().toISOString(),
    };
  }

  async getPlaybookWorkspace(userId: string) {
    const [
      user,
      authWorkspace,
      walletWorkspace,
      sendWorkspace,
      actionWorkspace,
      contactsWorkspace,
      portfolioWorkspace,
      historyWorkspace,
      readiness,
    ] = await Promise.all([
      this.findById(userId),
      this.authService.getAuthWorkspace(userId),
      this.getWalletWorkspace(userId),
      this.getSendWorkspace(userId),
      this.getActionCenterWorkspace(userId),
      this.getContactsWorkspace(userId),
      this.getPortfolioWorkspace(userId),
      this.getHistoryWorkspace(userId),
      this.opsService.getReadiness(),
    ]);

    if (!user) {
      throw new Error('User not found');
    }

    const publicXlm = Number(walletWorkspace.balances.public.xlm || 0);
    const publicUsdc = Number(walletWorkspace.balances.public.usdc || 0);
    const privateXlm = Number(walletWorkspace.balances.private.xlm || 0);
    const privateUsdc = Number(walletWorkspace.balances.private.usdc || 0);
    const totalPublic = publicXlm + publicUsdc;
    const totalPrivate = privateXlm + privateUsdc;
    const totalExposure = totalPublic + totalPrivate;
    const topContact = contactsWorkspace.contacts[0];
    const readyRoutes = portfolioWorkspace.routeRisk.filter(
      (item: any) => item.tone === 'ready',
    ).length;
    const laggingPools = readiness.lagging.length;
    const privatePreferredContacts = contactsWorkspace.summary.privatePreferred;
    const failureCount = historyWorkspace.summary.failed;
    const pendingCount = historyWorkspace.summary.pending;
    const sponsoredCount = historyWorkspace.summary.sponsored;
    const hasFunding = authWorkspace.wallet.public.hasXlm;
    const hasTrustline = authWorkspace.wallet.public.hasUsdcTrustline;
    const hasPrivateBalance = authWorkspace.wallet.private.hasShieldedBalance;

    const sponsorshipPairs = await Promise.all(
      (
        [
          { operation: 'public_send', asset: WalletAsset.XLM },
          { operation: 'public_send', asset: WalletAsset.USDC },
          { operation: 'deposit', asset: WalletAsset.XLM },
          { operation: 'deposit', asset: WalletAsset.USDC },
          { operation: 'withdraw_self', asset: WalletAsset.XLM },
          { operation: 'withdraw_self', asset: WalletAsset.USDC },
        ] as const
      ).map(async (entry) => ({
        operation: entry.operation,
        asset: entry.asset,
        preview: await this.previewSponsorship(userId, {
          operation: entry.operation,
          asset: entry.asset,
          amount: 1,
          recipient: topContact?.stellarPublicKey ?? topContact?.counterparty,
        }).catch(() => ({
          supported: false,
          sponsored: false,
          reason: 'Preview unavailable for this operation right now.',
        })),
      })),
    );

    const sponsorBoard = sponsorshipPairs.map((item) => ({
      id: `${item.operation}_${item.asset}`.toLowerCase(),
      operation: item.operation,
      asset: item.asset,
      supported: item.preview.supported,
      sponsored: item.preview.sponsored,
      reason: item.preview.reason,
      tone: item.preview.sponsored ? 'ready' : item.preview.supported ? 'attention' : 'blocked',
      label: `${item.operation.replaceAll('_', ' ')} ${item.asset}`,
    }));

    const sponsoredOpportunities = sponsorBoard.filter((item) => item.sponsored).length;

    const routeComparisons = [
      {
        id: 'public_wallet_lane',
        label: 'Visible wallet lane',
        recommended: totalPublic > 0,
        tone: totalPublic > 0 ? 'ready' : 'blocked',
        summary:
          totalPublic > 0
            ? 'Visible funds are already available, so public sends, trustline management, and fast recovery remain reachable.'
            : 'Visible funds are missing, so direct wallet operations still depend on fresh funding first.',
        nextStep:
          totalPublic > 0
            ? 'Use wallet, send, or fiat routes without waiting on a first deposit.'
            : 'Open the funding desk and add visible XLM first.',
        sponsorship:
          sponsorBoard.find((item) => item.operation === 'public_send' && item.asset === 'XLM') ??
          sponsorBoard[0],
      },
      {
        id: 'private_wallet_lane',
        label: 'Shielded wallet lane',
        recommended: totalPrivate > 0 || totalPublic > 0,
        tone: totalPrivate > 0 ? 'ready' : totalPublic > 0 ? 'attention' : 'blocked',
        summary:
          totalPrivate > 0
            ? 'Private balances already exist, so the app can start taking advantage of protected transfer and market routes.'
            : totalPublic > 0
              ? 'Private flow is reachable, but the first deposit or note-shaping step is still missing.'
              : 'Shielded flow is blocked because the wallet lacks both visible capital and a seeded private note.',
        nextStep:
          totalPrivate > 0
            ? 'Use send or swap flows that already benefit from private balance posture.'
            : totalPublic > 0
              ? 'Make the first deposit to unlock private sends and more protected market execution.'
              : 'Fund visible balance first, then seed a first private deposit.',
        sponsorship:
          sponsorBoard.find((item) => item.operation === 'deposit' && item.asset === 'XLM') ??
          sponsorBoard[2],
      },
      {
        id: 'relationship_lane',
        label: 'Counterparty lane',
        recommended: !!topContact,
        tone: topContact ? topContact.routeReadiness : 'blocked',
        summary: topContact
          ? `@${topContact.username} is currently the strongest known counterparty, so repeat routing can be more deliberate than a cold send.`
          : 'No established counterparty graph is available yet, so every route still behaves like a cold start.',
        nextStep: topContact
          ? `Use contacts or send planning before repeating a transfer to @${topContact.username}.`
          : 'Build the first reliable transfer relationship before leaning on route memory.',
        sponsorship:
          sponsorBoard.find(
            (item) =>
              item.operation === 'public_send' &&
              item.asset === (topContact?.preferredAsset ?? 'USDC'),
          ) ?? sponsorBoard[1],
      },
      {
        id: 'ops_lane',
        label: 'Operational freshness lane',
        recommended: readiness.status === 'ready',
        tone: readiness.status === 'ready' ? 'ready' : laggingPools > 0 ? 'attention' : 'blocked',
        summary:
          readiness.status === 'ready'
            ? 'Readiness is healthy, so audits, balances, and notes should feel current enough for normal use.'
            : laggingPools > 0
              ? 'Lagging indexer pools can distort how fast the product reflects deposits, withdrawals, and proof outcomes.'
              : 'Dependencies still need operator attention before the app should be trusted as fully current.',
        nextStep:
          readiness.status === 'ready'
            ? 'Use the product normally while monitoring the status desk.'
            : 'Open status and remediation surfaces before assuming balances are fresh.',
        sponsorship:
          sponsorBoard.find(
            (item) => item.operation === 'withdraw_self' && item.asset === 'USDC',
          ) ?? sponsorBoard[5],
      },
    ];

    const scenarioCards = [
      {
        id: 'bootstrap_visible_wallet',
        title: 'Bootstrap visible liquidity',
        lane: 'wallet',
        tone: hasFunding ? 'ready' : 'blocked',
        destination: '/wallet/fund',
        headline: hasFunding
          ? 'Visible XLM is already funded, so the wallet has the minimum capital needed for fees and direct actions.'
          : 'The fastest way to improve every route is still to add visible XLM first.',
        detail: hasFunding
          ? 'This scenario is already in good shape. From here the playbook is about maintaining enough visible balance to keep public sends, trustline actions, and recovery flows cheap and predictable.'
          : 'Without visible XLM the wallet remains brittle. Deposits, trustline setup, public sends, and even fallback flows all feel worse until fees are funded.',
        status: hasFunding ? 'Executable now' : 'Blocked by missing visible XLM',
        requirements: [
          hasFunding
            ? 'Visible XLM is present for fees and direct payment routes.'
            : 'Friendbot or another XLM funding path must succeed first.',
          hasTrustline
            ? 'USDC trustline is already reachable once stablecoin liquidity is available.'
            : 'Trustline can be added immediately after XLM funding.',
          readiness.status === 'ready'
            ? 'Indexer and readiness surfaces are healthy enough for the wallet to feel current.'
            : 'Ops freshness should still be checked if new balances do not appear quickly.',
        ],
        blockers: [
          !hasFunding ? 'Public fee balance is still zero.' : undefined,
          laggingPools > 0
            ? `${laggingPools} pool lane(s) are lagging and may delay confidence in follow-up flows.`
            : undefined,
          failureCount > 0
            ? `${failureCount} recent failed or retryable actions mean the first next step should stay simple and visible.`
            : undefined,
        ].filter(Boolean),
        steps: [
          'Open the funding desk and confirm the account has testnet XLM.',
          'Refresh visible balances and confirm the wallet can pay fees without hesitation.',
          'Immediately follow with USDC trustline setup if stablecoin flow matters for the next route.',
          'Return to playbook or wallet to choose whether to stay visible or seed the first private deposit.',
        ],
        whyNow: [
          'Every other route becomes easier after visible funding.',
          'Fee confidence reduces friction across trustline, send, deposit, and swap flows.',
          'Recovery paths stay simpler when the public wallet is not empty.',
        ],
        metrics: [
          { label: 'Public XLM', value: walletWorkspace.balances.public.xlm },
          { label: 'Public USDC', value: walletWorkspace.balances.public.usdc },
          { label: 'Ready routes', value: String(readyRoutes) },
          { label: 'Lagging pools', value: String(laggingPools) },
        ],
        recommendation: hasFunding
          ? 'Maintain enough visible XLM to keep every route from regressing into setup friction.'
          : 'Do this before any more ambitious flow. It has the best downstream leverage in the entire playbook.',
      },
      {
        id: 'seed_private_capital',
        title: 'Seed the first private lane',
        lane: 'private',
        tone: hasPrivateBalance ? 'ready' : hasFunding || publicUsdc > 0 ? 'attention' : 'blocked',
        destination: '/wallet',
        headline: hasPrivateBalance
          ? 'Shielded balances already exist, so the app can plan private sends and more protected market routes.'
          : totalPublic > 0
            ? 'A first private deposit is the cleanest way to unlock the app’s differentiated behavior.'
            : 'Private flow is still blocked because the wallet lacks visible capital to deposit.',
        detail: hasPrivateBalance
          ? 'This scenario is no longer theoretical. The wallet already has note-based capital, which means the next decision is about shaping or using it well.'
          : totalPublic > 0
            ? 'The product has visible funds available, but until some of that capital is deposited into the shielded pool, private sends and protected route planning stay mostly aspirational.'
            : 'There is no visible source balance yet, so a private note cannot be created. Funding comes first.',
        status: hasPrivateBalance
          ? 'Executable now'
          : totalPublic > 0
            ? 'Ready after deposit'
            : 'Blocked until visible funding exists',
        requirements: [
          totalPublic > 0
            ? 'Visible balance exists to fund the initial deposit.'
            : 'Visible balance is still required before a deposit can be made.',
          sponsorBoard.find((item) => item.operation === 'deposit' && item.asset === 'XLM')
            ?.supported
            ? 'Deposit sponsorship policy is available for at least one asset.'
            : 'Deposit sponsorship may fall back to the user fee path.',
          readiness.status === 'ready'
            ? 'Indexer freshness is healthy enough that deposited notes should appear without unusual lag.'
            : 'Expect more patience after deposit because current ops freshness is degraded.',
        ],
        blockers: [
          !totalPublic ? 'No visible source balance is available for a first deposit.' : undefined,
          !hasTrustline && publicUsdc === 0
            ? 'USDC trustline is not ready yet, which limits stablecoin private seeding.'
            : undefined,
          laggingPools > 0
            ? 'Lagging indexer pools may slow confidence after the deposit settles.'
            : undefined,
        ].filter(Boolean),
        steps: [
          'Choose the asset whose visible balance you can afford to move into the shielded lane.',
          'Use the wallet workspace to submit a deposit and watch the private balance refresh.',
          'Return to send or swap flows once a note exists and route comparisons become meaningfully different.',
          'Use split or exact-note preparation only if the next private transfer needs a specific amount shape.',
        ],
        whyNow: [
          'Private balance is what unlocks the product’s strongest differentiator.',
          'Counterparties that prefer protected routes become materially more useful once a note exists.',
          'Portfolio quality improves when capital is not trapped entirely in visible lanes.',
        ],
        metrics: [
          { label: 'Private XLM', value: walletWorkspace.balances.private.xlm },
          { label: 'Private USDC', value: walletWorkspace.balances.private.usdc },
          { label: 'Private contacts', value: String(privatePreferredContacts) },
          {
            label: 'Deposit sponsorship',
            value:
              sponsorBoard.find((item) => item.operation === 'deposit' && item.asset === 'XLM')
                ?.tone ?? 'blocked',
          },
        ],
        recommendation: hasPrivateBalance
          ? 'Use existing private capital deliberately instead of letting it sit idle without route advantage.'
          : 'This is the highest-value move after visible funding because it upgrades the app from setup mode into real privacy mode.',
      },
      {
        id: 'repeat_trusted_counterparty',
        title: 'Repeat a trusted counterparty route',
        lane: 'contacts',
        tone: topContact ? topContact.routeReadiness : 'blocked',
        destination: topContact ? '/contacts' : '/wallet/send',
        headline: topContact
          ? `@${topContact.username} is your strongest reusable route today.`
          : 'No trusted counterparty is strong enough yet to anchor a repeat route.',
        detail: topContact
          ? `This scenario turns relationship history into execution confidence. ${topContact.interactions} prior touch(es), ${topContact.privateFlows} private flow(s), and a trust score of ${topContact.trustScore} mean this is the least-cold send relationship in the workspace.`
          : 'Before a repeat route can be treated as a safe default, the wallet needs at least one successful, well-understood transfer relationship to learn from.',
        status: topContact
          ? `Recommended via ${topContact.recommendedRoute}`
          : 'Blocked by missing relationship signal',
        requirements: [
          topContact
            ? `Known counterparty: @${topContact.username}.`
            : 'A repeat counterparty is not established yet.',
          topContact?.routeReadiness === 'ready'
            ? 'Recommended route already looks executable.'
            : topContact
              ? 'Recommended route needs more setup before it should be treated as dependable.'
              : 'No route memory exists yet for repeat-send planning.',
          sponsoredCount > 0
            ? 'Prior sponsored activity exists, which slightly lowers friction for repeating protected or fee-sensitive actions.'
            : 'No sponsored activity has been recorded yet.',
        ],
        blockers: [
          !topContact ? 'No reusable counterparty graph exists yet.' : undefined,
          topContact && topContact.routeReadiness !== 'ready'
            ? `Route to @${topContact.username} still needs preparation before it should be treated as low-risk.`
            : undefined,
          topContact && topContact.failedTouches > 0
            ? `${topContact.failedTouches} prior failure touch(es) mean route memory should be used with care.`
            : undefined,
        ].filter(Boolean),
        steps: [
          'Open the contacts workspace and review the recommended route for the strongest counterparty.',
          'Check whether the route is public or private and confirm the necessary balance lane is actually ready.',
          'Use send planning before execution if the amount differs meaningfully from prior history.',
          'Record whether the route felt smooth so the relationship graph becomes more trustworthy over time.',
        ],
        whyNow: [
          'Known counterparties reduce cold-start uncertainty.',
          'Relationship-aware sends are one of the easiest ways to make the product feel smarter over time.',
          'Repeat routes become more valuable as the user base and transfer cadence grow.',
        ],
        metrics: [
          { label: 'Top contact', value: topContact ? `@${topContact.username}` : 'None' },
          { label: 'Trust score', value: topContact ? String(topContact.trustScore) : '0' },
          { label: 'Interactions', value: topContact ? String(topContact.interactions) : '0' },
          { label: 'Route', value: topContact ? topContact.recommendedRoute : 'blocked' },
        ],
        recommendation: topContact
          ? `Use @${topContact.username} as the first choice when you want a repeatable route instead of a cold transfer.`
          : 'Create one successful counterparty pattern before expecting contact intelligence to guide send decisions.',
      },
      {
        id: 'clear_pending_and_failure_pressure',
        title: 'Clear pending pressure and failure drag',
        lane: 'recovery',
        tone: pendingCount > 0 || failureCount > 0 ? 'attention' : 'ready',
        destination: pendingCount > 0 ? '/wallet' : '/history',
        headline:
          pendingCount > 0 || failureCount > 0
            ? 'The next improvement may be cleanup, not more execution.'
            : 'There is no meaningful queue or failure drag visible in recent history.',
        detail:
          pendingCount > 0 || failureCount > 0
            ? `There are ${pendingCount} pending item(s) and ${failureCount} failed or retryable touch(es). Until some of that is cleared, portfolio quality and route confidence can be deceptively lower than the raw balances suggest.`
            : 'Recent activity is not carrying unusual queue pressure or repeated failures, so the workspace can safely bias toward new execution instead of remediation.',
        status:
          pendingCount > 0 || failureCount > 0
            ? 'Remediation advised'
            : 'Clean enough to keep building',
        requirements: [
          pendingCount > 0
            ? 'Pending withdrawals or queued actions should be reviewed for settlement or retry.'
            : 'No pending queue is dragging balance freshness right now.',
          failureCount > 0
            ? 'Recent failure buckets should be understood before repeating the same route blindly.'
            : 'Failure pressure is currently low.',
          readiness.status === 'ready'
            ? 'Healthy ops posture improves confidence that cleanups will reflect accurately.'
            : 'Degraded ops posture means some cleanup results may take longer to feel visible.',
        ],
        blockers: [
          laggingPools > 0
            ? 'Lagging pools can blur whether a cleanup has fully settled.'
            : undefined,
          pendingCount === 0 && failureCount === 0
            ? undefined
            : 'Jumping straight into more activity can compound ambiguity instead of improving clarity.',
        ].filter(Boolean),
        steps: [
          'Open wallet or history depending on whether queue pressure or failures are more visible.',
          'Process pending withdrawals first so visible and private capital stop drifting apart.',
          'Inspect failure buckets for repeated route mistakes, missing prerequisites, or stale assumptions.',
          'Return to playbook only after the next action list no longer prioritizes cleanup.',
        ],
        whyNow: [
          'Cleanup improves the honesty of every other workspace.',
          'Failure-aware iteration is better than adding more noisy activity to a confused state.',
          'Users trust the product more when pending and retryable edges are explicitly handled.',
        ],
        metrics: [
          { label: 'Pending', value: String(pendingCount) },
          { label: 'Failed', value: String(failureCount) },
          { label: 'Lagging pools', value: String(laggingPools) },
          { label: 'Recent momentum', value: historyWorkspace.velocity.momentum },
        ],
        recommendation:
          pendingCount > 0 || failureCount > 0
            ? 'Treat cleanup as a first-class execution path, not a side task.'
            : 'No cleanup detour is necessary right now, so stay focused on growth routes.',
      },
      {
        id: 'grow_market_and_fiat_optionality',
        title: 'Grow market and fiat optionality',
        lane: 'market',
        tone:
          totalExposure > 0
            ? actionWorkspace.lanes.market.total > 0
              ? 'ready'
              : 'attention'
            : 'blocked',
        destination: actionWorkspace.lanes.market.total > 0 ? '/swap' : '/fiat',
        headline:
          totalExposure > 0
            ? actionWorkspace.lanes.market.total > 0
              ? 'The account has enough history and funding to treat swap and fiat planning as active options.'
              : 'There is enough capital to start learning the market and fiat desks, but route experience is still thin.'
            : 'No capital exists yet, so market or fiat experimentation would mostly be empty planning.',
        detail:
          totalExposure > 0
            ? `With ${portfolioWorkspace.summary.totalExposure} total exposure across visible and shielded lanes, the account can start using the product beyond simple storage. The remaining question is whether market flow is already active or just becoming reachable.`
            : 'The market and fiat surfaces work best after at least some funded capital and route confidence already exist.',
        status:
          totalExposure > 0
            ? actionWorkspace.lanes.market.total > 0
              ? 'Market lanes already active'
              : 'Planning-ready but early'
            : 'Blocked until capital exists',
        requirements: [
          totalExposure > 0
            ? 'At least some funded capital exists to support swap or fiat planning.'
            : 'Capital must be funded before meaningful market planning can happen.',
          authWorkspace.wallet.public.hasXlm || authWorkspace.wallet.private.hasShieldedBalance
            ? 'At least one route lane is funded enough to explore execution planning.'
            : 'Neither public nor private lanes are funded enough yet.',
          contactsWorkspace.summary.contacts > 0
            ? 'Counterparty and relationship data can help interpret route quality.'
            : 'Market route decisions will still feel like a cold start.',
        ],
        blockers: [
          totalExposure === 0 ? 'There is no capital to deploy or model against.' : undefined,
          actionWorkspace.lanes.market.proofsPending > 0
            ? `${actionWorkspace.lanes.market.proofsPending} proof-stage task(s) are still waiting and may deserve cleanup before more growth moves.`
            : undefined,
          !authWorkspace.wallet.public.hasUsdcTrustline
            ? 'Stablecoin optionality is still limited until the USDC trustline is enabled.'
            : undefined,
        ].filter(Boolean),
        steps: [
          'Open swap if you want liquidity discovery, queue visibility, or offer-driven execution planning.',
          'Open fiat if the goal is payout and conversion planning instead of market matching.',
          'Compare public and private route posture before choosing which capital lane to expose to a new market flow.',
          'Come back to playbook after the first market action so future strategy can lean on real execution history.',
        ],
        whyNow: [
          'A wallet that never graduates into swap or fiat planning leaves a lot of route intelligence unused.',
          'Even small first moves create future signal for better decision-making.',
          'Market optionality is stronger when it is layered on top of stable wallet and private posture, not before.',
        ],
        metrics: [
          { label: 'Total exposure', value: String(portfolioWorkspace.summary.totalExposure) },
          { label: 'Open market items', value: String(actionWorkspace.lanes.market.total) },
          { label: 'Open offers', value: String(actionWorkspace.lanes.market.requested) },
          { label: 'Contacts', value: String(contactsWorkspace.summary.contacts) },
        ],
        recommendation:
          totalExposure > 0
            ? 'Use one measured market or fiat action to deepen route intelligence, not just to move capital.'
            : 'Fund the wallet first so market and fiat planning can become real instead of hypothetical.',
      },
    ];

    const actionRail = [
      {
        id: 'playbook-funding',
        label: 'Funding desk',
        href: '/wallet/fund',
        tone: hasFunding ? 'info' : 'critical',
        detail: hasFunding
          ? 'Visible fee liquidity is present, so funding is now about optimization and range rather than emergency setup.'
          : 'Use this first if the account still needs public XLM or trustline preparation.',
      },
      {
        id: 'playbook-wallet',
        label: 'Wallet workspace',
        href: '/wallet',
        tone: hasPrivateBalance ? 'info' : totalPublic > 0 ? 'warning' : 'critical',
        detail: hasPrivateBalance
          ? 'Best place to shape, move, or withdraw capital across visible and shielded lanes.'
          : totalPublic > 0
            ? 'Best place to seed the first private deposit and start note-based flow.'
            : 'Wallet setup remains blocked on visible capital.',
      },
      {
        id: 'playbook-send',
        label: 'Send planner',
        href: '/wallet/send',
        tone: topContact ? (topContact.routeReadiness === 'ready' ? 'info' : 'warning') : 'warning',
        detail: topContact
          ? `Best for validating amount shape and route choice before sending to @${topContact.username}.`
          : 'Use this to create the first clean route relationship and teach the system a reusable counterparty pattern.',
      },
      {
        id: 'playbook-status',
        label: 'Status cockpit',
        href: '/status',
        tone: readiness.status === 'ready' ? 'info' : 'warning',
        detail:
          readiness.status === 'ready'
            ? 'Use this to confirm the app stays fresh while you keep executing.'
            : 'Open this before trusting stale-looking notes, balances, or queue results.',
      },
    ];

    const recentSignals = [
      `Portfolio exposure is ${portfolioWorkspace.summary.totalExposure} across public and private lanes.`,
      topContact
        ? `@${topContact.username} is the current strongest reusable counterparty path with ${topContact.interactions} tracked interaction(s).`
        : 'No strong repeat counterparty exists yet, so the send layer is still relationship-light.',
      hasPrivateBalance
        ? 'Private balance already exists, so protected routing is materially more reachable than a cold-start wallet.'
        : 'No private balance exists yet, so protected routes still depend on the first deposit.',
      laggingPools > 0
        ? `${laggingPools} lagging pool lane(s) can still affect freshness perception.`
        : 'Ops freshness is healthy enough that balance and note views should feel current.',
      failureCount > 0
        ? `${failureCount} failed or retryable action(s) are still adding drag to route confidence.`
        : 'Recent history is not showing unusual failure drag right now.',
    ];

    const posture = {
      readinessTone: portfolioWorkspace.portfolioHealth.tone,
      capitalShape:
        totalExposure === 0
          ? 'Unfunded'
          : totalPrivate > totalPublic
            ? 'Private-led'
            : totalPublic > totalPrivate * 1.5
              ? 'Public-led'
              : 'Balanced',
      marketShape:
        actionWorkspace.lanes.market.total > 0
          ? actionWorkspace.lanes.market.proofsReady > 0 ||
            actionWorkspace.lanes.market.requested > 0
            ? 'Active with follow-up pressure'
            : 'Active and relatively calm'
          : 'Early',
      relationshipShape:
        contactsWorkspace.summary.contacts > 0
          ? contactsWorkspace.summary.privatePreferred > contactsWorkspace.summary.publicPreferred
            ? 'Privacy-friendly graph'
            : 'Visible-route graph'
          : 'Cold-start graph',
      riskShape:
        failureCount > 0 || laggingPools > 0
          ? pendingCount > 0
            ? 'Needs cleanup'
            : 'Watchful'
          : 'Healthy',
    };

    return {
      user: {
        username: user.username,
        stellarPublicKey: user.stellarPublicKey,
        reputation: user.reputation,
      },
      summary: {
        scenarios: scenarioCards.length,
        executable: scenarioCards.filter((item) => item.tone === 'ready').length,
        blocked: scenarioCards.filter((item) => item.tone === 'blocked').length,
        sponsoredOpportunities,
        urgentBlockers: actionWorkspace.summary.critical,
        readyRoutes,
      },
      posture,
      routeComparisons,
      sponsorBoard,
      scenarioCards,
      actionRail,
      recentSignals,
      updatedAt: new Date().toISOString(),
    };
  }

  async getSettlementWorkspace(userId: string) {
    const [
      user,
      walletWorkspace,
      historyWorkspace,
      actionWorkspace,
      portfolioWorkspace,
      authWorkspace,
      readiness,
      audits,
    ] = await Promise.all([
      this.findById(userId),
      this.getWalletWorkspace(userId),
      this.getHistoryWorkspace(userId),
      this.getActionCenterWorkspace(userId),
      this.getPortfolioWorkspace(userId),
      this.authService.getAuthWorkspace(userId),
      this.opsService.getReadiness(),
      this.transactionAuditService.listRecentForUser(userId, 80),
    ]);

    if (!user) {
      throw new Error('User not found');
    }

    const pendingWithdrawals = await this.pendingWithdrawalModel
      .find({ recipientId: new Types.ObjectId(userId), processed: false })
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    const privatePendingEntries = historyWorkspace.latestEntries.filter(
      (item: any) =>
        item.privateFlow &&
        (item.state === 'pending' ||
          item.state === 'queued' ||
          item.indexing?.status === 'pending' ||
          item.indexing?.status === 'lagging'),
    );
    const retryableEntries = historyWorkspace.latestEntries.filter(
      (item: any) => item.state === 'retryable' || item.state === 'failed',
    );
    const laggingPrivateEntries = historyWorkspace.latestEntries.filter(
      (item: any) =>
        item.privateFlow &&
        (item.indexing?.status === 'lagging' || item.indexing?.status === 'pending'),
    );
    const sponsoredEntries = historyWorkspace.latestEntries.filter(
      (item: any) => item.sponsorship?.sponsored,
    );
    const publicSettlementEntries = historyWorkspace.latestEntries.filter(
      (item: any) =>
        !item.privateFlow &&
        (item.state === 'pending' || item.state === 'queued' || item.state === 'retryable'),
    );

    const totals = pendingWithdrawals.reduce(
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

    const settlementSponsorship = await Promise.all(
      ([WalletAsset.USDC, WalletAsset.XLM] as const).flatMap((asset) => [
        this.previewSponsorship(userId, {
          asset,
          operation: 'deposit',
          amount: 1,
        }).then((preview) => ({ key: `deposit_${asset}`, asset, operation: 'deposit', preview })),
        this.previewSponsorship(userId, {
          asset,
          operation: 'withdraw_self',
          amount: 1,
        }).then((preview) => ({
          key: `withdraw_self_${asset}`,
          asset,
          operation: 'withdraw_self',
          preview,
        })),
      ]),
    );

    const sponsorshipBoard = settlementSponsorship.map((item) => ({
      id: item.key,
      asset: item.asset,
      operation: item.operation,
      supported: item.preview.supported,
      sponsored: item.preview.sponsored,
      tone: item.preview.sponsored ? 'ready' : item.preview.supported ? 'attention' : 'blocked',
      reason: item.preview.reason,
      label: `${item.operation.replaceAll('_', ' ')} ${item.asset}`,
    }));

    const queueCards = pendingWithdrawals.map((item: any) => {
      const matchingAudit = audits.find(
        (audit: any) =>
          audit.operation === 'pending_withdrawal' &&
          typeof audit.metadata?.pendingWithdrawalId === 'string' &&
          audit.metadata.pendingWithdrawalId === item._id.toString(),
      ) as any;

      const assetTone =
        item.asset === 'USDC'
          ? Number(walletWorkspace.balances.public.usdc || 0) === 0 &&
            Number(walletWorkspace.balances.private.usdc || 0) > 0
            ? 'attention'
            : 'info'
          : Number(walletWorkspace.balances.public.xlm || 0) === 0 &&
              Number(walletWorkspace.balances.private.xlm || 0) > 0
            ? 'attention'
            : 'info';

      const status =
        matchingAudit?.state ?? (item.processed ? 'success' : item.txHash ? 'pending' : 'queued');

      return {
        id: item._id.toString(),
        asset: item.asset,
        amount: item.amount,
        status,
        tone:
          status === 'success'
            ? 'ready'
            : status === 'failed' || status === 'retryable'
              ? 'attention'
              : 'info',
        txHash: item.txHash,
        createdAt: item.createdAt,
        summary:
          status === 'success'
            ? 'This withdrawal has already been submitted to the visible wallet and should be waiting on chain confirmation only.'
            : status === 'pending'
              ? 'Proof material exists and a transaction hash is present, so this item is past proof generation and into visible settlement.'
              : 'Proof material exists locally, but the visible withdrawal still needs to be processed from the queue.',
        notes: [
          `Pool source: ${item.poolAddress}`,
          matchingAudit?.indexingDetail
            ? `Audit note: ${matchingAudit.indexingDetail}`
            : 'No detailed audit note is attached to this queued withdrawal yet.',
          item.asset === 'USDC'
            ? 'Stablecoin withdrawals are useful when the next route needs visible liquidity or fiat planning.'
            : 'XLM withdrawals are useful when the next route needs fee coverage, visible payments, or simpler recovery.',
        ],
        destination: status === 'queued' ? '/wallet' : '/history',
        assetTone,
      };
    });

    const laneCards = [
      {
        id: 'visible_settlement',
        label: 'Visible settlement lane',
        tone:
          publicSettlementEntries.length > 0
            ? 'attention'
            : Number(walletWorkspace.balances.public.xlm || 0) > 0 ||
                Number(walletWorkspace.balances.public.usdc || 0) > 0
              ? 'ready'
              : 'blocked',
        count: publicSettlementEntries.length,
        total: `${walletWorkspace.balances.public.xlm} XLM / ${walletWorkspace.balances.public.usdc} USDC`,
        detail:
          publicSettlementEntries.length > 0
            ? 'Visible settlement is already carrying pending or retry pressure, so the public wallet may not fully reflect intended state yet.'
            : Number(walletWorkspace.balances.public.xlm || 0) > 0 ||
                Number(walletWorkspace.balances.public.usdc || 0) > 0
              ? 'Visible balances are already funded enough that settlement can complete without depending entirely on fresh deposits.'
              : 'Visible settlement remains weak because the wallet still lacks meaningful public liquidity.',
        nextStep:
          publicSettlementEntries.length > 0
            ? 'Use wallet or history to confirm hashes, retries, and balance refresh instead of assuming visible state is final.'
            : 'Visible settlement is currently calm enough for normal use.',
      },
      {
        id: 'private_settlement',
        label: 'Shielded settlement lane',
        tone:
          privatePendingEntries.length > 0
            ? 'attention'
            : authWorkspace.wallet.private.hasShieldedBalance
              ? 'ready'
              : Number(walletWorkspace.balances.public.xlm || 0) > 0 ||
                  Number(walletWorkspace.balances.public.usdc || 0) > 0
                ? 'info'
                : 'blocked',
        count: privatePendingEntries.length,
        total: `${walletWorkspace.balances.private.xlm} XLM / ${walletWorkspace.balances.private.usdc} USDC`,
        detail:
          privatePendingEntries.length > 0
            ? 'Private settlement is waiting on proof completion, queue processing, or indexer freshness, so note-based balances may still be in motion.'
            : authWorkspace.wallet.private.hasShieldedBalance
              ? 'Shielded balances already exist and no unusual pending settlement pressure is visible right now.'
              : Number(walletWorkspace.balances.public.xlm || 0) > 0 ||
                  Number(walletWorkspace.balances.public.usdc || 0) > 0
                ? 'Shielded settlement is reachable, but it still depends on the first deposit before any private balance can settle back out.'
                : 'Shielded settlement is blocked until visible capital exists and a private note can be created.',
        nextStep:
          privatePendingEntries.length > 0
            ? 'Watch indexer freshness and queue state before assuming private balances have stopped changing.'
            : authWorkspace.wallet.private.hasShieldedBalance
              ? 'Private settlement is stable enough to support further protected routes.'
              : 'Seed the first deposit when you want private settlement to become a real option.',
      },
      {
        id: 'queue_lane',
        label: 'Withdrawal queue lane',
        tone:
          queueCards.length > 0
            ? queueCards.some((item: any) => item.status === 'queued')
              ? 'attention'
              : 'info'
            : 'ready',
        count: queueCards.length,
        total: `${totals.xlm.toFixed(7).replace(/\.?0+$/, '') || '0'} XLM / ${totals.usdc.toFixed(7).replace(/\.?0+$/, '') || '0'} USDC`,
        detail:
          queueCards.length > 0
            ? 'Queued withdrawals represent value that exists in the private flow but still needs visible settlement or confirmation.'
            : 'No queued withdrawals are waiting right now, so there is no settlement backlog between private and public lanes.',
        nextStep:
          queueCards.length > 0
            ? 'Process the queue or verify chain confirmation before treating the corresponding public balance as final.'
            : 'No queue action is required right now.',
      },
      {
        id: 'ops_lane',
        label: 'Indexer freshness lane',
        tone:
          readiness.status === 'ready'
            ? 'ready'
            : readiness.lagging.length > 0
              ? 'attention'
              : 'blocked',
        count: readiness.lagging.length,
        total: `${readiness.counts.trackedPools} tracked pools`,
        detail:
          readiness.status === 'ready'
            ? 'Ops freshness is healthy, so settlement state should feel current across notes, withdrawals, and visible follow-up.'
            : readiness.lagging.length > 0
              ? `${readiness.lagging.length} pool lane(s) are lagging, which can make deposits, notes, and queue outcomes feel stale.`
              : 'Dependency readiness is degraded enough that settlement state should be treated carefully until status improves.',
        nextStep:
          readiness.status === 'ready'
            ? 'Continue monitoring normally.'
            : 'Use the status cockpit before treating stale-looking balances as definitive.',
      },
    ];

    const transitionBoard = [
      {
        id: 'private_to_public',
        label: 'Private to public',
        tone:
          queueCards.length > 0
            ? 'attention'
            : authWorkspace.wallet.private.hasShieldedBalance
              ? 'ready'
              : 'blocked',
        summary:
          queueCards.length > 0
            ? 'Some capital is already on the way back to the visible wallet, so public balances may still be catching up.'
            : authWorkspace.wallet.private.hasShieldedBalance
              ? 'The wallet can unshield value when public spending, fiat planning, or recovery calls for it.'
              : 'There is no settled shielded capital to unshield right now.',
        nextStep:
          queueCards.length > 0
            ? 'Process pending withdrawals and verify resulting hashes.'
            : authWorkspace.wallet.private.hasShieldedBalance
              ? 'Withdraw only when the next route actually needs public visibility.'
              : 'Seed private capital first before expecting to settle back to the public lane.',
      },
      {
        id: 'public_to_private',
        label: 'Public to private',
        tone:
          Number(walletWorkspace.balances.public.xlm || 0) > 0 ||
          Number(walletWorkspace.balances.public.usdc || 0) > 0
            ? authWorkspace.wallet.private.hasShieldedBalance
              ? 'ready'
              : 'info'
            : 'blocked',
        summary:
          Number(walletWorkspace.balances.public.xlm || 0) > 0 ||
          Number(walletWorkspace.balances.public.usdc || 0) > 0
            ? authWorkspace.wallet.private.hasShieldedBalance
              ? 'Visible capital can continue feeding the private lane when you want to deepen protected route capacity.'
              : 'The wallet has visible capital, so the first private settlement path is available whenever you want to unlock it.'
            : 'Public capital is missing, so the next private settlement path cannot start yet.',
        nextStep:
          Number(walletWorkspace.balances.public.xlm || 0) > 0 ||
          Number(walletWorkspace.balances.public.usdc || 0) > 0
            ? 'Use deposit flows deliberately instead of over-exposing the visible lane.'
            : 'Fund visible balance first before trying to improve private settlement posture.',
      },
      {
        id: 'audited_visibility',
        label: 'Audit visibility',
        tone:
          historyWorkspace.summary.failed > 0 || historyWorkspace.summary.pending > 0
            ? 'attention'
            : sponsoredEntries.length > 0 || historyWorkspace.summary.completed > 0
              ? 'ready'
              : 'info',
        summary:
          historyWorkspace.summary.failed > 0 || historyWorkspace.summary.pending > 0
            ? 'The audit stream is showing work-in-progress or failures, so settlement certainty should come from explicit states rather than assumptions.'
            : sponsoredEntries.length > 0 || historyWorkspace.summary.completed > 0
              ? 'Audit visibility is already rich enough to explain most recent settlement behavior.'
              : 'The audit stream is still early and will become more valuable after more real flow passes through it.',
        nextStep:
          historyWorkspace.summary.failed > 0 || historyWorkspace.summary.pending > 0
            ? 'Use history and settlement together when deciding whether a route is actually finished.'
            : 'Audit visibility is strong enough to support normal follow-up.',
      },
    ];

    const riskBoard = [
      {
        id: 'queue_pressure',
        label: 'Queue pressure',
        tone: queueCards.length > 0 ? 'attention' : 'ready',
        detail:
          queueCards.length > 0
            ? `${queueCards.length} queued withdrawal item(s) are still separating private value from visible settlement.`
            : 'No queued withdrawal items are currently holding settlement apart.',
      },
      {
        id: 'retry_pressure',
        label: 'Retry pressure',
        tone: retryableEntries.length > 0 ? 'attention' : 'ready',
        detail:
          retryableEntries.length > 0
            ? `${retryableEntries.length} recent retryable or failed entries are asking for deliberate follow-up.`
            : 'No unusual retry pressure is present in recent activity.',
      },
      {
        id: 'indexer_pressure',
        label: 'Indexer pressure',
        tone:
          laggingPrivateEntries.length > 0 || readiness.lagging.length > 0 ? 'attention' : 'ready',
        detail:
          laggingPrivateEntries.length > 0 || readiness.lagging.length > 0
            ? 'Settlement may feel stale because the indexer still has lagging work across private note visibility or pool sync lanes.'
            : 'Indexer freshness is not the main settlement risk right now.',
      },
      {
        id: 'public_liquidity_pressure',
        label: 'Public liquidity pressure',
        tone:
          Number(walletWorkspace.balances.public.xlm || 0) === 0 &&
          Number(walletWorkspace.balances.public.usdc || 0) === 0
            ? 'blocked'
            : 'info',
        detail:
          Number(walletWorkspace.balances.public.xlm || 0) === 0 &&
          Number(walletWorkspace.balances.public.usdc || 0) === 0
            ? 'Visible settlement is fragile because there is no public balance to absorb or confirm next steps cleanly.'
            : 'Public liquidity exists, so settlement does not rely entirely on future funding.',
      },
    ];

    const recommendedActions = [
      queueCards.length > 0
        ? {
            id: 'settlement-process-queue',
            severity: 'critical',
            title: 'Process queued withdrawals before assuming visible balances are final',
            detail: `${queueCards.length} item(s) are still carrying private value toward the visible wallet.`,
            href: '/wallet',
          }
        : undefined,
      retryableEntries[0]
        ? {
            id: 'settlement-review-retries',
            severity: 'warning',
            title: 'Review retryable settlement activity before repeating the same route',
            detail: `${retryableEntries.length} failed or retryable item(s) remain in the recent audit trail.`,
            href: '/history',
          }
        : undefined,
      readiness.status !== 'ready'
        ? {
            id: 'settlement-check-status',
            severity: 'warning',
            title: 'Check ops freshness before trusting stale private balances',
            detail: `${readiness.lagging.length} lagging pool lane(s) can still distort settlement visibility.`,
            href: '/status',
          }
        : undefined,
      !authWorkspace.wallet.private.hasShieldedBalance &&
      portfolioWorkspace.summary.publicExposure > 0
        ? {
            id: 'settlement-seed-private',
            severity: 'info',
            title: 'Seed private capital so settlement has a second lane',
            detail:
              'Visible exposure exists, but all settlement still depends on public routing and public confirmation.',
            href: '/wallet',
          }
        : undefined,
    ].filter(Boolean);

    const settlementTimeline = historyWorkspace.latestEntries
      .filter(
        (item: any) =>
          item.operation.includes('deposit') ||
          item.operation.includes('withdraw') ||
          item.operation.includes('split') ||
          item.indexing?.status === 'pending' ||
          item.indexing?.status === 'lagging' ||
          item.privateFlow,
      )
      .slice(0, 18)
      .map((item: any) => ({
        id: item.id,
        title: item.title,
        detail: item.detail,
        state: item.state,
        asset: item.asset,
        amountDisplay: item.amountDisplay,
        txHash: item.txHash,
        privateFlow: item.privateFlow,
        indexing: item.indexing,
        sponsorship: item.sponsorship,
        date: item.date,
        statusLabel: item.statusLabel,
      }));

    const assetWindows = [
      {
        asset: 'USDC',
        publicBalance: walletWorkspace.balances.public.usdc,
        privateBalance: walletWorkspace.balances.private.usdc,
        queuedAmount: totals.usdc.toFixed(7).replace(/\.?0+$/, '') || '0',
        tone:
          Number(walletWorkspace.balances.private.usdc || 0) > 0 &&
          Number(walletWorkspace.balances.public.usdc || 0) === 0
            ? 'attention'
            : Number(walletWorkspace.balances.public.usdc || 0) > 0 ||
                Number(walletWorkspace.balances.private.usdc || 0) > 0
              ? 'ready'
              : 'blocked',
        detail:
          Number(walletWorkspace.balances.private.usdc || 0) > 0 &&
          Number(walletWorkspace.balances.public.usdc || 0) === 0
            ? 'USDC value exists privately, but visible stablecoin settlement still depends on withdrawal processing.'
            : Number(walletWorkspace.balances.public.usdc || 0) > 0
              ? 'USDC is already visible enough to support swap, fiat, or repeat payment routes.'
              : 'USDC settlement is still minimal and may need trustline or funding support.',
      },
      {
        asset: 'XLM',
        publicBalance: walletWorkspace.balances.public.xlm,
        privateBalance: walletWorkspace.balances.private.xlm,
        queuedAmount: totals.xlm.toFixed(7).replace(/\.?0+$/, '') || '0',
        tone:
          Number(walletWorkspace.balances.private.xlm || 0) > 0 &&
          Number(walletWorkspace.balances.public.xlm || 0) === 0
            ? 'attention'
            : Number(walletWorkspace.balances.public.xlm || 0) > 0 ||
                Number(walletWorkspace.balances.private.xlm || 0) > 0
              ? 'ready'
              : 'blocked',
        detail:
          Number(walletWorkspace.balances.private.xlm || 0) > 0 &&
          Number(walletWorkspace.balances.public.xlm || 0) === 0
            ? 'Fee-bearing XLM is trapped privately until withdrawal settlement catches up.'
            : Number(walletWorkspace.balances.public.xlm || 0) > 0
              ? 'Visible XLM already supports fee payment and fast public settlement.'
              : 'XLM settlement is still too thin for comfortable fee coverage.',
      },
    ];

    const outlook = [
      queueCards.length > 0
        ? `${queueCards.length} queued withdrawal item(s) mean the visible wallet may still gain balance without a new funding event.`
        : 'No queued withdrawals are waiting to change the visible wallet unexpectedly.',
      laggingPrivateEntries.length > 0
        ? `${laggingPrivateEntries.length} private settlement item(s) are still waiting on indexing or canonical freshness.`
        : 'No unusual private indexing lag is visible in the latest settlement feed.',
      sponsoredEntries.length > 0
        ? `${sponsoredEntries.length} recent sponsored settlement-related touch(es) reduce the effective fee friction around movement between lanes.`
        : 'Settlement is not currently leaning on sponsorship-heavy flow.',
      portfolioWorkspace.portfolioHealth.tone === 'ready'
        ? 'Portfolio posture is healthy enough that settlement should mostly be about timing, not structural weakness.'
        : 'Portfolio posture still has structural gaps, so settlement improvements may need funding or note seeding rather than simple patience.',
    ];

    return {
      user: {
        username: user.username,
        stellarPublicKey: user.stellarPublicKey,
        reputation: user.reputation,
      },
      summary: {
        queuedWithdrawals: queueCards.length,
        retryable: retryableEntries.length,
        laggingPrivate: laggingPrivateEntries.length,
        sponsoredSettlementTouches: sponsoredEntries.length,
        readyLanes: laneCards.filter((item) => item.tone === 'ready').length,
        trackedTimeline: settlementTimeline.length,
      },
      laneCards,
      transitionBoard,
      sponsorshipBoard,
      riskBoard,
      recommendedActions,
      queueCards,
      assetWindows,
      settlementTimeline,
      outlook,
      updatedAt: new Date().toISOString(),
    };
  }

  async getLiquidityWorkspace(userId: string) {
    const [
      user,
      authWorkspace,
      walletWorkspace,
      actionWorkspace,
      contactsWorkspace,
      portfolioWorkspace,
      playbookWorkspace,
      settlementWorkspace,
      historyWorkspace,
      readiness,
      stats,
    ] = await Promise.all([
      this.findById(userId),
      this.authService.getAuthWorkspace(userId),
      this.getWalletWorkspace(userId),
      this.getActionCenterWorkspace(userId),
      this.getContactsWorkspace(userId),
      this.getPortfolioWorkspace(userId),
      this.getPlaybookWorkspace(userId),
      this.getSettlementWorkspace(userId),
      this.getHistoryWorkspace(userId),
      this.opsService.getReadiness(),
      this.opsService.getStats(),
    ]);

    if (!user) {
      throw new Error('User not found');
    }

    const publicXlm = Number(walletWorkspace.balances.public.xlm || 0);
    const publicUsdc = Number(walletWorkspace.balances.public.usdc || 0);
    const privateXlm = Number(walletWorkspace.balances.private.xlm || 0);
    const privateUsdc = Number(walletWorkspace.balances.private.usdc || 0);
    const totalVisible = publicXlm + publicUsdc;
    const totalShielded = privateXlm + privateUsdc;
    const totalCapital = totalVisible + totalShielded;
    const queuedWithdrawals = settlementWorkspace.summary.queuedWithdrawals;
    const retryable = settlementWorkspace.summary.retryable;
    const readyRoutes = playbookWorkspace.summary.readyRoutes;
    const marketLoad = actionWorkspace.lanes.market.total;
    const openOffers = stats.flows?.openOffers ?? 0;
    const swaps = stats.flows?.swaps ?? 0;
    const pendingWithdrawals = stats.flows?.pendingWithdrawals ?? walletWorkspace.pending.count;
    const activeUsers = stats.users?.active24h ?? 0;
    const privatePreferredContacts = contactsWorkspace.summary.privatePreferred;
    const blockedContacts = contactsWorkspace.summary.blocked;

    const capitalSummary = {
      totalCapital: Number(totalCapital.toFixed(4)),
      visibleCapital: Number(totalVisible.toFixed(4)),
      shieldedCapital: Number(totalShielded.toFixed(4)),
      queuedCapital: Number(
        (
          Number(walletWorkspace.pending.byAsset.xlm || 0) +
          Number(walletWorkspace.pending.byAsset.usdc || 0)
        ).toFixed(4),
      ),
      dryPowder: Number(
        (
          Math.max(publicXlm, 0) +
          Math.max(publicUsdc, 0) +
          Math.max(privateXlm * 0.4, 0) +
          Math.max(privateUsdc * 0.4, 0)
        ).toFixed(4),
      ),
    };

    const deploymentWindows = [
      {
        id: 'visible_send',
        label: 'Visible send window',
        tone: totalVisible > 0 ? 'ready' : 'blocked',
        availableCapital: Number(totalVisible.toFixed(4)),
        routeCount: publicXlm > 0 || publicUsdc > 0 ? 1 : 0,
        summary:
          totalVisible > 0
            ? 'Visible balance is immediately deployable for direct wallet sends, fiat planning, or public settlement follow-up.'
            : 'Visible balance is missing, so fast public deployment remains blocked by funding.',
        strongestAsset: publicUsdc >= publicXlm ? 'USDC' : 'XLM',
        nextMove:
          totalVisible > 0
            ? 'Use the send planner, fiat desk, or wallet workspace without waiting on note prep.'
            : 'Open the funding desk and restore public liquidity first.',
      },
      {
        id: 'shielded_send',
        label: 'Shielded send window',
        tone: totalShielded > 0 ? 'ready' : totalVisible > 0 ? 'attention' : 'blocked',
        availableCapital: Number(totalShielded.toFixed(4)),
        routeCount:
          privatePreferredContacts > 0 ? privatePreferredContacts : totalShielded > 0 ? 1 : 0,
        summary:
          totalShielded > 0
            ? 'Shielded balances are deployable for protected sends, note-driven planning, and more privacy-native route choices.'
            : totalVisible > 0
              ? 'Shielded deployment is reachable, but only after a first deposit or note-shaping step.'
              : 'There is no capital in a state that can feed the shielded lane yet.',
        strongestAsset: privateUsdc >= privateXlm ? 'USDC' : 'XLM',
        nextMove:
          totalShielded > 0
            ? 'Use private send or market routes that benefit from note-based capital.'
            : totalVisible > 0
              ? 'Deposit visible capital to create the first deployable private window.'
              : 'Fund visible capital before trying to deploy private routes.',
      },
      {
        id: 'market_window',
        label: 'Market liquidity window',
        tone:
          totalCapital > 0 ? (marketLoad > 0 || openOffers > 0 ? 'ready' : 'attention') : 'blocked',
        availableCapital: Number(
          (publicUsdc + privateUsdc + publicXlm * 0.3 + privateXlm * 0.3).toFixed(4),
        ),
        routeCount: openOffers + marketLoad,
        summary:
          totalCapital > 0
            ? marketLoad > 0 || openOffers > 0
              ? 'Capital can already lean into swap and offer routes with some visible market structure around it.'
              : 'Capital exists, but market use is still early and needs the first deliberate swap or offer action.'
            : 'No capital exists to deploy into swap or offer routes yet.',
        strongestAsset: publicUsdc + privateUsdc >= publicXlm + privateXlm ? 'USDC' : 'XLM',
        nextMove:
          totalCapital > 0
            ? marketLoad > 0 || openOffers > 0
              ? 'Use swap or seller desks to move beyond storage into routed market execution.'
              : 'Take a first measured market action so capital learns a usable route.'
            : 'Fund or seed the wallet before expecting market routes to matter.',
      },
      {
        id: 'recovery_window',
        label: 'Recovery liquidity window',
        tone:
          queuedWithdrawals > 0 || retryable > 0
            ? 'attention'
            : totalVisible > 0
              ? 'ready'
              : 'blocked',
        availableCapital: Number(
          (
            publicXlm +
            publicUsdc +
            Number(walletWorkspace.pending.byAsset.xlm || 0) +
            Number(walletWorkspace.pending.byAsset.usdc || 0)
          ).toFixed(4),
        ),
        routeCount: settlementWorkspace.summary.readyLanes,
        summary:
          queuedWithdrawals > 0 || retryable > 0
            ? 'Some capital is still in a recovery-sensitive state, so settlement clarity matters before redeploying it aggressively.'
            : totalVisible > 0
              ? 'Visible capital and a calm queue make recovery and follow-up deployment relatively safe.'
              : 'Recovery flexibility is weak because the public lane lacks enough settled liquidity.',
        strongestAsset:
          publicXlm + Number(walletWorkspace.pending.byAsset.xlm || 0) >=
          publicUsdc + Number(walletWorkspace.pending.byAsset.usdc || 0)
            ? 'XLM'
            : 'USDC',
        nextMove:
          queuedWithdrawals > 0 || retryable > 0
            ? 'Use settlement or history before treating this capital as free for new routes.'
            : totalVisible > 0
              ? 'Recovery liquidity is stable enough to support follow-up sends or fiat planning.'
              : 'Rebuild visible liquidity so recovery is not dependent on future settlement.',
      },
    ];

    const capitalLanes = [
      {
        id: 'public_xlm',
        label: 'Public XLM',
        amount: publicXlm,
        share: totalCapital > 0 ? Number(((publicXlm / totalCapital) * 100).toFixed(1)) : 0,
        tone: publicXlm > 0 ? 'ready' : 'blocked',
        role: 'fees, visible sends, and fast settlement',
        risk:
          publicXlm > 0
            ? 'This lane is strong when the next move needs fees or public confirmation.'
            : 'Without public XLM, most quick public actions become fragile.',
      },
      {
        id: 'public_usdc',
        label: 'Public USDC',
        amount: publicUsdc,
        share: totalCapital > 0 ? Number(((publicUsdc / totalCapital) * 100).toFixed(1)) : 0,
        tone:
          publicUsdc > 0
            ? 'ready'
            : authWorkspace.wallet.public.hasUsdcTrustline
              ? 'attention'
              : 'blocked',
        role: 'stable visible payments, fiat readiness, and public market use',
        risk:
          publicUsdc > 0
            ? 'This lane is useful when the next move benefits from visible stablecoin liquidity.'
            : authWorkspace.wallet.public.hasUsdcTrustline
              ? 'The trustline is ready, but stablecoin liquidity has not settled publicly yet.'
              : 'Stablecoin routes are still gated by trustline or funding readiness.',
      },
      {
        id: 'private_xlm',
        label: 'Private XLM',
        amount: privateXlm,
        share: totalCapital > 0 ? Number(((privateXlm / totalCapital) * 100).toFixed(1)) : 0,
        tone: privateXlm > 0 ? 'ready' : totalVisible > 0 ? 'info' : 'blocked',
        role: 'protected fee-bearing movement and shielded route flexibility',
        risk:
          privateXlm > 0
            ? 'This lane supports private movement, but it may still need withdrawal to become publicly spendable.'
            : totalVisible > 0
              ? 'Private XLM is reachable after deposit, but not yet deployable.'
              : 'No shielded XLM exists yet.',
      },
      {
        id: 'private_usdc',
        label: 'Private USDC',
        amount: privateUsdc,
        share: totalCapital > 0 ? Number(((privateUsdc / totalCapital) * 100).toFixed(1)) : 0,
        tone: privateUsdc > 0 ? 'ready' : totalVisible > 0 ? 'info' : 'blocked',
        role: 'protected stablecoin routes, private swaps, and hidden balance posture',
        risk:
          privateUsdc > 0
            ? 'This lane expands privacy-native stablecoin routing.'
            : totalVisible > 0
              ? 'Private USDC can be created, but the wallet has not seeded it yet.'
              : 'There is no capital available to create private stablecoin exposure.',
      },
    ];

    const idleCapitalBoard = [
      {
        id: 'public_idle',
        label: 'Visible idle capital',
        tone:
          totalVisible > 0 && totalShielded === 0 && marketLoad === 0
            ? 'attention'
            : totalVisible > 0
              ? 'info'
              : 'blocked',
        amount: Number(totalVisible.toFixed(4)),
        detail:
          totalVisible > 0 && totalShielded === 0 && marketLoad === 0
            ? 'Visible capital is doing most of the work while privacy and market routes remain underused.'
            : totalVisible > 0
              ? 'Visible capital is present, but it is not necessarily idle if settlement and send routes still need it.'
              : 'No visible idle capital exists right now.',
      },
      {
        id: 'private_idle',
        label: 'Shielded idle capital',
        tone:
          totalShielded > 0 &&
          queuedWithdrawals === 0 &&
          privatePreferredContacts === 0 &&
          marketLoad === 0
            ? 'attention'
            : totalShielded > 0
              ? 'info'
              : 'blocked',
        amount: Number(totalShielded.toFixed(4)),
        detail:
          totalShielded > 0 &&
          queuedWithdrawals === 0 &&
          privatePreferredContacts === 0 &&
          marketLoad === 0
            ? 'Private capital exists, but there is little current route pressure using its privacy advantage.'
            : totalShielded > 0
              ? 'Shielded capital is present, though it may still be strategically useful even if not immediately deployed.'
              : 'No shielded idle capital exists yet.',
      },
      {
        id: 'queued_idle',
        label: 'Queued capital',
        tone: queuedWithdrawals > 0 ? 'attention' : 'ready',
        amount: Number(
          (
            Number(walletWorkspace.pending.byAsset.xlm || 0) +
            Number(walletWorkspace.pending.byAsset.usdc || 0)
          ).toFixed(4),
        ),
        detail:
          queuedWithdrawals > 0
            ? 'This capital is not idle in a helpful sense. It is waiting on settlement and should not be counted twice.'
            : 'No material queued capital is distorting deployable liquidity right now.',
      },
      {
        id: 'blocked_relationship_liquidity',
        label: 'Blocked relationship liquidity',
        tone: blockedContacts > 0 ? 'attention' : 'ready',
        amount: Number((blockedContacts * 0.5 + privatePreferredContacts * 0.2).toFixed(1)),
        detail:
          blockedContacts > 0
            ? `${blockedContacts} contact route(s) are blocked, which means some liquidity cannot be used as cleanly as the raw balances suggest.`
            : 'Relationship-driven liquidity is not visibly blocked right now.',
      },
    ];

    const deploymentScenarios = [
      {
        id: 'fee-and-recovery',
        title: 'Protect fee and recovery liquidity',
        tone: publicXlm > 0 ? 'ready' : 'blocked',
        destination: '/wallet/fund',
        capital: Number(publicXlm.toFixed(4)),
        summary:
          publicXlm > 0
            ? 'Visible XLM should stay funded enough that no route collapses because of missing fees.'
            : 'Fee and recovery liquidity is too thin, so every other route remains more brittle than it should be.',
        steps: [
          'Keep visible XLM funded for fees, trustline changes, and public fallbacks.',
          'Avoid over-deploying all visible XLM into the private lane unless a strong reason exists.',
          'Revisit this lane after any large withdrawal or market action that materially drains fee coverage.',
        ],
      },
      {
        id: 'seed-private-optionality',
        title: 'Convert visible capital into private optionality',
        tone:
          totalVisible > 0 && totalShielded === 0
            ? 'attention'
            : totalShielded > 0
              ? 'ready'
              : 'blocked',
        destination: '/wallet',
        capital: Number((publicUsdc + publicXlm).toFixed(4)),
        summary:
          totalVisible > 0 && totalShielded === 0
            ? 'Visible liquidity exists, but the account is still missing deployable private optionality.'
            : totalShielded > 0
              ? 'Private optionality is already present, so further seeding is now a strategic choice rather than a prerequisite.'
              : 'No visible capital exists to convert into private optionality yet.',
        steps: [
          'Choose which asset should first create private route capacity.',
          'Deposit enough to make protected sends and protected market flow genuinely usable.',
          'Return to portfolio or playbook once the shielded lane exists and can be compared against visible deployment.',
        ],
      },
      {
        id: 'redeploy-settled-stablecoin',
        title: 'Redeploy stablecoin once visibly settled',
        tone:
          publicUsdc > 0
            ? 'ready'
            : privateUsdc > 0 || Number(walletWorkspace.pending.byAsset.usdc || 0) > 0
              ? 'attention'
              : 'blocked',
        destination: publicUsdc > 0 ? '/fiat' : '/settlement',
        capital: Number(
          (publicUsdc + privateUsdc + Number(walletWorkspace.pending.byAsset.usdc || 0)).toFixed(4),
        ),
        summary:
          publicUsdc > 0
            ? 'Stablecoin liquidity is already public enough for fiat, swaps, or repeat payments.'
            : privateUsdc > 0 || Number(walletWorkspace.pending.byAsset.usdc || 0) > 0
              ? 'Stablecoin capital exists, but some of it is still private or queued instead of visibly deployable.'
              : 'Stablecoin deployment is still weak because the wallet lacks meaningful USDC liquidity.',
        steps: [
          'Verify whether the stablecoin is public, private, or still queued in settlement.',
          'Use fiat or market desks only once the lane you need is actually visible and settled.',
          'Avoid treating queued USDC as immediately deployable in visible-only routes.',
        ],
      },
      {
        id: 'market-pressure-deployment',
        title: 'Answer market pressure with the right lane',
        tone:
          totalCapital > 0
            ? marketLoad > 0 || openOffers > 0 || swaps > 0
              ? 'ready'
              : 'info'
            : 'blocked',
        destination: '/swap',
        capital: Number((totalCapital * 0.65).toFixed(4)),
        summary:
          totalCapital > 0
            ? marketLoad > 0 || openOffers > 0 || swaps > 0
              ? 'There is enough capital and enough market signal that deployment can become route-aware instead of hypothetical.'
              : 'The account has capital, but market pressure is still early and may not justify aggressive deployment yet.'
            : 'No capital exists to answer market pressure yet.',
        steps: [
          'Check whether visible or private capital best matches the market route you actually want.',
          'Do not over-expose visible liquidity if the market opportunity benefits from privacy.',
          'Use seller or swap desks after confirming settlement and fee posture are strong enough.',
        ],
      },
    ];

    const pressureBoard = [
      {
        id: 'ops-pressure',
        label: 'Ops pressure',
        tone: readiness.status === 'ready' ? 'ready' : 'attention',
        value: `${readiness.lagging.length} lagging pool lane(s)`,
        detail:
          readiness.status === 'ready'
            ? 'Ops freshness is not materially reducing deployable liquidity right now.'
            : 'Lagging pool lanes can make liquidity appear less deployable than it really is until state catches up.',
      },
      {
        id: 'queue-pressure',
        label: 'Queue pressure',
        tone: queuedWithdrawals > 0 ? 'attention' : 'ready',
        value: `${queuedWithdrawals} queued withdrawal(s)`,
        detail:
          queuedWithdrawals > 0
            ? 'Some capital is still between private and public lanes.'
            : 'No material queue pressure is currently slowing deployment choices.',
      },
      {
        id: 'relationship-pressure',
        label: 'Relationship pressure',
        tone: blockedContacts > 0 ? 'attention' : 'info',
        value: `${contactsWorkspace.summary.contacts} contact(s) tracked`,
        detail:
          blockedContacts > 0
            ? 'Blocked counterparties reduce how easily existing balances can be reused.'
            : 'Counterparty quality is not obviously limiting deployment right now.',
      },
      {
        id: 'activity-pressure',
        label: 'Activity pressure',
        tone: retryable > 0 || pendingWithdrawals > 0 ? 'attention' : 'info',
        value: `${historyWorkspace.summary.pending} pending / ${historyWorkspace.summary.failed} failed`,
        detail:
          retryable > 0 || pendingWithdrawals > 0
            ? 'Recent unfinished activity is still pulling attention away from fresh deployment.'
            : 'Recent activity is not heavily distorting deployment confidence.',
      },
    ];

    const actionBoard = [
      !authWorkspace.wallet.public.hasXlm
        ? {
            id: 'liquidity-fund-xlm',
            severity: 'critical',
            title: 'Restore visible XLM before trying to deploy capital elsewhere',
            detail:
              'Fee liquidity is the narrowest choke point in the whole system when visible XLM is absent.',
            href: '/wallet/fund',
          }
        : undefined,
      totalVisible > 0 && totalShielded === 0
        ? {
            id: 'liquidity-seed-private',
            severity: 'warning',
            title: 'Create a private deployment lane instead of leaving all capital visible',
            detail:
              'Right now the wallet is over-dependent on public liquidity for every route choice.',
            href: '/wallet',
          }
        : undefined,
      queuedWithdrawals > 0
        ? {
            id: 'liquidity-process-queue',
            severity: 'warning',
            title: 'Settle queued withdrawals before double-counting that capital',
            detail:
              'Queued value is real, but it is not fully redeployable until settlement completes.',
            href: '/settlement',
          }
        : undefined,
      marketLoad === 0 && totalCapital > 0 && activeUsers > 0
        ? {
            id: 'liquidity-use-market',
            severity: 'info',
            title:
              'Use one market or fiat route so capital starts learning real deployment behavior',
            detail:
              'There is funded capital and active usage around the product, but your own deployment graph is still light.',
            href: '/swap',
          }
        : undefined,
    ].filter(Boolean);

    const routeRadar = [
      {
        id: 'wallet-route',
        label: 'Wallet route',
        tone: totalVisible > 0 ? 'ready' : 'blocked',
        score: Math.max(0, Math.min(100, Math.round(publicXlm * 12 + publicUsdc * 6))),
        detail:
          totalVisible > 0
            ? 'Best for immediate balance control, trustline action, and visible sends.'
            : 'Still blocked by missing visible liquidity.',
      },
      {
        id: 'private-route',
        label: 'Private route',
        tone: totalShielded > 0 ? 'ready' : totalVisible > 0 ? 'attention' : 'blocked',
        score: Math.max(
          0,
          Math.min(
            100,
            Math.round(privateXlm * 9 + privateUsdc * 9 + privatePreferredContacts * 6),
          ),
        ),
        detail:
          totalShielded > 0
            ? 'Best for protected transfer and privacy-led deployment.'
            : totalVisible > 0
              ? 'Reachable after seeding a first private deposit.'
              : 'Not reachable yet.',
      },
      {
        id: 'market-route',
        label: 'Market route',
        tone: totalCapital > 0 ? (marketLoad > 0 || openOffers > 0 ? 'ready' : 'info') : 'blocked',
        score: Math.max(0, Math.min(100, Math.round((openOffers + swaps) * 5 + totalCapital * 3))),
        detail:
          totalCapital > 0
            ? 'Best when you want routed deployment instead of static storage.'
            : 'Needs funded capital first.',
      },
      {
        id: 'recovery-route',
        label: 'Recovery route',
        tone:
          queuedWithdrawals > 0 || retryable > 0
            ? 'attention'
            : totalVisible > 0
              ? 'ready'
              : 'blocked',
        score: Math.max(
          0,
          Math.min(
            100,
            Math.round((publicXlm + publicUsdc) * 4 + settlementWorkspace.summary.readyLanes * 9),
          ),
        ),
        detail:
          queuedWithdrawals > 0 || retryable > 0
            ? 'Important right now because some capital still needs clarity before reuse.'
            : 'Calm enough that recovery is not the main deployment concern.',
      },
    ];

    const outlook = [
      totalCapital > 0
        ? `The account has ${capitalSummary.totalCapital} total capital across visible and shielded lanes.`
        : 'The account still has no meaningful capital to deploy.',
      totalVisible > totalShielded
        ? 'Visible capital currently dominates, so the easiest next moves will still favor public routes.'
        : totalShielded > totalVisible
          ? 'Shielded capital currently dominates, so protected routes and settlement discipline matter more.'
          : 'Visible and shielded capital are relatively balanced right now.',
      queuedWithdrawals > 0
        ? `${queuedWithdrawals} queued withdrawal item(s) mean some liquidity is real but not fully public yet.`
        : 'No queued withdrawals are hiding future visible balance changes right now.',
      marketLoad > 0 || openOffers > 0
        ? `There are ${marketLoad} market task(s) and ${openOffers} open offer(s), so route-aware deployment has a meaningful surface to work with.`
        : 'Market pressure is still light, so capital deployment can stay conservative unless you want to grow route history.',
    ];

    return {
      user: {
        username: user.username,
        stellarPublicKey: user.stellarPublicKey,
        reputation: user.reputation,
      },
      summary: {
        windows: deploymentWindows.length,
        readyWindows: deploymentWindows.filter((item) => item.tone === 'ready').length,
        blockedWindows: deploymentWindows.filter((item) => item.tone === 'blocked').length,
        routeScoreAverage: Math.round(
          routeRadar.reduce((sum, item) => sum + item.score, 0) / routeRadar.length,
        ),
        activeUsers,
        dryPowder: capitalSummary.dryPowder,
      },
      capitalSummary,
      deploymentWindows,
      capitalLanes,
      idleCapitalBoard,
      deploymentScenarios,
      pressureBoard,
      actionBoard,
      routeRadar,
      outlook,
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
    const looksLikePublicKey =
      recipientIdentifier.startsWith('G') && recipientIdentifier.length === 56;
    const byUsername = looksLikePublicKey ? null : await this.findByUsername(recipientIdentifier);
    const byPublicKey = looksLikePublicKey
      ? await this.findByStellarPublicKey(recipientIdentifier)
      : null;
    const resolvedUser = byUsername ?? byPublicKey;

    return {
      identifier: recipientIdentifier,
      resolved: !!resolvedUser || looksLikePublicKey,
      type: resolvedUser ? 'user' : looksLikePublicKey ? 'public_key' : 'unknown',
      username: resolvedUser?.username,
      stellarPublicKey:
        resolvedUser?.stellarPublicKey ?? (looksLikePublicKey ? recipientIdentifier : undefined),
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
    if (
      detail.includes('index') ||
      entry.indexing?.status === 'pending' ||
      entry.indexing?.status === 'lagging'
    ) {
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

  private computeHistoryVelocity(
    timeline: Array<{ date: string | Date | undefined; state: string }>,
  ) {
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
        pending: recent24h.filter((item) => item.state === 'pending' || item.state === 'queued')
          .length,
      },
      last7d: {
        total: recent7d.length,
        successful: successful7d,
        dailyAverage: Number((recent7d.length / 7).toFixed(2)),
      },
      momentum: recent24h.length >= 8 ? 'high' : recent24h.length >= 3 ? 'moderate' : 'light',
    };
  }
}
