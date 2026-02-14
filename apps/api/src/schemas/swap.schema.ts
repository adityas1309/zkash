import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type SwapStatus = 'requested' | 'locked' | 'completed' | 'cancelled';

@Schema({ timestamps: true })
export class Swap extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  aliceId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  bobId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Offer' })
  offerId: Types.ObjectId;

  @Prop({ required: true, enum: ['requested', 'locked', 'completed', 'cancelled'] })
  status: SwapStatus;

  @Prop({ required: true })
  amountIn: number;

  @Prop({ required: true })
  amountOut: number;

  @Prop()
  txHash?: string;

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
