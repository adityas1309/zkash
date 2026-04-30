import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class User extends Document {
  @Prop({ required: true, unique: true })
  email: string;

  @Prop({ required: true, unique: true })
  username: string;

  @Prop({ required: true })
  stellarPublicKey: string;

  @Prop({ required: true })
  stellarSecretKeyEncrypted: string;

  @Prop({ required: true })
  zkSpendingKeyEncrypted: string;

  @Prop({ required: true })
  zkViewKeyEncrypted: string;

  @Prop({ default: 0 })
  reputation: number;

  @Prop()
  googleId?: string;

  @Prop({ default: 1 })
  keyDerivationVersion: number;

  @Prop({ unique: true, sparse: true })
  identityCommitment?: string;
}

export const UserSchema = SchemaFactory.createForClass(User);
