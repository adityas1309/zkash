import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

/**
 * Spendable note: full note data (label, value, nullifier, secret, commitment)
 * stored encrypted so the backend can use it for proof generation.
 * Created on deposit; consumed when user sends privately or participates in a swap.
 */
@Schema({ timestamps: true })
export class SpendableNote extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  /** Encrypted JSON: { label, value, nullifier, secret, commitment } (all as hex or decimal strings for field elements). */
  @Prop({ required: true })
  ciphertext: string;

  /** Pool contract address this note belongs to (USDC or XLM pool). */
  @Prop({ required: true })
  poolAddress: string;

  /** Asset: USDC or XLM */
  @Prop({ required: true })
  asset: string;

  /** Whether this note has been spent (nullifier used). */
  @Prop({ default: false })
  spent: boolean;
}

export const SpendableNoteSchema = SchemaFactory.createForClass(SpendableNote);
