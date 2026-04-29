'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  Database,
  ExternalLink,
  Gauge,
  Layers3,
  RefreshCw,
  Shield,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  TriangleAlert,
  Wallet,
  Wrench,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api';

interface StatusWorkspace {
  health: {
    status: string;
    service: string;
    timestamp: string;
  };
  readiness: {
    status: 'ready' | 'degraded';
    dependencies: {
      mongodb: string;
      indexer: string;
    };
    counts: {
      users: number;
      trackedPools: number;
    };
    lagging: Array<{
      poolAddress: string;
      status: string;
      lastProcessedLedger: number;
      lastSuccessfulSyncAt?: string;
      lastError?: string;
    }>;
    timestamp: string;
  };
  stats: {
    users?: {
      total?: number;
      active24h?: number;
    };
    flows?: {
      swaps?: number;
      openOffers?: number;
      encryptedNotes?: number;
      pendingWithdrawals?: number;
      auditedTransactions?: number;
    };
    indexer?: {
      commitments?: number;
      pools?: Array<{
        network: string;
        poolAddress: string;
        lastProcessedLedger: number;
        lastSuccessfulSyncAt?: string;
        eventCount?: number;
        commitmentCount?: number;
        status: string;
        lastError?: string;
      }>;
    };
  };
  alertSummary: Array<{
    severity: 'info' | 'warning' | 'critical';
    title: string;
    detail: string;
  }>;
  activitySummary: {
    recentFailures: number;
    sponsoredCount: number;
    swapAuditCount: number;
    walletAuditCount: number;
    recentAudits: Array<{
      operation?: string;
      state?: string;
      txHash?: string;
      error?: string;
      indexingStatus?: string;
      indexingDetail?: string;
      sponsorshipAttempted?: boolean;
      sponsored?: boolean;
      createdAt?: string;
      metadata?: Record<string, unknown>;
    }>;
  };
  dependencyBoard: Array<{
    id: string;
    label: string;
    status: 'healthy' | 'degraded' | 'critical';
    summary: string;
    metrics: Array<{
      label: string;
      value: string;
    }>;
  }>;
  remediationBoard: Array<{
    id: string;
    severity: 'critical' | 'warning' | 'info';
    title: string;
    detail: string;
    owner: string;
    destination: string;
    signals: string[];
  }>;
  throughputBoard: {
    adoption: {
      users: number;
      active24h: number;
      openOffers: number;
      swaps: number;
    };
    privacyFlow: {
      encryptedNotes: number;
      pendingWithdrawals: number;
      commitments: number;
      events: number;
    };
    auditFlow: {
      total: number;
      recentFailures: number;
      walletAudits: number;
      swapAudits: number;
      sponsored: number;
    };
  };
  routeHealth: Array<{
    id: string;
    label: string;
    tone: 'critical' | 'warning' | 'healthy' | 'info';
    summary: string;
  }>;
  incidentFeed: Array<{
    id: string;
    severity: 'critical' | 'warning' | 'info';
    title: string;
    detail: string;
    source: string;
    createdAt?: string;
  }>;
  poolSummaries: Array<{
    network: string;
    poolAddress: string;
    status: string;
    lastProcessedLedger: number;
    lastSuccessfulSyncAt?: string;
    eventCount: number;
    commitmentCount: number;
    lastError?: string;
  }>;
  laggingPools: Array<{
    poolAddress: string;
    status: string;
    lastProcessedLedger: number;
    lastSuccessfulSyncAt?: string;
    lastError?: string;
  }>;
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
  if (value === 'critical' || value === 'failed') {
    return 'error' as const;
  }
  if (value === 'warning' || value === 'degraded' || value === 'retryable' || value === 'pending') {
    return 'warning' as const;
  }
  if (value === 'healthy' || value === 'success' || value === 'ready') {
    return 'success' as const;
  }
  return 'default' as const;
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

export default function StatusPage() {
  const [workspace, setWorkspace] = useState<StatusWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchWorkspace = async (showRefresh = false) => {
    if (showRefresh) {
      setRefreshing(true);
    }
    try {
      const response = await fetch(`${API_URL}/status/workspace`, { credentials: 'include' });
      const data = await response.json().catch(() => null);
      setWorkspace(response.ok ? data : null);
    } catch (error) {
      console.error('[StatusPage] Failed to load status workspace', error);
      setWorkspace(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchWorkspace();
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      fetchWorkspace();
    }, 15000);
    return () => window.clearInterval(interval);
  }, []);

