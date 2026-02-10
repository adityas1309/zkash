import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class EncryptedNote extends Document {
  @Prop({ default: '' })
  commitment: string;

  @Prop({ default: '' })
  ciphertext: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  recipientId?: Types.ObjectId;

  @Prop({ required: true })
  asset: string;

  @Prop({ required: true })
  txHash: string;

  @Prop({ required: true })
  poolAddress: string;

  @Prop({ default: false })
  decrypted: boolean;
}

export const EncryptedNoteSchema = SchemaFactory.createForClass(EncryptedNote);
