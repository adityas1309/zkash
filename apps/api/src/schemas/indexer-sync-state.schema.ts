import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class IndexerSyncState extends Document {
  @Prop({ required: true, index: true })
  network: string;

  @Prop({ required: true, index: true })
  poolAddress: string;

  @Prop({ required: true, default: 0 })
  lastProcessedLedger: number;

  @Prop({ default: 0 })
  eventCount: number;

  @Prop({ default: 0 })
  commitmentCount: number;

  @Prop({ default: 'healthy' })
  status: string;

  @Prop()
  lastSuccessfulSyncAt?: Date;

  @Prop()
  lastError?: string;
}

export const IndexerSyncStateSchema = SchemaFactory.createForClass(IndexerSyncState);
IndexerSyncStateSchema.index({ network: 1, poolAddress: 1 }, { unique: true });
