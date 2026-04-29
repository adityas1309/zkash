'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { PrivacyToggle } from '@/components/ui/PrivacyToggle';
import { usePrivacy } from '@/context/PrivacyContext';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle,
  Clock3,
  ExternalLink,
  Filter,
  Globe,
  Layers3,
  RefreshCw,
  Shield,
  Sparkles,
  TrendingUp,
  TriangleAlert,
  Users,
  XCircle,
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api';

type HistoryState = 'success' | 'pending' | 'failed' | 'retryable' | 'queued';
type HistoryCategory = 'wallet' | 'private' | 'swap' | 'system';

interface HistoryEntry {
  id: string;
  source: 'audit' | 'encrypted_note' | 'withdrawal' | 'swap';
  category: HistoryCategory;
  operation: string;
  title: string;
  detail: string;
  state: HistoryState;
  asset?: string;
  amount?: string;
  amountDisplay: string;
  txHash?: string;
  sponsorship: {
    attempted: boolean;
    sponsored: boolean;
    detail?: string;
  };
  indexing?: {
    status?: string;
    detail?: string;
  };
  participants?: {
    role?: 'alice' | 'bob';
    counterparty?: string;
  };
  privateFlow: boolean;
  date: string;
  statusLabel: string;
}

interface HistoryWorkspace {
  user: {
    username?: string;
    stellarPublicKey?: string;
    reputation?: number;
  };
  summary: {
    total: number;
    completed: number;
    pending: number;
    failed: number;
    privateFlows: number;
    sponsored: number;
  };
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
    momentum: 'high' | 'moderate' | 'light';
  };
  categoryBreakdown: Array<{
    category: HistoryCategory;
    count: number;
    completed: number;
    pending: number;
    failed: number;
    latestAt?: string;
  }>;
  failureBuckets: Array<{
    key: string;
    label: string;
    count: number;
    latestEntry?: {
      id: string;
      title: string;
      detail: string;
      date: string;
    };
  }>;
  counterparties: Array<{
    counterparty: string;
    interactions: number;
    privateFlows: number;
    swapFlows: number;
    latestAt?: string;
  }>;
  actionQueue: Array<{
    id: string;
    operation: string;
    title: string;
    detail: string;
    state: HistoryState;
    category: HistoryCategory;
  }>;
  walletSignals: {
    pendingWithdrawals: number;
    privateUsdc: string;
    privateXlm: string;
    publicUsdc: string;
    publicXlm: string;
  };
  latestEntries: HistoryEntry[];
  timeline: HistoryEntry[];
}

function getStateVariant(state: HistoryState) {
  if (state === 'success') {
    return 'success' as const;
  }
  if (state === 'failed') {
    return 'error' as const;
  }
  if (state === 'retryable') {
    return 'warning' as const;
  }
  return 'default' as const;
}

