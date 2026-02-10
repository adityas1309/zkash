import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class PendingWithdrawal extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  recipientId: Types.ObjectId;

  @Prop({ required: true })
  proofBytes: string; // base64

  @Prop({ required: true })
  pubSignalsBytes: string; // base64

  @Prop({ required: true })
  nullifier: string; // hex or base64

  @Prop({ required: true })
  amount: string;

  @Prop({ required: true })
  asset: string;

  @Prop()
  txHash?: string;

  @Prop({ default: false })
  processed: boolean;
}

export const PendingWithdrawalSchema = SchemaFactory.createForClass(PendingWithdrawal);
