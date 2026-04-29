'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Clock3,
  ExternalLink,
  Eye,
  Gauge,
  GitBranch,
  Layers3,
  RefreshCw,
  Shield,
  Sparkles,
  TimerReset,
  TrendingUp,
  Wallet,
  Waves,
  Wrench,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api';

type Tone = 'ready' | 'attention' | 'blocked' | 'info' | 'critical' | 'warning';

interface SettlementWorkspace {
  user: {
    username?: string;
    stellarPublicKey?: string;
    reputation?: number;
  };
  summary: {
    queuedWithdrawals: number;
    retryable: number;
    laggingPrivate: number;
    sponsoredSettlementTouches: number;
    readyLanes: number;
    trackedTimeline: number;
  };
  laneCards: Array<{
    id: string;
    label: string;
    tone: Tone;
    count: number;
    total: string;
    detail: string;
    nextStep: string;
  }>;
  transitionBoard: Array<{
    id: string;
    label: string;
    tone: Tone;
    summary: string;
    nextStep: string;
  }>;
  sponsorshipBoard: Array<{
    id: string;
    asset: string;
    operation: string;
    supported: boolean;
    sponsored: boolean;
    tone: Tone;
    reason: string;
    label: string;
  }>;
  riskBoard: Array<{
    id: string;
    label: string;
    tone: Tone;
    detail: string;
  }>;
  recommendedActions: Array<{
    id: string;
    severity: 'critical' | 'warning' | 'info';
    title: string;
    detail: string;
    href: string;
  }>;
  queueCards: Array<{
    id: string;
    asset: string;
    amount: string;
    status: string;
    tone: Tone;
    txHash?: string;
    createdAt?: string;
    summary: string;
    notes: string[];
    destination: string;
    assetTone: Tone;
  }>;
  assetWindows: Array<{
    asset: string;
    publicBalance: string;
    privateBalance: string;
    queuedAmount: string;
    tone: Tone;
    detail: string;
  }>;
  settlementTimeline: Array<{
    id: string;
    title: string;
    detail: string;
    state: string;
    asset?: string;
    amountDisplay: string;
    txHash?: string;
    privateFlow: boolean;
    indexing?: {
      status?: string;
      detail?: string;
    };
    sponsorship?: {
      attempted: boolean;
      sponsored: boolean;
      detail?: string;
    };
    date?: string;
    statusLabel: string;
  }>;
  outlook: string[];
  updatedAt: string;
}

function variantFor(value: string) {
  if (value === 'critical' || value === 'blocked' || value === 'failed') {
    return 'error' as const;
  }
  if (
    value === 'warning' ||
    value === 'attention' ||
    value === 'retryable' ||
    value === 'pending'
  ) {
    return 'warning' as const;
  }
  if (value === 'ready' || value === 'success') {
    return 'success' as const;
  }
  return 'default' as const;
}

