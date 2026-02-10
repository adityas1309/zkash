import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Swap } from '../schemas/swap.schema';
import { User } from '../schemas/user.schema';
import { AuthService } from '../auth/auth.service';
import { UsersService } from '../users/users.service';
import { SorobanService } from '../soroban/soroban.service';
import { ProofService } from '../zk/proof.service';
import { MerkleTreeService } from '../zk/merkle-tree.service';
import { Asset, Horizon, Keypair, Networks, TransactionBuilder, Operation } from '@stellar/stellar-sdk';

@Injectable()
export class SwapService {
  private server: Horizon.Server;
  // Keep in sync with ShieldedPool FIXED_AMOUNT.
  private static readonly SHIELDED_POOL_FIXED_AMOUNT = 10_000_000n; // 1 token (6 decimals)

  constructor(
    @InjectModel(Swap.name) private swapModel: Model<Swap>,
    @InjectModel(User.name) private userModel: Model<User>,
    @Inject(forwardRef(() => AuthService)) private authService: AuthService,
    @Inject(forwardRef(() => UsersService)) private usersService: UsersService,
    private sorobanService: SorobanService,
    private proofService: ProofService,
    private merkleTree: MerkleTreeService,
  ) {
    const rpcUrl = process.env.RPC_URL || '';
    const horizonUrl = rpcUrl.includes('horizon') ? rpcUrl : 'https://horizon-testnet.stellar.org';
    this.server = new Horizon.Server(horizonUrl);
  }

  async request(aliceId: Types.ObjectId, bobId: Types.ObjectId, amountIn: number, amountOut: number) {
    return this.swapModel.create({
      aliceId,
      bobId,
      status: 'requested',
      amountIn,
      amountOut,
    });
  }

  async accept(swapId: string, bobId: Types.ObjectId) {
    const swap = await this.swapModel.findById(swapId).exec();
    if (!swap || swap.bobId.toString() !== bobId.toString()) return null;
    swap.status = 'locked';
    return swap.save();
  }

