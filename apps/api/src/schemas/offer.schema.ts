import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type AssetType = 'USDC' | 'XLM';

@Schema({ timestamps: true })
export class Offer extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  merchantId: Types.ObjectId;

  @Prop({ required: true, enum: ['USDC', 'XLM'] })
  assetIn: AssetType;

  @Prop({ required: true, enum: ['USDC', 'XLM'] })
  assetOut: AssetType;

  @Prop({ required: true })
  rate: number;

  @Prop({ required: true })
  min: number;

  @Prop({ required: true })
  max: number;

  @Prop({ default: true })
  active: boolean;
}

export const OfferSchema = SchemaFactory.createForClass(Offer);