function tonePanelClass(value: string) {
  if (value === 'ready') {
    return 'border-emerald-500/30 bg-emerald-500/10';
  }
  if (value === 'attention' || value === 'warning') {
    return 'border-amber-500/30 bg-amber-500/10';
  }
  if (value === 'blocked' || value === 'critical') {
    return 'border-rose-500/30 bg-rose-500/10';
  }
  return 'border-slate-800 bg-slate-950/70';
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

function laneIcon(id: string) {
  if (id === 'visible_settlement') {
    return <Wallet className="h-5 w-5 text-cyan-300" />;
  }
  if (id === 'private_settlement') {
    return <Shield className="h-5 w-5 text-emerald-300" />;
  }
  if (id === 'queue_lane') {
    return <TimerReset className="h-5 w-5 text-amber-300" />;
  }
  return <Gauge className="h-5 w-5 text-indigo-300" />;
}

function flowIcon(privateFlow: boolean) {
  return privateFlow ? (
    <Shield className="h-4 w-4 text-emerald-300" />
  ) : (
    <Wallet className="h-4 w-4 text-cyan-300" />
  );
}

export default function SettlementPage() {
  const [workspace, setWorkspace] = useState<SettlementWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchWorkspace = async (showRefresh = false) => {
    if (showRefresh) {
      setRefreshing(true);
    }

    try {
      const response = await fetch(`${API_URL}/users/settlement/workspace`, {
        credentials: 'include',
      });
      const data = await response.json().catch(() => null);
      setWorkspace(response.ok ? data : null);
    } catch (error) {
      console.error('[SettlementPage] Failed to load settlement workspace', error);
      setWorkspace(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchWorkspace();
  }, []);

  const headline = useMemo(() => {
    if (!workspace) {
      return {
        label: 'Unavailable',
        detail: 'The settlement workspace could not be loaded.',
      };
    }
    if (workspace.summary.queuedWithdrawals > 0) {
      return {
        label: 'Settlement backlog is active',
        detail:
          'Private value is still moving toward the visible wallet, so balance clarity depends on queue progress and confirmation.',
      };
    }
    if (workspace.summary.retryable > 0 || workspace.summary.laggingPrivate > 0) {
      return {
        label: 'Settlement needs attention',
        detail: 'Retry pressure or indexer lag is still shaping what should be treated as final.',
      };
    }
    return {
      label: 'Settlement is calm',
      detail:
        'No major queue or freshness pressure is distorting how public and private balances should be interpreted.',
    };
  }, [workspace]);

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
          <AlertTriangle className="mx-auto mb-4 h-12 w-12 text-red-400" />
          <h1 className="text-2xl font-semibold text-white">Settlement workspace unavailable</h1>
          <p className="mt-3 text-slate-400">
            The settlement desk could not be loaded from the backend right now.
          </p>
          <div className="mt-6">
            <Link href="/dashboard">
              <Button>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Return to dashboard
              </Button>
            </Link>
          </div>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl space-y-8 p-4 md:p-8">
      <section className="relative overflow-hidden rounded-[32px] border border-white/10 bg-slate-950/80 px-6 py-8 shadow-2xl shadow-indigo-500/10 md:px-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.18),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(34,197,94,0.14),transparent_34%)]" />
        <div className="relative flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-4xl">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant={
                  workspace.summary.queuedWithdrawals > 0
                    ? 'warning'
                    : workspace.summary.retryable > 0
                      ? 'warning'
                      : 'success'
                }
              >
                {headline.label}
              </Badge>
              <Badge variant="default">
                {workspace.summary.queuedWithdrawals} queued withdrawals
              </Badge>
              <Badge variant="default">
                {workspace.summary.laggingPrivate} lagging private items
              </Badge>
              <Badge variant="default">Updated {formatTimestamp(workspace.updatedAt)}</Badge>
            </div>
            <p className="mt-4 text-xs uppercase tracking-[0.32em] text-slate-500">
              Settlement Workspace
            </p>
            <h1 className="mt-3 bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-3xl font-bold text-transparent md:text-5xl">
              See what has settled, what is still in flight, and what will become visible next
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300 md:text-base">
              This desk exists for the moments when a balance looks stale, a private withdrawal is
              queued, or a proof has been submitted but the user still cannot tell whether value is
              visible, pending, or safe to retry.
            </p>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-400">{headline.detail}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 xl:w-[34rem]">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
              <p className="text-xs uppercase tracking-wide text-slate-500">Ready lanes</p>
              <p className="mt-2 text-3xl font-semibold text-white">
                {workspace.summary.readyLanes}
              </p>
              <p className="mt-2 text-sm text-slate-400">
                Settlement lanes currently calm enough for normal use.
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
              <p className="text-xs uppercase tracking-wide text-slate-500">Retry pressure</p>
              <p className="mt-2 text-3xl font-semibold text-white">
                {workspace.summary.retryable}
              </p>
              <p className="mt-2 text-sm text-slate-400">
                Failed or retryable items still asking for user attention.
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
              <p className="text-xs uppercase tracking-wide text-slate-500">Timeline size</p>
              <p className="mt-2 text-3xl font-semibold text-white">
                {workspace.summary.trackedTimeline}
              </p>
              <p className="mt-2 text-sm text-slate-400">
                Recent settlement-relevant history entries being tracked here.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card variant="glass">
          <div className="flex items-center gap-2 text-slate-200">
            <TimerReset className="h-4 w-4 text-amber-300" />
            <p className="text-xs uppercase tracking-wide text-slate-500">Queued value</p>
          </div>
          <p className="mt-3 text-3xl font-semibold text-white">
            {workspace.summary.queuedWithdrawals}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Private withdrawals that still separate note value from visible wallet confirmation.
          </p>
        </Card>
        <Card variant="glass">
          <div className="flex items-center gap-2 text-slate-200">
            <Shield className="h-4 w-4 text-emerald-300" />
            <p className="text-xs uppercase tracking-wide text-slate-500">Sponsored touches</p>
          </div>
          <p className="mt-3 text-3xl font-semibold text-white">
            {workspace.summary.sponsoredSettlementTouches}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Settlement-adjacent actions that already benefitted from sponsorship support.
          </p>
        </Card>
        <Card variant="glass">
          <div className="flex items-center gap-2 text-slate-200">
            <Clock3 className="h-4 w-4 text-cyan-300" />
            <p className="text-xs uppercase tracking-wide text-slate-500">Lagging private items</p>
          </div>
          <p className="mt-3 text-3xl font-semibold text-white">
            {workspace.summary.laggingPrivate}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Private-flow entries still waiting on indexer freshness or canonical visibility.
          </p>
        </Card>
        <Card variant="glass">
          <div className="flex items-center gap-2 text-slate-200">
            <Activity className="h-4 w-4 text-indigo-300" />
            <p className="text-xs uppercase tracking-wide text-slate-500">Timeline coverage</p>
          </div>
          <p className="mt-3 text-3xl font-semibold text-white">
            {workspace.summary.trackedTimeline}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Settlement-relevant actions currently being mapped across audit and queue sources.
          </p>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.04fr_0.96fr]">
        <Card variant="neon">
          <div className="mb-5 flex items-center gap-2">
            <Layers3 className="h-5 w-5 text-indigo-300" />
            <h2 className="text-xl font-semibold text-white">Settlement lanes</h2>
          </div>
          <div className="space-y-4">
            {workspace.laneCards.map((lane) => (
              <div key={lane.id} className={`rounded-2xl border p-4 ${tonePanelClass(lane.tone)}`}>
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex rounded-2xl border border-white/10 bg-slate-950/60 p-2">
                        {laneIcon(lane.id)}
                      </span>
                      <p className="text-lg font-semibold text-white">{lane.label}</p>
                      <Badge variant={variantFor(lane.tone)}>{lane.tone}</Badge>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-300">{lane.detail}</p>
                    <p className="mt-3 text-sm leading-6 text-slate-400">
                      <span className="font-semibold text-slate-200">Next step:</span>{' '}
                      {lane.nextStep}
                    </p>
                  </div>
                  <div className="grid gap-2 text-right">
                    <p className="text-2xl font-semibold text-white">{lane.count}</p>
                    <p className="text-sm text-slate-400">{lane.total}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card variant="glass">
          <div className="mb-5 flex items-center gap-2">
            <GitBranch className="h-5 w-5 text-cyan-300" />
            <h2 className="text-xl font-semibold text-white">Lane transitions</h2>
          </div>
          <div className="space-y-4">
            {workspace.transitionBoard.map((item) => (
              <div key={item.id} className={`rounded-2xl border p-4 ${tonePanelClass(item.tone)}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-white">{item.label}</p>
                  <Badge variant={variantFor(item.tone)}>{item.tone}</Badge>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-300">{item.summary}</p>
                <p className="mt-3 text-sm leading-6 text-slate-400">
                  <span className="font-semibold text-slate-200">Next step:</span> {item.nextStep}
                </p>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
        <Card variant="glass">
          <div className="mb-5 flex items-center gap-2">
            <Wrench className="h-5 w-5 text-amber-300" />
            <h2 className="text-xl font-semibold text-white">Recommended actions</h2>
          </div>
          <div className="space-y-3">
            {workspace.recommendedActions.length === 0 ? (
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm leading-6 text-emerald-200">
                No urgent settlement action is visible right now. The wallet looks settled enough
                for normal product use.
              </div>
            ) : (
              workspace.recommendedActions.map((item) => (
                <Link
                  key={item.id}
                  href={item.href}
                  className="block rounded-2xl border border-slate-800 bg-slate-950/70 p-4 transition hover:border-indigo-500/30 hover:bg-slate-900"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-white">{item.title}</p>
                        <Badge variant={variantFor(item.severity)}>{item.severity}</Badge>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-slate-400">{item.detail}</p>
                    </div>
                    <ArrowRight className="mt-1 h-4 w-4 text-slate-500" />
                  </div>
                </Link>
              ))
            )}
          </div>
        </Card>

        <Card variant="glass">
          <div className="mb-5 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-rose-300" />
            <h2 className="text-xl font-semibold text-white">Settlement risk board</h2>
          </div>
          <div className="space-y-4">
            {workspace.riskBoard.map((item) => (
              <div key={item.id} className={`rounded-2xl border p-4 ${tonePanelClass(item.tone)}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-white">{item.label}</p>
                  <Badge variant={variantFor(item.tone)}>{item.tone}</Badge>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-300">{item.detail}</p>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.06fr_0.94fr]">
        <Card variant="neon">
          <div className="mb-5 flex items-center gap-2">
            <TimerReset className="h-5 w-5 text-indigo-300" />
            <h2 className="text-xl font-semibold text-white">Withdrawal queue</h2>
          </div>
          <div className="space-y-4">
            {workspace.queueCards.length === 0 ? (
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-5 text-sm leading-6 text-emerald-200">
                The withdrawal queue is empty. Private value is not currently waiting on visible
                settlement.
              </div>
            ) : (
              workspace.queueCards.map((item) => (
                <div
                  key={item.id}
                  className={`rounded-[26px] border p-5 ${tonePanelClass(item.tone)}`}
                >
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-lg font-semibold text-white">
                          {item.amount} {item.asset}
                        </p>
                        <Badge variant={variantFor(item.tone)}>{item.status}</Badge>
                        <Badge variant={variantFor(item.assetTone)}>{item.asset}</Badge>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-slate-300">{item.summary}</p>
                      <p className="mt-3 text-sm leading-6 text-slate-400">
                        Created {formatTimestamp(item.createdAt)}
                      </p>
                      {item.txHash && (
                        <p className="mt-2 break-all font-mono text-xs text-slate-500">
                          {item.txHash}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-3">
                      <Link href={item.destination}>
                        <Button variant="ghost">
                          Open related desk
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                      </Link>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3 md:grid-cols-3">
                    {item.notes.map((note) => (
                      <div
                        key={note}
                        className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3 text-sm leading-6 text-slate-300"
                      >
                        {note}
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card variant="glass">
          <div className="mb-5 flex items-center gap-2">
            <Waves className="h-5 w-5 text-cyan-300" />
            <h2 className="text-xl font-semibold text-white">Asset windows</h2>
          </div>
          <div className="space-y-4">
            {workspace.assetWindows.map((item) => (
              <div
                key={item.asset}
                className={`rounded-2xl border p-4 ${tonePanelClass(item.tone)}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-white">{item.asset}</p>
                  <Badge variant={variantFor(item.tone)}>{item.tone}</Badge>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Public</p>
                    <p className="mt-2 text-lg font-semibold text-white">{item.publicBalance}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Private</p>
                    <p className="mt-2 text-lg font-semibold text-white">{item.privateBalance}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Queued</p>
                    <p className="mt-2 text-lg font-semibold text-white">{item.queuedAmount}</p>
                  </div>
                </div>
                <p className="mt-4 text-sm leading-6 text-slate-300">{item.detail}</p>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.98fr_1.02fr]">
        <Card variant="glass">
          <div className="mb-5 flex items-center gap-2">
            <Shield className="h-5 w-5 text-emerald-300" />
            <h2 className="text-xl font-semibold text-white">Settlement sponsorship</h2>
          </div>
          <div className="space-y-3">
            {workspace.sponsorshipBoard.map((item) => (
              <div key={item.id} className={`rounded-2xl border p-4 ${tonePanelClass(item.tone)}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-white">{item.label}</p>
                  <Badge variant={variantFor(item.tone)}>{item.tone}</Badge>
                  {item.sponsored && <Badge variant="success">sponsored</Badge>}
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-300">{item.reason}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card variant="glass">
          <div className="mb-5 flex items-center gap-2">
            <Eye className="h-5 w-5 text-sky-300" />
            <h2 className="text-xl font-semibold text-white">Settlement outlook</h2>
          </div>
          <div className="space-y-3">
            {workspace.outlook.map((item) => (
              <div
                key={item}
                className="flex items-start gap-3 rounded-2xl border border-slate-800 bg-slate-950/70 p-4"
              >
                <Sparkles className="mt-1 h-4 w-4 shrink-0 text-sky-300" />
                <p className="text-sm leading-6 text-slate-300">{item}</p>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <section>
        <Card variant="neon">
          <div className="mb-5 flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-indigo-300" />
            <h2 className="text-xl font-semibold text-white">Settlement timeline</h2>
          </div>
          <div className="space-y-4">
            {workspace.settlementTimeline.length === 0 ? (
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5 text-sm leading-6 text-slate-400">
                No settlement-relevant timeline entries are available yet. Deposits, withdrawals, or
                private actions will populate this desk as soon as the wallet starts using those
                routes.
              </div>
            ) : (
              workspace.settlementTimeline.map((item) => (
                <div
                  key={item.id}
                  className="rounded-[26px] border border-slate-800 bg-slate-950/70 p-5"
                >
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex rounded-2xl border border-white/10 bg-slate-900/80 p-2">
                          {flowIcon(item.privateFlow)}
                        </span>
                        <p className="text-lg font-semibold text-white">{item.title}</p>
                        <Badge variant={variantFor(item.state)}>{item.statusLabel}</Badge>
                        {item.asset && <Badge variant="default">{item.asset}</Badge>}
                        {item.sponsorship?.sponsored && <Badge variant="success">sponsored</Badge>}
                      </div>
                      <p className="mt-3 text-sm leading-6 text-slate-300">{item.detail}</p>
                      <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-400">
                        <span>{item.amountDisplay}</span>
                        <span>{formatTimestamp(item.date)}</span>
                        {item.indexing?.status && <span>Indexing: {item.indexing.status}</span>}
                      </div>
                      {item.txHash && (
                        <p className="mt-2 break-all font-mono text-xs text-slate-500">
                          {item.txHash}
                        </p>
                      )}
                    </div>
                    <div className="grid gap-2 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 xl:w-72">
                      <p className="text-xs uppercase tracking-wide text-slate-500">
                        Settlement lens
                      </p>
                      <p className="text-sm leading-6 text-slate-300">
                        {item.privateFlow
                          ? 'This action affects shielded balances, note visibility, or movement back into the visible wallet.'
                          : 'This action is already visible or is settling directly into the public wallet.'}
                      </p>
                      {item.indexing?.detail && (
                        <p className="text-sm leading-6 text-slate-400">{item.indexing.detail}</p>
                      )}
                      {item.sponsorship?.detail && (
                        <p className="text-sm leading-6 text-slate-400">
                          {item.sponsorship.detail}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </section>

      <section className="flex flex-col gap-4 rounded-[28px] border border-slate-800 bg-slate-950/80 p-6 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-slate-500">
            Use this desk when balances feel ambiguous
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-white">
            Confirm settlement before you assume the wallet is final
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            If the next question is “did this private value settle yet?” or “should I retry this
            withdrawal?”, this is the first place to check before jumping into a new flow.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" onClick={() => fetchWorkspace(true)}>
            <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Link href="/dashboard">
            <Button variant="secondary">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Dashboard
            </Button>
          </Link>
          <Link href={workspace.summary.queuedWithdrawals > 0 ? '/wallet' : '/history'}>
            <Button>
              Open next settlement desk
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </section>
    </main>
  );
}
