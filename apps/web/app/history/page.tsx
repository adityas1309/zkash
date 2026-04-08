"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { PrivacyToggle } from "@/components/ui/PrivacyToggle";
import { usePrivacy } from "@/context/PrivacyContext";
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
  XCircle,
} from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api";

type HistoryState = "success" | "pending" | "failed" | "retryable" | "queued";
type HistoryCategory = "wallet" | "private" | "swap" | "system";

interface HistoryEntry {
  id: string;
  source: "audit" | "encrypted_note" | "withdrawal" | "swap";
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
    role?: "alice" | "bob";
    counterparty?: string;
  };
  privateFlow: boolean;
  date: string;
  statusLabel: string;
}

function getStateVariant(state: HistoryState) {
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

function getCategoryVariant(category: HistoryCategory) {
  if (category === "swap") {
    return "warning" as const;
  }
  if (category === "private") {
    return "success" as const;
  }
  if (category === "wallet") {
    return "default" as const;
  }
  return "error" as const;
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
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
        <div className="rounded-2xl border border-white/10 bg-slate-950/80 p-3 text-indigo-300">{icon}</div>
      </div>
    </Card>
  );
}

export default function HistoryPage() {
  const { isPrivate, togglePrivacy } = usePrivacy();
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState<"all" | HistoryCategory>("all");
  const [stateFilter, setStateFilter] = useState<"all" | HistoryState>("all");

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/users/history`, { credentials: "include" });
      const data = await response.json().catch(() => []);
      if (Array.isArray(data)) {
        setHistory(data);
      } else {
        setHistory([]);
      }
    } catch (error) {
      console.error("[HistoryPage] Failed to fetch history", error);
      setHistory([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  const filteredHistory = useMemo(() => {
    return history.filter((item) => {
      if (categoryFilter !== "all" && item.category !== categoryFilter) {
        return false;
      }
      if (stateFilter !== "all" && item.state !== stateFilter) {
        return false;
      }
      return true;
    });
  }, [categoryFilter, history, stateFilter]);

  const summary = useMemo(() => {
    return {
      completed: history.filter((item) => item.state === "success").length,
      pending: history.filter((item) => item.state === "pending" || item.state === "queued").length,
      privateFlows: history.filter((item) => item.privateFlow).length,
      sponsored: history.filter((item) => item.sponsorship?.sponsored).length,
    };
  }, [history]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  return (
    <div className="mx-auto mb-8 flex min-h-[50vh] max-w-[1450px] flex-col rounded-[32px] border border-white/5 bg-slate-900/30 p-8 text-white selection:bg-indigo-500/30 lg:p-12">
      <div className="absolute right-8 top-6 z-20">
        <PrivacyToggle checked={isPrivate} onCheckedChange={togglePrivacy} />
      </div>

      <main className="relative z-10 mx-auto w-full max-w-6xl space-y-8 pt-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Unified Activity Timeline</p>
            <h1 className="mt-2 bg-gradient-to-r from-white to-slate-400 bg-clip-text text-3xl font-bold text-transparent">
              Transaction History
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
              This timeline merges transaction audits, private notes, withdrawals, and swap lifecycle updates so you
              can see what actually happened instead of guessing from partial rows.
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => fetchHistory()}
              className="inline-flex items-center rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-sm text-slate-200 transition-colors hover:bg-slate-800"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </button>
            <Link
              href="/dashboard"
              className="inline-flex items-center rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-sm text-slate-200 transition-colors hover:bg-slate-800"
            >
              Back to Dashboard
            </Link>
          </div>
        </div>

        <section className="grid gap-4 md:grid-cols-4">
          <MetricCard
            title="Completed"
            value={String(summary.completed)}
            detail="Audit and lifecycle events that ended in a successful state."
            icon={<CheckCircle className="h-5 w-5" />}
          />
          <MetricCard
            title="Pending"
            value={String(summary.pending)}
            detail="Operations still waiting on acceptance, execution, or indexing follow-up."
            icon={<Clock3 className="h-5 w-5" />}
          />
          <MetricCard
            title="Private flows"
            value={String(summary.privateFlows)}
            detail="Deposits, withdrawals, private transfers, or swap legs involving shielded state."
            icon={<Shield className="h-5 w-5" />}
          />
          <MetricCard
            title="Sponsored"
            value={String(summary.sponsored)}
            detail="Entries where the backend recorded successful fee sponsorship."
            icon={<Sparkles className="h-5 w-5" />}
          />
        </section>

        <section className="grid gap-6 lg:grid-cols-[0.28fr_0.72fr]">
          <Card variant="glass">
            <div className="mb-5 flex items-center gap-2">
              <Filter className="h-4 w-4 text-indigo-300" />
              <p className="text-sm font-medium text-white">Timeline filters</p>
            </div>

            <div className="space-y-4">
              <label className="block">
                <span className="mb-2 block text-xs uppercase tracking-wide text-slate-500">Category</span>
                <select
                  value={categoryFilter}
                  onChange={(event) => setCategoryFilter(event.target.value as typeof categoryFilter)}
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
                <span className="mb-2 block text-xs uppercase tracking-wide text-slate-500">State</span>
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

              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Visible entries</p>
                <p className="mt-2 text-3xl font-semibold text-white">{filteredHistory.length}</p>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Filters help isolate swap-only flows, private indexing delays, or sponsored wallet activity.
                </p>
              </div>
            </div>
          </Card>

          <div className="space-y-4">
            {filteredHistory.length === 0 ? (
              <Card variant="glass" className="py-12 text-center">
                <div className="flex flex-col items-center gap-4">
                  <AlertCircle className="h-12 w-12 text-slate-500" />
                  <p className="text-lg text-slate-400">No history entries match the current filters.</p>
                  <p className="max-w-md text-sm text-slate-500">
                    Try broadening the filters or generate new wallet, private, or swap activity to populate the
                    timeline.
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
                        <Badge variant={getStateVariant(item.state)}>
                          {item.statusLabel}
                        </Badge>
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
                          <h3 className="truncate text-xl font-semibold text-white">{item.title}</h3>
                          <p className="mt-1 text-sm leading-6 text-slate-400">{item.detail}</p>
                        </div>
                        <div className="text-left md:text-right">
                          <p className="text-xs uppercase tracking-wide text-slate-500">Time</p>
                          <p className="mt-1 text-sm text-white">{formatTimestamp(item.date)}</p>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-3 md:grid-cols-4">
                        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
                          <p className="text-xs uppercase tracking-wide text-slate-500">Operation</p>
                          <p className="mt-2 text-sm font-medium text-white">{item.operation.replaceAll("_", " ")}</p>
                        </div>
                        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
                          <p className="text-xs uppercase tracking-wide text-slate-500">Asset</p>
                          <p className="mt-2 text-sm font-medium text-white">{item.asset || "Not specified"}</p>
                        </div>
                        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
                          <p className="text-xs uppercase tracking-wide text-slate-500">Amount</p>
                          <p className="mt-2 text-sm font-medium text-white">{item.amountDisplay}</p>
                        </div>
                        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
                          <p className="text-xs uppercase tracking-wide text-slate-500">Counterparty</p>
                          <p className="mt-2 text-sm font-medium text-white">
                            {item.participants?.counterparty ? `@${item.participants.counterparty}` : "Not applicable"}
                          </p>
                        </div>
                      </div>

                      {(item.indexing?.detail || item.sponsorship?.detail) && (
                        <div className="mt-4 grid gap-3 md:grid-cols-2">
                          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
                            <p className="text-xs uppercase tracking-wide text-slate-500">Indexing</p>
                            <p className="mt-2 text-sm font-medium text-white">{item.indexing?.status || "Not tracked"}</p>
                            <p className="mt-1 text-sm leading-6 text-slate-400">{item.indexing?.detail || "No indexing detail recorded."}</p>
                          </div>
                          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
                            <p className="text-xs uppercase tracking-wide text-slate-500">Sponsorship</p>
                            <p className="mt-2 text-sm font-medium text-white">
                              {item.sponsorship?.attempted
                                ? item.sponsorship?.sponsored
                                  ? "Fee sponsored"
                                  : "Attempted but not sponsored"
                                : "Not attempted"}
                            </p>
                            <p className="mt-1 text-sm leading-6 text-slate-400">
                              {item.sponsorship?.detail || "No sponsorship note recorded for this entry."}
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
          <Link href="/dashboard" className="inline-flex items-center transition-colors hover:text-slate-400">
            <ArrowLeft className="mr-1 h-3 w-3" />
            Back to Dashboard
          </Link>
        </div>
      </main>
    </div>
  );
}