function getCategoryVariant(category: HistoryCategory) {
  if (category === 'swap') {
    return 'warning' as const;
  }
  if (category === 'private') {
    return 'success' as const;
  }
  if (category === 'wallet') {
    return 'default' as const;
  }
  return 'error' as const;
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

function MetricCard({
  title,
  value,
  detail,
  icon,
}: {
  title: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
}) {
  return (
    <Card variant="glass">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">{title}</p>
          <p className="mt-2 text-3xl font-semibold text-white">{value}</p>
          <p className="mt-2 text-sm leading-6 text-slate-400">{detail}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-slate-950/80 p-3 text-indigo-300">
          {icon}
        </div>
      </div>
    </Card>
  );
}

export default function HistoryPage() {
  const { isPrivate, togglePrivacy } = usePrivacy();
  const [workspace, setWorkspace] = useState<HistoryWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState<'all' | HistoryCategory>('all');
  const [stateFilter, setStateFilter] = useState<'all' | HistoryState>('all');
  const [focusMode, setFocusMode] = useState<'timeline' | 'recovery' | 'relationships'>('timeline');

  const fetchHistoryWorkspace = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/users/history/workspace`, {
        credentials: 'include',
      });
      const data = await response.json().catch(() => null);
      setWorkspace(data);
    } catch (error) {
      console.error('[HistoryPage] Failed to fetch history workspace', error);
      setWorkspace(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistoryWorkspace();
  }, []);

  const filteredHistory = useMemo(() => {
    const timeline = workspace?.timeline ?? [];
    return timeline.filter((item) => {
      if (categoryFilter !== 'all' && item.category !== categoryFilter) {
        return false;
      }
      if (stateFilter !== 'all' && item.state !== stateFilter) {
        return false;
      }
      return true;
    });
  }, [categoryFilter, stateFilter, workspace]);

  const summary = workspace?.summary;

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center px-6">
        <Card variant="glass" className="max-w-xl py-12 text-center">
          <div className="flex flex-col items-center gap-4">
            <AlertCircle className="h-12 w-12 text-slate-500" />
            <p className="text-lg text-slate-300">History workspace could not be loaded.</p>
            <button
              onClick={() => fetchHistoryWorkspace()}
              className="inline-flex items-center rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-sm text-slate-200 transition-colors hover:bg-slate-800"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Retry
            </button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto mb-8 flex min-h-[50vh] max-w-[1500px] flex-col rounded-[32px] border border-white/5 bg-slate-900/30 p-8 text-white selection:bg-indigo-500/30 lg:p-12">
      <div className="absolute right-8 top-6 z-20">
        <PrivacyToggle checked={isPrivate} onCheckedChange={togglePrivacy} />
      </div>

      <main className="relative z-10 mx-auto w-full max-w-7xl space-y-8 pt-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-slate-500">
              Activity Intelligence Workspace
            </p>
            <h1 className="mt-2 bg-gradient-to-r from-white to-slate-400 bg-clip-text text-3xl font-bold text-transparent">
              History & Recovery Desk
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
              This workspace shows not just what happened, but what is blocked, who you interact
              with most, where failures cluster, and which items should be resolved next.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => fetchHistoryWorkspace()}
              className="inline-flex items-center rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-sm text-slate-200 transition-colors hover:bg-slate-800"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </button>
            <Link
              href="/status"
              className="inline-flex items-center rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-sm text-slate-200 transition-colors hover:bg-slate-800"
            >
              Status Workspace
            </Link>
            <Link
              href="/dashboard"
              className="inline-flex items-center rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-sm text-slate-200 transition-colors hover:bg-slate-800"
            >
              Dashboard
            </Link>
          </div>
        </div>

        <section className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
          <MetricCard
            title="Total events"
            value={String(summary?.total ?? 0)}
            detail="Full merged history volume across wallet, private, and swap flows."
            icon={<Layers3 className="h-5 w-5" />}
          />
          <MetricCard
            title="Completed"
            value={String(summary?.completed ?? 0)}
            detail="Operations that reached a successful terminal state."
            icon={<CheckCircle className="h-5 w-5" />}
          />
          <MetricCard
            title="Pending"
            value={String(summary?.pending ?? 0)}
            detail="Items still waiting on proofs, retries, withdrawals, or indexing."
            icon={<Clock3 className="h-5 w-5" />}
          />
          <MetricCard
            title="Failures"
            value={String(summary?.failed ?? 0)}
            detail="Failures and retryable blockers clustered from the same history stream."
            icon={<XCircle className="h-5 w-5" />}
          />
          <MetricCard
            title="Private flows"
            value={String(summary?.privateFlows ?? 0)}
            detail="Entries touching deposits, notes, withdrawals, or shielded execution."
            icon={<Shield className="h-5 w-5" />}
          />
          <MetricCard
            title="Sponsored"
            value={String(summary?.sponsored ?? 0)}
            detail="Events where fee sponsorship was successfully applied."
            icon={<Sparkles className="h-5 w-5" />}
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <Card variant="neon">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Velocity</p>
                <h2 className="mt-2 text-xl font-semibold text-white">
                  Activity momentum and readiness signals
                </h2>
              </div>
              <Badge
                variant={
                  workspace.velocity.momentum === 'high'
                    ? 'success'
                    : workspace.velocity.momentum === 'moderate'
                      ? 'warning'
                      : 'default'
                }
              >
                {workspace.velocity.momentum.toUpperCase()} MOMENTUM
              </Badge>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Last 24h</p>
                <p className="mt-2 text-3xl font-semibold text-white">
                  {workspace.velocity.last24h.total}
                </p>
                <p className="mt-2 text-sm text-slate-400">
                  {workspace.velocity.last24h.successful} successful,{' '}
                  {workspace.velocity.last24h.pending} still waiting.
                </p>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Last 7d</p>
                <p className="mt-2 text-3xl font-semibold text-white">
                  {workspace.velocity.last7d.total}
                </p>
                <p className="mt-2 text-sm text-slate-400">
                  {workspace.velocity.last7d.successful} successful with{' '}
                  {workspace.velocity.last7d.dailyAverage} avg/day.
                </p>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Wallet signals</p>
                <p className="mt-2 text-lg font-semibold text-white">
                  {workspace.walletSignals.privateXlm} XLM private /{' '}
                  {workspace.walletSignals.pendingWithdrawals} queued
                </p>
                <p className="mt-2 text-sm text-slate-400">
                  Private and withdrawal signals help explain why the history feed is moving or
                  stalling.
                </p>
              </div>
            </div>
          </Card>

          <Card variant="glass">
            <div className="flex items-center gap-2">
              <TriangleAlert className="h-5 w-5 text-yellow-400" />
              <h2 className="text-xl font-semibold text-white">Action queue</h2>
            </div>
            <div className="mt-5 grid gap-3">
              {workspace.actionQueue.length ? (
                workspace.actionQueue.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-white">{item.title}</p>
                      <Badge variant={getStateVariant(item.state)}>
                        {item.state.toUpperCase()}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-400">{item.detail}</p>
                    <div className="mt-3 flex items-center gap-2">
                      <Badge variant={getCategoryVariant(item.category)}>
                        {item.category.toUpperCase()}
                      </Badge>
                      <span className="text-xs uppercase tracking-wide text-slate-500">
                        {item.operation.replaceAll('_', ' ')}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-500">
                  No unresolved action items are standing out in the current history stream.
                </div>
              )}
            </div>
          </Card>
        </section>

        <section className="grid gap-6 xl:grid-cols-[0.28fr_0.72fr]">
          <div className="space-y-6">
            <Card variant="glass">
              <div className="mb-5 flex items-center gap-2">
                <Filter className="h-4 w-4 text-indigo-300" />
                <p className="text-sm font-medium text-white">Timeline filters</p>
              </div>

              <div className="space-y-4">
                <label className="block">
                  <span className="mb-2 block text-xs uppercase tracking-wide text-slate-500">
                    Category
                  </span>
                  <select
                    value={categoryFilter}
                    onChange={(event) =>
                      setCategoryFilter(event.target.value as typeof categoryFilter)
                    }
                    className="w-full rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none transition focus:border-indigo-500"
                  >
                    <option value="all">All categories</option>
                    <option value="wallet">Wallet</option>
                    <option value="private">Private</option>
                    <option value="swap">Swap</option>
                    <option value="system">System</option>
                  </select>
                </label>

                <label className="block">
                  <span className="mb-2 block text-xs uppercase tracking-wide text-slate-500">
                    State
                  </span>
                  <select
                    value={stateFilter}
                    onChange={(event) => setStateFilter(event.target.value as typeof stateFilter)}
                    className="w-full rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none transition focus:border-indigo-500"
                  >
                    <option value="all">All states</option>
                    <option value="success">Success</option>
                    <option value="pending">Pending</option>
                    <option value="failed">Failed</option>
                    <option value="retryable">Retryable</option>
                    <option value="queued">Queued</option>
                  </select>
                </label>

                <label className="block">
                  <span className="mb-2 block text-xs uppercase tracking-wide text-slate-500">
                    View focus
                  </span>
                  <select
                    value={focusMode}
                    onChange={(event) => setFocusMode(event.target.value as typeof focusMode)}
                    className="w-full rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none transition focus:border-indigo-500"
                  >
                    <option value="timeline">Timeline</option>
                    <option value="recovery">Recovery blockers</option>
                    <option value="relationships">Counterparties</option>
                  </select>
                </label>

                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Visible entries</p>
                  <p className="mt-2 text-3xl font-semibold text-white">{filteredHistory.length}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    Filters isolate the exact slice you need, while the focus mode swaps the
                    right-hand intelligence panel.
                  </p>
                </div>
              </div>
            </Card>

            <Card variant="glass">
              <div className="mb-4 flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-emerald-300" />
                <p className="text-sm font-medium text-white">Category breakdown</p>
              </div>
              <div className="space-y-3">
                {workspace.categoryBreakdown.map((bucket) => (
                  <div
                    key={bucket.category}
                    className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <Badge variant={getCategoryVariant(bucket.category)}>
                        {bucket.category.toUpperCase()}
                      </Badge>
                      <span className="text-sm font-medium text-white">{bucket.count}</span>
                    </div>
                    <p className="mt-2 text-xs text-slate-400">
                      {bucket.completed} completed, {bucket.pending} pending, {bucket.failed}{' '}
                      blocked
                    </p>
                    <p className="mt-2 text-xs text-slate-500">
                      Latest: {formatTimestamp(bucket.latestAt)}
                    </p>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <div className="space-y-6">
            {focusMode === 'recovery' && (
              <Card variant="glass">
                <div className="mb-4 flex items-center gap-2">
                  <TriangleAlert className="h-5 w-5 text-yellow-400" />
                  <h2 className="text-xl font-semibold text-white">Recovery blockers</h2>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  {workspace.failureBuckets.length ? (
                    workspace.failureBuckets.map((bucket) => (
                      <div
                        key={bucket.key}
                        className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium text-white">{bucket.label}</p>
                          <Badge variant="warning">{bucket.count}</Badge>
                        </div>
                        {bucket.latestEntry ? (
                          <>
                            <p className="mt-2 text-sm text-slate-300">
                              {bucket.latestEntry.title}
                            </p>
                            <p className="mt-2 text-sm leading-6 text-slate-400">
                              {bucket.latestEntry.detail}
                            </p>
                            <p className="mt-2 text-xs text-slate-500">
                              {formatTimestamp(bucket.latestEntry.date)}
                            </p>
                          </>
                        ) : (
                          <p className="mt-2 text-sm text-slate-500">No sample entry recorded.</p>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-500 md:col-span-2">
                      No blocker clusters are standing out right now.
                    </div>
                  )}
                </div>
              </Card>
            )}

            {focusMode === 'relationships' && (
              <Card variant="glass">
                <div className="mb-4 flex items-center gap-2">
                  <Users className="h-5 w-5 text-indigo-300" />
                  <h2 className="text-xl font-semibold text-white">Top counterparties</h2>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  {workspace.counterparties.length ? (
                    workspace.counterparties.map((counterparty) => (
                      <div
                        key={counterparty.counterparty}
                        className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium text-white">
                            @{counterparty.counterparty}
                          </p>
                          <Badge variant="default">{counterparty.interactions} touches</Badge>
                        </div>
                        <p className="mt-2 text-sm text-slate-300">
                          {counterparty.privateFlows} private flows and {counterparty.swapFlows}{' '}
                          swap-related events.
                        </p>
                        <p className="mt-2 text-xs text-slate-500">
                          Latest interaction: {formatTimestamp(counterparty.latestAt)}
                        </p>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-500 md:col-span-2">
                      Counterparty relationships will appear here once transfer and swap history
                      builds up.
                    </div>
                  )}
                </div>
              </Card>
            )}

            {focusMode === 'timeline' && workspace.latestEntries.length > 0 && (
              <Card variant="glass">
                <div className="mb-4 flex items-center gap-2">
                  <Layers3 className="h-5 w-5 text-indigo-300" />
                  <h2 className="text-xl font-semibold text-white">Latest critical entries</h2>
                </div>
                <div className="grid gap-3">
                  {workspace.latestEntries.slice(0, 5).map((item) => (
                    <div
                      key={item.id}
                      className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium text-white">{item.title}</p>
                        <Badge variant={getStateVariant(item.state)}>{item.statusLabel}</Badge>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-slate-400">{item.detail}</p>
                      <p className="mt-2 text-xs text-slate-500">{formatTimestamp(item.date)}</p>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {filteredHistory.length === 0 ? (
              <Card variant="glass" className="py-12 text-center">
                <div className="flex flex-col items-center gap-4">
                  <AlertCircle className="h-12 w-12 text-slate-500" />
                  <p className="text-lg text-slate-400">
                    No history entries match the current filters.
                  </p>
                  <p className="max-w-md text-sm text-slate-500">
                    Try broadening the filters or generate new wallet, private, or swap activity to
                    populate the timeline.
                  </p>
                </div>
              </Card>
            ) : (
              filteredHistory.map((item) => (
                <Card key={item.id} variant="glass" className="overflow-hidden">
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <Badge variant={getCategoryVariant(item.category)}>
                          {item.category.toUpperCase()}
                        </Badge>
                        <Badge variant={getStateVariant(item.state)}>{item.statusLabel}</Badge>
                        {item.privateFlow ? (
                          <Badge variant="success">
                            <Shield className="mr-1 h-3 w-3" />
                            Private context
                          </Badge>
                        ) : (
                          <Badge variant="default">
                            <Globe className="mr-1 h-3 w-3" />
                            Public context
                          </Badge>
                        )}
                        {item.sponsorship?.sponsored && (
                          <Badge variant="warning">
                            <Sparkles className="mr-1 h-3 w-3" />
                            Sponsored
                          </Badge>
                        )}
                      </div>

                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <div className="min-w-0">
                          <h3 className="truncate text-xl font-semibold text-white">
                            {item.title}
                          </h3>
                          <p className="mt-1 text-sm leading-6 text-slate-400">{item.detail}</p>
                        </div>
                        <div className="text-left md:text-right">
                          <p className="text-xs uppercase tracking-wide text-slate-500">Time</p>
                          <p className="mt-1 text-sm text-white">{formatTimestamp(item.date)}</p>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-3 md:grid-cols-4">
                        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
                          <p className="text-xs uppercase tracking-wide text-slate-500">
                            Operation
                          </p>
                          <p className="mt-2 text-sm font-medium text-white">
                            {item.operation.replaceAll('_', ' ')}
                          </p>
                        </div>
                        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
                          <p className="text-xs uppercase tracking-wide text-slate-500">Asset</p>
                          <p className="mt-2 text-sm font-medium text-white">
                            {item.asset || 'Not specified'}
                          </p>
                        </div>
                        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
                          <p className="text-xs uppercase tracking-wide text-slate-500">Amount</p>
                          <p className="mt-2 text-sm font-medium text-white">
                            {item.amountDisplay}
                          </p>
                        </div>
                        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
                          <p className="text-xs uppercase tracking-wide text-slate-500">
                            Counterparty
                          </p>
                          <p className="mt-2 text-sm font-medium text-white">
                            {item.participants?.counterparty
                              ? `@${item.participants.counterparty}`
                              : 'Not applicable'}
                          </p>
                        </div>
                      </div>

                      {(item.indexing?.detail || item.sponsorship?.detail) && (
                        <div className="mt-4 grid gap-3 md:grid-cols-2">
                          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
                            <p className="text-xs uppercase tracking-wide text-slate-500">
                              Indexing
                            </p>
                            <p className="mt-2 text-sm font-medium text-white">
                              {item.indexing?.status || 'Not tracked'}
                            </p>
                            <p className="mt-1 text-sm leading-6 text-slate-400">
                              {item.indexing?.detail || 'No indexing detail recorded.'}
                            </p>
                          </div>
                          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
                            <p className="text-xs uppercase tracking-wide text-slate-500">
                              Sponsorship
                            </p>
                            <p className="mt-2 text-sm font-medium text-white">
                              {item.sponsorship?.attempted
                                ? item.sponsorship?.sponsored
                                  ? 'Fee sponsored'
                                  : 'Attempted but not sponsored'
                                : 'Not attempted'}
                            </p>
                            <p className="mt-1 text-sm leading-6 text-slate-400">
                              {item.sponsorship?.detail ||
                                'No sponsorship note recorded for this entry.'}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="shrink-0 md:ml-4">
                      {item.txHash ? (
                        <a
                          href={`https://stellar.expert/explorer/testnet/tx/${item.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center rounded-xl border border-indigo-500/20 bg-indigo-500/10 px-4 py-2 text-sm text-indigo-200 transition-colors hover:bg-indigo-500/20"
                        >
                          View tx
                          <ExternalLink className="ml-2 h-4 w-4" />
                        </a>
                      ) : (
                        <div className="rounded-xl border border-slate-800 bg-slate-950/70 px-4 py-2 text-sm text-slate-500">
                          No transaction hash
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              ))
            )}
          </div>
        </section>

        <div className="flex justify-center text-xs text-slate-600">
          <Link
            href="/dashboard"
            className="inline-flex items-center transition-colors hover:text-slate-400"
          >
            <ArrowLeft className="mr-1 h-3 w-3" />
            Back to Dashboard
          </Link>
        </div>
      </main>
    </div>
  );
}
