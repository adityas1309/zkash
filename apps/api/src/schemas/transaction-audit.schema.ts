import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type TransactionAuditState =
  | 'queued'
  | 'pending'
  | 'success'
  | 'failed'
  | 'retryable';

@Schema({ timestamps: true })
export class TransactionAudit extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, index: true })
  operation: string;

  @Prop({ required: true, default: 'pending', index: true })
  state: TransactionAuditState;

  @Prop()
  txHash?: string;

  @Prop()
  asset?: string;

  @Prop()
  amount?: string;

  @Prop()
  recipient?: string;

  @Prop({ default: false })
  sponsorshipAttempted: boolean;

  @Prop({ default: false })
  sponsored: boolean;

  @Prop()
  sponsorshipDetail?: string;

  @Prop()
  indexingStatus?: string;

  @Prop()
  indexingDetail?: string;

  @Prop()
  error?: string;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, unknown>;
}

export const TransactionAuditSchema = SchemaFactory.createForClass(TransactionAudit);
TransactionAuditSchema.index({ userId: 1, createdAt: -1 });
