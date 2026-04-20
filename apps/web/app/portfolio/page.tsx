'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Compass,
  ExternalLink,
  Eye,
  Globe,
  Layers3,
  PieChart,
  RefreshCw,
  Shield,
  Sparkles,
  Target,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api';

type Tone = 'ready' | 'attention' | 'blocked' | 'info';

interface PortfolioWorkspace {
  user: {
    username?: string;
    stellarPublicKey?: string;
    reputation?: number;
  };
  summary: {
    totalExposure: number;
    publicExposure: number;
    privateExposure: number;
    totalUsdc: number;
    totalXlm: number;
  };
  allocation: Array<{
    id: string;
    label: string;
    amount: number;
    share: number;
    lane: 'public' | 'private';
    asset: 'USDC' | 'XLM';
  }>;
  exposureSignals: Array<{
    id: string;
    label: string;
    value: number;
    detail: string;
  }>;
  routeRisk: Array<{
    id: string;
    label: string;
    tone: Tone;
    detail: string;
  }>;
  rebalanceIdeas: string[];
  flowMix: Array<{
    label: string;
    count: number;
  }>;
  actionLinks: Array<{
    id: string;
    label: string;
    href: string;
    tone: 'critical' | 'warning' | 'info';
    detail: string;
  }>;
  portfolioHealth: {
    tone: Tone;
    headline: string;
  };
  recentTitles: string[];
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

function formatAmount(value: number) {
  if (!Number.isFinite(value)) {
    return '0';
  }
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

function formatCompact(value: number) {
  if (!Number.isFinite(value)) {
    return '0';
  }
  return value.toLocaleString(undefined, {
    notation: value >= 1000 ? 'compact' : 'standard',
    maximumFractionDigits: value >= 1000 ? 1 : 1,
  });
}

function badgeVariantForTone(value: string) {
  if (value === 'ready' || value === 'success') {
    return 'success' as const;
  }
  if (value === 'attention' || value === 'warning') {
    return 'warning' as const;
  }
  if (value === 'blocked' || value === 'critical' || value === 'error') {
    return 'error' as const;
  }
  return 'default' as const;
}

function toneRingClass(value: string) {
  if (value === 'ready') {
    return 'border-emerald-500/30 bg-emerald-500/10';
  }
  if (value === 'attention') {
    return 'border-amber-500/30 bg-amber-500/10';
  }
  if (value === 'blocked') {
    return 'border-rose-500/30 bg-rose-500/10';
  }
  return 'border-slate-700 bg-slate-900/70';
}

function lanePillClass(lane: 'public' | 'private') {
  return lane === 'private'
    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
    : 'border-sky-500/30 bg-sky-500/10 text-sky-200';
}

function allocationBarClass(id: string) {
  if (id.includes('private') && id.includes('usdc')) {
    return 'from-emerald-400 via-emerald-300 to-lime-200';
  }
  if (id.includes('public') && id.includes('usdc')) {
    return 'from-cyan-400 via-sky-300 to-blue-200';
  }
  if (id.includes('private') && id.includes('xlm')) {
    return 'from-teal-300 via-emerald-200 to-cyan-100';
  }
  return 'from-indigo-400 via-violet-300 to-sky-200';
}

function deriveStrengthLabel(value: number) {
  if (value >= 75) {
    return 'High';
  }
  if (value >= 45) {
    return 'Moderate';
  }
  return 'Early';
}

function deriveBalanceHeadline(summary: PortfolioWorkspace['summary']) {
  if (summary.totalExposure === 0) {
    return 'No capital is allocated yet, so the product still behaves like a fresh setup.';
  }
  if (summary.privateExposure > summary.publicExposure * 1.4) {
    return 'Shielded exposure is dominant, which is great for privacy but can slow recovery and public routing.';
  }
  if (summary.publicExposure > summary.privateExposure * 1.7) {
    return 'Visible balances are dominant, so the portfolio is still leaning on public flows more than private ones.';
  }
  return 'Public and private balances are both represented, which gives the portfolio more route flexibility.';
}

function deriveFlowHeadline(flowMix: PortfolioWorkspace['flowMix']) {
  const top = [...flowMix].sort((left, right) => right.count - left.count)[0];
  if (!top || top.count === 0) {
    return 'No meaningful activity pattern has formed yet.';
  }
  if (top.label === 'Private') {
    return 'Private flow is already a core part of this portfolio’s behavior.';
  }
  if (top.label === 'Swap') {
    return 'Market activity is driving the most visible portfolio motion right now.';
  }
  if (top.label === 'Wallet') {
    return 'Direct wallet activity is still the strongest source of signal in this portfolio.';
  }
  return 'System-level state is still shaping more of the portfolio than user flow.';
}

export default function PortfolioPage() {
  const [workspace, setWorkspace] = useState<PortfolioWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchWorkspace = async (showRefresh = false) => {
    if (showRefresh) {
      setRefreshing(true);
    }

    try {
      const response = await fetch(`${API_URL}/users/portfolio/workspace`, {
        credentials: 'include',
      });
      const data = await response.json().catch(() => null);
      setWorkspace(response.ok ? data : null);
    } catch (error) {
      console.error('[PortfolioPage] Failed to load portfolio workspace', error);
      setWorkspace(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchWorkspace();
  }, []);

  const totalAllocationShare = useMemo(() => {
    if (!workspace) {
      return 0;
    }
    return workspace.allocation.reduce((sum, item) => sum + item.share, 0);
  }, [workspace]);

  const strongestSignal = useMemo(() => {
    if (!workspace || workspace.exposureSignals.length === 0) {
      return null;
    }
    return [...workspace.exposureSignals].sort((left, right) => right.value - left.value)[0];
  }, [workspace]);

  const highestFlow = useMemo(() => {
    if (!workspace || workspace.flowMix.length === 0) {
      return null;
    }
    return [...workspace.flowMix].sort((left, right) => right.count - left.count)[0];
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
          <h1 className="text-2xl font-semibold text-white">Portfolio workspace unavailable</h1>
          <p className="mt-3 text-slate-400">
            The portfolio intelligence surface could not be loaded right now.
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
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(99,102,241,0.24),transparent_40%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.18),transparent_35%)]" />
        <div className="relative flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-4xl">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={badgeVariantForTone(workspace.portfolioHealth.tone)}>
                {workspace.portfolioHealth.tone === 'ready'
                  ? 'Portfolio ready'
                  : workspace.portfolioHealth.tone === 'attention'
                    ? 'Needs balancing'
                    : 'Blocked'}
              </Badge>
              <Badge variant="default">Exposure {formatAmount(workspace.summary.totalExposure)}</Badge>
              <Badge variant="default">Updated {formatTimestamp(workspace.updatedAt)}</Badge>
            </div>

            <p className="mt-4 text-xs uppercase tracking-[0.32em] text-slate-500">Portfolio Workspace</p>
            <h1 className="mt-3 bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-3xl font-bold text-transparent md:text-5xl">
              See how public, private, and market activity are shaping your capital posture
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300 md:text-base">
              This desk turns balances, route readiness, counterparty strength, and recent activity into a usable
              portfolio view so you can decide where to add liquidity, when to move into shielded lanes, and which
              workflow should handle the next adjustment.
            </p>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-400">
              {workspace.portfolioHealth.headline}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 xl:w-[32rem]">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
              <p className="text-xs uppercase tracking-wide text-slate-500">Total exposure</p>
              <p className="mt-2 text-3xl font-semibold text-white">{formatAmount(workspace.summary.totalExposure)}</p>
              <p className="mt-2 text-sm text-slate-400">Public and private balance combined.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
              <p className="text-xs uppercase tracking-wide text-slate-500">Public lane</p>
              <p className="mt-2 text-3xl font-semibold text-white">{formatAmount(workspace.summary.publicExposure)}</p>
              <p className="mt-2 text-sm text-slate-400">Recovery-ready visible capital.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
              <p className="text-xs uppercase tracking-wide text-slate-500">Private lane</p>
              <p className="mt-2 text-3xl font-semibold text-white">{formatAmount(workspace.summary.privateExposure)}</p>
              <p className="mt-2 text-sm text-slate-400">Shielded route capacity and note power.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card variant="glass">
          <div className="flex items-center gap-2 text-slate-200">
            <Wallet className="h-4 w-4 text-cyan-300" />
            <p className="text-xs uppercase tracking-wide text-slate-500">Public vs private</p>
          </div>
          <p className="mt-3 text-3xl font-semibold text-white">
            {workspace.summary.totalExposure > 0
              ? `${formatAmount((workspace.summary.privateExposure / workspace.summary.totalExposure) * 100)}%`
              : '0%'}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Private share of the whole portfolio. Public share is{' '}
            {workspace.summary.totalExposure > 0
              ? `${formatAmount((workspace.summary.publicExposure / workspace.summary.totalExposure) * 100)}%`
              : '0%'}
            .
          </p>
        </Card>
        <Card variant="glass">
          <div className="flex items-center gap-2 text-slate-200">
            <Target className="h-4 w-4 text-emerald-300" />
            <p className="text-xs uppercase tracking-wide text-slate-500">Primary signal</p>
          </div>
          <p className="mt-3 text-3xl font-semibold text-white">
            {strongestSignal ? formatCompact(strongestSignal.value) : '0'}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            {strongestSignal
              ? `${strongestSignal.label} is currently the strongest portfolio signal.`
              : 'No strong signal is available yet.'}
          </p>
        </Card>
        <Card variant="glass">
          <div className="flex items-center gap-2 text-slate-200">
            <Activity className="h-4 w-4 text-violet-300" />
            <p className="text-xs uppercase tracking-wide text-slate-500">Activity mix</p>
          </div>
          <p className="mt-3 text-3xl font-semibold text-white">{highestFlow ? highestFlow.count : 0}</p>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            {highestFlow
              ? `${highestFlow.label} is the heaviest activity lane right now.`
              : 'No flow has started dominating yet.'}
          </p>
        </Card>
        <Card variant="glass">
          <div className="flex items-center gap-2 text-slate-200">
            <Compass className="h-4 w-4 text-amber-300" />
            <p className="text-xs uppercase tracking-wide text-slate-500">Allocation coverage</p>
          </div>
          <p className="mt-3 text-3xl font-semibold text-white">{formatAmount(totalAllocationShare)}%</p>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Rounded allocation coverage across public/private USDC and XLM lanes.
          </p>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.12fr_0.88fr]">
        <Card variant="neon">
          <div className="mb-5 flex items-center gap-2">
            <PieChart className="h-5 w-5 text-indigo-300" />
            <h2 className="text-xl font-semibold text-white">Allocation board</h2>
          </div>
          <div className="space-y-4">
            {workspace.allocation.map((item) => (
              <div key={item.id} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-lg font-semibold text-white">{item.label}</p>
                      <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${lanePillClass(item.lane)}`}>
                        {item.lane}
                      </span>
                      <Badge variant="default">{item.asset}</Badge>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-400">
                      {item.lane === 'private'
                        ? 'This capital is already in shielded form and supports private routing more naturally.'
                        : 'This capital remains visible and is easiest to use for direct public wallet operations.'}
                    </p>
                  </div>
                  <div className="grid gap-2 text-right">
                    <p className="text-2xl font-semibold text-white">{formatAmount(item.amount)}</p>
                    <p className="text-sm text-slate-400">{formatAmount(item.share)}% of total portfolio</p>
                  </div>
                </div>
                <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-900">
                  <div
                    className={`h-full rounded-full bg-gradient-to-r ${allocationBarClass(item.id)}`}
                    style={{ width: `${Math.max(item.share, item.amount > 0 ? 4 : 0)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card variant="glass">
          <div className="mb-5 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-emerald-300" />
            <h2 className="text-xl font-semibold text-white">Portfolio posture</h2>
          </div>
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Balance headline</p>
              <p className="mt-3 text-sm leading-7 text-slate-300">{deriveBalanceHeadline(workspace.summary)}</p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Flow headline</p>
              <p className="mt-3 text-sm leading-7 text-slate-300">{deriveFlowHeadline(workspace.flowMix)}</p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Stablecoin position</p>
              <p className="mt-3 text-sm leading-7 text-slate-300">
                USDC exposure is {formatAmount(workspace.summary.totalUsdc)} while XLM exposure is{' '}
                {formatAmount(workspace.summary.totalXlm)}. This matters because stablecoin-heavy portfolios tend to
                support swaps and fiat routing better, while XLM-heavy portfolios are easier to fund and recover.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Relationship strength</p>
              <p className="mt-3 text-sm leading-7 text-slate-300">
                Counterparty strength is currently{' '}
                <span className="font-semibold text-white">
                  {deriveStrengthLabel(
                    workspace.exposureSignals.find((item) => item.id === 'counterparty_strength')?.value ?? 0,
                  )}
                </span>
                , which affects how safely the portfolio can reuse known send routes instead of starting from a cold
                path.
              </p>
            </div>
          </div>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.94fr_1.06fr]">
        <Card variant="glass">
          <div className="mb-5 flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-cyan-300" />
            <h2 className="text-xl font-semibold text-white">Exposure signals</h2>
          </div>
          <div className="space-y-4">
            {workspace.exposureSignals.map((signal) => (
              <div key={signal.id} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-white">{signal.label}</p>
                  <Badge variant="default">{formatCompact(signal.value)}</Badge>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-900">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-indigo-400 via-cyan-300 to-emerald-300"
                    style={{ width: `${Math.min(Math.max(signal.value, 0), 100)}%` }}
                  />
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-400">{signal.detail}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card variant="glass">
          <div className="mb-5 flex items-center gap-2">
            <Shield className="h-5 w-5 text-emerald-300" />
            <h2 className="text-xl font-semibold text-white">Route readiness and risk</h2>
          </div>
          <div className="space-y-4">
            {workspace.routeRisk.map((item) => (
              <div key={item.id} className={`rounded-2xl border p-4 ${toneRingClass(item.tone)}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-white">{item.label}</p>
                  <Badge variant={badgeVariantForTone(item.tone)}>{item.tone}</Badge>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-300">{item.detail}</p>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.02fr_0.98fr]">
        <Card variant="glass">
          <div className="mb-5 flex items-center gap-2">
            <Layers3 className="h-5 w-5 text-violet-300" />
            <h2 className="text-xl font-semibold text-white">Activity composition</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {workspace.flowMix.map((item) => {
              const share =
                workspace.flowMix.reduce((sum, entry) => sum + entry.count, 0) > 0
                  ? (item.count / workspace.flowMix.reduce((sum, entry) => sum + entry.count, 0)) * 100
                  : 0;
              return (
                <div key={item.label} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-white">{item.label}</p>
                    <Badge variant="default">{item.count}</Badge>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-900">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-fuchsia-400 via-violet-300 to-indigo-200"
                      style={{ width: `${Math.max(share, item.count > 0 ? 6 : 0)}%` }}
                    />
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-400">
                    {share > 0
                      ? `${formatAmount(share)}% of the tracked activity mix currently comes from ${item.label.toLowerCase()} flow.`
                      : `${item.label} has not contributed meaningfully to the tracked mix yet.`}
                  </p>
                </div>
              );
            })}
          </div>
        </Card>

        <Card variant="glass">
          <div className="mb-5 flex items-center gap-2">
            <Target className="h-5 w-5 text-amber-300" />
            <h2 className="text-xl font-semibold text-white">Rebalance ideas</h2>
          </div>
          <div className="space-y-3">
            {workspace.rebalanceIdeas.length === 0 ? (
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm leading-6 text-slate-400">
                The portfolio is not surfacing any obvious rebalance ideas right now. That usually means the wallet has
                enough funding, route diversity, and operational freshness for the current usage level.
              </div>
            ) : (
              workspace.rebalanceIdeas.map((item) => (
                <div key={item} className="flex items-start gap-3 rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                  <p className="text-sm leading-6 text-slate-300">{item}</p>
                </div>
              ))
            )}
          </div>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.96fr_1.04fr]">
        <Card variant="neon">
          <div className="mb-5 flex items-center gap-2">
            <Compass className="h-5 w-5 text-indigo-300" />
            <h2 className="text-xl font-semibold text-white">Workspace handoff map</h2>
          </div>
          <div className="space-y-4">
            {workspace.actionLinks.map((link) => (
              <Link
                key={link.id}
                href={link.href}
                className="block rounded-2xl border border-slate-800 bg-slate-950/70 p-4 transition hover:border-indigo-500/30 hover:bg-slate-900"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-white">{link.label}</p>
                      <Badge variant={badgeVariantForTone(link.tone)}>{link.tone}</Badge>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-400">{link.detail}</p>
                  </div>
                  <ArrowRight className="mt-1 h-4 w-4 text-slate-500" />
                </div>
              </Link>
            ))}
          </div>
        </Card>

        <Card variant="glass">
          <div className="mb-5 flex items-center gap-2">
            <Eye className="h-5 w-5 text-sky-300" />
            <h2 className="text-xl font-semibold text-white">Recent portfolio drivers</h2>
          </div>
          <div className="space-y-3">
            {workspace.recentTitles.length === 0 ? (
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm leading-6 text-slate-400">
                No recent drivers are available yet. Once sends, swaps, deposits, or recovery actions happen, this area
                will show what most recently moved the portfolio.
              </div>
            ) : (
              workspace.recentTitles.map((title, index) => (
                <div key={`${title}-${index}`} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-indigo-500/20 bg-indigo-500/10 text-xs font-semibold text-indigo-200">
                        {index + 1}
                      </div>
                      <p className="truncate text-sm font-medium text-white">{title}</p>
                    </div>
                    <Badge variant="default">signal</Badge>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.04fr_0.96fr]">
        <Card variant="glass">
          <div className="mb-5 flex items-center gap-2">
            <Globe className="h-5 w-5 text-cyan-300" />
            <h2 className="text-xl font-semibold text-white">Portfolio interpretation</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Visible operating lane</p>
              <p className="mt-3 text-sm leading-7 text-slate-300">
                Public balances are still the easiest way to recover, fund trustlines, and execute simple wallet sends.
                If this lane is too small, the whole portfolio feels fragile when a user needs immediate visible
                settlement.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Shielded operating lane</p>
              <p className="mt-3 text-sm leading-7 text-slate-300">
                Private balances are what unlock the product’s differentiated behavior. Without them, the portfolio may
                still work, but it is not yet exercising the strongest privacy surfaces.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Counterparty leverage</p>
              <p className="mt-3 text-sm leading-7 text-slate-300">
                Known counterparties reduce route uncertainty. A portfolio with strong relationship data can choose more
                confidently between public and private sends instead of guessing every time.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Operational freshness</p>
              <p className="mt-3 text-sm leading-7 text-slate-300">
                Indexer and ops freshness shape how honest the portfolio feels. Even a funded wallet can feel wrong if
                lag hides notes, pending withdrawals, or recent transaction outcomes.
              </p>
            </div>
          </div>
        </Card>

        <Card variant="glass">
          <div className="mb-5 flex items-center gap-2">
            <ExternalLink className="h-5 w-5 text-slate-300" />
            <h2 className="text-xl font-semibold text-white">Shortcuts</h2>
          </div>
          <div className="space-y-3">
            <Link
              href="/wallet"
              className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-950/70 p-4 transition hover:border-indigo-500/30 hover:bg-slate-900"
            >
              <div>
                <p className="text-sm font-semibold text-white">Open wallet workspace</p>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Move funds between public and private lanes or process pending withdrawals.
                </p>
              </div>
              <ArrowRight className="h-4 w-4 text-slate-500" />
            </Link>
            <Link
              href="/swap"
              className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-950/70 p-4 transition hover:border-indigo-500/30 hover:bg-slate-900"
            >
              <div>
                <p className="text-sm font-semibold text-white">Open market workspace</p>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Use this when the next portfolio move depends on liquidity, pair discovery, or offer flow.
                </p>
              </div>
              <ArrowRight className="h-4 w-4 text-slate-500" />
            </Link>
            <Link
              href="/status"
              className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-950/70 p-4 transition hover:border-indigo-500/30 hover:bg-slate-900"
            >
              <div>
                <p className="text-sm font-semibold text-white">Open status workspace</p>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Check health, freshness, and remediation signals when the portfolio looks out of date.
                </p>
              </div>
              <ArrowRight className="h-4 w-4 text-slate-500" />
            </Link>
            {workspace.user.stellarPublicKey && (
              <a
                href={`https://stellar.expert/explorer/testnet/account/${workspace.user.stellarPublicKey}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-950/70 p-4 transition hover:border-indigo-500/30 hover:bg-slate-900"
              >
                <div>
                  <p className="text-sm font-semibold text-white">View account on Stellar Explorer</p>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    Cross-check visible account posture directly on the network explorer.
                  </p>
                </div>
                <ExternalLink className="h-4 w-4 text-slate-500" />
              </a>
            )}
          </div>
        </Card>
      </section>

      <section className="flex flex-col gap-4 rounded-[28px] border border-slate-800 bg-slate-950/80 p-6 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Next move</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Take the portfolio to the right workspace</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            If capital posture looks balanced, move into send, swap, or fiat execution. If not, use funding, wallet,
            or action-center flows to improve route strength before adding more activity.
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
          <Link href="/actions">
            <Button>
              Action Center
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </section>
    </main>
  );
}
