import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type SwapStatus =
  | 'requested'
  | 'proofs_pending'
  | 'proofs_ready'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type SwapProofStatus =
  | 'awaiting_acceptance'
  | 'awaiting_both'
  | 'awaiting_alice'
  | 'awaiting_bob'
  | 'ready';

export type SwapExecutionStatus = 'not_started' | 'ready' | 'processing' | 'confirmed' | 'failed';

@Schema({ timestamps: true })
export class Swap extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  aliceId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  bobId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Offer' })
  offerId: Types.ObjectId;

  @Prop({
    required: true,
    enum: [
      'requested',
      'proofs_pending',
      'proofs_ready',
      'executing',
      'completed',
      'failed',
      'cancelled',
    ],
  })
  status: SwapStatus;

  @Prop({
    required: true,
    default: 'awaiting_acceptance',
    enum: ['awaiting_acceptance', 'awaiting_both', 'awaiting_alice', 'awaiting_bob', 'ready'],
  })
  proofStatus: SwapProofStatus;

  @Prop({
    required: true,
    default: 'not_started',
    enum: ['not_started', 'ready', 'processing', 'confirmed', 'failed'],
  })
  executionStatus: SwapExecutionStatus;

  @Prop({ required: true })
  amountIn: number;

  @Prop({ required: true })
  amountOut: number;

  @Prop()
  txHash?: string;

  @Prop()
  lastActorId?: Types.ObjectId;

  @Prop()
  lastActorRole?: 'alice' | 'bob';

  @Prop()
  acceptedAt?: Date;

  @Prop()
  proofsReadyAt?: Date;

  @Prop()
  executionStartedAt?: Date;

  @Prop()
  completedAt?: Date;

  @Prop()
  failedAt?: Date;

  @Prop()
  lastError?: string;

  @Prop()
  aliceProofBytes?: string;
  @Prop()
  alicePubSignalsBytes?: string;
  @Prop()
  aliceNullifier?: string;
  @Prop()
  bobProofBytes?: string;
  @Prop()
  bobPubSignalsBytes?: string;
  @Prop()
  bobNullifier?: string;
}

export const SwapSchema = SchemaFactory.createForClass(Swap);
SwapSchema.index({ aliceId: 1, createdAt: -1 });
SwapSchema.index({ bobId: 1, createdAt: -1 });
SwapSchema.index({ status: 1, proofStatus: 1, createdAt: -1 });
