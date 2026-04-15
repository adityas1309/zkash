'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CircleDollarSign,
  Droplet,
  ExternalLink,
  Flag,
  Globe,
  Layers3,
  RefreshCw,
  Shield,
  ShieldCheck,
  Sparkles,
  Wallet,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api';

type Asset = 'USDC' | 'XLM';
type FundingTarget = 'public_send' | 'private_flow' | 'swap_readiness' | 'fiat_sell';

interface FundingWorkspace {
  user: {
    username?: string;
    stellarPublicKey?: string;
    reputation?: number;
  };
  balances: {
    public: { usdc: string; xlm: string };
    private: { usdc: string; xlm: string };
  };
  pending: {
    count: number;
    byAsset: {
      usdc: string;
      xlm: string;
    };
  };
  readinessChecklist: Array<{
    id: string;
    label: string;
    status: 'complete' | 'attention' | 'blocked';
    detail: string;
  }>;
  fundingEvents: Array<{
    id: string;
    title: string;
    detail: string;
    state: 'success' | 'pending' | 'failed' | 'retryable' | 'queued';
    amountDisplay: string;
    date: string;
    txHash?: string;
    privateFlow?: boolean;
  }>;
  fundingSignals: {
    publicXlmReady: boolean;
    trustlineReady: boolean;
    privateSeeded: boolean;
    usdcFaucetUrl: string;
  };
  actionCards: Array<{
    id: string;
    title: string;
    action: 'request_xlm' | 'add_trustline' | 'deposit_private';
    tone: 'ready' | 'attention' | 'blocked';
    detail: string;
  }>;
  guidance: string[];
}