  // Execute the actual Stellar swap transaction
  async executeSwap(swapId: string, sellerId: Types.ObjectId): Promise<{ txHash: string }> {
    const swap = await this.swapModel.findById(swapId).exec();
    if (!swap) throw new Error('Swap not found');
    if (swap.status !== 'locked') throw new Error('Swap must be locked to execute');
    if (swap.bobId.toString() !== sellerId.toString()) throw new Error('Only the seller can execute');

    // Get both users
    const seller = await this.userModel.findById(swap.bobId).exec();
    const buyer = await this.userModel.findById(swap.aliceId).exec();

    if (!seller || !buyer) throw new Error('Users not found');
    if (!seller.googleId || !buyer.googleId) throw new Error('Google IDs required');

    // Decrypt seller's secret key
    const sellerEncryptionKey = this.authService.getDecryptionKeyForUser(seller, seller.googleId, seller.email);
    const sellerSecretKey = this.authService.decrypt(seller.stellarSecretKeyEncrypted, sellerEncryptionKey);
    const sellerKeypair = Keypair.fromSecret(sellerSecretKey);

    // Decrypt buyer's secret key
    const buyerEncryptionKey = this.authService.getDecryptionKeyForUser(buyer, buyer.googleId, buyer.email);
    const buyerSecretKey = this.authService.decrypt(buyer.stellarSecretKeyEncrypted, buyerEncryptionKey);
    const buyerKeypair = Keypair.fromSecret(buyerSecretKey);

    // Load seller's account (source account for the transaction)
    const sellerAccount = await this.server.loadAccount(seller.stellarPublicKey);

    // USDC asset on testnet
    const usdcIssuer = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
    const usdcAsset = new Asset('USDC', usdcIssuer);

    // Build atomic swap transaction:
    // 1. Seller sends USDC to buyer
    // 2. Buyer sends XLM to seller
    const tx = new TransactionBuilder(sellerAccount, {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      // Seller sends USDC to buyer
      .addOperation(
        Operation.payment({
          destination: buyer.stellarPublicKey,
          asset: usdcAsset,
          amount: swap.amountOut.toString(),
        })
      )
      // Buyer sends XLM to seller
      .addOperation(
        Operation.payment({
          source: buyer.stellarPublicKey,
          destination: seller.stellarPublicKey,
          asset: Asset.native(),
          amount: swap.amountIn.toString(),
        })
      )
      .setTimeout(30)
      .build();

    // Both parties sign the transaction
    tx.sign(sellerKeypair);
    tx.sign(buyerKeypair);

    // Submit the transaction
    const result = await this.server.submitTransaction(tx);
    const txHash = result.hash;

    // Update swap status
    swap.status = 'completed';
    swap.txHash = txHash;
    await swap.save();

    console.log(`[SwapService] Swap ${swapId} completed with tx: ${txHash}`);

    return { txHash };
  }

  async complete(swapId: string, txHash: string) {
    return this.swapModel.findByIdAndUpdate(swapId, { status: 'completed', txHash }, { new: true }).exec();
  }

  /** Generate and store my proof for a locked swap (caller is alice or bob). */
  async prepareMyProof(swapId: string, userId: Types.ObjectId): Promise<{ ready: boolean; error?: string }> {
    const swap = await this.swapModel.findById(swapId).exec();
    if (!swap || swap.status !== 'locked') return { ready: false, error: 'Swap not found or not locked' };

    const isAlice = swap.aliceId.toString() === userId.toString();
    const isBob = swap.bobId.toString() === userId.toString();
    if (!isAlice && !isBob) return { ready: false, error: 'You are not a party to this swap' };

    const asset: 'USDC' | 'XLM' = isAlice ? 'USDC' : 'XLM';
    // Shielded pool supports only fixed-amount notes/proofs.
    // (Swap UI may show different amounts, but private execution requires fixed notes.)
    const minValue = SwapService.SHIELDED_POOL_FIXED_AMOUNT;
    const poolAddress =
      asset === 'USDC'
        ? (process.env.SHIELDED_POOL_ADDRESS ?? '')
        : (process.env.SHIELDED_POOL_XLM_ADDRESS ?? process.env.SHIELDED_POOL_ADDRESS ?? '');
    if (!poolAddress) return { ready: false, error: 'Pool not configured' };

    const notes = await this.usersService.getSpendableNotes(userId.toString(), asset, minValue);
    if (notes.length === 0) return { ready: false, error: 'No spendable private balance for this asset. Deposit first.' };

    // Get user's public key for the contract call
    const user = await this.userModel.findById(userId).exec();
    if (!user) return { ready: false, error: 'User not found' };

    const note = notes[0];
    const stateRoot = await this.sorobanService.getMerkleRoot(poolAddress, user.stellarPublicKey);

    // Fetch on-chain commitments and compute a real Merkle path for this note commitment.
    const leaves = await this.sorobanService.getCommitments(poolAddress, user.stellarPublicKey);
    const commitmentBytes = new Uint8Array(Buffer.from(note.commitment, 'hex'));
    const stateIndex = leaves.findIndex((l) => Buffer.from(l).equals(Buffer.from(commitmentBytes)));
    if (stateIndex < 0) return { ready: false, error: 'Deposit not indexed on-chain yet for this pool. Wait and retry.' };
    const stateSiblings = await this.merkleTree.computeSiblingsForIndex(leaves, stateIndex, 20);

    const { proofBytes, pubSignalsBytes, nullifierHex } = await this.proofService.generateProof(
      { label: note.label, value: note.value, nullifier: note.nullifier, secret: note.secret },
      stateRoot,
      SwapService.SHIELDED_POOL_FIXED_AMOUNT,
      { commitmentBytes, stateIndex, stateSiblings },
    );

    await this.submitSwapProof(
      swapId,
      userId,
      Buffer.from(proofBytes).toString('base64'),
      Buffer.from(pubSignalsBytes).toString('base64'),
      nullifierHex,
    );

    const updated = await this.swapModel.findById(swapId).exec();
    const ready = !!(
      updated?.aliceProofBytes &&
      updated?.alicePubSignalsBytes &&
      updated?.aliceNullifier &&
      updated?.bobProofBytes &&
      updated?.bobPubSignalsBytes &&
      updated?.bobNullifier
    );
    return { ready };
  }

  /** Submit ZK proof for a locked swap (caller is alice or bob). */
  async submitSwapProof(
    swapId: string,
    userId: Types.ObjectId,
    proofBytesB64: string,
    pubSignalsBytesB64: string,
    nullifierHex: string,
  ): Promise<{ role: 'alice' | 'bob'; ready: boolean }> {
    const swap = await this.swapModel.findById(swapId).exec();
    if (!swap || swap.status !== 'locked') throw new Error('Swap not found or not locked');

    const isAlice = swap.aliceId.toString() === userId.toString();
    const isBob = swap.bobId.toString() === userId.toString();
    if (!isAlice && !isBob) throw new Error('You are not a party to this swap');

    if (isAlice) {
      swap.aliceProofBytes = proofBytesB64;
      swap.alicePubSignalsBytes = pubSignalsBytesB64;
      swap.aliceNullifier = nullifierHex;
    } else {
      swap.bobProofBytes = proofBytesB64;
      swap.bobPubSignalsBytes = pubSignalsBytesB64;
      swap.bobNullifier = nullifierHex;
    }
    await swap.save();

    const ready =
      !!(swap.aliceProofBytes && swap.alicePubSignalsBytes && swap.aliceNullifier &&
        swap.bobProofBytes && swap.bobPubSignalsBytes && swap.bobNullifier);
    return { role: isAlice ? 'alice' : 'bob', ready };
  }

  /** Execute swap via ZKSwap contract (private). Uses proofs from body or stored on swap. */
  async executeSwapPrivate(
    swapId: string,
    aliceProof: Uint8Array,
    alicePubSignals: Uint8Array,
    aliceNullifier: Uint8Array,
    bobProof: Uint8Array,
    bobPubSignals: Uint8Array,
    bobNullifier: Uint8Array,
  ): Promise<{ txHash: string }> {
    const swap = await this.swapModel.findById(swapId).exec();
    if (!swap || swap.status !== 'locked') throw new Error('Swap not found or not locked');

    const alice = await this.userModel.findById(swap.aliceId).exec();
    const bob = await this.userModel.findById(swap.bobId).exec();
    if (!alice || !bob || !alice.googleId || !bob.googleId) throw new Error('Users not found');

    const aliceEncKey = this.authService.getDecryptionKeyForUser(alice, alice.googleId, alice.email);
    const bobEncKey = this.authService.getDecryptionKeyForUser(bob, bob.googleId, bob.email);
    const aliceSecret = this.authService.decrypt(alice.stellarSecretKeyEncrypted, aliceEncKey);
    const bobSecret = this.authService.decrypt(bob.stellarSecretKeyEncrypted, bobEncKey);

    const zkSwapAddress = process.env.ZK_SWAP_ADDRESS;
    const usdcPool = process.env.SHIELDED_POOL_ADDRESS;
    if (!zkSwapAddress || !usdcPool) throw new Error('ZK_SWAP_ADDRESS and SHIELDED_POOL_ADDRESS required');
    const xlmPool = process.env.SHIELDED_POOL_XLM_ADDRESS ?? usdcPool;

    const amountUsdc = String(Math.round(swap.amountOut * 1_000_000));
    const amountXlm = String(Math.round(swap.amountIn * 1_000_000));

    const hash = await this.sorobanService.invokeZkSwapExecute(
      zkSwapAddress,
      aliceSecret,
      bobSecret,
      alice.stellarPublicKey,
      bob.stellarPublicKey,
      usdcPool,
      xlmPool,
      amountUsdc,
      amountXlm,
      aliceProof,
      alicePubSignals,
      aliceNullifier,
      bobProof,
      bobPubSignals,
      bobNullifier,
    );

    swap.status = 'completed';
    swap.txHash = hash;
    await swap.save();
    return { txHash: hash };
  }

  async findByUser(userId: Types.ObjectId) {
    return this.swapModel
      .find({ $or: [{ aliceId: userId }, { bobId: userId }] })
      .populate('aliceId', 'username')
      .populate('bobId', 'username')
      .sort({ createdAt: -1 })
      .exec();
  }

  async findPendingForBob(bobId: Types.ObjectId) {
    return this.swapModel
      .find({ bobId, status: 'requested' })
      .populate('aliceId', 'username')
      .populate('bobId', 'username')
      .sort({ createdAt: -1 })
      .exec();
  }

  async findById(swapId: string) {
    return this.swapModel.findById(swapId).exec();
  }
}
