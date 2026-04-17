'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Clock3,
  ExternalLink,
  Layers3,
  RefreshCw,
  Shield,
  Sparkles,
  TriangleAlert,
  Wallet,
  Wrench,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api';

interface ActionsWorkspace {
  user: {
    username?: string;
    stellarPublicKey?: string;
    reputation?: number;
  };
  summary: {
    totalPriorities: number;
    critical: number;
    caution: number;
    quickWins: number;
  };
  lanes: {
    wallet: {
      publicXlm: string;
      publicUsdc: string;
      privateXlm: string;
      privateUsdc: string;
      pendingWithdrawals: number;
      hasUsdcTrustline: boolean;
      hasPrivateBalance: boolean;
    };
    activity: {
      total: number;
      pending: number;
      failed: number;
      privateFlows: number;
      sponsored: number;
      momentum: string;
    };
    market: {
      total: number;
      requested: number;
      proofsPending: number;
      proofsReady: number;
      executing: number;
      failed: number;
      completed: number;
    };
    ops: {
      status: 'ready' | 'degraded';
      trackedPools: number;
      laggingPools: number;
      laggingPoolAddresses: string[];
    };
  };
  priorities: Array<{
    id: string;
    severity: 'critical' | 'caution' | 'info';
    lane: 'wallet' | 'private' | 'market' | 'ops' | 'history';
    label: string;
    detail: string;
    href: string;
    cta: string;
    status: string;
  }>;
  quickWins: string[];
  routeCards: Array<{
    id: string;
    label: string;
    href: string;
    readiness: 'critical' | 'caution' | 'ready' | 'info';
    detail: string;
  }>;
  swapQueue: Array<{
    id: string;
    participantRole: string;
    counterparty?: string;
    status: string;
    proofStatus?: string;
    executionStatus?: string;
    amountIn: number;
    amountOut: number;
    action: string;
    urgency: 'critical' | 'caution' | 'info';
    detail: string;
    href: string;
    updatedAt?: string;
  }>;
  blockerFeed: Array<{
    id: string;
    title: string;
    detail: string;
    lane: string;
    state: string;
    href: string;
  }>;
  latestTitles: string[];
  updatedAt: string;
}

