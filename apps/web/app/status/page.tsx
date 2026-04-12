"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Database,
  Layers3,
  RefreshCw,
  Shield,
  Sparkles,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api";

interface StatusWorkspace {
  health: {
    status: string;
    service: string;
    timestamp: string;
  };
  readiness: {
    status: "ready" | "degraded";
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
    severity: "info" | "warning" | "critical";
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
    return "Unknown time";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }
  return date.toLocaleString();
}

function alertVariant(severity: "info" | "warning" | "critical") {
  if (severity === "critical") {
    return "error" as const;
  }
  if (severity === "warning") {
    return "warning" as const;
  }
  return "default" as const;
}

function auditVariant(state?: string) {
  if (state === "success") {
    return "success" as const;
  }
  if (state === "failed") {
    return "error" as const;
  }
  if (state === "retryable") {
    return "warning" as const;
  }
  return "default" as const;
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
        <div className="rounded-2xl border border-white/10 bg-slate-950/80 p-3 text-indigo-300">{icon}</div>
      </div>
    </Card>
  );
}

export default function StatusPage() {
  const [workspace, setWorkspace] = useState<StatusWorkspace | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchWorkspace = async () => {
    try {
      const response = await fetch(`${API_URL}/status/workspace`, { credentials: "include" });
      const data = await response.json().catch(() => null);
      setWorkspace(response.ok ? data : null);
    } catch (error) {
      console.error("[StatusPage] Failed to load status workspace", error);
      setWorkspace(null);
    } finally {
      setLoading(false);
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
        label: "Unavailable",
        detail: "The status workspace could not be loaded.",
      };
    }
    return workspace.readiness.status === "ready"
      ? {
          label: "Operationally ready",
          detail: "Health, readiness, and tracked pools are all reporting within the normal band.",
        }
      : {
          label: "Degraded readiness",
          detail: "At least one tracked dependency or pool is lagging behind the expected healthy state.",
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
          <h1 className="text-2xl font-semibold text-white">Status workspace unavailable</h1>
          <p className="mt-3 text-slate-400">
            The consolidated operations view could not be loaded from the backend.
          </p>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl p-4 md:p-8">
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Operations Workspace</p>
          <h1 className="mt-2 bg-gradient-to-r from-white to-slate-400 bg-clip-text text-3xl font-bold text-transparent">
            System Status
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">{headline.detail}</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={workspace.readiness.status === "ready" ? "success" : "warning"}>
            {headline.label}
          </Badge>
          <Button variant="ghost" onClick={() => fetchWorkspace()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      <section className="mb-8 grid gap-4 md:grid-cols-4">
        <MetricCard
          title="Service Health"
          value={workspace.health.status}
          detail={`Service: ${workspace.health.service}`}
          icon={<Activity className="h-5 w-5" />}
        />
        <MetricCard
          title="Tracked Pools"
          value={String(workspace.readiness.counts.trackedPools)}
          detail={`${workspace.laggingPools.length} currently lagging`}
          icon={<Layers3 className="h-5 w-5" />}
        />
        <MetricCard
          title="Recent Failures"
          value={String(workspace.activitySummary.recentFailures)}
          detail="Failure count across the most recent audit window."
          icon={<AlertTriangle className="h-5 w-5" />}
        />
        <MetricCard
          title="Sponsored Events"
          value={String(workspace.activitySummary.sponsoredCount)}
          detail="Successful fee-sponsored audit entries in the recent window."
          icon={<Sparkles className="h-5 w-5" />}
        />
      </section>

      <section className="mb-8 grid gap-6 lg:grid-cols-[0.38fr_0.62fr]">
        <Card variant="glass">
          <div className="mb-4">
            <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Alert Summary</p>
            <h2 className="mt-2 text-xl font-semibold text-white">What needs attention</h2>
          </div>
          <div className="space-y-3">
            {workspace.alertSummary.map((alert) => (
              <div key={`${alert.severity}-${alert.title}`} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-white">{alert.title}</p>
                    <p className="mt-2 text-sm leading-6 text-slate-400">{alert.detail}</p>
                  </div>
                  <Badge variant={alertVariant(alert.severity)}>{alert.severity.toUpperCase()}</Badge>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card variant="glass">
          <div className="mb-4">
            <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Flow Totals</p>
            <h2 className="mt-2 text-xl font-semibold text-white">Current activity volume</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Users</p>
              <p className="mt-2 text-2xl font-semibold text-white">{workspace.stats.users?.total ?? 0}</p>
              <p className="mt-2 text-sm text-slate-400">Active 24h: {workspace.stats.users?.active24h ?? 0}</p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Swaps</p>
              <p className="mt-2 text-2xl font-semibold text-white">{workspace.stats.flows?.swaps ?? 0}</p>
              <p className="mt-2 text-sm text-slate-400">Open offers: {workspace.stats.flows?.openOffers ?? 0}</p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Pending withdrawals</p>
              <p className="mt-2 text-2xl font-semibold text-white">{workspace.stats.flows?.pendingWithdrawals ?? 0}</p>
              <p className="mt-2 text-sm text-slate-400">Encrypted notes: {workspace.stats.flows?.encryptedNotes ?? 0}</p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Indexer commitments</p>
              <p className="mt-2 text-2xl font-semibold text-white">{workspace.stats.indexer?.commitments ?? 0}</p>
              <p className="mt-2 text-sm text-slate-400">
                Audited transactions: {workspace.stats.flows?.auditedTransactions ?? 0}
              </p>
            </div>
          </div>
        </Card>
      </section>

      <section className="mb-8 grid gap-6 lg:grid-cols-[0.58fr_0.42fr]">
        <Card variant="glass">
          <div className="mb-4">
            <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Pool Status</p>
            <h2 className="mt-2 text-xl font-semibold text-white">Indexer and pool summaries</h2>
          </div>
          <div className="space-y-3">
            {workspace.poolSummaries.map((pool) => (
              <div key={`${pool.network}-${pool.poolAddress}`} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="text-sm font-medium text-white">
                      {pool.poolAddress.slice(0, 10)}...{pool.poolAddress.slice(-6)}
                    </p>
                    <p className="mt-1 text-xs uppercase tracking-wide text-slate-500">{pool.network}</p>
                  </div>
                  <Badge variant={pool.status === "healthy" ? "success" : "warning"}>
                    {pool.status.toUpperCase()}
                  </Badge>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Ledger</p>
                    <p className="mt-1 text-sm font-medium text-white">{pool.lastProcessedLedger}</p>
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
          <div className="mb-4">
            <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Recent Audit Stream</p>
            <h2 className="mt-2 text-xl font-semibold text-white">Latest tracked events</h2>
          </div>
          <div className="space-y-3">
            {workspace.activitySummary.recentAudits.slice(0, 8).map((audit, index) => (
              <div key={`${audit.operation}-${audit.createdAt}-${index}`} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-white">{String(audit.operation ?? "unknown").replaceAll("_", " ")}</p>
                    <p className="mt-2 text-xs text-slate-400">{formatTimestamp(audit.createdAt)}</p>
                  </div>
                  <Badge variant={auditVariant(audit.state)}>{String(audit.state ?? "pending").toUpperCase()}</Badge>
                </div>
                {audit.indexingDetail && <p className="mt-3 text-sm leading-6 text-slate-400">{audit.indexingDetail}</p>}
                {audit.error && <p className="mt-3 text-sm text-red-300">{audit.error}</p>}
                {audit.sponsored && (
                  <div className="mt-3 inline-flex items-center gap-2 rounded-xl border border-indigo-500/20 bg-indigo-500/10 px-3 py-2 text-xs text-indigo-100">
                    <Shield className="h-3.5 w-3.5" />
                    Sponsored event
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      </section>

      <div className="flex gap-4">
        <Link href="/dashboard">
          <Button variant="ghost">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Dashboard
          </Button>
        </Link>
        <Link href="/history">
          <Button variant="ghost">Activity Timeline</Button>
        </Link>
      </div>
    </main>
  );
}
