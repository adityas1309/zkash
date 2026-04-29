'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { usePrivacy } from '@/context/PrivacyContext';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Globe,
  Layers3,
  RefreshCw,
  Shield,
  ShieldAlert,
  Sparkles,
  Wallet,
  XCircle,
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api';

interface SwapWorkspace {
  swap: {
    _id: string;
    aliceId: {
      _id: string;
      username?: string;
      stellarPublicKey?: string;
    };
    bobId: {
      _id: string;
      username?: string;
      stellarPublicKey?: string;
    };
    offerId?: string;
    amountIn: number;
    amountOut: number;
    status: string;
    proofStatus: string;
    executionStatus: string;
    txHash?: string;
    createdAt?: string;
    acceptedAt?: string;
    proofsReadyAt?: string;
    completedAt?: string;
    failedAt?: string;
    lastError?: string;
    participantRole: 'alice' | 'bob' | null;
    proofReady: boolean;
    myProofSubmitted: boolean;
    counterpartyProofSubmitted: boolean;
    lastActorRole?: 'alice' | 'bob';
  };
  participantRole: 'alice' | 'bob';
  counterparty: {
    username?: string;
    stellarPublicKey?: string;
  };
  proofs: {
    status: string;
    hasAliceProof: boolean;
    hasBobProof: boolean;
    ready: boolean;
  };
  execution: {
    status: string;
    txHash?: string;
    lastError?: string;
  };
  audits: Array<{
    id: string;
    operation: string;
    state: string;
    txHash?: string;
    indexingStatus?: string;
    indexingDetail?: string;
    error?: string;
    metadata?: Record<string, unknown>;
    createdAt?: string;
    updatedAt?: string;
  }>;
  routeSummary: {
    recommendedMode: 'public' | 'private';
    public: string;
    private: string;
  };
  proofRequirement: {
    asset: 'USDC' | 'XLM';
    amount: number;
    publicBalance: number;
    privateBalance: number;
    hasPublicFunding: boolean;
    hasPrivateFunding: boolean;
    exactProofLikely: boolean;
  };
  offerHealth: null | {
    active: boolean;
    rate: number;
    min: number;
    max: number;
    merchant: {
      username?: string;
      reputation: number;
    };
  };
  actionBoard: Array<{
    id: string;
    severity: 'critical' | 'warning' | 'info';
    title: string;
    detail: string;
    cta: string;
    href?: string;
    action: 'accept' | 'prepare_proof' | 'deposit' | 'execute_public' | 'execute_private' | 'wait';
  }>;
  journey: Array<{
    id: string;
    label: string;
    status: 'active' | 'done' | 'pending' | 'blocked';
    detail: string;
  }>;
  viewerWallet: {
    public: {
      xlm: string;
      usdc: string;
    };
    private: {
      xlm: string;
      usdc: string;
    };
  };
  recentRelatedSwaps: Array<{
    id: string;
    status: string;
    proofStatus: string;
    executionStatus: string;
    amountIn: number;
    amountOut: number;
    participantRole: string;
    createdAt?: string;
    txHash?: string;
  }>;
  timestamps: {
    createdAt?: string;
    acceptedAt?: string;
    proofsReadyAt?: string;
    completedAt?: string;
    failedAt?: string;
  };
  updatedAt: string;
}

function formatTimestamp(value?: string) {
  if (!value) {
    return 'Unknown time';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown time';
  }
  return date.toLocaleString();
}

function variantFor(value: string) {
  if (value === 'critical' || value === 'failed' || value === 'blocked') {
    return 'error' as const;
  }
  if (value === 'warning' || value === 'pending' || value === 'active') {
    return 'warning' as const;
  }
  if (value === 'done' || value === 'healthy' || value === 'success' || value === 'ready') {
    return 'success' as const;
  }
  return 'default' as const;
}

