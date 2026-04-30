import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '../schemas/user.schema';
import { Keypair } from '@stellar/stellar-sdk';
import * as crypto from 'crypto';
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

export interface AccountWorkspaceView {
  session: {
    authenticated: boolean;
    provider: 'google';
    network: {
      mode: 'testnet' | 'mainnet';
      label: string;
    };
    readiness: AuthWorkspaceView['readiness'];
    memberSince?: string;
  };
  profile: {
    id: string;
    email: string;
    username: string;
    stellarPublicKey: string;
    stellarKeyPreview: string;
    reputation: number;
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
    pendingWithdrawals: number;
    composition: {
      publicValueSignals: string[];
      privateValueSignals: string[];
    };
  };
  operations: {
    status: 'ready' | 'degraded';
    trackedPools: number;
    laggingPools: number;
    laggingPoolLabels: string[];
    summary: string;
  };
  activity: {
    total: number;
    completed: number;
    pending: number;
    failed: number;
    privateFlows: number;
    sponsored: number;
    velocity: {
      last24h: {
        total: number;
        successful: number;
        pending: number;
      };
      last7d: {
        total: number;
        successful: number;
        dailyAverage: number;
      };
      momentum: string;
    };
    latestTitles: string[];
  };
  safety: {
    checklist: AuthWorkspaceChecklistItem[];
    recoveryActions: string[];
    keyMaterial: Array<{
      id: string;
      label: string;
      status: 'ready' | 'attention';
      detail: string;
    }>;
  };
  routes: Array<{
    id: string;
    label: string;
    href: string;
    readiness: 'ready' | 'attention' | 'blocked';
    detail: string;
  }>;
  dangerZone: {
    deleteConfirmationLabel: string;
    deleteWarning: string[];
  };
}

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    @Inject(forwardRef(() => UsersService)) private usersService: UsersService,
    private opsService: OpsService,
  ) {}

  async deleteUser(userId: string): Promise<boolean> {
    const res = await this.userModel.deleteOne({ _id: userId }).exec();
    return res.deletedCount > 0;
  }

  async findOrCreateFromGoogle(profile: {
    id: string;
    emails: { value: string }[];
    displayName?: string;
  }): Promise<User> {
    const email = profile.emails?.[0]?.value;
    if (!email) throw new Error('No email from Google');

    let user = await this.userModel.findOne({ email }).exec();
    if (user) {
      if (!user.googleId) {
        user.googleId = profile.id;
        await user.save();
      }
      if ((user.keyDerivationVersion ?? 1) < 2) {
        await this.migrateUserKeyEncryption(user, profile.id, email);
      }
      return user;
    }

    const username = this.generateUsername(email, profile.displayName);
    const { stellarPublicKey, stellarSecretKey } = this.createStellarKeypair();
    const { spendingKey, viewKey } = this.createzkKeypair();

    const encryptionKey = this.deriveEncryptionKey(profile.id, email, 2);

    const stellarSecretKeyEncrypted = this.encrypt(stellarSecretKey, encryptionKey);

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
      keyDerivationVersion: 2,
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
          detail:
            'Authentication unlocks wallet generation, trustline setup, private-note actions, and the full dashboard.',
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
            detail:
              'A Google sign-in is required before the app can provision wallet secrets securely.',
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
        status: hasShieldedBalance
          ? 'complete'
          : hasXlm || hasUsdcTrustline
            ? 'attention'
            : 'blocked',
        detail: hasShieldedBalance
          ? `Shielded balances are active with ${privateBalances.xlm} XLM and ${privateBalances.usdc} USDC in private flow.`
          : 'A first deposit into the shielded pool will unlock private send, note splitting, and private swap readiness.',
        action: hasShieldedBalance ? 'Open private flows' : 'Make first deposit',
      },
      {
        id: 'ops',
        label: 'Operational readiness',
        status:
          laggingPools === 0 && ready.status === 'ready'
            ? 'complete'
            : laggingPools > 0
              ? 'attention'
              : 'blocked',
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
            detail:
              'Funding, trustline, and private-note prerequisites are all in place, so the app can move straight into transactions.',
          }
        : score >= 50
          ? {
              score,
              tone: 'attention' as const,
              headline: 'Your account is close, but a few setup steps still gate smooth execution.',
              detail:
                'You can explore the product now, but finishing wallet funding, trustline setup, or first deposit will reduce friction.',
            }
          : {
              score,
              tone: 'blocked' as const,
              headline:
                'Your account exists, but it still needs setup before private flows will feel reliable.',
              detail:
                'The wallet is provisioned, yet core prerequisites like XLM funding or a USDC trustline are still missing.',
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

  async getAccountWorkspace(userId: string): Promise<AccountWorkspaceView> {
    const [authWorkspace, walletWorkspace, historyWorkspace, ready, user] = await Promise.all([
      this.getAuthWorkspace(userId),
      this.usersService.getWalletWorkspace(userId),
      this.usersService.getHistoryWorkspace(userId),
      this.opsService.getReadiness(),
      this.findById(userId),
    ]);

    if (!user || !authWorkspace.user) {
      throw new Error('User not found');
    }

    const laggingPoolLabels = ready.lagging.map((pool) => pool.poolAddress ?? 'pool');
    const publicSignals = [
      Number(walletWorkspace.balances.public.xlm || 0) > 0
        ? `Visible XLM already covers fees at ${walletWorkspace.balances.public.xlm}.`
        : 'Visible XLM is still missing, so fees and setup actions remain fragile.',
      Number(walletWorkspace.balances.public.usdc || 0) > 0
        ? `Visible USDC balance is live at ${walletWorkspace.balances.public.usdc}.`
        : authWorkspace.wallet.public.hasUsdcTrustline
          ? 'USDC trustline appears ready, but stablecoin liquidity has not been funded yet.'
          : 'USDC is still blocked on trustline or funding readiness.',
    ];
    const privateSignals = [
      Number(walletWorkspace.balances.private.xlm || 0) > 0 ||
      Number(walletWorkspace.balances.private.usdc || 0) > 0
        ? `Private balances are seeded with ${walletWorkspace.balances.private.xlm} XLM and ${walletWorkspace.balances.private.usdc} USDC.`
        : 'No shielded balance exists yet, so private sends and exact-note planning remain gated.',
      walletWorkspace.pending.count > 0
        ? `${walletWorkspace.pending.count} withdrawals are still queued for public settlement.`
        : 'No pending withdrawals are waiting on public settlement.',
    ];

    const routeReadiness = [
      {
        id: 'wallet',
        label: 'Wallet workspace',
        href: '/wallet',
        readiness: authWorkspace.wallet.public.hasXlm ? ('ready' as const) : ('attention' as const),
        detail: authWorkspace.wallet.public.hasXlm
          ? 'Wallet controls are funded and ready for balance management.'
          : 'Open wallet first to fund XLM and stabilize setup.',
      },
      {
        id: 'funding',
        label: 'Funding desk',
        href: '/wallet/fund',
        readiness:
          authWorkspace.wallet.public.hasXlm && authWorkspace.wallet.public.hasUsdcTrustline
            ? ('ready' as const)
            : authWorkspace.wallet.public.hasXlm
              ? ('attention' as const)
              : ('blocked' as const),
        detail:
          authWorkspace.wallet.public.hasXlm && authWorkspace.wallet.public.hasUsdcTrustline
            ? 'Funding prerequisites are mostly complete, so the desk is now about optimization.'
            : 'Funding desk is the next stop for trustline, faucet, and private seeding work.',
      },
      {
        id: 'status',
        label: 'Status workspace',
        href: '/status',
        readiness: ready.status === 'ready' ? ('ready' as const) : ('attention' as const),
        detail:
          ready.status === 'ready'
            ? 'Operational surfaces are healthy and safe to monitor.'
            : 'Use status to inspect lagging pools and degraded readiness.',
      },
      {
        id: 'history',
        label: 'History desk',
        href: '/history',
        readiness: historyWorkspace.summary.total > 0 ? ('ready' as const) : ('attention' as const),
        detail:
          historyWorkspace.summary.total > 0
            ? 'History already has enough signal to investigate activity patterns.'
            : 'History will become more useful after your first funded or private actions.',
      },
      {
        id: 'swap',
        label: 'Swap market',
        href: '/swap',
        readiness:
          authWorkspace.wallet.public.hasXlm || authWorkspace.wallet.private.hasShieldedBalance
            ? ('attention' as const)
            : ('blocked' as const),
        detail:
          authWorkspace.wallet.public.hasXlm || authWorkspace.wallet.private.hasShieldedBalance
            ? 'You can inspect markets now, but deeper execution improves after funding and note prep.'
            : 'Swap routes are still blocked by missing wallet setup.',
      },
      {
        id: 'fiat',
        label: 'Fiat desk',
        href: '/fiat',
        readiness: authWorkspace.wallet.public.hasXlm
          ? ('attention' as const)
          : ('blocked' as const),
        detail: authWorkspace.wallet.public.hasXlm
          ? 'Fiat planning is reachable, but route quality improves with more visible liquidity.'
          : 'Fiat planning should wait until the public wallet is funded.',
      },
    ];

    return {
      session: {
        authenticated: true,
        provider: 'google',
        network: authWorkspace.network,
        readiness: authWorkspace.readiness,
        memberSince: (user as any).createdAt
          ? new Date((user as any).createdAt).toISOString()
          : undefined,
      },
      profile: {
        id: user._id.toString(),
        email: user.email,
        username: user.username,
        stellarPublicKey: user.stellarPublicKey,
        stellarKeyPreview: `${user.stellarPublicKey.slice(0, 6)}...${user.stellarPublicKey.slice(-6)}`,
        reputation: user.reputation ?? 0,
      },
      wallet: {
        public: authWorkspace.wallet.public,
        private: authWorkspace.wallet.private,
        pendingWithdrawals: walletWorkspace.pending.count,
        composition: {
          publicValueSignals: publicSignals,
          privateValueSignals: privateSignals,
        },
      },
      operations: {
        status: authWorkspace.ops.status,
        trackedPools: authWorkspace.ops.trackedPools,
        laggingPools: authWorkspace.ops.laggingPools,
        laggingPoolLabels,
        summary:
          authWorkspace.ops.status === 'ready'
            ? `${authWorkspace.ops.trackedPools} tracked pools are healthy with no lagging sync lanes.`
            : `${authWorkspace.ops.laggingPools} pool lanes are lagging, so private balance and audit freshness may be delayed.`,
      },
      activity: {
        total: historyWorkspace.summary.total,
        completed: historyWorkspace.summary.completed,
        pending: historyWorkspace.summary.pending,
        failed: historyWorkspace.summary.failed,
        privateFlows: historyWorkspace.summary.privateFlows,
        sponsored: historyWorkspace.summary.sponsored,
        velocity: historyWorkspace.velocity,
        latestTitles: historyWorkspace.latestEntries.slice(0, 5).map((entry: any) => entry.title),
      },
      safety: {
        checklist: authWorkspace.checklist,
        recoveryActions: [
          ...authWorkspace.nextActions,
          walletWorkspace.pending.count > 0
            ? 'Process queued withdrawals to bring pending private funds back into the visible wallet.'
            : 'Withdrawal queue is clear, so recovery effort can stay focused on new funding and trustline work.',
          ready.status !== 'ready'
            ? 'Open the status workspace before assuming new private activity has been fully indexed.'
            : 'Indexer and sponsorship readiness are healthy enough for normal product use.',
        ].slice(0, 5),
        keyMaterial: [
          {
            id: 'google',
            label: 'Google-linked session',
            status: user.googleId ? 'ready' : 'attention',
            detail: user.googleId
              ? 'The account is linked to a Google identity that can derive wallet decryption material.'
              : 'Google identity link is missing, which would break normal key recovery.',
          },
          {
            id: 'stellar',
            label: 'Stellar signing key',
            status: user.stellarSecretKeyEncrypted ? 'ready' : 'attention',
            detail: user.stellarSecretKeyEncrypted
              ? 'The Stellar signing key is stored in encrypted form and used only for authenticated wallet actions.'
              : 'Encrypted Stellar key material is missing.',
          },
          {
            id: 'zk',
            label: 'Shielded note keys',
            status: user.zkSpendingKeyEncrypted && user.zkViewKeyEncrypted ? 'ready' : 'attention',
            detail:
              user.zkSpendingKeyEncrypted && user.zkViewKeyEncrypted
                ? 'Spending and viewing keys are provisioned for private-flow note access.'
                : 'One or more private-flow keys are missing.',
          },
        ],
      },
      routes: routeReadiness,
      dangerZone: {
        deleteConfirmationLabel: user.username,
        deleteWarning: [
          'Deleting the account removes the mapped user record and ends the current session immediately.',
          'This action is intended for personal testnet cleanup and should only be used when you truly want to remove the account.',
          'Type your username exactly before the delete endpoint will execute.',
        ],
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

  private async migrateUserKeyEncryption(
    user: User,
    googleId: string,
    email: string,
  ): Promise<void> {
    const legacyKey = this.deriveEncryptionKey(googleId, email, 1);
    const upgradedKey = this.deriveEncryptionKey(googleId, email, 2);

    const stellarSecretKey = this.decrypt(user.stellarSecretKeyEncrypted, legacyKey);
    const zkSpendingKey = this.decrypt(user.zkSpendingKeyEncrypted, legacyKey);
    const zkViewKey = this.decrypt(user.zkViewKeyEncrypted, legacyKey);

    user.stellarSecretKeyEncrypted = this.encrypt(stellarSecretKey, upgradedKey);
    user.zkSpendingKeyEncrypted = this.encrypt(zkSpendingKey, upgradedKey);
    user.zkViewKeyEncrypted = this.encrypt(zkViewKey, upgradedKey);
    user.keyDerivationVersion = 2;
    await user.save();
  }

  private deriveEncryptionKey(googleId: string, email: string, version = 2): Uint8Array {
    const normalizedEmail = email.trim().toLowerCase();
    const input = version >= 2 ? `${googleId}:${normalizedEmail}` : `${googleId}:${email}`;

    if (version >= 2) {
      const serverSecret = process.env.KEY_ENCRYPTION_SECRET ?? process.env.SESSION_SECRET;
      if (!serverSecret) {
        throw new Error(
          'KEY_ENCRYPTION_SECRET or SESSION_SECRET is required for wallet encryption',
        );
      }
      const salt = `zkash-wallet-v2:${serverSecret}`;
      return new Uint8Array(
        crypto.scryptSync(input, salt, nacl.secretbox.keyLength, {
          N: 16384,
          r: 8,
          p: 1,
        }),
      );
    }

    const hash = nacl.hash(naclUtil.decodeUTF8(input));
    return hash.slice(0, nacl.secretbox.keyLength);
  }

  private encrypt(plaintext: string, key: Uint8Array): string {
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
    const encrypted = nacl.secretbox(naclUtil.decodeUTF8(plaintext), nonce, key);
    const combined = new Uint8Array(nonce.length + encrypted.length);
    combined.set(nonce);
    combined.set(encrypted, nonce.length); // FIXED: Add offset to not overwrite nonce
    return Buffer.from(combined).toString('base64');
  }

  decrypt(encryptedBase64: string, key: Uint8Array): string {
    const combined = Buffer.from(encryptedBase64, 'base64');
    const nonce = new Uint8Array(combined.slice(0, nacl.secretbox.nonceLength));
    const ciphertext = new Uint8Array(combined.slice(nacl.secretbox.nonceLength));

    const decrypted = nacl.secretbox.open(ciphertext, nonce, key);
    if (!decrypted) {
      throw new Error('Decryption failed');
    }
    return naclUtil.encodeUTF8(decrypted);
  }

  getDecryptionKeyForUser(user: User, googleId: string, email: string): Uint8Array {
    return this.deriveEncryptionKey(googleId, email, user.keyDerivationVersion ?? 1);
  }

  private getNetworkInfo() {
    const isMainnet = process.env.NETWORK === 'mainnet';
    return {
      mode: isMainnet ? ('mainnet' as const) : ('testnet' as const),
      label: isMainnet ? 'Stellar Mainnet' : 'Stellar Testnet',
    };
  }

  private mightHaveTrustline(balance: string) {
    return balance !== undefined && balance !== null;
  }
}
