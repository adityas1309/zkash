import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Swap } from '../schemas/swap.schema';
import { User } from '../schemas/user.schema';
import { Offer } from '../schemas/offer.schema';
import { AuthService } from '../auth/auth.service';
import { UsersService } from '../users/users.service';
import { SorobanService } from '../soroban/soroban.service';
import { ProofService } from '../zk/proof.service';
import { MerkleTreeService } from '../zk/merkle-tree.service';
import { Asset, Horizon, Keypair, Networks, TransactionBuilder, Operation } from '@stellar/stellar-sdk';

@Injectable()
export class SwapService {
  private server: Horizon.Server;
  // ShieldedPool transfers a variable amount per deposit/withdraw.

  constructor(
    @InjectModel(Swap.name) private swapModel: Model<Swap>,
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(Offer.name) private offerModel: Model<Offer>,
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

  async request(aliceId: Types.ObjectId, bobId: Types.ObjectId, amountIn: number, amountOut: number, offerId?: Types.ObjectId) {
    return this.swapModel.create({
      aliceId,
      bobId,
      status: 'requested',
      amountIn,
      amountOut,
      offerId,
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

    // Deactivate Offer if linked
    if (swap.offerId) {
      await this.deactivateOffer(swap.offerId);
    }

    console.log(`[SwapService] Swap ${swapId} completed with tx: ${txHash}`);

    return { txHash };
  }

  async complete(swapId: string, txHash: string) {
    return this.swapModel.findByIdAndUpdate(swapId, { status: 'completed', txHash }, { new: true }).exec();
  }

  /** Generate and store my proof for a locked swap (caller is alice or bob). */
  async prepareMyProof(swapId: string, userId: Types.ObjectId): Promise<{ ready: boolean; error?: string }> {
    const swap = await this.swapModel.findById(swapId).populate('offerId').exec();
    if (!swap || swap.status !== 'locked') return { ready: false, error: 'Swap not found or not locked' };

    const offer = swap.offerId as unknown as Offer; // Offer is populated
    if (!offer) return { ready: false, error: 'Offer not found for swap' };

    const isDbAlice = swap.aliceId.toString() === userId.toString();
    const isDbBob = swap.bobId.toString() === userId.toString();
    if (!isDbAlice && !isDbBob) return { ready: false, error: 'You are not a party to this swap' };

    // DYNAMIC MAPPING:
    // Offer: Buyer gives assetIn, Seller gives assetOut.
    // DB Alice (Buyer) -> Must prove she has assetIn.
    // DB Bob (Seller) -> Must prove he has assetOut.

    const asset: 'USDC' | 'XLM' = isDbAlice ? offer.assetIn : offer.assetOut;
    const amountRequired = isDbAlice ? swap.amountIn : swap.amountOut;

    // Scale amount to stroops for comparison
    const minValue = BigInt(Math.round(amountRequired * 10_000_000));
    const poolAddress =
      asset === 'USDC'
        ? (process.env.SHIELDED_POOL_ADDRESS ?? '')
        : (process.env.SHIELDED_POOL_XLM_ADDRESS ?? process.env.SHIELDED_POOL_ADDRESS ?? '');
    if (!poolAddress) return { ready: false, error: 'Pool not configured' };

    const notes = await this.usersService.getSpendableNotes(userId.toString(), asset, minValue);

    // For ZK Swap, we must use an EXACT matching note because the contract 
    // does not support "change" outputs. If we use a larger note, the difference is lost.
    // NOTE: minValue is the scaled amount (stroops)
    const note = notes.find(n => n.value === minValue);

    if (!note) {
      return {
        ready: false,
        error: `No private note with EXACT amount ${amountRequired} ${asset} found. Please use "Send to Self" to split your notes first.`
      };
    }

    // Get user's public key for the contract call
    const user = await this.userModel.findById(userId).exec();
    if (!user) return { ready: false, error: 'User not found' };

    let stateRoot: Uint8Array | undefined;
    let leaves: Uint8Array[] | undefined;
    let stateIndex: number | undefined;
    let stateSiblings: Uint8Array[] | undefined;
    let commitmentBytes: Uint8Array | undefined;

    let retries = 20;
    while (retries > 0) {
      try {
        const root = await this.sorobanService.getMerkleRoot(poolAddress, user.stellarPublicKey);
        const lvs = await this.sorobanService.getCommitments(poolAddress, user.stellarPublicKey);

        const computed = await this.merkleTree.computeRootFromLeaves(lvs, 20);
        if (!Buffer.from(computed).equals(Buffer.from(root))) {
          console.warn(`[prepareMyProof] Root mismatch. Retrying (${retries} left)...`);
          console.warn(`  On-chain Root: ${Buffer.from(root).toString('hex')}`);
          console.warn(`  Computed Root: ${Buffer.from(computed).toString('hex')}`);
          console.warn(`  Leaves Count:  ${lvs.length}`);

          await new Promise(r => setTimeout(r, 2000));
          retries--;
          continue;
        }

        const comm = new Uint8Array(Buffer.from(note.commitment, 'hex'));
        const idx = lvs.findIndex((l) => Buffer.from(l).equals(Buffer.from(comm)));
        if (idx < 0) return { ready: false, error: 'Deposit not indexed on-chain yet. Wait and retry.' };

        stateRoot = root;
        leaves = lvs;
        stateIndex = idx;
        commitmentBytes = comm;
        stateSiblings = await this.merkleTree.computeSiblingsForIndex(lvs, idx, 20);
        break;
      } catch (e) {
        console.warn(`[prepareMyProof] Error fetching state:`, e);
        retries--;
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    if (!stateRoot || !stateSiblings || stateIndex === undefined || !commitmentBytes) {
      return { ready: false, error: 'Failed to fetch consistent Merkle state after retries' };
    }

    const { proofBytes, pubSignalsBytes, nullifierHash } = await this.proofService.generateProof(
      { label: note.label, value: note.value, nullifier: note.nullifier, secret: note.secret },
      stateRoot,
      note.value, // Withdrawn value (Amount)
      { commitmentBytes, stateIndex, stateSiblings },
    );

    await this.submitSwapProof(
      swapId,
      userId,
      Buffer.from(proofBytes).toString('base64'),
      Buffer.from(pubSignalsBytes).toString('base64'),
      nullifierHash,
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
    executorId: Types.ObjectId,
    aliceProof: Uint8Array,
    alicePubSignals: Uint8Array,
    aliceNullifier: Uint8Array,
    bobProof: Uint8Array,
    bobPubSignals: Uint8Array,
    bobNullifier: Uint8Array,
  ): Promise<{ txHash: string }> {
    const swap = await this.swapModel.findById(swapId).populate('offerId').exec();
    if (!swap || swap.status !== 'locked') throw new Error('Swap not found or not locked');

    const offer = swap.offerId as unknown as Offer;
    if (!offer) throw new Error('Offer not found for swap');

    const dbAlice = await this.userModel.findById(swap.aliceId).exec(); // Buyer
    const dbBob = await this.userModel.findById(swap.bobId).exec();     // Seller
    if (!dbAlice || !dbBob || !dbAlice.googleId || !dbBob.googleId) throw new Error('Users not found');

    const aliceEncKey = this.authService.getDecryptionKeyForUser(dbAlice, dbAlice.googleId, dbAlice.email);
    const bobEncKey = this.authService.getDecryptionKeyForUser(dbBob, dbBob.googleId, dbBob.email);
    const aliceSecret = this.authService.decrypt(dbAlice.stellarSecretKeyEncrypted, aliceEncKey);
    const bobSecret = this.authService.decrypt(dbBob.stellarSecretKeyEncrypted, bobEncKey);

    const zkSwapAddress = process.env.ZK_SWAP_ADDRESS;
    const usdcPool = process.env.SHIELDED_POOL_ADDRESS;
    if (!zkSwapAddress || !usdcPool) throw new Error('ZK_SWAP_ADDRESS and SHIELDED_POOL_ADDRESS required');
    const xlmPool = process.env.SHIELDED_POOL_XLM_ADDRESS ?? usdcPool;

    const amountUsdc = String(Math.round(swap.amountOut * 10_000_000));
    const amountXlm = String(Math.round(swap.amountIn * 10_000_000));

    // DYNAMIC ROLE MAPPING
    // Offer: Sell AssetOut for AssetIn.
    // DB Alice (Buyer) gives AssetIn.
    // DB Bob (Seller) gives AssetOut.

    // Contract Roles:
    // Contract Alice: Always input USDC.
    // Contract Bob: Always input XLM.

    let contractAliceProof, contractAlicePubSignals, contractAliceNullifier;
    let contractAliceOutputCommitment, contractAliceOutputRoot; // New XLM Note (for whomever gave USDC)

    let contractBobProof, contractBobPubSignals, contractBobNullifier;
    let contractBobOutputCommitment, contractBobOutputRoot; // New USDC Note (for whomever gave XLM)

    // Outcome Notes (To be saved):
    let dbAliceNewNote, dbAliceNewCommitment;
    let dbBobNewNote, dbBobNewCommitment;
    let dbAliceNewAsset: 'USDC' | 'XLM', dbBobNewAsset: 'USDC' | 'XLM';

    // Case 1: Buyer (Alice) gives USDC. Seller (Bob) gives XLM.
    if (offer.assetIn === 'USDC' && offer.assetOut === 'XLM') {
      console.log('[SwapService] Mapping: Buyer (Alice) -> USDC Giver, Seller (Bob) -> XLM Giver');

      // DB Alice gives USDC -> Should Map to Contract Alice
      contractAliceProof = aliceProof; // Proving USDC
      contractAlicePubSignals = alicePubSignals;
      contractAliceNullifier = aliceNullifier;

      // DB Bob gives XLM -> Should Map to Contract Bob
      contractBobProof = bobProof; // Proving XLM
      contractBobPubSignals = bobPubSignals;
      contractBobNullifier = bobNullifier;

      // OUTPUTS
      // Who gets USDC? (Who gave XLM?) -> DB Bob gave XLM. Contract Bob gives XLM.
      // Contract: Bob Input XLM -> Output USDC (bob_output) to Bob.
      // So DB Bob should get the new USDC note.
      const bobRes = await this.usersService.generateNote(dbBob._id.toString(), swap.amountIn); // Getting amountIn (USDC)
      dbBobNewNote = bobRes.noteFields;
      dbBobNewCommitment = bobRes.commitmentBytes;
      dbBobNewAsset = 'USDC';

      contractBobOutputCommitment = dbBobNewCommitment;
      const usdcLeaves = await this.sorobanService.getCommitments(usdcPool, dbBob.stellarPublicKey);
      contractBobOutputRoot = await this.merkleTree.computeRootFromLeaves([...usdcLeaves, dbBobNewCommitment], 20);

      // Who gets XLM? (Who gave USDC?) -> DB Alice gave USDC. Contract Alice gives USDC.
      // Contract: Alice Input USDC -> Output XLM (alice_output) to Alice.
      // So DB Alice should get the new XLM note.
      const aliceRes = await this.usersService.generateNote(dbAlice._id.toString(), swap.amountOut); // Getting amountOut (XLM)
      dbAliceNewNote = aliceRes.noteFields;
      dbAliceNewCommitment = aliceRes.commitmentBytes;
      dbAliceNewAsset = 'XLM';

      contractAliceOutputCommitment = dbAliceNewCommitment;
      const xlmLeaves = await this.sorobanService.getCommitments(xlmPool, dbAlice.stellarPublicKey);
      contractAliceOutputRoot = await this.merkleTree.computeRootFromLeaves([...xlmLeaves, dbAliceNewCommitment], 20);
    }
    // Case 2: Buyer (Alice) gives XLM. Seller (Bob) gives USDC.
    else if (offer.assetIn === 'XLM' && offer.assetOut === 'USDC') {
      console.log('[SwapService] Mapping: Buyer (Alice) -> XLM Giver, Seller (Bob) -> USDC Giver');

      // DB Alice gives XLM -> Should Map to Contract Bob
      contractBobProof = aliceProof; // Proving XLM
      contractBobPubSignals = alicePubSignals;
      contractBobNullifier = aliceNullifier;

      // DB Bob gives USDC -> Should Map to Contract Alice
      contractAliceProof = bobProof; // Proving USDC
      contractAlicePubSignals = bobPubSignals;
      contractAliceNullifier = bobNullifier;

      // OUTPUTS
      // Who gets USDC? (Who gave XLM?) -> DB Alice gave XLM.
      // Contract Bob Output (USDC).
      // So DB Alice should get the new USDC note.
      const aliceRes = await this.usersService.generateNote(dbAlice._id.toString(), swap.amountOut); // Getting amountOut (USDC)
      dbAliceNewNote = aliceRes.noteFields;
      dbAliceNewCommitment = aliceRes.commitmentBytes;
      dbAliceNewAsset = 'USDC';

      contractBobOutputCommitment = dbAliceNewCommitment;
      // Compute root using Alice's view of USDC Pool (or any view, pool is global)
      const usdcLeaves = await this.sorobanService.getCommitments(usdcPool, dbAlice.stellarPublicKey);
      contractBobOutputRoot = await this.merkleTree.computeRootFromLeaves([...usdcLeaves, dbAliceNewCommitment], 20);

      // Who gets XLM? (Who gave USDC?) -> DB Bob gave USDC.
      // Contract Alice Output (XLM).
      // So DB Bob should get the new XLM note.
      const bobRes = await this.usersService.generateNote(dbBob._id.toString(), swap.amountIn); // Getting amountIn (XLM)
      dbBobNewNote = bobRes.noteFields;
      dbBobNewCommitment = bobRes.commitmentBytes;
      dbBobNewAsset = 'XLM';

      contractAliceOutputCommitment = dbBobNewCommitment;
      const xlmLeaves = await this.sorobanService.getCommitments(xlmPool, dbBob.stellarPublicKey);
      contractAliceOutputRoot = await this.merkleTree.computeRootFromLeaves([...xlmLeaves, dbBobNewCommitment], 20);
    } else {
      throw new Error(`Unsupported asset pair: ${offer.assetIn}/${offer.assetOut}`);
    }

    console.log(`[SwapService] Executing Anonymous Swap...`);

    // Determine who is signing (paying fee)
    let submitterSecret = aliceSecret;
    if (executorId.equals(dbBob._id)) {
      submitterSecret = bobSecret;
      console.log('[SwapService] DB Bob is executing');
    } else {
      console.log('[SwapService] DB Alice is executing');
    }

    const hash = await this.sorobanService.invokeZkSwapExecute(
      zkSwapAddress,
      submitterSecret,
      usdcPool,
      xlmPool,
      amountUsdc,
      amountXlm,
      contractAliceProof,
      contractAlicePubSignals,
      contractAliceNullifier,
      contractAliceOutputCommitment,
      contractAliceOutputRoot,
      contractBobProof,
      contractBobPubSignals,
      contractBobNullifier,
      contractBobOutputCommitment,
      contractBobOutputRoot,
    );

    // PERSIST NEW NOTES
    await this.usersService.saveNote(dbAlice._id.toString(), dbAliceNewAsset,
      dbAliceNewAsset === 'USDC' ? usdcPool : xlmPool, dbAliceNewNote, dbAliceNewCommitment, hash);

    await this.usersService.saveNote(dbBob._id.toString(), dbBobNewAsset,
      dbBobNewAsset === 'USDC' ? usdcPool : xlmPool, dbBobNewNote, dbBobNewCommitment, hash);

    // DEACTIVATE OFFER
    if (swap.offerId) {
      await this.deactivateOffer(swap.offerId);
    }

    // MARK INPUT NOTES AS SPENT
    try {
      const aliceNullifierHex = Buffer.from(aliceNullifier).toString('hex');
      await this.usersService.markNoteSpent(dbAlice._id.toString(), aliceNullifierHex);

      const bobNullifierHex = Buffer.from(bobNullifier).toString('hex');
      await this.usersService.markNoteSpent(dbBob._id.toString(), bobNullifierHex);
    } catch (e) {
      console.error('[SwapService] Failed to mark input notes as spent:', e);
    }

    swap.status = 'completed';
    swap.txHash = hash;
    await swap.save();

    // AUTO-WITHDRAWAL
    // Attempt to withdraw funds to public account immediately for better UX.
    // This is a "best effort" operation. If it fails, funds remain in Shielded Pool (private balance).
    console.log(`[SwapService] Initiating Auto-Withdrawal for ${dbAlice.username} and ${dbBob.username}...`);

    // 1. Withdraw for Alice (Received dbAliceNewAsset -> Always amountOut)
    this.autoWithdrawSafe(dbAlice._id.toString(), dbAlice.username, dbAliceNewAsset, swap.amountOut);

    // 2. Withdraw for Bob (Received dbBobNewAsset -> Always amountIn)
    this.autoWithdrawSafe(dbBob._id.toString(), dbBob.username, dbBobNewAsset, swap.amountIn);

    return { txHash: hash };
  }

  /**
   * Helper to perform auto-withdrawal without throwing error to the main flow.
   */
  /**
   * Helper to perform auto-withdrawal with robust retries.
   * Retries for up to 10 minutes to handle slow indexing or network issues.
   */
  private async autoWithdrawSafe(userId: string, username: string, asset: 'USDC' | 'XLM', amount: number) {
    const MAX_RETRIES = 20; // 20 attempts
    const RETRY_DELAY_MS = 30_000; // 30 seconds between attempts
    // Total duration: ~10 minutes coverage

    // Initial delay for propagation
    console.log(`[SwapService] delaying auto-withdraw for 10s...`);
    await new Promise(r => setTimeout(r, 10000));

    let attempt = 1;
    while (attempt <= MAX_RETRIES) {
      try {
        console.log(`[SwapService] Auto-withdraw attempt ${attempt}/${MAX_RETRIES} for ${username} (${amount} ${asset})...`);
        const res = await this.usersService.withdrawSelf(userId, asset, amount);

        if (res.success) {
          console.log(`[SwapService] Auto-withdraw SUCCESS for ${username}: ${res.txHash}`);
          return; // Done!
        }

        // If failed, log and wait
        console.warn(`[SwapService] Auto-withdraw attempt ${attempt} failed: ${res.error}`);

        // If error is "Note not found", it implies indexing lag.
        // If error is "InsufficientBalance", maybe note not found yet?
        // If error is "User not found", abort.
        if (typeof res.error === 'string' && res.error.includes('User not found')) {
          console.error('[SwapService] Aborting auto-withdraw: User not found');
          return;
        }

      } catch (e) {
        console.error(`[SwapService] Auto-withdraw exception attempt ${attempt}:`, e);
      }

      // Wait before next retry
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
      }
      attempt++;
    }

    console.error(`[SwapService] Auto-withdraw GAVE UP for ${username} after ${MAX_RETRIES} attempts. manual withdrawal required.`);
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

  private async deactivateOffer(offerId: Types.ObjectId) {
    try {
      console.log(`[SwapService] Deactivating offer ${offerId}`);
      await this.offerModel.findByIdAndUpdate(offerId, { active: false }).exec();
    } catch (e) {
      console.error('Failed to deactivate offer:', e);
    }
  }
}