export default function SwapWorkspacePage() {
  const params = useParams();
  const { isPrivate } = usePrivacy();
  const swapId = params.id as string;

  const [workspace, setWorkspace] = useState<SwapWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('');

  const fetchWorkspace = async (showRefresh = false) => {
    if (showRefresh) {
      setRefreshing(true);
    }
    try {
      const response = await fetch(`${API_URL}/swap/${swapId}/workspace`, {
        credentials: 'include',
      });
      const data = await response.json().catch(() => null);
      setWorkspace(response.ok && data?.swap ? data : null);
    } catch (error) {
      console.error('[SwapWorkspacePage] Failed to load swap workspace', error);
      setWorkspace(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchWorkspace();
  }, [swapId]);

  const runSwapAction = async (action: SwapWorkspace['actionBoard'][number]['action']) => {
    if (!workspace) {
      return;
    }

    setActionLoading(action);
    setStatusMessage('');

    try {
      if (action === 'deposit') {
        const payload = {
          asset: workspace.proofRequirement.asset,
          amount: workspace.proofRequirement.amount,
        };
        const response = await fetch(`${API_URL}/users/deposit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.success === false) {
          throw new Error(data.error || 'Deposit failed');
        }
        setStatusMessage(data.message || 'Deposit submitted to prepare the private route.');
      } else if (action === 'accept') {
        const response = await fetch(`${API_URL}/swap/${swapId}/accept`, {
          method: 'POST',
          credentials: 'include',
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || 'Accept failed');
        }
        setStatusMessage('Swap request accepted.');
      } else if (action === 'prepare_proof') {
        const response = await fetch(`${API_URL}/swap/${swapId}/prepare-my-proof`, {
          method: 'POST',
          credentials: 'include',
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.success === false) {
          throw new Error(data.error || data.message || 'Proof preparation failed');
        }
        setStatusMessage(data.message || 'Proof prepared and stored.');
      } else if (action === 'execute_public') {
        const response = await fetch(`${API_URL}/swap/${swapId}/execute`, {
          method: 'POST',
          credentials: 'include',
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.success === false) {
          throw new Error(data.error || data.message || 'Public execution failed');
        }
        setStatusMessage(data.message || 'Public execution submitted.');
      } else if (action === 'execute_private') {
        const response = await fetch(`${API_URL}/swap/${swapId}/execute-private`, {
          method: 'POST',
          credentials: 'include',
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.success === false) {
          throw new Error(data.error || data.message || 'Private execution failed');
        }
        setStatusMessage(data.message || 'Private execution submitted.');
      } else {
        setStatusMessage('Status refreshed.');
      }

      await fetchWorkspace();
    } catch (error) {
      setStatusMessage((error as Error).message || 'Action failed');
    } finally {
      setActionLoading(null);
    }
  };

  const highlightedAction = useMemo(() => workspace?.actionBoard[0], [workspace]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  if (!workspace) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <Card variant="glass" className="text-center">
          <XCircle className="mx-auto mb-4 h-12 w-12 text-red-400" />
          <h1 className="text-2xl font-semibold text-white">Swap workspace unavailable</h1>
          <p className="mt-3 text-slate-400">
            The swap control tower could not be loaded for this route.
          </p>
          <div className="mt-6">
            <Link href="/swap">
              <Button variant="ghost">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Market
              </Button>
            </Link>
          </div>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl space-y-8 p-4 md:p-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Swap Control Tower</p>
          <h1 className="mt-2 bg-gradient-to-r from-white to-slate-400 bg-clip-text text-3xl font-bold text-transparent">
            Manage one swap from request to settlement
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            This workspace combines proof requirements, wallet readiness, route posture, audit flow,
            and the next highest-value action so the lifecycle stops feeling fragmented.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={variantFor(workspace.swap.status)}>{workspace.swap.status}</Badge>
          <Badge variant={isPrivate ? 'success' : 'warning'}>
            {isPrivate ? 'Private mode' : 'Public mode'}
          </Badge>
          <Button variant="ghost" onClick={() => fetchWorkspace(true)}>
            <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-4">
        <Card variant="glass">
          <p className="text-xs uppercase tracking-wide text-slate-500">Counterparty</p>
          <p className="mt-2 text-2xl font-semibold text-white">
            @{workspace.counterparty.username || 'Unknown'}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            {workspace.participantRole} side of the current swap.
          </p>
        </Card>
        <Card variant="glass">
          <p className="text-xs uppercase tracking-wide text-slate-500">Proof stage</p>
          <p className="mt-2 text-2xl font-semibold text-white">{workspace.proofs.status}</p>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            My proof {workspace.swap.myProofSubmitted ? 'submitted' : 'missing'}, counterparty{' '}
            {workspace.swap.counterpartyProofSubmitted ? 'submitted' : 'missing'}.
          </p>
        </Card>
        <Card variant="glass">
          <p className="text-xs uppercase tracking-wide text-slate-500">Execution</p>
          <p className="mt-2 text-2xl font-semibold text-white">{workspace.execution.status}</p>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Public and private settlement readiness live here.
          </p>
        </Card>
        <Card variant="glass">
          <p className="text-xs uppercase tracking-wide text-slate-500">Funding need</p>
          <p className="mt-2 text-2xl font-semibold text-white">
            {workspace.proofRequirement.amount} {workspace.proofRequirement.asset}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Amount your side needs to fund or prove cleanly.
          </p>
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Card variant="neon">
          <div className="mb-4 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-indigo-300" />
            <h2 className="text-xl font-semibold text-white">Primary action</h2>
          </div>

          {statusMessage && (
            <div className="mb-4 rounded-2xl border border-indigo-500/20 bg-indigo-500/10 p-4 text-sm text-indigo-100">
              {statusMessage}
            </div>
          )}

          {highlightedAction ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={variantFor(highlightedAction.severity)}>
                    {highlightedAction.severity}
                  </Badge>
                  <Badge variant="default">{highlightedAction.action}</Badge>
                </div>
                <h3 className="mt-3 text-lg font-semibold text-white">{highlightedAction.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-400">{highlightedAction.detail}</p>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                {workspace.actionBoard.slice(1).map((item) => (
                  <div
                    key={item.id}
                    className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={variantFor(item.severity)}>{item.severity}</Badge>
                      <Badge variant="default">{item.action}</Badge>
                    </div>
                    <p className="mt-3 text-sm font-semibold text-white">{item.title}</p>
                    <p className="mt-2 text-sm leading-6 text-slate-400">{item.detail}</p>
                  </div>
                ))}
              </div>

              {highlightedAction.href ? (
                <Link
                  href={highlightedAction.href}
                  className="inline-flex items-center rounded-xl border border-indigo-500/20 bg-indigo-500/10 px-4 py-2 text-sm text-indigo-200 transition-colors hover:bg-indigo-500/20"
                >
                  {highlightedAction.cta}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              ) : (
                <Button
                  onClick={() => runSwapAction(highlightedAction.action)}
                  isLoading={actionLoading === highlightedAction.action}
                >
                  {highlightedAction.cta}
                </Button>
              )}
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-500">
              No active intervention is required right now.
            </div>
          )}
        </Card>

        <Card variant="glass">
          <div className="mb-4 flex items-center gap-2">
            <Shield className="h-5 w-5 text-emerald-300" />
            <h2 className="text-xl font-semibold text-white">Route posture</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <div className="flex items-center gap-2 text-white">
                <Globe className="h-4 w-4 text-sky-300" />
                <p className="font-semibold">Public route</p>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-400">
                {workspace.routeSummary.public}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <div className="flex items-center gap-2 text-white">
                <Shield className="h-4 w-4 text-emerald-300" />
                <p className="font-semibold">Private route</p>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-400">
                {workspace.routeSummary.private}
              </p>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant={
                  workspace.routeSummary.recommendedMode === 'private' ? 'success' : 'warning'
                }
              >
                Recommended {workspace.routeSummary.recommendedMode}
              </Badge>
              <Badge variant={workspace.proofs.ready ? 'success' : 'warning'}>
                {workspace.proofs.ready ? 'Proofs ready' : 'Proofs not ready'}
              </Badge>
            </div>
          </div>
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
        <Card variant="glass">
          <div className="mb-4 flex items-center gap-2">
            <Wallet className="h-5 w-5 text-indigo-300" />
            <h2 className="text-xl font-semibold text-white">Funding and proof readiness</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Public balance</p>
              <p className="mt-2 text-sm text-white">
                {workspace.proofRequirement.publicBalance} {workspace.proofRequirement.asset}
              </p>
              <Badge
                variant={workspace.proofRequirement.hasPublicFunding ? 'success' : 'warning'}
                className="mt-3"
              >
                {workspace.proofRequirement.hasPublicFunding
                  ? 'Can fund publicly'
                  : 'Needs more public balance'}
              </Badge>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Private balance</p>
              <p className="mt-2 text-sm text-white">
                {workspace.proofRequirement.privateBalance} {workspace.proofRequirement.asset}
              </p>
              <Badge
                variant={workspace.proofRequirement.hasPrivateFunding ? 'success' : 'warning'}
                className="mt-3"
              >
                {workspace.proofRequirement.hasPrivateFunding
                  ? 'Can fund privately'
                  : 'Needs private funding'}
              </Badge>
            </div>
          </div>
          <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
            <div className="flex items-start gap-3">
              {workspace.proofRequirement.exactProofLikely ? (
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
              ) : (
                <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-yellow-300" />
              )}
              <p className="text-sm leading-6 text-slate-300">
                {workspace.proofRequirement.exactProofLikely
                  ? 'Your private balance looks strong enough to attempt proof preparation, although exact note shape may still matter.'
                  : 'This route still looks fragile for proof preparation, so expect deposit or note-shaping work before private execution becomes smooth.'}
              </p>
            </div>
          </div>
        </Card>

        <Card variant="glass">
          <div className="mb-4 flex items-center gap-2">
            <Layers3 className="h-5 w-5 text-cyan-300" />
            <h2 className="text-xl font-semibold text-white">Journey map</h2>
          </div>
          <div className="space-y-3">
            {workspace.journey.map((step) => (
              <div
                key={step.id}
                className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-white">{step.label}</p>
                  <Badge variant={variantFor(step.status)}>{step.status}</Badge>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-400">{step.detail}</p>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.02fr_0.98fr]">
        <Card variant="glass">
          <div className="mb-4 flex items-center gap-2">
            <Clock3 className="h-5 w-5 text-yellow-300" />
            <h2 className="text-xl font-semibold text-white">Audit trail</h2>
          </div>
          <div className="space-y-3">
            {workspace.audits.length === 0 ? (
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-500">
                No audit events recorded yet.
              </div>
            ) : (
              workspace.audits.map((audit) => (
                <div
                  key={audit.id}
                  className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-white">
                      {audit.operation.replaceAll('_', ' ')}
                    </p>
                    <Badge variant={variantFor(audit.state)}>{audit.state}</Badge>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">{formatTimestamp(audit.createdAt)}</p>
                  {audit.indexingDetail && (
                    <p className="mt-2 text-sm leading-6 text-slate-400">{audit.indexingDetail}</p>
                  )}
                  {audit.error && <p className="mt-2 text-sm text-red-300">{audit.error}</p>}
                  {audit.txHash && (
                    <a
                      href={`https://stellar.expert/explorer/testnet/tx/${audit.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 inline-flex items-center text-xs text-indigo-300 hover:text-indigo-200"
                    >
                      View tx
                      <ExternalLink className="ml-1 h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              ))
            )}
          </div>
        </Card>

        <div className="space-y-6">
          <Card variant="glass">
            <div className="mb-4 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-300" />
              <h2 className="text-xl font-semibold text-white">Offer posture</h2>
            </div>
            {workspace.offerHealth ? (
              <div className="space-y-3">
                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-white">
                      @{workspace.offerHealth.merchant.username || 'Unknown'}
                    </p>
                    <Badge variant={workspace.offerHealth.active ? 'success' : 'warning'}>
                      {workspace.offerHealth.active ? 'Offer live' : 'Offer paused'}
                    </Badge>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    Rate {workspace.offerHealth.rate} with a ticket band of{' '}
                    {workspace.offerHealth.min} to {workspace.offerHealth.max}.
                  </p>
                  <p className="mt-2 text-sm text-slate-300">
                    Seller reputation: {workspace.offerHealth.merchant.reputation}
                  </p>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-500">
                Offer posture is not available for this swap record.
              </div>
            )}
          </Card>

          <Card variant="glass">
            <div className="mb-4 flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-indigo-300" />
              <h2 className="text-xl font-semibold text-white">Recent related swaps</h2>
            </div>
            <div className="space-y-3">
              {workspace.recentRelatedSwaps.length === 0 ? (
                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-500">
                  No nearby swap history for this user yet.
                </div>
              ) : (
                workspace.recentRelatedSwaps.map((swap) => (
                  <div
                    key={swap.id}
                    className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-white">
                        {swap.amountIn} XLM / {swap.amountOut} USDC
                      </p>
                      <Badge variant={variantFor(swap.status)}>{swap.status}</Badge>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">{formatTimestamp(swap.createdAt)}</p>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-4">
        <Link href="/swap/my">
          <Button variant="ghost">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Seller desk
          </Button>
        </Link>
        <Link href="/actions">
          <Button variant="ghost">
            <Sparkles className="mr-2 h-4 w-4" />
            Action Center
          </Button>
        </Link>
        <div className="text-sm text-slate-500">
          Last refresh: {formatTimestamp(workspace.updatedAt)}
        </div>
      </div>
    </main>
  );
}