interface FundingPlan {
  asset: Asset;
  target: FundingTarget;
  readiness: {
    tone: 'ready' | 'attention' | 'blocked';
    headline: string;
    detail: string;
  };
  stages: Array<{
    id: string;
    label: string;
    status: 'ready' | 'attention' | 'blocked';
    detail: string;
  }>;
  nextActions: string[];
  actionCards: FundingWorkspace['actionCards'];
  recentFundingEvents: FundingWorkspace['fundingEvents'];
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

function toneVariant(value: string) {
  if (value === 'complete' || value === 'ready' || value === 'success') {
    return 'success' as const;
  }
  if (value === 'blocked' || value === 'failed') {
    return 'error' as const;
  }
  if (value === 'attention' || value === 'retryable') {
    return 'warning' as const;
  }
  return 'default' as const;
}

function targetLabel(target: FundingTarget) {
  if (target === 'public_send') {
    return 'Public send';
  }
  if (target === 'private_flow') {
    return 'Private flow';
  }
  if (target === 'swap_readiness') {
    return 'Swap readiness';
  }
  return 'Fiat sell';
}

export default function FundingDeskPage() {
  const [workspace, setWorkspace] = useState<FundingWorkspace | null>(null);
  const [plan, setPlan] = useState<FundingPlan | null>(null);
  const [asset, setAsset] = useState<Asset>('XLM');
  const [target, setTarget] = useState<FundingTarget>('public_send');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [faucetLoading, setFaucetLoading] = useState(false);
  const [trustlineLoading, setTrustlineLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  const fetchWorkspace = async (showSpinner = false) => {
    if (showSpinner) {
      setRefreshing(true);
    }

    try {
      const response = await fetch(`${API_URL}/faucet/workspace`, {
        credentials: 'include',
      });
      const data = await response.json().catch(() => null);
      setWorkspace(data);
      return data as FundingWorkspace | null;
    } catch (error) {
      console.error('[FundingDeskPage] Failed to load funding workspace', error);
      setWorkspace(null);
      return null;
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const fetchPlan = async (nextAsset: Asset, nextTarget: FundingTarget) => {
    setPlanning(true);
    try {
      const response = await fetch(`${API_URL}/faucet/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          asset: nextAsset,
          target: nextTarget,
        }),
      });
      const data = await response.json().catch(() => null);
      setPlan(data);
    } catch (error) {
      console.error('[FundingDeskPage] Failed to load funding plan', error);
      setPlan(null);
    } finally {
      setPlanning(false);
    }
  };

  useEffect(() => {
    fetchWorkspace();
  }, []);

  useEffect(() => {
    if (!workspace?.user?.stellarPublicKey) {
      return;
    }
    fetchPlan(asset, target);
  }, [workspace?.user?.stellarPublicKey, asset, target]);

  const visibleAssetBalance = useMemo(() => {
    if (!workspace) {
      return '0';
    }
    return asset === 'USDC' ? workspace.balances.public.usdc : workspace.balances.public.xlm;
  }, [asset, workspace]);

  const privateAssetBalance = useMemo(() => {
    if (!workspace) {
      return '0';
    }
    return asset === 'USDC' ? workspace.balances.private.usdc : workspace.balances.private.xlm;
  }, [asset, workspace]);

  const handleFriendbot = async () => {
    if (!workspace?.user?.stellarPublicKey) {
      return;
    }

    setFaucetLoading(true);
    setStatusMessage('');
    try {
      const response = await fetch(`${API_URL}/faucet/xlm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          address: workspace.user.stellarPublicKey,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.success) {
        setStatusMessage(`Friendbot funding submitted${data.txHash ? ` with transaction ${data.txHash}.` : '.'}`);
      } else {
        setStatusMessage(data.error || 'Friendbot funding failed.');
      }
      const nextWorkspace = await fetchWorkspace();
      if (nextWorkspace?.user?.stellarPublicKey) {
        await fetchPlan(asset, target);
      }
    } finally {
      setFaucetLoading(false);
    }
  };

  const handleTrustline = async () => {
    setTrustlineLoading(true);
    setStatusMessage('');
    try {
      const response = await fetch(`${API_URL}/users/trustline`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.success) {
        setStatusMessage(`Trustline submitted${data.hash ? ` with transaction ${data.hash}.` : '.'}`);
      } else {
        setStatusMessage(data.message || data.error || 'Trustline setup failed.');
      }
      const nextWorkspace = await fetchWorkspace();
      if (nextWorkspace?.user?.stellarPublicKey) {
        await fetchPlan(asset, target);
      }
    } finally {
      setTrustlineLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  if (!workspace?.user) {
    return (
      <div className="p-8 text-white">
        <p>
          Not logged in.{' '}
          <Link href="/" className="text-indigo-400">
            Go home
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8 text-white">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Funding Desk</p>
          <h1 className="mt-2 bg-gradient-to-r from-white to-slate-400 bg-clip-text text-3xl font-bold text-transparent">
            Stage wallet setup before you enter real flows
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            This desk plans funding, trustline readiness, and private-balance seeding so users know whether the next
            move is Friendbot, trustline setup, or a first shielded deposit.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={workspace.fundingSignals.publicXlmReady ? 'success' : 'warning'}>
            <Droplet className="mr-1 h-3.5 w-3.5" />
            {workspace.fundingSignals.publicXlmReady ? 'XLM ready' : 'Needs XLM'}
          </Badge>
          <Badge variant={workspace.fundingSignals.privateSeeded ? 'success' : 'warning'}>
            <Shield className="mr-1 h-3.5 w-3.5" />
            {workspace.fundingSignals.privateSeeded ? 'Private seeded' : 'Private empty'}
          </Badge>
          <Button variant="ghost" onClick={() => fetchWorkspace(true)}>
            <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-4">
        <Card variant="glass">
          <p className="text-xs uppercase tracking-wide text-slate-500">Visible {asset}</p>
          <p className="mt-2 text-3xl font-semibold text-white">{visibleAssetBalance}</p>
          <p className="mt-2 text-sm leading-6 text-slate-400">Current public balance available for setup and direct usage.</p>
        </Card>
        <Card variant="glass">
          <p className="text-xs uppercase tracking-wide text-slate-500">Private {asset}</p>
          <p className="mt-2 text-3xl font-semibold text-white">{privateAssetBalance}</p>
          <p className="mt-2 text-sm leading-6 text-slate-400">Shielded balance readiness for the selected route.</p>
        </Card>
        <Card variant="glass">
          <p className="text-xs uppercase tracking-wide text-slate-500">Pending queue</p>
          <p className="mt-2 text-3xl font-semibold text-white">{workspace.pending.count}</p>
          <p className="mt-2 text-sm leading-6 text-slate-400">Queued withdrawals still waiting to re-surface publicly.</p>
        </Card>
        <Card variant="glass">
          <p className="text-xs uppercase tracking-wide text-slate-500">Planned target</p>
          <p className="mt-2 text-3xl font-semibold text-white">{targetLabel(target)}</p>
          <p className="mt-2 text-sm leading-6 text-slate-400">Funding guidance is tuned to the route you want to unlock next.</p>
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-[0.92fr_1.08fr]">
        <Card variant="neon">
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-400">Asset focus</label>
                <select
                  value={asset}
                  onChange={(event) => setAsset(event.target.value as Asset)}
                  className="h-12 w-full rounded-xl border border-slate-700 bg-slate-900/50 px-3 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="XLM">XLM</option>
                  <option value="USDC">USDC</option>
                </select>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-400">Target route</label>
                <select
                  value={target}
                  onChange={(event) => setTarget(event.target.value as FundingTarget)}
                  className="h-12 w-full rounded-xl border border-slate-700 bg-slate-900/50 px-3 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="public_send">Public send</option>
                  <option value="private_flow">Private flow</option>
                  <option value="swap_readiness">Swap readiness</option>
                  <option value="fiat_sell">Fiat sell</option>
                </select>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              {workspace.actionCards.map((card) => (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => {
                    if (card.action === 'request_xlm') {
                      handleFriendbot();
                    } else if (card.action === 'add_trustline') {
                      handleTrustline();
                    } else {
                      window.location.href = '/wallet';
                    }
                  }}
                  disabled={
                    card.tone === 'blocked' ||
                    (card.action === 'request_xlm' && faucetLoading) ||
                    (card.action === 'add_trustline' && trustlineLoading)
                  }
                  className="rounded-2xl border border-slate-700 bg-slate-950/70 p-4 text-left transition hover:border-indigo-500/30 hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-white">{card.title}</p>
                    <Badge variant={toneVariant(card.tone)}>{card.tone}</Badge>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-400">{card.detail}</p>
                </button>
              ))}
            </div>

            {statusMessage && (
              <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/10 p-4 text-sm text-indigo-100">
                {statusMessage}
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-3">
              <Button onClick={handleFriendbot} isLoading={faucetLoading} disabled={!workspace.user.stellarPublicKey}>
                <Droplet className="mr-2 h-4 w-4" />
                Request XLM
              </Button>
              <Button onClick={handleTrustline} variant="secondary" isLoading={trustlineLoading}>
                <ShieldCheck className="mr-2 h-4 w-4" />
                Add trustline
              </Button>
              <a
                href={workspace.fundingSignals.usdcFaucetUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-700 bg-slate-950/70 px-4 text-sm font-medium text-slate-100 transition hover:border-blue-500/40 hover:bg-blue-500/10"
              >
                <CircleDollarSign className="mr-2 h-4 w-4" />
                Open Circle faucet
                <ExternalLink className="ml-2 h-4 w-4" />
              </a>
            </div>
          </div>
        </Card>

        <Card variant="glass">
          <div className="mb-4 flex items-center gap-2">
            <Flag className="h-5 w-5 text-amber-300" />
            <h2 className="text-xl font-semibold text-white">Readiness planner</h2>
            {planning && (
              <Badge variant="default">
                <RefreshCw className="mr-1 h-3.5 w-3.5 animate-spin" />
                Updating
              </Badge>
            )}
          </div>

          {plan ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={toneVariant(plan.readiness.tone)}>{plan.readiness.tone}</Badge>
                  <Badge variant="default">{targetLabel(plan.target)}</Badge>
                  <Badge variant="default">{plan.asset}</Badge>
                </div>
                <h3 className="mt-3 text-lg font-semibold text-white">{plan.readiness.headline}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-400">{plan.readiness.detail}</p>
              </div>

              <div className="space-y-3">
                {plan.stages.map((stage) => (
                  <div key={stage.id} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-white">{stage.label}</p>
                          <Badge variant={toneVariant(stage.status)}>{stage.status}</Badge>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-slate-400">{stage.detail}</p>
                      </div>
                      {stage.status === 'ready' ? (
                        <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-300" />
                      ) : stage.status === 'blocked' ? (
                        <AlertTriangle className="h-5 w-5 shrink-0 text-rose-300" />
                      ) : (
                        <Layers3 className="h-5 w-5 shrink-0 text-amber-300" />
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Next actions</p>
                  <div className="mt-3 space-y-3">
                    {plan.nextActions.map((item) => (
                      <div key={item} className="flex items-start gap-3">
                        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-indigo-300" />
                        <p className="text-sm leading-6 text-slate-300">{item}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Funding signals</p>
                  <div className="mt-3 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm text-slate-300">Public XLM ready</span>
                      <Badge variant={workspace.fundingSignals.publicXlmReady ? 'success' : 'warning'}>
                        {workspace.fundingSignals.publicXlmReady ? 'Yes' : 'No'}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm text-slate-300">Trustline preparation</span>
                      <Badge variant={workspace.fundingSignals.trustlineReady ? 'success' : 'warning'}>
                        {workspace.fundingSignals.trustlineReady ? 'Ready' : 'Waiting'}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm text-slate-300">Private balance seeded</span>
                      <Badge variant={workspace.fundingSignals.privateSeeded ? 'success' : 'warning'}>
                        {workspace.fundingSignals.privateSeeded ? 'Ready' : 'Pending'}
                      </Badge>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-500">
              Planning guidance will appear here once the workspace is loaded.
            </div>
          )}
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <Card variant="glass">
          <div className="mb-4 flex items-center gap-2">
            <Wallet className="h-5 w-5 text-indigo-300" />
            <h2 className="text-xl font-semibold text-white">Setup checklist</h2>
          </div>
          <div className="space-y-3">
            {workspace.readinessChecklist.map((entry) => (
              <div key={entry.id} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-white">{entry.label}</p>
                      <Badge variant={toneVariant(entry.status)}>{entry.status}</Badge>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-400">{entry.detail}</p>
                  </div>
                  {entry.status === 'complete' ? (
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-300" />
                  ) : entry.status === 'blocked' ? (
                    <AlertTriangle className="h-5 w-5 shrink-0 text-rose-300" />
                  ) : (
                    <Flag className="h-5 w-5 shrink-0 text-amber-300" />
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card variant="glass">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Globe className="h-5 w-5 text-cyan-300" />
              <h2 className="text-xl font-semibold text-white">Recent funding trail</h2>
            </div>
            <Badge variant="default">{workspace.fundingEvents.length} events</Badge>
          </div>
          <div className="space-y-3">
            {workspace.fundingEvents.length === 0 ? (
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-500">
                No recent funding activity yet.
              </div>
            ) : (
              workspace.fundingEvents.map((event) => (
                <div key={event.id} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={toneVariant(event.state)}>{event.state}</Badge>
                        <Badge variant={event.privateFlow ? 'success' : 'default'}>
                          {event.privateFlow ? 'Private touch' : 'Public touch'}
                        </Badge>
                      </div>
                      <p className="mt-3 text-base font-semibold text-white">{event.title}</p>
                      <p className="mt-2 text-sm leading-6 text-slate-400">{event.detail}</p>
                      <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500">
                        <span>{event.amountDisplay}</span>
                        <span>{formatTimestamp(event.date)}</span>
                      </div>
                    </div>
                    {event.txHash ? (
                      <a
                        href={`https://stellar.expert/explorer/testnet/tx/${event.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center rounded-xl border border-indigo-500/20 bg-indigo-500/10 px-4 py-2 text-sm text-indigo-200 transition-colors hover:bg-indigo-500/20"
                      >
                        View tx
                        <ExternalLink className="ml-2 h-4 w-4" />
                      </a>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-[0.96fr_1.04fr]">
        <Card variant="glass">
          <div className="mb-4 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-indigo-300" />
            <h2 className="text-xl font-semibold text-white">Funding guidance</h2>
          </div>
          <div className="space-y-3">
            {workspace.guidance.map((entry) => (
              <div key={entry} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm leading-6 text-slate-300">
                {entry}
              </div>
            ))}
          </div>
        </Card>

        <Card variant="glass">
          <div className="mb-4 flex items-center gap-2">
            <Shield className="h-5 w-5 text-indigo-300" />
            <h2 className="text-xl font-semibold text-white">Route intent shortcuts</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {(['public_send', 'private_flow', 'swap_readiness', 'fiat_sell'] as FundingTarget[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setTarget(option)}
                className={`rounded-2xl border p-4 text-left transition ${
                  target === option
                    ? 'border-indigo-500/40 bg-indigo-500/10'
                    : 'border-slate-800 bg-slate-950/70 hover:border-indigo-500/20 hover:bg-slate-900'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-white">{targetLabel(option)}</p>
                  <Badge variant={target === option ? 'success' : 'default'}>{target === option ? 'Active' : 'Preview'}</Badge>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  {option === 'public_send' && 'Prioritize visible wallet funding and direct payment readiness.'}
                  {option === 'private_flow' && 'Seed shielded balances so private transfers stop feeling blocked.'}
                  {option === 'swap_readiness' && 'Balance visible liquidity with exact-note and deposit preparation.'}
                  {option === 'fiat_sell' && 'Prepare the asset mix that can actually reach a sell route cleanly.'}
                </p>
              </button>
            ))}
          </div>
        </Card>
      </section>

      <div className="flex flex-wrap items-center gap-4">
        <Link href="/wallet">
          <Button variant="ghost" size="sm" className="pl-0 text-slate-500 hover:text-slate-300">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Wallet
          </Button>
        </Link>
        <Link href="/wallet/send">
          <Button variant="ghost" size="sm" className="pl-0 text-slate-500 hover:text-slate-300">
            <Wallet className="mr-2 h-4 w-4" />
            Open send planner
          </Button>
        </Link>
      </div>
    </div>
  );
}
