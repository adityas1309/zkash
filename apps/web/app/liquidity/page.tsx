'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Compass,
  Droplets,
  Eye,
  ExternalLink,
  Gauge,
  Layers3,
  Orbit,
  RefreshCw,
  Shield,
  Sparkles,
  TrendingUp,
  Wallet,
  Waves,
  Wrench,
  Zap,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api';

type Tone = 'ready' | 'attention' | 'blocked' | 'info' | 'critical' | 'warning';

interface LiquidityWorkspace {
  user: {
    username?: string;
    stellarPublicKey?: string;
    reputation?: number;
  };
  summary: {
    windows: number;
    readyWindows: number;
    blockedWindows: number;
    routeScoreAverage: number;
    activeUsers: number;
    dryPowder: number;
  };
  capitalSummary: {
    totalCapital: number;
    visibleCapital: number;
    shieldedCapital: number;
    queuedCapital: number;
    dryPowder: number;
  };
  deploymentWindows: Array<{
    id: string;
    label: string;
    tone: Tone;
    availableCapital: number;
    routeCount: number;
    summary: string;
    strongestAsset: string;
    nextMove: string;
  }>;
  capitalLanes: Array<{
    id: string;
    label: string;
    amount: number;
    share: number;
    tone: Tone;
    role: string;
    risk: string;
  }>;
  idleCapitalBoard: Array<{
    id: string;
    label: string;
    tone: Tone;
    amount: number;
    detail: string;
  }>;
  deploymentScenarios: Array<{
    id: string;
    title: string;
    tone: Tone;
    destination: string;
    capital: number;
    summary: string;
    steps: string[];
  }>;
  pressureBoard: Array<{
    id: string;
    label: string;
    tone: Tone;
    value: string;
    detail: string;
  }>;
  actionBoard: Array<{
    id: string;
    severity: 'critical' | 'warning' | 'info';
    title: string;
    detail: string;
    href: string;
  }>;
  routeRadar: Array<{
    id: string;
    label: string;
    tone: Tone;
    score: number;
    detail: string;
  }>;
  outlook: string[];
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
  if (value === 'critical' || value === 'blocked') {
    return 'error' as const;
  }
  if (value === 'warning' || value === 'attention') {
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

function formatAmount(value: number) {
  if (!Number.isFinite(value)) {
    return '0';
  }
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

function laneIcon(id: string) {
  if (id.includes('visible') || id.includes('public')) {
    return <Wallet className="h-5 w-5 text-cyan-300" />;
  }
  if (id.includes('shielded') || id.includes('private')) {
    return <Shield className="h-5 w-5 text-emerald-300" />;
  }
  if (id.includes('market')) {
    return <Orbit className="h-5 w-5 text-fuchsia-300" />;
  }
  return <Gauge className="h-5 w-5 text-amber-300" />;
}

export default function LiquidityPage() {
  const [workspace, setWorkspace] = useState<LiquidityWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchWorkspace = async (showRefresh = false) => {
    if (showRefresh) {
      setRefreshing(true);
    }

    try {
      const response = await fetch(`${API_URL}/users/liquidity/workspace`, {
        credentials: 'include',
      });
      const data = await response.json().catch(() => null);
      setWorkspace(response.ok ? data : null);
    } catch (error) {
      console.error('[LiquidityPage] Failed to load liquidity workspace', error);
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
        detail: 'The liquidity workspace could not be loaded.',
      };
    }
    if (workspace.capitalSummary.totalCapital === 0) {
      return {
        label: 'No deployable capital yet',
        detail:
          'The wallet still needs real liquidity before route quality or deployment choices can matter.',
      };
    }
    if (workspace.capitalSummary.queuedCapital > 0) {
      return {
        label: 'Some capital is still in transit',
        detail:
          'Queued settlement means part of the balance is real but not fully public or redeployable yet.',
      };
    }
    if (workspace.summary.readyWindows >= 3) {
      return {
        label: 'Liquidity posture is healthy',
        detail:
          'Multiple deployment windows are ready, so the account can choose routes based on strategy instead of pure constraint.',
      };
    }
    return {
      label: 'Liquidity posture needs shaping',
      detail:
        'Capital exists, but more of it should be moved into the right lane before the best routes become easy.',
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
          <h1 className="text-2xl font-semibold text-white">Liquidity workspace unavailable</h1>
          <p className="mt-3 text-slate-400">
            The liquidity desk could not be loaded from the backend right now.
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
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(6,182,212,0.18),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(168,85,247,0.16),transparent_38%)]" />
        <div className="relative flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-4xl">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant={variantFor(
                  headline.label.includes('healthy')
                    ? 'ready'
                    : headline.label.includes('transit')
                      ? 'attention'
                      : workspace.capitalSummary.totalCapital > 0
                        ? 'info'
                        : 'blocked',
                )}
              >
                {headline.label}
              </Badge>
              <Badge variant="default">{workspace.summary.readyWindows} ready windows</Badge>
              <Badge variant="default">
                Dry powder {formatAmount(workspace.summary.dryPowder)}
              </Badge>
              <Badge variant="default">Updated {formatTimestamp(workspace.updatedAt)}</Badge>
            </div>
            <p className="mt-4 text-xs uppercase tracking-[0.32em] text-slate-500">
              Liquidity Workspace
            </p>
            <h1 className="mt-3 bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-3xl font-bold text-transparent md:text-5xl">
              See where capital is actually deployable, idle, stuck, or strategically underused
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300 md:text-base">
              This desk answers the practical capital question the other workspaces only imply: what
              money can move now, what should stay visible, what should be shielded, and what is
              real but not truly deployable yet.
            </p>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-400">{headline.detail}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 xl:w-[34rem]">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
              <p className="text-xs uppercase tracking-wide text-slate-500">Total capital</p>
              <p className="mt-2 text-3xl font-semibold text-white">
                {formatAmount(workspace.capitalSummary.totalCapital)}
              </p>
              <p className="mt-2 text-sm text-slate-400">
                All visible and shielded balance combined.
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
              <p className="text-xs uppercase tracking-wide text-slate-500">Queued capital</p>
              <p className="mt-2 text-3xl font-semibold text-white">
                {formatAmount(workspace.capitalSummary.queuedCapital)}
              </p>
              <p className="mt-2 text-sm text-slate-400">
                Value still waiting on settlement clarity.
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
              <p className="text-xs uppercase tracking-wide text-slate-500">Route score</p>
              <p className="mt-2 text-3xl font-semibold text-white">
                {workspace.summary.routeScoreAverage}
              </p>
              <p className="mt-2 text-sm text-slate-400">
                Average deployment strength across route families.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card variant="glass">
          <div className="flex items-center gap-2 text-slate-200">
            <Wallet className="h-4 w-4 text-cyan-300" />
            <p className="text-xs uppercase tracking-wide text-slate-500">Visible capital</p>
          </div>
          <p className="mt-3 text-3xl font-semibold text-white">
            {formatAmount(workspace.capitalSummary.visibleCapital)}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Immediate public deployment, recovery, and fiat-ready liquidity.
          </p>
        </Card>
        <Card variant="glass">
          <div className="flex items-center gap-2 text-slate-200">
            <Shield className="h-4 w-4 text-emerald-300" />
            <p className="text-xs uppercase tracking-wide text-slate-500">Shielded capital</p>
          </div>
          <p className="mt-3 text-3xl font-semibold text-white">
            {formatAmount(workspace.capitalSummary.shieldedCapital)}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Protected route capacity and privacy-native balance posture.
          </p>
        </Card>
        <Card variant="glass">
          <div className="flex items-center gap-2 text-slate-200">
            <Zap className="h-4 w-4 text-fuchsia-300" />
            <p className="text-xs uppercase tracking-wide text-slate-500">Dry powder</p>
          </div>
          <p className="mt-3 text-3xl font-semibold text-white">
            {formatAmount(workspace.capitalSummary.dryPowder)}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Capital that can most realistically answer the next meaningful route.
          </p>
        </Card>
        <Card variant="glass">
          <div className="flex items-center gap-2 text-slate-200">
            <Activity className="h-4 w-4 text-indigo-300" />
            <p className="text-xs uppercase tracking-wide text-slate-500">Active users</p>
          </div>
          <p className="mt-3 text-3xl font-semibold text-white">{workspace.summary.activeUsers}</p>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Current activity signal around the wider system stats surface.
          </p>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.04fr_0.96fr]">
        <Card variant="neon">
          <div className="mb-5 flex items-center gap-2">
            <Compass className="h-5 w-5 text-indigo-300" />
            <h2 className="text-xl font-semibold text-white">Deployment windows</h2>
          </div>
          <div className="space-y-4">
            {workspace.deploymentWindows.map((window) => (
              <div
                key={window.id}
                className={`rounded-[26px] border p-5 ${tonePanelClass(window.tone)}`}
              >
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex rounded-2xl border border-white/10 bg-slate-950/60 p-2">
                        {laneIcon(window.id)}
                      </span>
                      <p className="text-lg font-semibold text-white">{window.label}</p>
                      <Badge variant={variantFor(window.tone)}>{window.tone}</Badge>
                      <Badge variant="default">{window.strongestAsset}</Badge>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-300">{window.summary}</p>
                    <p className="mt-3 text-sm leading-6 text-slate-400">
                      <span className="font-semibold text-slate-200">Next move:</span>{' '}
                      {window.nextMove}
                    </p>
                  </div>
                  <div className="grid gap-2 text-right">
                    <p className="text-2xl font-semibold text-white">
                      {formatAmount(window.availableCapital)}
                    </p>
                    <p className="text-sm text-slate-400">{window.routeCount} route signal(s)</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card variant="glass">
          <div className="mb-5 flex items-center gap-2">
            <Gauge className="h-5 w-5 text-cyan-300" />
            <h2 className="text-xl font-semibold text-white">Route radar</h2>
          </div>
          <div className="space-y-4">
            {workspace.routeRadar.map((item) => (
              <div key={item.id} className={`rounded-2xl border p-4 ${tonePanelClass(item.tone)}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-white">{item.label}</p>
                    <Badge variant={variantFor(item.tone)}>{item.tone}</Badge>
                  </div>
                  <Badge variant="default">{item.score}</Badge>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-900">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-indigo-400 via-cyan-300 to-emerald-300"
                    style={{ width: `${Math.min(Math.max(item.score, 0), 100)}%` }}
                  />
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-300">{item.detail}</p>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.98fr_1.02fr]">
        <Card variant="glass">
          <div className="mb-5 flex items-center gap-2">
            <Waves className="h-5 w-5 text-emerald-300" />
            <h2 className="text-xl font-semibold text-white">Capital lanes</h2>
          </div>
          <div className="space-y-4">
            {workspace.capitalLanes.map((lane) => (
              <div key={lane.id} className={`rounded-2xl border p-4 ${tonePanelClass(lane.tone)}`}>
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-white">{lane.label}</p>
                      <Badge variant={variantFor(lane.tone)}>{lane.tone}</Badge>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-300">{lane.role}</p>
                    <p className="mt-3 text-sm leading-6 text-slate-400">{lane.risk}</p>
                  </div>
                  <div className="grid gap-2 text-right">
                    <p className="text-2xl font-semibold text-white">{formatAmount(lane.amount)}</p>
                    <p className="text-sm text-slate-400">{formatAmount(lane.share)}%</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card variant="glass">
          <div className="mb-5 flex items-center gap-2">
            <Droplets className="h-5 w-5 text-sky-300" />
            <h2 className="text-xl font-semibold text-white">Idle and blocked capital</h2>
          </div>
          <div className="space-y-4">
            {workspace.idleCapitalBoard.map((item) => (
              <div key={item.id} className={`rounded-2xl border p-4 ${tonePanelClass(item.tone)}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-white">{item.label}</p>
                    <Badge variant={variantFor(item.tone)}>{item.tone}</Badge>
                  </div>
                  <Badge variant="default">{formatAmount(item.amount)}</Badge>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-300">{item.detail}</p>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <Card variant="neon">
          <div className="mb-5 flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-indigo-300" />
            <h2 className="text-xl font-semibold text-white">Deployment scenarios</h2>
          </div>
          <div className="space-y-5">
            {workspace.deploymentScenarios.map((scenario) => (
              <div
                key={scenario.id}
                className={`rounded-[26px] border p-5 ${tonePanelClass(scenario.tone)}`}
              >
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-lg font-semibold text-white">{scenario.title}</p>
                      <Badge variant={variantFor(scenario.tone)}>{scenario.tone}</Badge>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-300">{scenario.summary}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-3">
                    <Badge variant="default">{formatAmount(scenario.capital)}</Badge>
                    <Link href={scenario.destination}>
                      <Button>
                        Open desk
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    </Link>
                  </div>
                </div>
                <div className="mt-5 space-y-3">
                  {scenario.steps.map((step, index) => (
                    <div
                      key={step}
                      className="flex items-start gap-3 rounded-2xl border border-slate-800 bg-slate-950/70 p-3"
                    >
                      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-indigo-500/30 bg-indigo-500/10 text-xs font-semibold text-indigo-200">
                        {index + 1}
                      </div>
                      <p className="text-sm leading-6 text-slate-300">{step}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <div className="space-y-6">
          <Card variant="glass">
            <div className="mb-5 flex items-center gap-2">
              <Wrench className="h-5 w-5 text-amber-300" />
              <h2 className="text-xl font-semibold text-white">Pressure board</h2>
            </div>
            <div className="space-y-4">
              {workspace.pressureBoard.map((item) => (
                <div
                  key={item.id}
                  className={`rounded-2xl border p-4 ${tonePanelClass(item.tone)}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-white">{item.label}</p>
                      <Badge variant={variantFor(item.tone)}>{item.tone}</Badge>
                    </div>
                    <Badge variant="default">{item.value}</Badge>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-300">{item.detail}</p>
                </div>
              ))}
            </div>
          </Card>

          <Card variant="glass">
            <div className="mb-5 flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-fuchsia-300" />
              <h2 className="text-xl font-semibold text-white">Action board</h2>
            </div>
            <div className="space-y-3">
              {workspace.actionBoard.length === 0 ? (
                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm leading-6 text-emerald-200">
                  No urgent liquidity action is visible right now. The account can choose routes
                  more freely.
                </div>
              ) : (
                workspace.actionBoard.map((item) => (
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
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.96fr_1.04fr]">
        <Card variant="glass">
          <div className="mb-5 flex items-center gap-2">
            <Eye className="h-5 w-5 text-sky-300" />
            <h2 className="text-xl font-semibold text-white">Liquidity outlook</h2>
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

        <Card variant="glass">
          <div className="mb-5 flex items-center gap-2">
            <ExternalLink className="h-5 w-5 text-slate-300" />
            <h2 className="text-xl font-semibold text-white">Fast links</h2>
          </div>
          <div className="space-y-3">
            <Link
              href="/portfolio"
              className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-950/70 p-4 transition hover:border-indigo-500/30 hover:bg-slate-900"
            >
              <div>
                <p className="text-sm font-semibold text-white">Open portfolio desk</p>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Re-check allocation and public/private posture before moving capital.
                </p>
              </div>
              <ArrowRight className="h-4 w-4 text-slate-500" />
            </Link>
            <Link
              href="/settlement"
              className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-950/70 p-4 transition hover:border-indigo-500/30 hover:bg-slate-900"
            >
              <div>
                <p className="text-sm font-semibold text-white">Open settlement desk</p>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Confirm queued or in-flight capital before counting it as deployable twice.
                </p>
              </div>
              <ArrowRight className="h-4 w-4 text-slate-500" />
            </Link>
            <Link
              href="/playbook"
              className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-950/70 p-4 transition hover:border-indigo-500/30 hover:bg-slate-900"
            >
              <div>
                <p className="text-sm font-semibold text-white">Open playbook</p>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Translate liquidity posture into actual scenario-based next steps.
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
                  <p className="text-sm font-semibold text-white">
                    View account on Stellar Explorer
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    Cross-check visible account liquidity directly on-chain.
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
          <p className="text-xs uppercase tracking-[0.28em] text-slate-500">
            Use this desk when the question is deployability
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-white">
            Confirm what capital is actually free to move next
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            This is the workspace for the moments when balances exist but route choice is still
            unclear because some value is queued, over-visible, over-private, or simply underused.
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
          <Link href={workspace.actionBoard[0]?.href ?? '/playbook'}>
            <Button>
              Open top liquidity action
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </section>
    </main>
  );
}
