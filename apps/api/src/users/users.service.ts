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
  // ShieldedPool transfers a fixed amount per deposit/withdraw.
  // Keep this in sync with `packages/contracts/shielded_pool/src/lib.rs`.
  private static readonly SHIELDED_POOL_FIXED_AMOUNT = 10_000_000n; // 1 token (6 decimals)

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

  /** Private balance from decrypted notes (indexer-stored). */
  async getPrivateBalance(userId: string): Promise<{ xlm: string; usdc: string }> {
    const user = await this.findById(userId);
    if (!user || !user.googleId) return { xlm: '0', usdc: '0' };

    let viewKey: Uint8Array;
    try {
      const encKey = this.authService.getDecryptionKeyForUser(user, user.googleId, user.email);
      const viewKeyHex = this.authService.decrypt(user.zkViewKeyEncrypted, encKey);
      viewKey = new Uint8Array(Buffer.from(viewKeyHex, 'hex'));
    } catch {
      return { xlm: '0', usdc: '0' };
    }

    // Prefer notes explicitly addressed to this user (newer writes), but keep a fallback for older
    // notes that didn't set recipientId.
    const byRecipient = await this.encryptedNoteModel
      .find({ recipientId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(2000)
      .exec();
    const notes = byRecipient.length
      ? byRecipient
      : await this.encryptedNoteModel.find({}).sort({ createdAt: -1 }).limit(2000).exec();
    let usdc = 0;
    let xlm = 0;
    for (const note of notes) {
      if (!note.ciphertext) continue;
      try {
        const combined = Buffer.from(note.ciphertext, 'base64');
        const nonce = combined.slice(0, nacl.secretbox.nonceLength);
        const ciphertext = combined.slice(nacl.secretbox.nonceLength);
        const decrypted = nacl.secretbox.open(
          new Uint8Array(ciphertext),
          new Uint8Array(nonce),
          viewKey,
        );
        if (decrypted) {
          const obj = JSON.parse(naclUtil.encodeUTF8(decrypted)) as { value?: number; asset?: string };
          const v = Number(obj?.value ?? 0);
          if (obj?.asset === 'USDC') usdc += v;
          if (obj?.asset === 'XLM') xlm += v;
        }
      } catch {
        // skip
      }
    }
    return { usdc: String(usdc), xlm: String(xlm) };
  }

  /** Private send: generate proof from sender's spendable note, create pending withdrawal for recipient. */
  async sendPrivate(
    senderId: string,
    recipientIdentifier: string,
    asset: 'USDC' | 'XLM',
    amount: string,
  ): Promise<{ success: boolean; error?: string }> {
    const recipient = await this.findByUsername(recipientIdentifier) ?? await this.findByStellarPublicKey(recipientIdentifier);
    if (!recipient || !recipient.googleId) return { success: false, error: 'Recipient not found' };

    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) return { success: false, error: 'Invalid amount' };
    // ShieldedPool only supports fixed-amount notes/transfers.
    if (amountNum !== 1) return { success: false, error: 'Private transfers currently support only amount=1' };

    const poolAddress =
      asset === 'USDC'
        ? (process.env.SHIELDED_POOL_ADDRESS ?? '')
        : (process.env.SHIELDED_POOL_XLM_ADDRESS ?? process.env.SHIELDED_POOL_ADDRESS ?? '');
    if (!poolAddress) return { success: false, error: 'Pool not configured for this asset' };

    const notes = await this.getSpendableNotes(senderId, asset, UsersService.SHIELDED_POOL_FIXED_AMOUNT);
    if (notes.length === 0) return { success: false, error: 'No spendable private balance. Deposit first.' };

    // Get sender's public key for the contract call
    const sender = await this.findById(senderId);
    if (!sender) return { success: false, error: 'Sender not found' };

    const note = notes[0];
    const stateRoot = await this.sorobanService.getMerkleRoot(poolAddress, sender.stellarPublicKey);

    const leaves = await this.sorobanService.getCommitments(poolAddress, sender.stellarPublicKey);
    const commitmentBytes = new Uint8Array(Buffer.from(note.commitment, 'hex'));
    const stateIndex = leaves.findIndex((l) => Buffer.from(l).equals(Buffer.from(commitmentBytes)));
    if (stateIndex < 0) return { success: false, error: 'Deposit not indexed on-chain yet. Wait and retry.' };
    const stateSiblings = await this.merkleTree.computeSiblingsForIndex(leaves, stateIndex, 20);

    const { proofBytes, pubSignalsBytes, nullifierHex } = await this.proofService.generateProof(
      { label: note.label, value: note.value, nullifier: note.nullifier, secret: note.secret },
      stateRoot,
      UsersService.SHIELDED_POOL_FIXED_AMOUNT,
      { commitmentBytes, stateIndex, stateSiblings },
    );

    await this.pendingWithdrawalModel.create({
      recipientId: recipient._id,
      proofBytes: Buffer.from(proofBytes).toString('base64'),
      pubSignalsBytes: Buffer.from(pubSignalsBytes).toString('base64'),
      nullifier: nullifierHex,
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

    await this.markNoteSpent(senderId, nullifierHex);
    return { success: true };
  }

  /** Process pending withdrawals for the current user (submit withdraw txs to ShieldedPool). */
  async processPendingWithdrawals(userId: string): Promise<{ processed: number; txHashes: string[] }> {
    const user = await this.findById(userId);
    if (!user || !user.googleId) throw new Error('User not found');

    const poolAddress = process.env.SHIELDED_POOL_ADDRESS;
    if (!poolAddress) throw new Error('SHIELDED_POOL_ADDRESS not configured');

    const encKey = this.authService.getDecryptionKeyForUser(user, user.googleId, user.email);
    const secretKey = this.authService.decrypt(user.stellarSecretKeyEncrypted, encKey);

    const pending = await this.pendingWithdrawalModel.find({ recipientId: new Types.ObjectId(userId), processed: false }).exec();
    const txHashes: string[] = [];

    for (const p of pending) {
      try {
        const proofBytes = Buffer.from(p.proofBytes, 'base64');
        const pubSignalsBytes = Buffer.from(p.pubSignalsBytes, 'base64');
        const nullifierBytes = Buffer.from(p.nullifier, 'hex');
        const hash = await this.sorobanService.invokeShieldedPoolWithdraw(
          poolAddress,
          secretKey,
          user.stellarPublicKey,
          new Uint8Array(proofBytes),
          new Uint8Array(pubSignalsBytes),
          new Uint8Array(nullifierBytes),
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
  async deposit(userId: string, asset: 'USDC' | 'XLM'): Promise<{ txHash: string; error?: string }> {
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

      const noteFields: NoteFields = {
        value: UsersService.SHIELDED_POOL_FIXED_AMOUNT,
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
        console.error('[UsersService] deposit: failed to create EncryptedNote for private balance:', e);
      }

      return { txHash };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error('[UsersService] deposit error:', e);
      return { txHash: '', error: message };
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

  /** Mark a spendable note as spent (by nullifier). */
  async markNoteSpent(userId: string, nullifierHex: string): Promise<void> {
    const notes = await this.spendableNoteModel
      .find({ userId, spent: false })
      .exec();
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
        const obj = JSON.parse(naclUtil.encodeUTF8(decrypted)) as { nullifier: string };
        const noteNullifierHex = BigInt(obj.nullifier).toString(16).padStart(64, '0');
        if (noteNullifierHex === nullifierHex.replace(/^0x/, '').toLowerCase().padStart(64, '0')) {
          note.spent = true;
          await note.save();
          return;
        }
      } catch {
        // skip
      }
    }
  }
}
