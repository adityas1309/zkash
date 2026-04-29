'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Compass,
  Crown,
  ExternalLink,
  Globe,
  Layers3,
  RefreshCw,
  Rocket,
  Shield,
  Sparkles,
  Swords,
  Target,
  TrendingUp,
  Wallet,
  Wrench,
  Zap,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api';

type Tone = 'ready' | 'attention' | 'blocked' | 'info' | 'critical' | 'warning';

interface PlaybookWorkspace {
  user: {
    username?: string;
    stellarPublicKey?: string;
    reputation?: number;
  };
  summary: {
    scenarios: number;
    executable: number;
    blocked: number;
    sponsoredOpportunities: number;
    urgentBlockers: number;
    readyRoutes: number;
  };
  posture: {
    readinessTone: 'ready' | 'attention' | 'blocked';
    capitalShape: string;
    marketShape: string;
    relationshipShape: string;
    riskShape: string;
  };
  routeComparisons: Array<{
    id: string;
    label: string;
    recommended: boolean;
    tone: Tone;
    summary: string;
    nextStep: string;
    sponsorship: {
      id: string;
      operation: string;
      asset: string;
      supported: boolean;
      sponsored: boolean;
      reason: string;
      tone: Tone;
      label: string;
    };
  }>;
  sponsorBoard: Array<{
    id: string;
    operation: string;
    asset: string;
    supported: boolean;
    sponsored: boolean;
    reason: string;
    tone: Tone;
    label: string;
  }>;
  scenarioCards: Array<{
    id: string;
    title: string;
    lane: string;
    tone: Tone;
    destination: string;
    headline: string;
    detail: string;
    status: string;
    requirements: string[];
    blockers: string[];
    steps: string[];
    whyNow: string[];
    metrics: Array<{
      label: string;
      value: string;
    }>;
    recommendation: string;
  }>;
  actionRail: Array<{
    id: string;
    label: string;
    href: string;
    tone: Tone;
    detail: string;
  }>;
  recentSignals: string[];
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
  if (value === 'ready' || value === 'healthy' || value === 'success') {
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

function scenarioIcon(lane: string) {
  if (lane === 'wallet') {
    return <Wallet className="h-5 w-5 text-cyan-300" />;
  }
  if (lane === 'private') {
    return <Shield className="h-5 w-5 text-emerald-300" />;
  }
  if (lane === 'contacts') {
    return <Target className="h-5 w-5 text-indigo-300" />;
  }
  if (lane === 'recovery') {
    return <Wrench className="h-5 w-5 text-amber-300" />;
  }
  return <TrendingUp className="h-5 w-5 text-fuchsia-300" />;
}

function formatOperationLabel(value: string) {
  return value.replaceAll('_', ' ');
}

export default function PlaybookPage() {
  const [workspace, setWorkspace] = useState<PlaybookWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchWorkspace = async (showRefresh = false) => {
    if (showRefresh) {
      setRefreshing(true);
    }

    try {
      const response = await fetch(`${API_URL}/users/playbook/workspace`, {
        credentials: 'include',
      });
      const data = await response.json().catch(() => null);
      setWorkspace(response.ok ? data : null);
    } catch (error) {
      console.error('[PlaybookPage] Failed to load playbook workspace', error);
      setWorkspace(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchWorkspace();
  }, []);

  const topScenario = useMemo(() => {
    if (!workspace || workspace.scenarioCards.length === 0) {
      return null;
    }
    const order: Record<string, number> = {
      blocked: 0,
      attention: 1,
      warning: 1,
      ready: 2,
      info: 3,
      critical: 0,
    };
    return [...workspace.scenarioCards].sort((left, right) => {
      const leftRank = order[left.tone] ?? 99;
      const rightRank = order[right.tone] ?? 99;
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      return left.title.localeCompare(right.title);
    })[0];
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
          <h1 className="text-2xl font-semibold text-white">Playbook unavailable</h1>
          <p className="mt-3 text-slate-400">
            The execution playbook could not be loaded from the backend right now.
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
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,197,94,0.18),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(99,102,241,0.24),transparent_40%)]" />
        <div className="relative flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-4xl">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={variantFor(workspace.posture.readinessTone)}>
                {workspace.posture.readinessTone === 'ready'
                  ? 'Execution-ready'
                  : workspace.posture.readinessTone === 'attention'
                    ? 'Needs shaping'
                    : 'Still blocked'}
              </Badge>
              <Badge variant="default">{workspace.summary.scenarios} scenarios</Badge>
              <Badge variant="default">
                {workspace.summary.sponsoredOpportunities} sponsored opportunities
              </Badge>
              <Badge variant="default">Updated {formatTimestamp(workspace.updatedAt)}</Badge>
            </div>
            <p className="mt-4 text-xs uppercase tracking-[0.32em] text-slate-500">
              Playbook Workspace
            </p>
            <h1 className="mt-3 bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-3xl font-bold text-transparent md:text-5xl">
              Turn balances, route health, and counterparties into concrete next moves
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300 md:text-base">
              This workspace converts current wallet posture into scenario-based strategy. Instead
              of opening six pages and inferring what matters, you get a ranked playbook for
              funding, private seeding, repeat sends, cleanup, and growth routes.
            </p>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-400">
              {topScenario
                ? `${topScenario.title} is currently the strongest scenario to consider next. ${topScenario.recommendation}`
                : 'No scenario is strong enough to recommend yet.'}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 xl:w-[34rem]">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
              <p className="text-xs uppercase tracking-wide text-slate-500">Executable</p>
              <p className="mt-2 text-3xl font-semibold text-white">
                {workspace.summary.executable}
              </p>
              <p className="mt-2 text-sm text-slate-400">
                Scenarios that are already good enough to execute.
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
              <p className="text-xs uppercase tracking-wide text-slate-500">Blocked</p>
              <p className="mt-2 text-3xl font-semibold text-white">{workspace.summary.blocked}</p>
              <p className="mt-2 text-sm text-slate-400">
                Plans still gated by missing capital or readiness.
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
              <p className="text-xs uppercase tracking-wide text-slate-500">Urgent blockers</p>
              <p className="mt-2 text-3xl font-semibold text-white">
                {workspace.summary.urgentBlockers}
              </p>
              <p className="mt-2 text-sm text-slate-400">
                Critical action-center blockers still visible in the account.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card variant="glass">
          <div className="flex items-center gap-2 text-slate-200">
            <Compass className="h-4 w-4 text-cyan-300" />
            <p className="text-xs uppercase tracking-wide text-slate-500">Capital shape</p>
          </div>
          <p className="mt-3 text-2xl font-semibold text-white">{workspace.posture.capitalShape}</p>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Whether the account currently behaves more like a visible wallet, a private wallet, or a
            balanced mix.
          </p>
        </Card>
        <Card variant="glass">
          <div className="flex items-center gap-2 text-slate-200">
            <Swords className="h-4 w-4 text-fuchsia-300" />
            <p className="text-xs uppercase tracking-wide text-slate-500">Market shape</p>
          </div>
          <p className="mt-3 text-2xl font-semibold text-white">{workspace.posture.marketShape}</p>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Whether market routes are still early, active, or carrying follow-up pressure.
          </p>
        </Card>
        <Card variant="glass">
          <div className="flex items-center gap-2 text-slate-200">
            <Target className="h-4 w-4 text-indigo-300" />
            <p className="text-xs uppercase tracking-wide text-slate-500">Relationship shape</p>
          </div>
          <p className="mt-3 text-2xl font-semibold text-white">
            {workspace.posture.relationshipShape}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Whether strategy can lean on known counterparties or still has to behave like a
            cold-start wallet.
          </p>
        </Card>
        <Card variant="glass">
          <div className="flex items-center gap-2 text-slate-200">
            <Wrench className="h-4 w-4 text-amber-300" />
            <p className="text-xs uppercase tracking-wide text-slate-500">Risk shape</p>
          </div>
          <p className="mt-3 text-2xl font-semibold text-white">{workspace.posture.riskShape}</p>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Whether the playbook should bias toward growth or cleanup before the next route.
          </p>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
        <Card variant="neon">
          <div className="mb-5 flex items-center gap-2">
            <Rocket className="h-5 w-5 text-indigo-300" />
            <h2 className="text-xl font-semibold text-white">Scenario deck</h2>
          </div>
          <div className="space-y-5">
            {workspace.scenarioCards.map((scenario) => (
              <div
                key={scenario.id}
                className={`rounded-[28px] border p-5 ${tonePanelClass(scenario.tone)}`}
              >
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex rounded-2xl border border-white/10 bg-slate-950/60 p-2">
                        {scenarioIcon(scenario.lane)}
                      </span>
                      <p className="text-xl font-semibold text-white">{scenario.title}</p>
                      <Badge variant={variantFor(scenario.tone)}>{scenario.tone}</Badge>
                      <Badge variant="default">{scenario.lane}</Badge>
                    </div>
                    <p className="mt-4 text-sm font-medium text-slate-200">{scenario.headline}</p>
                    <p className="mt-3 text-sm leading-7 text-slate-300">{scenario.detail}</p>
                    <p className="mt-3 text-sm leading-6 text-slate-400">
                      <span className="font-semibold text-slate-200">Current status:</span>{' '}
                      {scenario.status}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-3">
                    <Link href={scenario.destination}>
                      <Button>
                        Open workspace
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    </Link>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-4">
                  {scenario.metrics.map((metric) => (
                    <div
                      key={`${scenario.id}-${metric.label}`}
                      className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3"
                    >
                      <p className="text-xs uppercase tracking-wide text-slate-500">
                        {metric.label}
                      </p>
                      <p className="mt-2 text-lg font-semibold text-white">{metric.value}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-5 grid gap-4 xl:grid-cols-2">
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                    <div className="flex items-center gap-2">
                      <Crown className="h-4 w-4 text-emerald-300" />
                      <p className="text-sm font-semibold text-white">Requirements</p>
                    </div>
                    <div className="mt-3 space-y-3">
                      {scenario.requirements.map((item) => (
                        <div key={item} className="flex items-start gap-3">
                          <Sparkles className="mt-1 h-4 w-4 shrink-0 text-emerald-300" />
                          <p className="text-sm leading-6 text-slate-300">{item}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-300" />
                      <p className="text-sm font-semibold text-white">Blockers</p>
                    </div>
                    <div className="mt-3 space-y-3">
                      {scenario.blockers.length === 0 ? (
                        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-200">
                          No meaningful blockers are visible right now.
                        </div>
                      ) : (
                        scenario.blockers.map((item) => (
                          <div key={item} className="flex items-start gap-3">
                            <AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-amber-300" />
                            <p className="text-sm leading-6 text-slate-300">{item}</p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-5 grid gap-4 xl:grid-cols-2">
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                    <div className="flex items-center gap-2">
                      <Zap className="h-4 w-4 text-cyan-300" />
                      <p className="text-sm font-semibold text-white">Execution steps</p>
                    </div>
                    <div className="mt-3 space-y-3">
                      {scenario.steps.map((item, index) => (
                        <div key={item} className="flex items-start gap-3">
                          <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-cyan-500/30 bg-cyan-500/10 text-xs font-semibold text-cyan-200">
                            {index + 1}
                          </div>
                          <p className="text-sm leading-6 text-slate-300">{item}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-fuchsia-300" />
                      <p className="text-sm font-semibold text-white">Why now</p>
                    </div>
                    <div className="mt-3 space-y-3">
                      {scenario.whyNow.map((item) => (
                        <div key={item} className="flex items-start gap-3">
                          <Rocket className="mt-1 h-4 w-4 shrink-0 text-fuchsia-300" />
                          <p className="text-sm leading-6 text-slate-300">{item}</p>
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 rounded-2xl border border-indigo-500/20 bg-indigo-500/10 p-4">
                      <p className="text-xs uppercase tracking-wide text-indigo-200">
                        Recommendation
                      </p>
                      <p className="mt-2 text-sm leading-6 text-slate-200">
                        {scenario.recommendation}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <div className="space-y-6">
          <Card variant="glass">
            <div className="mb-4 flex items-center gap-2">
              <Layers3 className="h-5 w-5 text-cyan-300" />
              <h2 className="text-xl font-semibold text-white">Route comparisons</h2>
            </div>
            <div className="space-y-4">
              {workspace.routeComparisons.map((item) => (
                <div
                  key={item.id}
                  className={`rounded-2xl border p-4 ${tonePanelClass(item.tone)}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-white">{item.label}</p>
                    <Badge variant={variantFor(item.tone)}>{item.tone}</Badge>
                    {item.recommended && <Badge variant="success">recommended</Badge>}
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-300">{item.summary}</p>
                  <p className="mt-3 text-sm leading-6 text-slate-400">
                    <span className="font-semibold text-slate-200">Next step:</span> {item.nextStep}
                  </p>
                  <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={variantFor(item.sponsorship.tone)}>
                        {item.sponsorship.tone}
                      </Badge>
                      <p className="text-sm font-medium text-white">{item.sponsorship.label}</p>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-400">
                      {item.sponsorship.reason}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card variant="glass">
            <div className="mb-4 flex items-center gap-2">
              <Shield className="h-5 w-5 text-emerald-300" />
              <h2 className="text-xl font-semibold text-white">Sponsorship map</h2>
            </div>
            <div className="space-y-3">
              {workspace.sponsorBoard.map((item) => (
                <div
                  key={item.id}
                  className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={variantFor(item.tone)}>{item.tone}</Badge>
                    <p className="text-sm font-semibold text-white">
                      {formatOperationLabel(item.operation)} {item.asset}
                    </p>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-400">{item.reason}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
        <Card variant="glass">
          <div className="mb-4 flex items-center gap-2">
            <Activity className="h-5 w-5 text-indigo-300" />
            <h2 className="text-xl font-semibold text-white">Recent signals</h2>
          </div>
          <div className="space-y-3">
            {workspace.recentSignals.map((item) => (
              <div
                key={item}
                className="flex items-start gap-3 rounded-2xl border border-slate-800 bg-slate-950/70 p-4"
              >
                <Sparkles className="mt-1 h-4 w-4 shrink-0 text-indigo-300" />
                <p className="text-sm leading-6 text-slate-300">{item}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card variant="glass">
          <div className="mb-4 flex items-center gap-2">
            <Compass className="h-5 w-5 text-sky-300" />
            <h2 className="text-xl font-semibold text-white">Workspace handoffs</h2>
          </div>
          <div className="space-y-3">
            {workspace.actionRail.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                className="block rounded-2xl border border-slate-800 bg-slate-950/70 p-4 transition hover:border-indigo-500/30 hover:bg-slate-900"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-white">{item.label}</p>
                      <Badge variant={variantFor(item.tone)}>{item.tone}</Badge>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-400">{item.detail}</p>
                  </div>
                  <ArrowRight className="mt-1 h-4 w-4 text-slate-500" />
                </div>
              </Link>
            ))}
          </div>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <Card variant="glass">
          <div className="mb-4 flex items-center gap-2">
            <Globe className="h-5 w-5 text-cyan-300" />
            <h2 className="text-xl font-semibold text-white">How to use this desk</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">
                1. Start with posture
              </p>
              <p className="mt-3 text-sm leading-7 text-slate-300">
                Capital shape, relationship shape, and risk shape tell you whether the account
                should be funding, protecting, reusing counterparties, or cleaning up.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">2. Pick one scenario</p>
              <p className="mt-3 text-sm leading-7 text-slate-300">
                The playbook works best when you commit to one scenario and complete it, instead of
                switching between three half-prepared routes at once.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">3. Respect blockers</p>
              <p className="mt-3 text-sm leading-7 text-slate-300">
                A blocked scenario is not a failure. It is the workspace telling you which
                prerequisite creates the most downstream leverage.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">4. Feed the graph</p>
              <p className="mt-3 text-sm leading-7 text-slate-300">
                Every successful route creates more history, stronger counterparty intelligence, and
                better future recommendations for the same account.
              </p>
            </div>
          </div>
        </Card>

        <Card variant="glass">
          <div className="mb-4 flex items-center gap-2">
            <ExternalLink className="h-5 w-5 text-slate-300" />
            <h2 className="text-xl font-semibold text-white">Fast links</h2>
          </div>
          <div className="space-y-3">
            <Link
              href="/wallet/send"
              className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-950/70 p-4 transition hover:border-indigo-500/30 hover:bg-slate-900"
            >
              <div>
                <p className="text-sm font-semibold text-white">Open send planner</p>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Validate amount, route shape, and sponsorship before sending.
                </p>
              </div>
              <ArrowRight className="h-4 w-4 text-slate-500" />
            </Link>
            <Link
              href="/portfolio"
              className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-950/70 p-4 transition hover:border-indigo-500/30 hover:bg-slate-900"
            >
              <div>
                <p className="text-sm font-semibold text-white">Open portfolio desk</p>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Re-check allocation and exposure before changing the next strategy.
                </p>
              </div>
              <ArrowRight className="h-4 w-4 text-slate-500" />
            </Link>
            <Link
              href="/actions"
              className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-950/70 p-4 transition hover:border-indigo-500/30 hover:bg-slate-900"
            >
              <div>
                <p className="text-sm font-semibold text-white">Open action center</p>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Use this when remediation matters more than growth.
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
                    Cross-check public chain posture outside the app before major moves.
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
            Commit to the next move
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-white">
            Choose one scenario and complete it end-to-end
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            The playbook becomes smarter when each move actually completes. Finish one scenario,
            then return here so the next recommendation is based on real updated posture instead of
            partial intent.
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
          <Link href={topScenario?.destination ?? '/actions'}>
            <Button>
              Open top scenario
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </section>
    </main>
  );
}
