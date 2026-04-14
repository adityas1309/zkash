import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '../schemas/user.schema';
import { Keypair } from '@stellar/stellar-sdk';
import * as nacl from 'tweetnacl';
import * as naclUtil from 'tweetnacl-util';
import { UsersService } from '../users/users.service';
import { OpsService } from '../ops/ops.service';

export interface AuthWorkspaceChecklistItem {
  id: string;
  label: string;
  status: 'complete' | 'attention' | 'blocked';
  detail: string;
  action: string;
}

export interface AuthWorkspaceView {
  session: {
    authenticated: boolean;
    hasUser: boolean;
  };
  user: null | {
    id: string;
    email: string;
    username: string;
    stellarPublicKey: string;
    reputation: number;
  };
  network: {
    mode: 'testnet' | 'mainnet';
    label: string;
  };
  readiness: {
    score: number;
    tone: 'guest' | 'blocked' | 'attention' | 'ready';
    headline: string;
    detail: string;
  };
  wallet: {
    public: {
      xlm: string;
      usdc: string;
      hasXlm: boolean;
      hasUsdcTrustline: boolean;
    };
    private: {
      xlm: string;
      usdc: string;
      hasShieldedBalance: boolean;
    };
  };
  ops: {
    status: 'ready' | 'degraded';
    trackedPools: number;
    laggingPools: number;
  };
  nextActions: string[];
  checklist: AuthWorkspaceChecklistItem[];
  faucet: {
    xlm: {
      available: boolean;
      label: string;
    };
    usdc: {
      available: boolean;
      url: string;
    };
  };
}

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    @Inject(forwardRef(() => UsersService)) private usersService: UsersService,
    private opsService: OpsService,
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

  async getAuthWorkspace(userId?: string): Promise<AuthWorkspaceView> {
    if (!userId) {
      return {
        session: {
          authenticated: false,
          hasUser: false,
        },
        user: null,
        network: this.getNetworkInfo(),
        readiness: {
          score: 10,
          tone: 'guest',
          headline: 'Sign in to start your private Stellar workspace.',
          detail: 'Authentication unlocks wallet generation, trustline setup, private-note actions, and the full dashboard.',
        },
        wallet: {
          public: {
            xlm: '0',
            usdc: '0',
            hasXlm: false,
            hasUsdcTrustline: false,
          },
          private: {
            xlm: '0',
            usdc: '0',
            hasShieldedBalance: false,
          },
        },
        ops: {
          status: 'degraded',
          trackedPools: 0,
          laggingPools: 0,
        },
        nextActions: [
          'Authenticate with Google to provision your Stellar and private note keys.',
          'Fund the generated wallet with testnet XLM before trying a deposit or swap.',
          'Add the USDC trustline so the wallet can receive and convert stable value.',
        ],
        checklist: [
          {
            id: 'login',
            label: 'Authenticate account',
            status: 'attention',
            detail: 'A Google sign-in is required before the app can provision wallet secrets securely.',
            action: 'Sign in with Google',
          },
          {
            id: 'funding',
            label: 'Fund testnet wallet',
            status: 'blocked',
            detail: 'Funding cannot happen until a wallet exists for this session.',
            action: 'Create a wallet first',
          },
          {
            id: 'trustline',
            label: 'Add USDC trustline',
            status: 'blocked',
            detail: 'Trustline setup is available after authentication and wallet funding.',
            action: 'Unlock wallet setup',
          },
        ],
        faucet: {
          xlm: {
            available: true,
            label: 'Friendbot XLM',
          },
          usdc: {
            available: true,
            url: 'https://faucet.circle.com/?network=stellar-testnet',
          },
        },
      };
    }

    const [user, balances, privateBalances, ready] = await Promise.all([
      this.findById(userId),
      this.usersService.getBalances(userId),
      this.usersService.getPrivateBalance(userId),
      this.opsService.getReadiness(),
    ]);

    if (!user) {
      return this.getAuthWorkspace(undefined);
    }

    const publicXlm = Number(balances.xlm || 0);
    const publicUsdc = Number(balances.usdc || 0);
    const privateXlm = Number(privateBalances.xlm || 0);
    const privateUsdc = Number(privateBalances.usdc || 0);
    const hasXlm = publicXlm > 0;
    const hasUsdcTrustline = publicUsdc > 0 || this.mightHaveTrustline(balances.usdc);
    const hasShieldedBalance = privateXlm > 0 || privateUsdc > 0;
    const laggingPools = ready.lagging.length;

    const checklist: AuthWorkspaceChecklistItem[] = [
      {
        id: 'wallet',
        label: 'Wallet provisioned',
        status: 'complete',
        detail: `Your account is mapped to ${user.stellarPublicKey.slice(0, 6)}...${user.stellarPublicKey.slice(-6)}.`,
        action: 'Open wallet workspace',
      },
      {
        id: 'funding',
        label: 'Fund public wallet',
        status: hasXlm ? 'complete' : 'attention',
        detail: hasXlm
          ? `Public wallet already holds ${balances.xlm} XLM for fees and transfers.`
          : 'The public wallet still needs testnet XLM before deposits, swaps, or trustline changes can execute.',
        action: hasXlm ? 'Refresh balances' : 'Use Friendbot XLM',
      },
      {
        id: 'trustline',
        label: 'Enable USDC trustline',
        status: hasUsdcTrustline ? 'complete' : hasXlm ? 'attention' : 'blocked',
        detail: hasUsdcTrustline
          ? `USDC flow is available with a current public balance of ${balances.usdc}.`
          : hasXlm
            ? 'The wallet is funded, so the next high-value step is adding the USDC trustline.'
            : 'Trustline setup should wait until the wallet has enough XLM to pay network fees.',
        action: hasUsdcTrustline ? 'Open wallet workspace' : 'Add trustline',
      },
      {
        id: 'private',
        label: 'Seed private balance',
        status: hasShieldedBalance ? 'complete' : hasXlm || hasUsdcTrustline ? 'attention' : 'blocked',
        detail: hasShieldedBalance
          ? `Shielded balances are active with ${privateBalances.xlm} XLM and ${privateBalances.usdc} USDC in private flow.`
          : 'A first deposit into the shielded pool will unlock private send, note splitting, and private swap readiness.',
        action: hasShieldedBalance ? 'Open private flows' : 'Make first deposit',
      },
      {
        id: 'ops',
        label: 'Operational readiness',
        status: laggingPools === 0 && ready.status === 'ready' ? 'complete' : laggingPools > 0 ? 'attention' : 'blocked',
        detail:
          laggingPools === 0 && ready.status === 'ready'
            ? 'The canonical indexer is healthy and sponsorship/indexing surfaces are available.'
            : laggingPools > 0
              ? `${laggingPools} pool sync lanes are lagging, so private balance refreshes may take longer than usual.`
              : 'The app is still booting required dependencies for a full private-flow experience.',
        action: 'Open status workspace',
      },
    ];

    const score = checklist.reduce((total, item) => {
      if (item.status === 'complete') return total + 25;
      if (item.status === 'attention') return total + 12;
      return total;
    }, 0);

    const readiness =
      score >= 90
        ? {
            score,
            tone: 'ready' as const,
            headline: 'Your account is ready for public, private, and market flows.',
            detail: 'Funding, trustline, and private-note prerequisites are all in place, so the app can move straight into transactions.',
          }
        : score >= 50
          ? {
              score,
              tone: 'attention' as const,
              headline: 'Your account is close, but a few setup steps still gate smooth execution.',
              detail: 'You can explore the product now, but finishing wallet funding, trustline setup, or first deposit will reduce friction.',
            }
          : {
              score,
              tone: 'blocked' as const,
              headline: 'Your account exists, but it still needs setup before private flows will feel reliable.',
              detail: 'The wallet is provisioned, yet core prerequisites like XLM funding or a USDC trustline are still missing.',
            };

    return {
      session: {
        authenticated: true,
        hasUser: true,
      },
      user: {
        id: user._id.toString(),
        email: user.email,
        username: user.username,
        stellarPublicKey: user.stellarPublicKey,
        reputation: user.reputation ?? 0,
      },
      network: this.getNetworkInfo(),
      readiness,
      wallet: {
        public: {
          xlm: balances.xlm,
          usdc: balances.usdc,
          hasXlm,
          hasUsdcTrustline,
        },
        private: {
          xlm: privateBalances.xlm,
          usdc: privateBalances.usdc,
          hasShieldedBalance,
        },
      },
      ops: {
        status: ready.status === 'ready' ? 'ready' : 'degraded',
        trackedPools: ready.counts.trackedPools,
        laggingPools,
      },
      nextActions: checklist
        .filter((item) => item.status !== 'complete')
        .slice(0, 3)
        .map((item) => `${item.label}: ${item.action}`),
      checklist,
      faucet: {
        xlm: {
          available: true,
          label: 'Friendbot XLM',
        },
        usdc: {
          available: true,
          url: 'https://faucet.circle.com/?network=stellar-testnet',
        },
      },
    };
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

  private getNetworkInfo() {
    const isMainnet = process.env.NETWORK === 'mainnet';
    return {
      mode: isMainnet ? 'mainnet' as const : 'testnet' as const,
      label: isMainnet ? 'Stellar Mainnet' : 'Stellar Testnet',
    };
  }

  private mightHaveTrustline(balance: string) {
    return balance !== undefined && balance !== null;
  }
}