function variantFor(value: string) {
  if (value === 'critical') {
    return 'error' as const;
  }
  if (value === 'caution') {
    return 'warning' as const;
  }
  if (value === 'ready') {
    return 'success' as const;
  }
  if (value === 'success' || value === 'complete') {
    return 'success' as const;
  }
  if (value === 'failed' || value === 'blocked') {
    return 'error' as const;
  }
  if (value === 'pending' || value === 'retryable' || value === 'attention') {
    return 'warning' as const;
  }
  return 'default' as const;
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

export default function ActionsPage() {
  const [workspace, setWorkspace] = useState<ActionsWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchWorkspace = async (showRefresh = false) => {
    if (showRefresh) {
      setRefreshing(true);
    }

    try {
      const response = await fetch(`${API_URL}/users/actions/workspace`, {
        credentials: 'include',
      });
      const data = await response.json().catch(() => null);
      setWorkspace(response.ok ? data : null);
    } catch (error) {
      console.error('[ActionsPage] Failed to load action center workspace', error);
      setWorkspace(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchWorkspace();
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="p-8 text-white">
        <p>
          Action center is unavailable right now.{' '}
          <Link href="/dashboard" className="text-indigo-400">
            Go back to dashboard
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8 text-white">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Action Center</p>
          <h1 className="mt-2 bg-gradient-to-r from-white to-slate-400 bg-clip-text text-3xl font-bold text-transparent">
            What actually needs your attention right now
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            This workspace ranks the next highest-value moves across funding, trustlines, shielded balances, swaps,
            failure recovery, and indexer freshness so you stop guessing which page to open next.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={workspace.summary.critical > 0 ? 'error' : workspace.summary.caution > 0 ? 'warning' : 'success'}>
            {workspace.summary.critical > 0 ? `${workspace.summary.critical} critical` : workspace.summary.caution > 0 ? `${workspace.summary.caution} caution` : 'All clear'}
          </Badge>
          <Button variant="ghost" onClick={() => fetchWorkspace(true)}>
            <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-4">
        <Card variant="glass">
          <p className="text-xs uppercase tracking-wide text-slate-500">Priority queue</p>
          <p className="mt-2 text-3xl font-semibold text-white">{workspace.summary.totalPriorities}</p>
          <p className="mt-2 text-sm leading-6 text-slate-400">Ranked actions across wallet, market, history, and ops.</p>
        </Card>
        <Card variant="glass">
          <p className="text-xs uppercase tracking-wide text-slate-500">Quick wins</p>
          <p className="mt-2 text-3xl font-semibold text-white">{workspace.summary.quickWins}</p>
          <p className="mt-2 text-sm leading-6 text-slate-400">Low-friction steps that remove the most day-to-day friction.</p>
        </Card>
        <Card variant="glass">
          <p className="text-xs uppercase tracking-wide text-slate-500">Pending actions</p>
          <p className="mt-2 text-3xl font-semibold text-white">{workspace.lanes.activity.pending}</p>
          <p className="mt-2 text-sm leading-6 text-slate-400">History items still waiting on chain follow-up or user intervention.</p>
        </Card>
        <Card variant="glass">
          <p className="text-xs uppercase tracking-wide text-slate-500">Market pressure</p>
          <p className="mt-2 text-3xl font-semibold text-white">{workspace.lanes.market.requested + workspace.lanes.market.proofsPending + workspace.lanes.market.proofsReady}</p>
          <p className="mt-2 text-sm leading-6 text-slate-400">Requests and proof-stage swaps still asking for active follow-up.</p>
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.03fr_0.97fr]">
        <Card variant="neon">
          <div className="mb-4 flex items-center gap-2">
            <TriangleAlert className="h-5 w-5 text-rose-300" />
            <h2 className="text-xl font-semibold text-white">Priority board</h2>
          </div>
          <div className="space-y-3">
            {workspace.priorities.length === 0 ? (
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-500">
                No urgent actions are waiting right now.
              </div>
            ) : (
              workspace.priorities.map((item, index) => (
                <div key={item.id} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={variantFor(item.severity)}>{item.severity}</Badge>
                        <Badge variant="default">{item.lane}</Badge>
                        <Badge variant="default">#{index + 1}</Badge>
                      </div>
                      <h3 className="mt-3 text-lg font-semibold text-white">{item.label}</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-400">{item.detail}</p>
                    </div>
                    <Link
                      href={item.href}
                      className="inline-flex items-center rounded-xl border border-indigo-500/20 bg-indigo-500/10 px-4 py-2 text-sm text-indigo-200 transition-colors hover:bg-indigo-500/20"
                    >
                      {item.cta}
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card variant="glass">
          <div className="mb-4 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-indigo-300" />
            <h2 className="text-xl font-semibold text-white">Quick wins</h2>
          </div>
          <div className="space-y-3">
            {workspace.quickWins.length === 0 ? (
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-500">
                Nothing lightweight is waiting right now.
              </div>
            ) : (
              workspace.quickWins.map((item) => (
                <div key={item} className="flex items-start gap-3 rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                  <p className="text-sm leading-6 text-slate-300">{item}</p>
                </div>
              ))
            )}
          </div>

          <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Latest signal themes</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {workspace.latestTitles.map((title) => (
                <Badge key={title} variant="default">
                  {title}
                </Badge>
              ))}
            </div>
          </div>
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-[0.92fr_1.08fr]">
        <Card variant="glass">
          <div className="mb-4 flex items-center gap-2">
            <Activity className="h-5 w-5 text-amber-300" />
            <h2 className="text-xl font-semibold text-white">Signal lanes</h2>
          </div>
          <div className="space-y-3">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-white">Wallet</p>
                <Badge variant={workspace.lanes.wallet.pendingWithdrawals > 0 ? 'warning' : 'success'}>
                  {workspace.lanes.wallet.pendingWithdrawals > 0 ? 'Queue waiting' : 'Stable'}
                </Badge>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Public: {workspace.lanes.wallet.publicXlm} XLM / {workspace.lanes.wallet.publicUsdc} USDC
              </p>
              <p className="mt-1 text-sm leading-6 text-slate-400">
                Private: {workspace.lanes.wallet.privateXlm} XLM / {workspace.lanes.wallet.privateUsdc} USDC
              </p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-white">Activity</p>
                <Badge variant="default">{workspace.lanes.activity.momentum}</Badge>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                {workspace.lanes.activity.pending} pending, {workspace.lanes.activity.failed} failed, {workspace.lanes.activity.privateFlows} private flow events.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-white">Market</p>
                <Badge variant={workspace.lanes.market.failed > 0 || workspace.lanes.market.proofsReady > 0 ? 'warning' : 'default'}>
                  {workspace.lanes.market.total} tracked swaps
                </Badge>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                {workspace.lanes.market.requested} requests, {workspace.lanes.market.proofsPending} proofs pending, {workspace.lanes.market.proofsReady} proofs ready, {workspace.lanes.market.executing} executing.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-white">Ops</p>
                <Badge variant={workspace.lanes.ops.status === 'ready' ? 'success' : 'warning'}>
                  {workspace.lanes.ops.status}
                </Badge>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                {workspace.lanes.ops.trackedPools} tracked pools with {workspace.lanes.ops.laggingPools} lagging lanes.
              </p>
            </div>
          </div>
        </Card>

        <Card variant="glass">
          <div className="mb-4 flex items-center gap-2">
            <Wrench className="h-5 w-5 text-indigo-300" />
            <h2 className="text-xl font-semibold text-white">Workspace shortcuts</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {workspace.routeCards.map((route) => (
              <Link
                key={route.id}
                href={route.href}
                className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 transition hover:border-indigo-500/30 hover:bg-slate-900"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-white">{route.label}</p>
                  <Badge variant={variantFor(route.readiness)}>{route.readiness}</Badge>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-400">{route.detail}</p>
              </Link>
            ))}
          </div>
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.08fr_0.92fr]">
        <Card variant="glass">
          <div className="mb-4 flex items-center gap-2">
            <Layers3 className="h-5 w-5 text-cyan-300" />
            <h2 className="text-xl font-semibold text-white">Swap queue</h2>
          </div>
          <div className="space-y-3">
            {workspace.swapQueue.length === 0 ? (
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-500">
                No active swap queue right now.
              </div>
            ) : (
              workspace.swapQueue.map((swap) => (
                <div key={swap.id} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={variantFor(swap.urgency)}>{swap.urgency}</Badge>
                        <Badge variant="default">{swap.status}</Badge>
                        <Badge variant="default">{swap.participantRole}</Badge>
                      </div>
                      <h3 className="mt-3 text-base font-semibold text-white">{swap.action}</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-400">{swap.detail}</p>
                      <p className="mt-2 text-xs text-slate-500">
                        Counterparty: {swap.counterparty ? `@${swap.counterparty}` : 'Unknown'} | Ticket {swap.amountIn} / {swap.amountOut}
                      </p>
                    </div>
                    <div className="shrink-0">
                      <Link
                        href={swap.href}
                        className="inline-flex items-center rounded-xl border border-indigo-500/20 bg-indigo-500/10 px-4 py-2 text-sm text-indigo-200 transition-colors hover:bg-indigo-500/20"
                      >
                        Open
                        <ExternalLink className="ml-2 h-4 w-4" />
                      </Link>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card variant="glass">
          <div className="mb-4 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-rose-300" />
            <h2 className="text-xl font-semibold text-white">Blocker feed</h2>
          </div>
          <div className="space-y-3">
            {workspace.blockerFeed.length === 0 ? (
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-500">
                No blockers are currently staged.
              </div>
            ) : (
              workspace.blockerFeed.map((item) => (
                <Link
                  key={item.id}
                  href={item.href}
                  className="block rounded-2xl border border-slate-800 bg-slate-950/70 p-4 transition hover:border-indigo-500/30 hover:bg-slate-900"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={variantFor(item.state)}>{item.state}</Badge>
                      <Badge variant="default">{item.lane}</Badge>
                    </div>
                    <ArrowRight className="h-4 w-4 text-slate-500" />
                  </div>
                  <h3 className="mt-3 text-sm font-semibold text-white">{item.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-400">{item.detail}</p>
                </Link>
              ))
            )}
          </div>
        </Card>
      </section>

      <div className="flex flex-wrap items-center gap-4">
        <Link href="/dashboard">
          <Button variant="ghost" size="sm" className="pl-0 text-slate-500 hover:text-slate-300">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Dashboard
          </Button>
        </Link>
        <div className="text-sm text-slate-500">Last refresh: {formatTimestamp(workspace.updatedAt)}</div>
      </div>
    </div>
  );
}
