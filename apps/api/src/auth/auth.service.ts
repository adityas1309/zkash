import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '../schemas/user.schema';
import { Keypair } from '@stellar/stellar-sdk';
import * as nacl from 'tweetnacl';
import * as naclUtil from 'tweetnacl-util';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
  ) { }

  async deleteUser(userId: string): Promise<boolean> {
    const res = await this.userModel.deleteOne({ _id: userId }).exec();
    return res.deletedCount > 0;
  }

  async findOrCreateFromGoogle(
    profile: { id: string; emails: { value: string }[]; displayName?: string },
  ): Promise<User> {
    const email = profile.emails?.[0]?.value;
    if (!email) throw new Error('No email from Google');

    let user = await this.userModel.findOne({ email }).exec();
    if (user) {
      if (!user.googleId) {
        user.googleId = profile.id;
        await user.save();
      }
      return user;
    }

    const username = this.generateUsername(email, profile.displayName);
    const { stellarPublicKey, stellarSecretKey } = this.createStellarKeypair();
    const { spendingKey, viewKey } = this.createzkKeypair();

    const encryptionKey = this.deriveEncryptionKey(profile.id, email);
    console.log(`[AuthService] New User - GoogleID: ${profile.id}, Email: ${email}`);
    console.log(`[AuthService] Derived Key (Hex): ${Buffer.from(encryptionKey).toString('hex')}`);

    const stellarSecretKeyEncrypted = this.encrypt(stellarSecretKey, encryptionKey);

    // DEBUG: Immediate Verification
    try {
      const decrypted = this.decrypt(stellarSecretKeyEncrypted, encryptionKey);
      if (decrypted !== stellarSecretKey) console.error("CRITICAL: Immediate decryption MISMATCH!");
      else console.log("IMMEDIATE DECRYPTION PASSED!");
    } catch (e) {
      console.error("CRITICAL: Immediate decryption THREW:", e);
    }

    const zkSpendingKeyEncrypted = this.encrypt(spendingKey, encryptionKey);
    const zkViewKeyEncrypted = this.encrypt(viewKey, encryptionKey);

    user = await this.userModel.create({
      email,
      username,
      googleId: profile.id,
      stellarPublicKey,
      stellarSecretKeyEncrypted,
      zkSpendingKeyEncrypted,
      zkViewKeyEncrypted,
      reputation: 0,
      identityCommitment: undefined,
    });

    return user;
  }

  async findById(id: string): Promise<User | null> {
    return this.userModel.findById(id).exec();
  }

  private generateUsername(email: string, displayName?: string): string {
    const base = displayName
      ? displayName.replace(/\s+/g, '_').toLowerCase().slice(0, 12)
      : email.split('@')[0].slice(0, 12);
    const suffix = Math.random().toString(36).slice(2, 6);
    return `${base}_${suffix}`;
  }

  private createStellarKeypair(): { stellarPublicKey: string; stellarSecretKey: string } {
    const pair = Keypair.random();
    return {
      stellarPublicKey: pair.publicKey(),
      stellarSecretKey: pair.secret(),
    };
  }

  private createzkKeypair(): { spendingKey: string; viewKey: string } {
    const spendingKey = nacl.randomBytes(32);
    const viewKey = nacl.randomBytes(32);
    return {
      spendingKey: Buffer.from(spendingKey).toString('hex'),
      viewKey: Buffer.from(viewKey).toString('hex'),
    };
  }

  private deriveEncryptionKey(googleId: string, email: string): Uint8Array {
    const input = `${googleId}:${email}`;
    const hash = nacl.hash(naclUtil.decodeUTF8(input));
    return hash.slice(0, nacl.secretbox.keyLength);
  }

  private encrypt(plaintext: string, key: Uint8Array): string {
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
    const encrypted = nacl.secretbox(
      naclUtil.decodeUTF8(plaintext),
      nonce,
      key,
    );
    const combined = new Uint8Array(nonce.length + encrypted.length);
    combined.set(nonce);
    combined.set(encrypted, nonce.length);  // FIXED: Add offset to not overwrite nonce
    return Buffer.from(combined).toString('base64');
  }

  decrypt(encryptedBase64: string, key: Uint8Array): string {
    const combined = Buffer.from(encryptedBase64, 'base64');
    const nonce = new Uint8Array(combined.slice(0, nacl.secretbox.nonceLength));
    const ciphertext = new Uint8Array(combined.slice(nacl.secretbox.nonceLength));

    const decrypted = nacl.secretbox.open(
      ciphertext,
      nonce,
      key,
    );
    if (!decrypted) {
      console.error('Decryption failed for key:', Buffer.from(key).toString('hex'));
      console.error('Nonce:', Buffer.from(nonce).toString('hex'));
      console.error('Ciphertext length:', ciphertext.length);
      throw new Error('Decryption failed - nacl.secretbox.open returned null');
    }
    return naclUtil.encodeUTF8(decrypted);
  }

  getDecryptionKeyForUser(user: User, googleId: string, email: string): Uint8Array {
    console.log(`[AuthService] Decrypting - GoogleID: ${googleId}, Email: ${email}`);
    const key = this.deriveEncryptionKey(googleId, email);
    console.log(`[AuthService] Derived Key (Hex): ${Buffer.from(key).toString('hex')}`);
    return key;
  }
}