  const headline = useMemo(() => {
    if (!workspace) {
      return {
        label: 'Unavailable',
        detail: 'The operations cockpit could not be loaded.',
      };
    }
    return workspace.readiness.status === 'ready'
      ? {
          label: 'Healthy operating band',
          detail:
            'Dependencies, queue pressure, and route health are all sitting within a normal range for the current workspace.',
        }
      : {
          label: 'Remediation recommended',
          detail:
            'At least one dependency, queue, or route is drifting out of the healthy band and deserves operator attention.',
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
          <XCircle className="mx-auto mb-4 h-12 w-12 text-red-400" />
          <h1 className="text-2xl font-semibold text-white">Operations cockpit unavailable</h1>
          <p className="mt-3 text-slate-400">
            The enriched status workspace could not be loaded from the backend.
          </p>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl space-y-8 p-4 md:p-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Operations Cockpit</p>
          <h1 className="mt-2 bg-gradient-to-r from-white to-slate-400 bg-clip-text text-3xl font-bold text-transparent">
            System status with remediation paths
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">{headline.detail}</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={workspace.readiness.status === 'ready' ? 'success' : 'warning'}>
            {headline.label}
          </Badge>
          <Button variant="ghost" onClick={() => fetchWorkspace(true)}>
            <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-4">
        <MetricCard
          title="Readiness"
          value={workspace.readiness.status}
          detail={`${workspace.readiness.counts.trackedPools} tracked pools, ${workspace.laggingPools.length} lagging`}
          icon={<Gauge className="h-5 w-5" />}
        />
        <MetricCard
          title="Active Users"
          value={String(workspace.throughputBoard.adoption.active24h)}
          detail={`${workspace.throughputBoard.adoption.users} total users tracked by the current stats surface.`}
          icon={<TrendingUp className="h-5 w-5" />}
        />
        <MetricCard
          title="Pending Queue"
          value={String(workspace.throughputBoard.privacyFlow.pendingWithdrawals)}
          detail="Withdrawal backlog that can make balances and history feel stale."
          icon={<Wallet className="h-5 w-5" />}
        />
        <MetricCard
          title="Recent Failures"
          value={String(workspace.throughputBoard.auditFlow.recentFailures)}
          detail={`${workspace.throughputBoard.auditFlow.sponsored} sponsored events in the same recent window.`}
          icon={<ShieldAlert className="h-5 w-5" />}
        />
      </section>

      <section className="grid gap-6 lg:grid-cols-[0.98fr_1.02fr]">
        <Card variant="neon">
          <div className="mb-4 flex items-center gap-2">
            <Wrench className="h-5 w-5 text-indigo-300" />
            <h2 className="text-xl font-semibold text-white">Remediation board</h2>
          </div>
          <div className="space-y-3">
            {workspace.remediationBoard.map((item) => (
              <div
                key={item.id}
                className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4"
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={variantFor(item.severity)}>{item.severity}</Badge>
                      <Badge variant="default">{item.owner}</Badge>
                    </div>
                    <h3 className="mt-3 text-lg font-semibold text-white">{item.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-400">{item.detail}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {item.signals.map((signal) => (
                        <Badge key={signal} variant="default">
                          {signal}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <Link
                    href={item.destination}
                    className="inline-flex items-center rounded-xl border border-indigo-500/20 bg-indigo-500/10 px-4 py-2 text-sm text-indigo-200 transition-colors hover:bg-indigo-500/20"
                  >
                    Open
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card variant="glass">
          <div className="mb-4 flex items-center gap-2">
            <TriangleAlert className="h-5 w-5 text-rose-300" />
            <h2 className="text-xl font-semibold text-white">Incident feed</h2>
          </div>
          <div className="space-y-3">
            {workspace.incidentFeed.length === 0 ? (
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-500">
                No incidents are currently staged.
              </div>
            ) : (
              workspace.incidentFeed.map((incident) => (
                <div
                  key={incident.id}
                  className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={variantFor(incident.severity)}>{incident.severity}</Badge>
                    <Badge variant="default">{incident.source}</Badge>
                  </div>
                  <h3 className="mt-3 text-base font-semibold text-white">{incident.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-400">{incident.detail}</p>
                  <p className="mt-3 text-xs text-slate-500">
                    {formatTimestamp(incident.createdAt)}
                  </p>
                </div>
              ))
            )}
          </div>
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-[0.52fr_0.48fr]">
        <Card variant="glass">
          <div className="mb-4 flex items-center gap-2">
            <Database className="h-5 w-5 text-cyan-300" />
            <h2 className="text-xl font-semibold text-white">Dependency board</h2>
          </div>
          <div className="space-y-3">
            {workspace.dependencyBoard.map((dependency) => (
              <div
                key={dependency.id}
                className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-white">{dependency.label}</p>
                  <Badge variant={variantFor(dependency.status)}>{dependency.status}</Badge>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-400">{dependency.summary}</p>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {dependency.metrics.map((metric) => (
                    <div
                      key={metric.label}
                      className="rounded-xl border border-slate-800 bg-slate-900/60 p-3"
                    >
                      <p className="text-xs uppercase tracking-wide text-slate-500">
                        {metric.label}
                      </p>
                      <p className="mt-1 text-sm font-medium text-white">{metric.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card variant="glass">
          <div className="mb-4 flex items-center gap-2">
            <Shield className="h-5 w-5 text-indigo-300" />
            <h2 className="text-xl font-semibold text-white">Route health</h2>
          </div>
          <div className="space-y-3">
            {workspace.routeHealth.map((route) => (
              <div
                key={route.id}
                className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-white">{route.label}</p>
                  <Badge variant={variantFor(route.tone)}>{route.tone}</Badge>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-400">{route.summary}</p>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-[0.56fr_0.44fr]">
        <Card variant="glass">
          <div className="mb-4 flex items-center gap-2">
            <Activity className="h-5 w-5 text-amber-300" />
            <h2 className="text-xl font-semibold text-white">Throughput board</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Adoption</p>
              <p className="mt-2 text-sm text-slate-300">
                {workspace.throughputBoard.adoption.users} users
              </p>
              <p className="mt-1 text-sm text-slate-300">
                {workspace.throughputBoard.adoption.active24h} active in 24h
              </p>
              <p className="mt-1 text-sm text-slate-300">
                {workspace.throughputBoard.adoption.openOffers} open offers
              </p>
              <p className="mt-1 text-sm text-slate-300">
                {workspace.throughputBoard.adoption.swaps} swaps
              </p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Privacy flow</p>
              <p className="mt-2 text-sm text-slate-300">
                {workspace.throughputBoard.privacyFlow.encryptedNotes} encrypted notes
              </p>
              <p className="mt-1 text-sm text-slate-300">
                {workspace.throughputBoard.privacyFlow.pendingWithdrawals} pending withdrawals
              </p>
              <p className="mt-1 text-sm text-slate-300">
                {workspace.throughputBoard.privacyFlow.commitments} commitments
              </p>
              <p className="mt-1 text-sm text-slate-300">
                {workspace.throughputBoard.privacyFlow.events} events
              </p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Audit flow</p>
              <p className="mt-2 text-sm text-slate-300">
                {workspace.throughputBoard.auditFlow.total} total audits
              </p>
              <p className="mt-1 text-sm text-slate-300">
                {workspace.throughputBoard.auditFlow.recentFailures} recent failures
              </p>
              <p className="mt-1 text-sm text-slate-300">
                {workspace.throughputBoard.auditFlow.walletAudits} wallet audits
              </p>
              <p className="mt-1 text-sm text-slate-300">
                {workspace.throughputBoard.auditFlow.swapAudits} swap audits
              </p>
            </div>
          </div>
        </Card>

        <Card variant="glass">
          <div className="mb-4 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-indigo-300" />
            <h2 className="text-xl font-semibold text-white">Alert summary</h2>
          </div>
          <div className="space-y-3">
            {workspace.alertSummary.map((alert) => (
              <div
                key={`${alert.severity}-${alert.title}`}
                className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-white">{alert.title}</p>
                  <Badge variant={variantFor(alert.severity)}>{alert.severity}</Badge>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-400">{alert.detail}</p>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-[0.58fr_0.42fr]">
        <Card variant="glass">
          <div className="mb-4 flex items-center gap-2">
            <Layers3 className="h-5 w-5 text-emerald-300" />
            <h2 className="text-xl font-semibold text-white">Pool summaries</h2>
          </div>
          <div className="space-y-3">
            {workspace.poolSummaries.map((pool) => (
              <div
                key={`${pool.network}-${pool.poolAddress}`}
                className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4"
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-white">
                        {pool.poolAddress.slice(0, 10)}...{pool.poolAddress.slice(-6)}
                      </p>
                      <Badge variant={pool.status === 'healthy' ? 'success' : 'warning'}>
                        {pool.status}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs uppercase tracking-wide text-slate-500">
                      {pool.network}
                    </p>
                  </div>
                  <a
                    href={`https://stellar.expert/explorer/testnet/contract/${pool.poolAddress}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center text-xs text-indigo-300 hover:text-indigo-200"
                  >
                    Open explorer
                    <ExternalLink className="ml-1 h-3.5 w-3.5" />
                  </a>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Ledger</p>
                    <p className="mt-1 text-sm font-medium text-white">
                      {pool.lastProcessedLedger}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Events</p>
                    <p className="mt-1 text-sm font-medium text-white">{pool.eventCount}</p>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Commitments</p>
                    <p className="mt-1 text-sm font-medium text-white">{pool.commitmentCount}</p>
                  </div>
                </div>
                <p className="mt-3 text-xs text-slate-400">
                  Last successful sync: {formatTimestamp(pool.lastSuccessfulSyncAt)}
                </p>
                {pool.lastError && <p className="mt-2 text-xs text-yellow-200">{pool.lastError}</p>}
              </div>
            ))}
          </div>
        </Card>

        <Card variant="glass">
          <div className="mb-4 flex items-center gap-2">
            <BadgeCheck className="h-5 w-5 text-cyan-300" />
            <h2 className="text-xl font-semibold text-white">Recent audit stream</h2>
          </div>
          <div className="space-y-3">
            {workspace.activitySummary.recentAudits.slice(0, 8).map((audit, index) => (
              <div
                key={`${audit.operation}-${audit.createdAt}-${index}`}
                className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-white">
                    {String(audit.operation ?? 'unknown').replaceAll('_', ' ')}
                  </p>
                  <Badge variant={variantFor(audit.state ?? 'pending')}>
                    {String(audit.state ?? 'pending')}
                  </Badge>
                </div>
                <p className="mt-2 text-xs text-slate-500">{formatTimestamp(audit.createdAt)}</p>
                {audit.indexingDetail && (
                  <p className="mt-2 text-sm leading-6 text-slate-400">{audit.indexingDetail}</p>
                )}
                {audit.error && <p className="mt-2 text-sm text-red-300">{audit.error}</p>}
              </div>
            ))}
          </div>
        </Card>
      </section>

      <div className="flex flex-wrap items-center gap-4">
        <Link href="/dashboard">
          <Button variant="ghost">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Dashboard
          </Button>
        </Link>
        <Link href="/actions">
          <Button variant="ghost">
            <Wrench className="mr-2 h-4 w-4" />
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
