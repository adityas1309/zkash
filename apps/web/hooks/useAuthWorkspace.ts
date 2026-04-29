'use client';

import { useEffect, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api';

export interface AuthWorkspace {
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
    createdAt?: string;
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
  checklist: Array<{
    id: string;
    label: string;
    status: 'complete' | 'attention' | 'blocked';
    detail: string;
    action: string;
  }>;
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

const guestFallback: AuthWorkspace = {
  session: {
    authenticated: false,
    hasUser: false,
  },
  user: null,
  network: {
    mode: 'testnet',
    label: 'Stellar Testnet',
  },
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
  checklist: [],
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

export function useAuthWorkspace() {
  const [workspace, setWorkspace] = useState<AuthWorkspace>(guestFallback);
  const [loading, setLoading] = useState(true);

  const fetchWorkspace = async () => {
    try {
      const res = await fetch(`${API_URL}/auth/workspace`, {
        credentials: 'include',
      });
      if (!res.ok) {
        setWorkspace(guestFallback);
        return;
      }
      const data = await res.json();
      setWorkspace(data);
    } catch (error) {
      console.error('[useAuthWorkspace] Failed to fetch workspace', error);
      setWorkspace(guestFallback);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWorkspace();
  }, []);

  return {
    workspace,
    loading,
    refresh: fetchWorkspace,
  };
}
