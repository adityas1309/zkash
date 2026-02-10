import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/**
 * Cached on-chain commitment list entry for a ShieldedPool.
 * This enables fast lookup of commitment -> index and Merkle path computation.
 */
@Schema({ timestamps: true })
export class PoolCommitment extends Document {
  @Prop({ required: true, index: true })
  poolAddress: string;

  /** 0-based leaf index in insertion order. */
  @Prop({ required: true })
  index: number;

  /** Commitment bytes hex (32 bytes, lowercase hex). */
  @Prop({ required: true })
  commitmentHex: string;
}

export const PoolCommitmentSchema = SchemaFactory.createForClass(PoolCommitment);
PoolCommitmentSchema.index({ poolAddress: 1, index: 1 }, { unique: true });
PoolCommitmentSchema.index({ poolAddress: 1, commitmentHex: 1 }, { unique: true });

