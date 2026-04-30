import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type FiatOrderStatus = 'created' | 'paid' | 'fulfilled' | 'failed';

@Schema({ timestamps: true })
export class FiatOrder extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, unique: true })
  razorpayOrderId: string;

  @Prop({ unique: true, sparse: true })
  razorpayPaymentId?: string;

  @Prop({ required: true })
  amountInr: number;

  @Prop({ required: true })
  amountPaise: number;

  @Prop({ required: true, default: 'INR' })
  currency: string;

  @Prop({ required: true, enum: ['public', 'zk'] })
  mode: 'public' | 'zk';

  @Prop({ required: true, enum: ['created', 'paid', 'fulfilled', 'failed'], default: 'created' })
  status: FiatOrderStatus;

  @Prop()
  netXlm?: string;

  @Prop()
  fulfilledTxHash?: string;

  @Prop()
  paidAt?: Date;

  @Prop()
  processedAt?: Date;

  @Prop()
  failureReason?: string;
}

export const FiatOrderSchema = SchemaFactory.createForClass(FiatOrder);
FiatOrderSchema.index({ userId: 1, createdAt: -1 });
FiatOrderSchema.index({ status: 1, createdAt: -1 });
