import {
  BadRequestException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  Asset,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { Model, Types } from 'mongoose';
import * as nacl from 'tweetnacl';
import * as naclUtil from 'tweetnacl-util';
import { AuthService } from '../auth/auth.service';
import { getContractAddress, getHorizonUrl, isMainnetContext } from '../network.context';
import { Offer, type AssetType } from '../schemas/offer.schema';
import { Swap, SwapExecutionStatus, SwapProofStatus, SwapStatus } from '../schemas/swap.schema';
import { User } from '../schemas/user.schema';
import { SorobanService } from '../soroban/soroban.service';
import { TransactionAuditService } from '../transactions/transaction-audit.service';
import { UsersService } from '../users/users.service';
import type { NoteFields } from '../zk/commitment';
import { MerkleTreeService } from '../zk/merkle-tree.service';
import { ProofService } from '../zk/proof.service';

type SwapPartyRole = 'alice' | 'bob';

const TRANSFER_PUBLIC_SIGNAL_BYTES = 5 * 32;

type SwapAuditOperation =
  | 'swap_request'
  | 'swap_accept'
  | 'swap_prepare_proof'
  | 'swap_submit_proof'
  | 'swap_execute_public'
  | 'swap_execute_private'
  | 'swap_complete';

interface SwapAuditContext {
  operation: SwapAuditOperation;
  actorId: Types.ObjectId;
  state?: 'queued' | 'pending' | 'success' | 'failed' | 'retryable';
  txHash?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

interface PreparedOutputNote {
  noteFields: NoteFields;
  commitmentBytes: Uint8Array;
  commitmentHex: string;
  asset: AssetType;
}

@Injectable()
export class SwapService {
  private static readonly SCALE_FACTOR = 10_000_000n;

  get server(): Horizon.Server {
    return new Horizon.Server(getHorizonUrl());
  }

  constructor(
    @InjectModel(Swap.name) private swapModel: Model<Swap>,
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(Offer.name) private offerModel: Model<Offer>,
    @Inject(forwardRef(() => AuthService)) private authService: AuthService,
    @Inject(forwardRef(() => UsersService)) private usersService: UsersService,
    private sorobanService: SorobanService,
    private proofService: ProofService,
    private merkleTree: MerkleTreeService,
    private transactionAuditService: TransactionAuditService,
  ) {}

  async request(
    aliceId: Types.ObjectId,
    bobId: Types.ObjectId,
    amountIn: number,
    amountOut: number,
    offerId?: Types.ObjectId,
  ) {
    if (aliceId.toString() === bobId.toString()) {
      throw new BadRequestException('Cannot request a swap with yourself');
    }
    if (!offerId) {
      throw new BadRequestException('Offer is required for swap requests');
    }

    const offer = await this.offerModel.findById(offerId).exec();
    if (!offer) {
      throw new BadRequestException('Offer not found');
    }
    if (!offer.active) {
      throw new BadRequestException('Offer is no longer active');
    }
    if (offer.merchantId.toString() !== bobId.toString()) {
      throw new BadRequestException('Offer does not belong to the requested merchant');
    }
    if (offer.assetIn === offer.assetOut) {
      throw new BadRequestException('Offer asset pair is invalid');
    }
    if (amountIn < offer.min || amountIn > offer.max) {
      throw new BadRequestException('Requested amount is outside the offer limits');
    }

    const quotedAmountOut = amountIn * offer.rate;
    if (!this.isSameStellarAmount(amountOut, quotedAmountOut)) {
      throw new BadRequestException('Requested output amount does not match the offer rate');
    }

    const swap = await this.swapModel.create({
      aliceId,
      bobId,
      status: 'requested',
      proofStatus: 'awaiting_acceptance',
      executionStatus: 'not_started',
      amountIn,
      amountOut,
      offerId,
      lastActorId: aliceId,
      lastActorRole: 'alice',
    });

    await this.createAudit(swap, {
      operation: 'swap_request',
      actorId: aliceId,
      state: 'success',
      metadata: {
        requestedBobId: bobId.toString(),
        amountIn,
        amountOut,
      },
    });

    return swap;
  }

  async accept(swapId: string, bobId: Types.ObjectId) {
    const swap = await this.swapModel.findById(swapId).exec();
    if (!swap || swap.bobId.toString() !== bobId.toString()) {
      return null;
    }

    swap.status = 'proofs_pending';
    swap.proofStatus = 'awaiting_both';
    swap.executionStatus = 'not_started';
    swap.acceptedAt = new Date();
    swap.lastActorId = bobId;
    swap.lastActorRole = 'bob';
    swap.lastError = undefined;
    await swap.save();

    await this.createAudit(swap, {
      operation: 'swap_accept',
      actorId: bobId,
      state: 'success',
    });

    return swap;
  }

  async executeSwap(
    swapId: string,
    sellerId: Types.ObjectId,
  ): Promise<{ txHash: string; auditId: string }> {
    const swap = await this.swapModel.findById(swapId).exec();
    if (!swap) {
      throw new Error('Swap not found');
    }
    if (!this.isExecutionReady(swap)) {
      throw new Error('Swap must be ready before execution');
    }
    if (swap.bobId.toString() !== sellerId.toString()) {
      throw new Error('Only the seller can execute');
    }

    swap.status = 'executing';
    swap.executionStatus = 'processing';
    swap.executionStartedAt = new Date();
    swap.lastActorId = sellerId;
    swap.lastActorRole = 'bob';
    swap.lastError = undefined;
    await swap.save();

    const audit = await this.createAudit(swap, {
      operation: 'swap_execute_public',
      actorId: sellerId,
      state: 'pending',
      metadata: {
        executionMode: 'public',
      },
    });

    try {
      const seller = await this.userModel.findById(swap.bobId).exec();
      const buyer = await this.userModel.findById(swap.aliceId).exec();
      const offer = swap.offerId ? await this.offerModel.findById(swap.offerId).exec() : null;

      if (!seller || !buyer || !offer) {
        throw new Error('Users or offer not found');
      }
      if (!seller.googleId || !buyer.googleId) {
        throw new Error('Google IDs required');
      }

      const sellerEncryptionKey = this.authService.getDecryptionKeyForUser(
        seller,
        seller.googleId,
        seller.email,
      );
      const sellerSecretKey = this.authService.decrypt(
        seller.stellarSecretKeyEncrypted,
        sellerEncryptionKey,
      );
      const sellerKeypair = Keypair.fromSecret(sellerSecretKey);

      const buyerEncryptionKey = this.authService.getDecryptionKeyForUser(
        buyer,
        buyer.googleId,
        buyer.email,
      );
      const buyerSecretKey = this.authService.decrypt(
        buyer.stellarSecretKeyEncrypted,
        buyerEncryptionKey,
      );
      const buyerKeypair = Keypair.fromSecret(buyerSecretKey);

      const sellerAccount = await this.server.loadAccount(seller.stellarPublicKey);

      const isMainnet = isMainnetContext();

      const tx = new TransactionBuilder(sellerAccount, {
        fee: '100',
        networkPassphrase: isMainnet ? Networks.PUBLIC : Networks.TESTNET,
      })
        .addOperation(
          Operation.payment({
            destination: buyer.stellarPublicKey,
            asset: this.stellarAssetFor(offer.assetOut),
            amount: swap.amountOut.toString(),
          }),
        )
        .addOperation(
          Operation.payment({
            source: buyer.stellarPublicKey,
            destination: seller.stellarPublicKey,
            asset: this.stellarAssetFor(offer.assetIn),
            amount: swap.amountIn.toString(),
          }),
        )
        .setTimeout(30)
        .build();

      const signers = [sellerKeypair];
      if (sellerKeypair.publicKey() !== buyerKeypair.publicKey()) {
        signers.push(buyerKeypair);
      }
      signers.forEach((signer) => tx.sign(signer));

      const result = await this.server.submitTransaction(tx);
      const txHash = result.hash;

      swap.status = 'completed';
      swap.proofStatus = this.computeProofStatus(swap);
      swap.executionStatus = 'confirmed';
      swap.txHash = txHash;
      swap.completedAt = new Date();
      await swap.save();

      if (swap.offerId) {
        await this.deactivateOffer(swap.offerId);
      }

      await this.transactionAuditService.updateState(audit._id.toString(), 'success', {
        txHash,
        indexingStatus: 'tracked',
        indexingDetail:
          'Public swap settles directly on-chain and does not wait on private note indexing.',
      });

      return { txHash, auditId: audit._id.toString() };
    } catch (e: any) {
      console.error('[SwapService] executeSwap Error:', e?.response?.data || e);
      const msg =
        e?.response?.data?.extras?.result_codes?.operations?.join(', ') ||
        e?.response?.data?.extras?.result_codes?.transaction ||
        e.message;

      swap.status = 'failed';
      swap.executionStatus = 'failed';
      swap.failedAt = new Date();
      swap.lastError = msg;
      await swap.save();

      await this.transactionAuditService.updateState(audit._id.toString(), 'failed', {
        error: msg,
        indexingStatus: 'not_required',
        indexingDetail: 'Public swap execution failed before any private indexing step was needed.',
      });

      throw new Error(`Swap Execution failed: ${msg}`);
    }
  }

  async complete(swapId: string, actorId: Types.ObjectId, txHash: string) {
    if (!/^[a-fA-F0-9]{64}$/.test(txHash)) {
      throw new BadRequestException('Invalid transaction hash');
    }

    const swap = await this.swapModel.findById(swapId).exec();
    if (!swap) {
      throw new NotFoundException('Swap not found');
    }

    const actorRole = this.getPartyRole(swap, actorId);
    if (!actorRole) {
      throw new ForbiddenException('You are not a party to this swap');
    }

    if (swap.status === 'completed') {
      if (swap.txHash !== txHash) {
        throw new BadRequestException('Swap is already completed with a different transaction');
      }
      return swap;
    }

    if (swap.status !== 'executing' && swap.status !== 'proofs_ready') {
      throw new BadRequestException('Swap is not ready to be completed');
    }

    await this.verifyPublicSwapSettlement(txHash, swap);

    swap.status = 'completed';
    swap.executionStatus = 'confirmed';
    swap.txHash = txHash;
    swap.completedAt = new Date();
    swap.lastActorId = actorId;
    swap.lastActorRole = actorRole;
    swap.lastError = undefined;
    await swap.save();

    await this.createAudit(swap, {
      operation: 'swap_complete',
      actorId,
      state: 'success',
      txHash,
    });

    return swap;
  }

  async prepareMyProof(
    swapId: string,
    userId: Types.ObjectId,
  ): Promise<{ ready: boolean; error?: string; auditId?: string; proofStatus?: SwapProofStatus }> {
    const swap = await this.swapModel.findById(swapId).populate('offerId').exec();
    if (!swap || !this.isProofCollectionState(swap.status)) {
      return { ready: false, error: 'Swap not found or not ready for proofs' };
    }

    const audit = await this.createAudit(swap, {
      operation: 'swap_prepare_proof',
      actorId: userId,
      state: 'pending',
    });

    const offer = swap.offerId as unknown as Offer;
    if (!offer) {
      await this.markAuditFailure(audit._id.toString(), 'Offer not found for swap');
      return { ready: false, error: 'Offer not found for swap', auditId: audit._id.toString() };
    }

    const actorRole = this.getPartyRole(swap, userId);
    if (!actorRole) {
      await this.markAuditFailure(audit._id.toString(), 'You are not a party to this swap');
      return {
        ready: false,
        error: 'You are not a party to this swap',
        auditId: audit._id.toString(),
      };
    }

    const asset: 'USDC' | 'XLM' = actorRole === 'alice' ? offer.assetIn : offer.assetOut;
    const amountRequired = actorRole === 'alice' ? swap.amountIn : swap.amountOut;
    const outputRecipientRole: SwapPartyRole = actorRole === 'alice' ? 'bob' : 'alice';
    const outputRecipient = await this.userModel
      .findById(actorRole === 'alice' ? swap.bobId : swap.aliceId)
      .exec();
    if (!outputRecipient) {
      await this.markAuditFailure(audit._id.toString(), 'Counterparty not found for swap');
      return {
        ready: false,
        error: 'Counterparty not found for swap',
        auditId: audit._id.toString(),
      };
    }
    const outputNote = await this.ensureOutputNote(
      swap,
      outputRecipientRole,
      outputRecipient,
      asset,
      amountRequired,
    );
    const minValue = BigInt(Math.round(amountRequired * 10_000_000));
    const poolAddress =
      asset === 'USDC'
        ? (getContractAddress('SHIELDED_POOL_ADDRESS') ?? '')
        : (getContractAddress('SHIELDED_POOL_XLM_ADDRESS') ??
          getContractAddress('SHIELDED_POOL_ADDRESS') ??
          '');

    if (!poolAddress) {
      await this.markAuditFailure(audit._id.toString(), 'Pool not configured');
      return { ready: false, error: 'Pool not configured', auditId: audit._id.toString() };
    }

    const notes = await this.usersService.getSpendableNotes(userId.toString(), asset, minValue);
    const note = notes.find((entry) => entry.value === minValue);
    if (!note) {
      const message = `No private note with EXACT amount ${amountRequired} ${asset} found. Please use "Send to Self" to split your notes first.`;
      await this.transactionAuditService.updateState(audit._id.toString(), 'retryable', {
        error: message,
        indexingStatus: 'tracked',
        indexingDetail:
          'Proof generation can be retried after note splitting or a matching deposit arrives.',
      });
      return {
        ready: false,
        error: message,
        auditId: audit._id.toString(),
        proofStatus: this.computeProofStatus(swap),
      };
    }

    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      await this.markAuditFailure(audit._id.toString(), 'User not found');
      return { ready: false, error: 'User not found', auditId: audit._id.toString() };
    }

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
          await new Promise((resolve) => setTimeout(resolve, 2000));
          retries--;
          continue;
        }

        const comm = new Uint8Array(Buffer.from(note.commitment, 'hex'));
        const idx = lvs.findIndex((leaf) => Buffer.from(leaf).equals(Buffer.from(comm)));
        if (idx < 0) {
          await this.transactionAuditService.updateState(audit._id.toString(), 'retryable', {
            indexingStatus: 'pending',
            indexingDetail: 'Deposit commitment exists locally but is not indexed on-chain yet.',
          });
          return {
            ready: false,
            error: 'Deposit not indexed on-chain yet. Wait and retry.',
            auditId: audit._id.toString(),
            proofStatus: this.computeProofStatus(swap),
          };
        }

        stateRoot = root;
        leaves = lvs;
        stateIndex = idx;
        commitmentBytes = comm;
        stateSiblings = await this.merkleTree.computeSiblingsForIndex(lvs, idx, 20);
        break;
      } catch (e) {
        console.warn('[prepareMyProof] Error fetching state:', e);
        retries--;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    if (!stateRoot || !leaves || stateIndex === undefined || !stateSiblings || !commitmentBytes) {
      const message = 'Failed to fetch consistent Merkle state after retries';
      await this.markAuditFailure(audit._id.toString(), message);
      return { ready: false, error: message, auditId: audit._id.toString() };
    }

    const { proofBytes, pubSignalsBytes, nullifierHash } = await this.proofService.generateProof(
      { label: note.label, value: note.value, nullifier: note.nullifier, secret: note.secret },
      stateRoot,
      note.value,
      { commitmentBytes, stateIndex, stateSiblings, publicBinding: outputNote.commitmentBytes },
    );

    const submitResult = await this.submitSwapProof(
      swapId,
      userId,
      Buffer.from(proofBytes).toString('base64'),
      Buffer.from(pubSignalsBytes).toString('base64'),
      nullifierHash,
      {
        source: 'prepare_my_proof',
        existingAuditId: audit._id.toString(),
      },
    );

    await this.transactionAuditService.updateState(audit._id.toString(), 'success', {
      indexingStatus: submitResult.ready ? 'tracked' : 'pending',
      indexingDetail: submitResult.ready
        ? 'Both swap proofs are present and the private swap can execute.'
        : 'Proof stored successfully. Waiting for the counterparty proof.',
      metadata: {
        source: 'prepare_my_proof',
        role: submitResult.role,
      },
    });

    return {
      ready: submitResult.ready,
      auditId: audit._id.toString(),
      proofStatus: submitResult.proofStatus,
    };
  }

  async submitSwapProof(
    swapId: string,
    userId: Types.ObjectId,
    proofBytesB64: string,
    pubSignalsBytesB64: string,
    nullifierHex: string,
    options: { source?: string; existingAuditId?: string } = {},
  ): Promise<{
    role: SwapPartyRole;
    ready: boolean;
    proofStatus: SwapProofStatus;
    auditId: string;
  }> {
    const swap = await this.swapModel.findById(swapId).exec();
    if (!swap || !this.isProofCollectionState(swap.status)) {
      throw new Error('Swap not found or not ready for proofs');
    }

    const isAlice = swap.aliceId.toString() === userId.toString();
    const isBob = swap.bobId.toString() === userId.toString();
    if (!isAlice && !isBob) {
      throw new Error('You are not a party to this swap');
    }

    const pubSignalLength = Buffer.from(pubSignalsBytesB64, 'base64').length;
    if (pubSignalLength !== TRANSFER_PUBLIC_SIGNAL_BYTES) {
      throw new Error('Swap proofs must use the output-bound transfer circuit');
    }
    const pubSignals = Buffer.from(pubSignalsBytesB64, 'base64');
    const bindingHex = pubSignals.subarray(4 * 32, 5 * 32).toString('hex');
    const expectedOutputCommitment = isAlice
      ? swap.bobOutputCommitment
      : swap.aliceOutputCommitment;
    if (!expectedOutputCommitment) {
      throw new Error('Prepare the swap output note before submitting this proof');
    }
    if (bindingHex !== expectedOutputCommitment) {
      throw new Error('Swap proof binding does not match the prepared output commitment');
    }

    const auditId =
      options.existingAuditId ??
      (
        await this.createAudit(swap, {
          operation: 'swap_submit_proof',
          actorId: userId,
          state: 'pending',
          metadata: {
            source: options.source ?? 'manual_submit',
          },
        })
      )._id.toString();

    if (isAlice) {
      swap.aliceProofBytes = proofBytesB64;
      swap.alicePubSignalsBytes = pubSignalsBytesB64;
      swap.aliceNullifier = nullifierHex;
      swap.lastActorRole = 'alice';
    } else {
      swap.bobProofBytes = proofBytesB64;
      swap.bobPubSignalsBytes = pubSignalsBytesB64;
      swap.bobNullifier = nullifierHex;
      swap.lastActorRole = 'bob';
    }

    swap.lastActorId = userId;
    swap.proofStatus = this.computeProofStatus(swap);
    swap.status = swap.proofStatus === 'ready' ? 'proofs_ready' : 'proofs_pending';
    swap.executionStatus = swap.proofStatus === 'ready' ? 'ready' : 'not_started';
    swap.proofsReadyAt = swap.proofStatus === 'ready' ? new Date() : undefined;
    swap.lastError = undefined;
    await swap.save();

    await this.transactionAuditService.updateState(auditId, 'success', {
      indexingStatus: swap.proofStatus === 'ready' ? 'tracked' : 'pending',
      indexingDetail:
        swap.proofStatus === 'ready'
          ? 'Both proofs are stored and the private swap is ready to execute.'
          : 'Proof stored successfully. Waiting for the remaining party proof.',
      metadata: {
        source: options.source ?? 'manual_submit',
        role: isAlice ? 'alice' : 'bob',
      },
    });

    return {
      role: isAlice ? 'alice' : 'bob',
      ready: swap.proofStatus === 'ready',
      proofStatus: swap.proofStatus,
      auditId,
    };
  }

  async executeSwapPrivate(
    swapId: string,
    executorId: Types.ObjectId,
    aliceProof: Uint8Array,
    alicePubSignals: Uint8Array,
    aliceNullifier: Uint8Array,
    bobProof: Uint8Array,
    bobPubSignals: Uint8Array,
    bobNullifier: Uint8Array,
  ): Promise<{ txHash: string; auditId: string }> {
    const swap = await this.swapModel.findById(swapId).populate('offerId').exec();
    if (!swap || !this.isExecutionReady(swap)) {
      throw new Error('Swap not found or not ready for execution');
    }
    if (
      alicePubSignals.length !== TRANSFER_PUBLIC_SIGNAL_BYTES ||
      bobPubSignals.length !== TRANSFER_PUBLIC_SIGNAL_BYTES
    ) {
      throw new Error('Swap proofs must use the output-bound transfer circuit');
    }

    const actorRole = this.getPartyRole(swap, executorId);
    if (!actorRole) {
      throw new Error('You are not a party to this swap');
    }

    swap.status = 'executing';
    swap.executionStatus = 'processing';
    swap.executionStartedAt = new Date();
    swap.lastActorId = executorId;
    swap.lastActorRole = actorRole;
    swap.lastError = undefined;
    await swap.save();

    const audit = await this.createAudit(swap, {
      operation: 'swap_execute_private',
      actorId: executorId,
      state: 'pending',
      metadata: {
        executionMode: 'private',
      },
    });

    try {
      const offer = swap.offerId as unknown as Offer;
      if (!offer) {
        throw new Error('Offer not found for swap');
      }

      const dbAlice = await this.userModel.findById(swap.aliceId).exec();
      const dbBob = await this.userModel.findById(swap.bobId).exec();
      if (!dbAlice || !dbBob || !dbAlice.googleId || !dbBob.googleId) {
        throw new Error('Users not found');
      }

      const aliceEncKey = this.authService.getDecryptionKeyForUser(
        dbAlice,
        dbAlice.googleId,
        dbAlice.email,
      );
      const bobEncKey = this.authService.getDecryptionKeyForUser(
        dbBob,
        dbBob.googleId,
        dbBob.email,
      );
      const aliceSecret = this.authService.decrypt(dbAlice.stellarSecretKeyEncrypted, aliceEncKey);
      const bobSecret = this.authService.decrypt(dbBob.stellarSecretKeyEncrypted, bobEncKey);

      const zkSwapAddress = getContractAddress('ZK_SWAP_ADDRESS');
      const usdcPool = getContractAddress('SHIELDED_POOL_ADDRESS');
      if (!zkSwapAddress || !usdcPool) {
        throw new Error('ZK_SWAP_ADDRESS and SHIELDED_POOL_ADDRESS required');
      }
      const xlmPool = getContractAddress('SHIELDED_POOL_XLM_ADDRESS') ?? usdcPool;

      const amountUsdcValue = offer.assetIn === 'USDC' ? swap.amountIn : swap.amountOut;
      const amountXlmValue = offer.assetIn === 'XLM' ? swap.amountIn : swap.amountOut;
      const amountUsdc = this.toScaledAmount(amountUsdcValue).toString();
      const amountXlm = this.toScaledAmount(amountXlmValue).toString();

      const aliceOutput = this.getPreparedOutputNote(
        swap,
        'alice',
        dbAlice,
        offer.assetOut,
        swap.amountOut,
      );
      const bobOutput = this.getPreparedOutputNote(
        swap,
        'bob',
        dbBob,
        offer.assetIn,
        swap.amountIn,
      );

      let contractAliceProof: Uint8Array;
      let contractAlicePubSignals: Uint8Array;
      let contractAliceNullifier: Uint8Array;
      let contractAliceOutputCommitment: Uint8Array;
      let contractAliceOutputRoot: Uint8Array;

      let contractBobProof: Uint8Array;
      let contractBobPubSignals: Uint8Array;
      let contractBobNullifier: Uint8Array;
      let contractBobOutputCommitment: Uint8Array;
      let contractBobOutputRoot: Uint8Array;

      const dbAliceNewNote = aliceOutput.noteFields;
      const dbAliceNewCommitment = aliceOutput.commitmentBytes;
      const dbAliceNewAsset = aliceOutput.asset;
      const dbBobNewNote = bobOutput.noteFields;
      const dbBobNewCommitment = bobOutput.commitmentBytes;
      const dbBobNewAsset = bobOutput.asset;

      if (offer.assetIn === 'USDC' && offer.assetOut === 'XLM') {
        // Alice spends USDC and mints the prepared USDC output note for Bob.
        contractAliceProof = aliceProof;
        contractAlicePubSignals = alicePubSignals;
        contractAliceNullifier = aliceNullifier;
        contractBobOutputCommitment = dbBobNewCommitment;
        const usdcLeaves = await this.sorobanService.getCommitments(
          usdcPool,
          dbBob.stellarPublicKey,
        );
        contractBobOutputRoot = await this.merkleTree.computeRootFromLeaves(
          [...usdcLeaves, dbBobNewCommitment],
          20,
        );

        // Bob spends XLM and mints the prepared XLM output note for Alice.
        contractBobProof = bobProof;
        contractBobPubSignals = bobPubSignals;
        contractBobNullifier = bobNullifier;
        contractAliceOutputCommitment = dbAliceNewCommitment;
        const xlmLeaves = await this.sorobanService.getCommitments(
          xlmPool,
          dbAlice.stellarPublicKey,
        );
        contractAliceOutputRoot = await this.merkleTree.computeRootFromLeaves(
          [...xlmLeaves, dbAliceNewCommitment],
          20,
        );
      } else if (offer.assetIn === 'XLM' && offer.assetOut === 'USDC') {
        // Bob spends USDC and mints the prepared USDC output note for Alice.
        contractAliceProof = bobProof;
        contractAlicePubSignals = bobPubSignals;
        contractAliceNullifier = bobNullifier;
        contractBobOutputCommitment = dbAliceNewCommitment;
        const usdcLeaves = await this.sorobanService.getCommitments(
          usdcPool,
          dbAlice.stellarPublicKey,
        );
        contractBobOutputRoot = await this.merkleTree.computeRootFromLeaves(
          [...usdcLeaves, dbAliceNewCommitment],
          20,
        );

        // Alice spends XLM and mints the prepared XLM output note for Bob.
        contractBobProof = aliceProof;
        contractBobPubSignals = alicePubSignals;
        contractBobNullifier = aliceNullifier;
        contractAliceOutputCommitment = dbBobNewCommitment;
        const xlmLeaves = await this.sorobanService.getCommitments(xlmPool, dbBob.stellarPublicKey);
        contractAliceOutputRoot = await this.merkleTree.computeRootFromLeaves(
          [...xlmLeaves, dbBobNewCommitment],
          20,
        );
      } else {
        throw new Error(`Unsupported asset pair: ${offer.assetIn}/${offer.assetOut}`);
      }

      const submitterSecret = executorId.equals(dbBob._id) ? bobSecret : aliceSecret;
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

      await this.usersService.saveNote(
        dbAlice._id.toString(),
        dbAliceNewAsset,
        dbAliceNewAsset === 'USDC' ? usdcPool : xlmPool,
        dbAliceNewNote,
        dbAliceNewCommitment,
        hash,
      );
      await this.usersService.saveNote(
        dbBob._id.toString(),
        dbBobNewAsset,
        dbBobNewAsset === 'USDC' ? usdcPool : xlmPool,
        dbBobNewNote,
        dbBobNewCommitment,
        hash,
      );

      if (swap.offerId) {
        await this.deactivateOffer(swap.offerId);
      }

      try {
        await this.usersService.markNoteSpent(
          dbAlice._id.toString(),
          Buffer.from(aliceNullifier).toString('hex'),
        );
        await this.usersService.markNoteSpent(
          dbBob._id.toString(),
          Buffer.from(bobNullifier).toString('hex'),
        );
      } catch (e) {
        console.error('[SwapService] Failed to mark input notes as spent:', e);
      }

      swap.status = 'completed';
      swap.executionStatus = 'confirmed';
      swap.txHash = hash;
      swap.completedAt = new Date();
      swap.lastError = undefined;
      await swap.save();

      this.autoWithdrawSafe(
        dbAlice._id.toString(),
        dbAlice.username,
        dbAliceNewAsset,
        swap.amountOut,
      );
      this.autoWithdrawSafe(dbBob._id.toString(), dbBob.username, dbBobNewAsset, swap.amountIn);

      await this.transactionAuditService.updateState(audit._id.toString(), 'success', {
        txHash: hash,
        indexingStatus: 'pending',
        indexingDetail:
          'Private swap executed successfully. Output notes are stored and public auto-withdraw will retry as indexing catches up.',
      });

      return { txHash: hash, auditId: audit._id.toString() };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      swap.status = 'failed';
      swap.executionStatus = 'failed';
      swap.failedAt = new Date();
      swap.lastError = message;
      await swap.save();

      await this.transactionAuditService.updateState(audit._id.toString(), 'failed', {
        error: message,
        indexingStatus: 'pending',
        indexingDetail:
          'Private swap execution failed after proof collection. Output notes should not be assumed to exist.',
      });

      throw e;
    }
  }

  private async autoWithdrawSafe(
    userId: string,
    username: string,
    asset: 'USDC' | 'XLM',
    amount: number,
  ) {
    const MAX_RETRIES = 20;
    const RETRY_DELAY_MS = 30_000;

    await new Promise((resolve) => setTimeout(resolve, 10000));

    let attempt = 1;
    while (attempt <= MAX_RETRIES) {
      try {
        console.log(
          `[SwapService] Auto-withdraw attempt ${attempt}/${MAX_RETRIES} for ${username} (${amount} ${asset})...`,
        );
        const res = await this.usersService.withdrawSelf(userId, asset, amount);
        if (res.success) {
          console.log(`[SwapService] Auto-withdraw SUCCESS for ${username}: ${res.txHash}`);
          return;
        }
        console.warn(`[SwapService] Auto-withdraw attempt ${attempt} failed: ${res.error}`);
        if (typeof res.error === 'string' && res.error.includes('User not found')) {
          console.error('[SwapService] Aborting auto-withdraw: User not found');
          return;
        }
      } catch (e) {
        console.error(`[SwapService] Auto-withdraw exception attempt ${attempt}:`, e);
      }

      if (attempt < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
      attempt++;
    }

    console.error(
      `[SwapService] Auto-withdraw GAVE UP for ${username} after ${MAX_RETRIES} attempts. manual withdrawal required.`,
    );
  }

  async findByUser(userId: Types.ObjectId) {
    const swaps = await this.swapModel
      .find({ $or: [{ aliceId: userId }, { bobId: userId }] })
      .populate('aliceId', 'username stellarPublicKey')
      .populate('bobId', 'username stellarPublicKey')
      .sort({ createdAt: -1 })
      .exec();

    return swaps.map((swap) => this.serializeSwapSummary(swap, userId));
  }

  async findPendingForBob(bobId: Types.ObjectId) {
    const swaps = await this.swapModel
      .find({ bobId, status: 'requested' })
      .populate('aliceId', 'username stellarPublicKey')
      .populate('bobId', 'username stellarPublicKey')
      .sort({ createdAt: -1 })
      .exec();

    return swaps.map((swap) => this.serializeSwapSummary(swap, bobId));
  }

  async findById(swapId: string) {
    return this.swapModel.findById(swapId).exec();
  }

  async getSwapStatusForUser(swapId: string, userId: Types.ObjectId) {
    const swap = await this.swapModel
      .findById(swapId)
      .populate('aliceId', 'username stellarPublicKey')
      .populate('bobId', 'username stellarPublicKey')
      .exec();
    if (!swap) {
      return null;
    }

    const role = this.getPartyRole(swap, userId);
    if (!role) {
      throw new Error('You are not a party to this swap');
    }

    const audits = await this.transactionAuditService.listRecentForSwap(swapId, 12);
    return {
      swap: this.serializeSwapSummary(swap, userId),
      participantRole: role,
      proofs: {
        status: this.computeProofStatus(swap),
        hasAliceProof: !!swap.aliceProofBytes,
        hasBobProof: !!swap.bobProofBytes,
        ready: this.computeProofStatus(swap) === 'ready',
      },
      execution: {
        status: swap.executionStatus,
        txHash: swap.txHash,
        lastError: swap.lastError,
      },
      audits: audits.map((audit: any) => ({
        id: audit._id.toString(),
        operation: audit.operation,
        state: audit.state,
        txHash: audit.txHash,
        indexingStatus: audit.indexingStatus,
        indexingDetail: audit.indexingDetail,
        error: audit.error,
        metadata: audit.metadata,
        createdAt: audit.createdAt,
        updatedAt: audit.updatedAt,
      })),
    };
  }

  async getSwapWorkspaceForUser(swapId: string, userId: Types.ObjectId) {
    const status = await this.getSwapStatusForUser(swapId, userId);
    if (!status) {
      return null;
    }

    const swap = status.swap as any;
    const offerId = swap.offerId?.toString?.() ?? swap.offerId;
    const offer = offerId
      ? await this.offerModel
          .findById(offerId)
          .populate('merchantId', 'username reputation')
          .lean()
          .exec()
      : null;

    const [viewerBalances, viewerPrivateBalances, recentSwaps] = await Promise.all([
      this.usersService.getBalances(userId.toString()),
      this.usersService.getPrivateBalance(userId.toString()),
      this.getRecentActivityForUser(userId, 8),
    ]);

    const participantRole = status.participantRole;
    const counterparty = participantRole === 'alice' ? swap.bobId : swap.aliceId;
    const myFundingAsset: 'USDC' | 'XLM' =
      participantRole === 'alice'
        ? ((offer?.assetIn as 'USDC' | 'XLM') ?? 'XLM')
        : ((offer?.assetOut as 'USDC' | 'XLM') ?? 'USDC');
    const myFundingAmount =
      participantRole === 'alice' ? Number(swap.amountIn) || 0 : Number(swap.amountOut) || 0;
    const publicFundingBalance = Number(
      myFundingAsset === 'USDC' ? viewerBalances.usdc || 0 : viewerBalances.xlm || 0,
    );
    const privateFundingBalance = Number(
      myFundingAsset === 'USDC' ? viewerPrivateBalances.usdc || 0 : viewerPrivateBalances.xlm || 0,
    );

    const proofRequirement = {
      asset: myFundingAsset,
      amount: myFundingAmount,
      publicBalance: publicFundingBalance,
      privateBalance: privateFundingBalance,
      hasPublicFunding: publicFundingBalance >= myFundingAmount,
      hasPrivateFunding: privateFundingBalance >= myFundingAmount,
      exactProofLikely:
        privateFundingBalance === myFundingAmount || privateFundingBalance >= myFundingAmount,
    };

    const routeMode =
      status.proofs.ready || swap.proofStatus === 'ready' || swap.status === 'proofs_pending'
        ? 'private'
        : 'public';

    const actionBoard: Array<{
      id: string;
      severity: 'critical' | 'warning' | 'info';
      title: string;
      detail: string;
      cta: string;
      href?: string;
      action:
        | 'accept'
        | 'prepare_proof'
        | 'deposit'
        | 'execute_public'
        | 'execute_private'
        | 'wait';
    }> = [];

    if (swap.status === 'requested' && participantRole === 'bob') {
      actionBoard.push({
        id: 'accept-request',
        severity: 'critical',
        title: 'Accept the buyer request',
        detail:
          'The buyer is blocked until the seller accepts and the lifecycle moves into proof collection or execution.',
        cta: 'Accept request',
        action: 'accept',
      });
    }

    if (swap.status === 'proofs_pending' && !swap.myProofSubmitted && routeMode === 'private') {
      actionBoard.push({
        id: 'prepare-proof',
        severity: 'critical',
        title: `Prepare an exact ${myFundingAmount} ${myFundingAsset} proof`,
        detail: proofRequirement.hasPrivateFunding
          ? 'You have enough private balance to attempt proof preparation, but exact-note shape may still require splitting.'
          : 'Private balance is not ready for this proof amount yet, so deposit or note preparation will be needed first.',
        cta: proofRequirement.hasPrivateFunding ? 'Prepare proof' : 'Fund private balance',
        href: proofRequirement.hasPrivateFunding ? undefined : '/wallet/fund',
        action: proofRequirement.hasPrivateFunding ? 'prepare_proof' : 'deposit',
      });
    }

    if (swap.status === 'proofs_ready') {
      actionBoard.push({
        id: 'execute-private',
        severity: 'critical',
        title: 'Finalize private execution',
        detail:
          'Both proofs are already present. The remaining blocker is an actual private execution submission.',
        cta: 'Execute privately',
        action: 'execute_private',
      });
    }

    if (swap.status === 'executing') {
      actionBoard.push({
        id: 'watch-execution',
        severity: 'info',
        title: 'Monitor execution outcome',
        detail:
          'The swap is already executing, so the right next step is monitoring rather than submitting a new action.',
        cta: 'Refresh status',
        action: 'wait',
      });
    }

    if (
      !actionBoard.length &&
      participantRole === 'bob' &&
      routeMode === 'public' &&
      swap.status !== 'completed' &&
      swap.status !== 'failed'
    ) {
      actionBoard.push({
        id: 'execute-public',
        severity: 'warning',
        title: 'Execute public settlement',
        detail:
          'Public settlement is controlled by the seller once both sides are operationally ready.',
        cta: 'Execute publicly',
        action: 'execute_public',
      });
    }

    if (swap.status === 'failed') {
      actionBoard.push({
        id: 'review-failure',
        severity: 'critical',
        title: 'Review the failed lifecycle before retrying',
        detail:
          swap.lastError ||
          status.execution.lastError ||
          'A recent failure is stored in the swap execution state or audit trail.',
        cta: 'Inspect audit trail',
        href: '/history',
        action: 'wait',
      });
    }

    const routeSummary = {
      recommendedMode:
        swap.status === 'requested'
          ? 'public'
          : swap.proofStatus === 'ready' || swap.status === 'proofs_pending'
            ? 'private'
            : 'public',
      public:
        participantRole === 'bob'
          ? 'Public settlement is available because the seller controls the final on-chain payment legs.'
          : 'Public settlement depends on the seller accepting and executing the direct on-chain transfer.',
      private:
        'Private settlement depends on both parties producing exact-value proofs and then executing the shielded swap lifecycle cleanly.',
    };

    const offerHealth = offer
      ? {
          active: !!offer.active,
          rate: Number(offer.rate) || 0,
          min: Number(offer.min) || 0,
          max: Number(offer.max) || 0,
          merchant: {
            username: (offer.merchantId as any)?.username,
            reputation: (offer.merchantId as any)?.reputation ?? 0,
          },
        }
      : null;

    const journey = [
      {
        id: 'requested',
        label: 'Request created',
        status: swap.status === 'requested' ? 'active' : 'done',
        detail:
          'A buyer request is on record and waiting for acceptance or the next route decision.',
      },
      {
        id: 'proofs',
        label: 'Proof collection',
        status:
          swap.status === 'proofs_pending'
            ? 'active'
            : swap.status === 'proofs_ready' || swap.proofStatus === 'ready'
              ? 'done'
              : swap.status === 'requested'
                ? 'pending'
                : swap.status === 'failed'
                  ? 'blocked'
                  : 'pending',
        detail:
          'Private flow requires both parties to produce exact-value proofs tied to the swap route.',
      },
      {
        id: 'execution',
        label: 'Execution',
        status:
          swap.status === 'executing'
            ? 'active'
            : swap.status === 'completed'
              ? 'done'
              : swap.status === 'failed'
                ? 'blocked'
                : 'pending',
        detail:
          'The final settlement leg can be public or private depending on route and readiness.',
      },
      {
        id: 'completion',
        label: 'Completion and audit visibility',
        status:
          swap.status === 'completed' ? 'done' : swap.status === 'failed' ? 'blocked' : 'pending',
        detail:
          'A finished swap should leave behind a clear tx hash or audit trail for both parties.',
      },
    ];

    return {
      swap: status.swap,
      participantRole,
      counterparty: {
        username: counterparty?.username,
        stellarPublicKey: counterparty?.stellarPublicKey,
      },
      proofs: status.proofs,
      execution: status.execution,
      audits: status.audits,
      routeSummary,
      proofRequirement,
      offerHealth,
      actionBoard,
      journey,
      viewerWallet: {
        public: viewerBalances,
        private: viewerPrivateBalances,
      },
      recentRelatedSwaps: recentSwaps.slice(0, 5).map((entry: any) => ({
        id: entry._id,
        status: entry.status,
        proofStatus: entry.proofStatus,
        executionStatus: entry.executionStatus,
        amountIn: entry.amountIn,
        amountOut: entry.amountOut,
        participantRole: entry.participantRole,
        createdAt: entry.createdAt,
        txHash: entry.txHash,
      })),
      timestamps: {
        createdAt: swap.createdAt,
        acceptedAt: swap.acceptedAt,
        proofsReadyAt: swap.proofsReadyAt,
        completedAt: swap.completedAt,
        failedAt: swap.failedAt,
      },
      updatedAt: new Date().toISOString(),
    };
  }

  async getRecentActivityForUser(userId: Types.ObjectId, limit = 10) {
    const swaps = await this.swapModel
      .find({ $or: [{ aliceId: userId }, { bobId: userId }] })
      .sort({ updatedAt: -1, createdAt: -1 })
      .limit(limit)
      .populate('aliceId', 'username')
      .populate('bobId', 'username')
      .exec();

    return swaps.map((swap) => this.serializeSwapSummary(swap, userId));
  }

  private toScaledAmount(amount: number): bigint {
    return BigInt(Math.round(amount * Number(SwapService.SCALE_FACTOR)));
  }

  private encryptOutputNote(
    recipient: User,
    noteFields: NoteFields,
    commitmentBytes: Uint8Array,
    asset: AssetType,
  ): string {
    if (!recipient.googleId) {
      throw new Error('Recipient Google ID required for output note encryption');
    }
    const encKey = this.authService.getDecryptionKeyForUser(
      recipient,
      recipient.googleId,
      recipient.email,
    );
    const payload = JSON.stringify({
      label: noteFields.label.toString(),
      value: noteFields.value.toString(),
      nullifier: noteFields.nullifier.toString(),
      secret: noteFields.secret.toString(),
      commitment: Buffer.from(commitmentBytes).toString('hex'),
      asset,
    });
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
    const ciphertext = nacl.secretbox(naclUtil.decodeUTF8(payload), nonce, encKey);
    const combined = Buffer.concat([Buffer.from(nonce), Buffer.from(ciphertext)]);
    return combined.toString('base64');
  }

  private decryptOutputNote(
    recipient: User,
    encryptedBase64: string,
    expectedAsset?: AssetType,
    expectedAmount?: number,
  ): PreparedOutputNote {
    if (!recipient.googleId) {
      throw new Error('Recipient Google ID required for output note decryption');
    }
    const encKey = this.authService.getDecryptionKeyForUser(
      recipient,
      recipient.googleId,
      recipient.email,
    );
    const combined = Buffer.from(encryptedBase64, 'base64');
    const nonce = new Uint8Array(combined.subarray(0, nacl.secretbox.nonceLength));
    const ciphertext = new Uint8Array(combined.subarray(nacl.secretbox.nonceLength));
    const decrypted = nacl.secretbox.open(ciphertext, nonce, encKey);
    if (!decrypted) {
      throw new Error('Output note decryption failed');
    }
    const parsed = JSON.parse(naclUtil.encodeUTF8(decrypted)) as {
      label: string;
      value: string;
      nullifier: string;
      secret: string;
      commitment: string;
      asset: AssetType;
    };
    const noteFields: NoteFields = {
      label: BigInt(parsed.label),
      value: BigInt(parsed.value),
      nullifier: BigInt(parsed.nullifier),
      secret: BigInt(parsed.secret),
    };
    if (expectedAsset && parsed.asset !== expectedAsset) {
      throw new Error('Prepared output note asset does not match swap terms');
    }
    if (expectedAmount !== undefined && noteFields.value !== this.toScaledAmount(expectedAmount)) {
      throw new Error('Prepared output note amount does not match swap terms');
    }
    return {
      noteFields,
      commitmentHex: parsed.commitment,
      commitmentBytes: new Uint8Array(Buffer.from(parsed.commitment, 'hex')),
      asset: parsed.asset,
    };
  }

  private async ensureOutputNote(
    swap: Swap,
    recipientRole: SwapPartyRole,
    recipient: User,
    asset: AssetType,
    amount: number,
  ): Promise<PreparedOutputNote> {
    const existingCiphertext =
      recipientRole === 'alice' ? swap.aliceOutputNoteCiphertext : swap.bobOutputNoteCiphertext;
    if (existingCiphertext) {
      return this.decryptOutputNote(recipient, existingCiphertext, asset, amount);
    }

    const generated = await this.usersService.generateNote(recipient._id.toString(), amount);
    const commitmentHex = Buffer.from(generated.commitmentBytes).toString('hex');
    const encrypted = this.encryptOutputNote(
      recipient,
      generated.noteFields,
      generated.commitmentBytes,
      asset,
    );

    if (recipientRole === 'alice') {
      swap.aliceOutputNoteCiphertext = encrypted;
      swap.aliceOutputCommitment = commitmentHex;
      swap.aliceOutputAsset = asset;
    } else {
      swap.bobOutputNoteCiphertext = encrypted;
      swap.bobOutputCommitment = commitmentHex;
      swap.bobOutputAsset = asset;
    }
    await swap.save();

    return {
      noteFields: generated.noteFields,
      commitmentBytes: generated.commitmentBytes,
      commitmentHex,
      asset,
    };
  }

  private getPreparedOutputNote(
    swap: Swap,
    recipientRole: SwapPartyRole,
    recipient: User,
    asset: AssetType,
    amount: number,
  ): PreparedOutputNote {
    const encrypted =
      recipientRole === 'alice' ? swap.aliceOutputNoteCiphertext : swap.bobOutputNoteCiphertext;
    const commitment =
      recipientRole === 'alice' ? swap.aliceOutputCommitment : swap.bobOutputCommitment;
    if (!encrypted || !commitment) {
      throw new Error('Prepared output note missing. Prepare both swap proofs again.');
    }
    const note = this.decryptOutputNote(recipient, encrypted, asset, amount);
    if (note.commitmentHex !== commitment) {
      throw new Error('Prepared output note commitment mismatch');
    }
    return note;
  }

  private getUsdcIssuer(): string {
    return (
      process.env.USDC_ISSUER ||
      (isMainnetContext()
        ? 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
        : 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5')
    );
  }

  private stellarAssetFor(asset: AssetType): Asset {
    return asset === 'XLM' ? Asset.native() : new Asset('USDC', this.getUsdcIssuer());
  }

  private getPartyRole(
    swap: Pick<Swap, 'aliceId' | 'bobId'>,
    userId: Types.ObjectId,
  ): SwapPartyRole | null {
    if (swap.aliceId.toString() === userId.toString()) {
      return 'alice';
    }
    if (swap.bobId.toString() === userId.toString()) {
      return 'bob';
    }
    return null;
  }

  private isProofCollectionState(status: SwapStatus) {
    return status === 'proofs_pending' || status === 'proofs_ready';
  }

  private isExecutionReady(swap: Pick<Swap, 'status' | 'proofStatus'>) {
    return swap.status === 'proofs_ready' || swap.proofStatus === 'ready';
  }

  private async verifyPublicSwapSettlement(
    txHash: string,
    swap: Pick<Swap, 'aliceId' | 'bobId' | 'offerId' | 'amountIn' | 'amountOut'>,
  ) {
    const [alice, bob, offer] = await Promise.all([
      this.userModel.findById(swap.aliceId).exec(),
      this.userModel.findById(swap.bobId).exec(),
      swap.offerId ? this.offerModel.findById(swap.offerId).exec() : Promise.resolve(null),
    ]);

    if (!alice || !bob || !offer) {
      throw new BadRequestException('Swap participants or offer could not be loaded');
    }

    try {
      const transaction = await this.server.transactions().transaction(txHash).call();
      if ((transaction as any).successful === false) {
        throw new BadRequestException('Transaction was not successful');
      }
      const operations = await this.server.operations().forTransaction(txHash).limit(200).call();
      const payments = operations.records.filter((operation: any) => operation.type === 'payment');

      const expectedLegs = [
        {
          from: bob.stellarPublicKey,
          to: alice.stellarPublicKey,
          asset: offer.assetOut,
          amount: swap.amountOut,
        },
        {
          from: alice.stellarPublicKey,
          to: bob.stellarPublicKey,
          asset: offer.assetIn,
          amount: swap.amountIn,
        },
      ];

      const settlesBothLegs = expectedLegs.every((leg) =>
        payments.some((operation: any) => this.paymentMatchesExpectedLeg(operation, leg)),
      );

      if (!settlesBothLegs) {
        throw new BadRequestException('Transaction does not settle both swap payment legs');
      }
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('Transaction hash was not found on the Stellar network');
    }
  }

  private paymentMatchesExpectedLeg(
    operation: any,
    leg: { from: string; to: string; asset: AssetType; amount: number },
  ) {
    const operationFrom = operation.from ?? operation.source_account;
    return (
      operationFrom === leg.from &&
      operation.to === leg.to &&
      this.paymentAssetMatches(operation, leg.asset) &&
      this.isSameStellarAmount(operation.amount, leg.amount)
    );
  }

  private paymentAssetMatches(operation: any, asset: AssetType) {
    if (asset === 'XLM') {
      return operation.asset_type === 'native';
    }
    return (
      operation.asset_type !== 'native' &&
      operation.asset_code === 'USDC' &&
      operation.asset_issuer === this.getUsdcIssuer()
    );
  }

  private isSameStellarAmount(actualValue: unknown, expectedValue: number) {
    const actual = Number(actualValue);
    return Number.isFinite(actual) && Math.abs(actual - expectedValue) <= 0.0000001;
  }

  private computeProofStatus(
    swap: Pick<Swap, 'status' | 'aliceProofBytes' | 'bobProofBytes'>,
  ): SwapProofStatus {
    if (swap.status === 'requested') {
      return 'awaiting_acceptance';
    }
    if (swap.aliceProofBytes && swap.bobProofBytes) {
      return 'ready';
    }
    if (swap.aliceProofBytes) {
      return 'awaiting_bob';
    }
    if (swap.bobProofBytes) {
      return 'awaiting_alice';
    }
    return 'awaiting_both';
  }

  private serializeSwapSummary(swap: any, userId?: Types.ObjectId) {
    const role = userId ? this.getPartyRole(swap, userId) : null;
    const myProofSubmitted =
      role === 'alice' ? !!swap.aliceProofBytes : role === 'bob' ? !!swap.bobProofBytes : false;
    const counterpartyProofSubmitted =
      role === 'alice' ? !!swap.bobProofBytes : role === 'bob' ? !!swap.aliceProofBytes : false;

    return {
      _id: swap._id,
      aliceId: swap.aliceId,
      bobId: swap.bobId,
      offerId: swap.offerId,
      amountIn: swap.amountIn,
      amountOut: swap.amountOut,
      status: swap.status,
      proofStatus: this.computeProofStatus(swap),
      executionStatus: swap.executionStatus,
      txHash: swap.txHash,
      createdAt: swap.createdAt,
      acceptedAt: swap.acceptedAt,
      proofsReadyAt: swap.proofsReadyAt,
      completedAt: swap.completedAt,
      failedAt: swap.failedAt,
      lastError: swap.lastError,
      participantRole: role,
      proofReady: !!(swap.aliceProofBytes && swap.bobProofBytes),
      myProofSubmitted,
      counterpartyProofSubmitted,
      lastActorRole: swap.lastActorRole,
    };
  }

  private async deactivateOffer(offerId: Types.ObjectId) {
    try {
      console.log(`[SwapService] Deactivating offer ${offerId}`);
      await this.offerModel.findByIdAndUpdate(offerId, { active: false }).exec();
    } catch (e) {
      console.error('Failed to deactivate offer:', e);
    }
  }

  private async createAudit(swap: Swap, context: SwapAuditContext) {
    return this.transactionAuditService.create({
      userId: context.actorId.toString(),
      operation: context.operation,
      state: context.state ?? 'pending',
      txHash: context.txHash,
      sponsorshipAttempted: false,
      sponsored: false,
      indexingStatus: 'tracked',
      indexingDetail: 'Swap lifecycle is tracked through request, proof, and execution stages.',
      error: context.error,
      metadata: {
        swapId: swap._id.toString(),
        aliceId: swap.aliceId.toString(),
        bobId: swap.bobId.toString(),
        offerId: swap.offerId?.toString(),
        status: swap.status,
        proofStatus: swap.proofStatus,
        executionStatus: swap.executionStatus,
        ...context.metadata,
      },
    });
  }

  private async markAuditFailure(auditId: string, error: string) {
    await this.transactionAuditService.updateState(auditId, 'failed', {
      error,
      indexingStatus: 'tracked',
      indexingDetail: 'Swap lifecycle tracking recorded the failure before execution.',
    });
  }
}
