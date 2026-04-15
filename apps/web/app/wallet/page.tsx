"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import {
  ArrowRightLeft,
  Clock3,
  Droplet,
  ExternalLink,
  Flag,
  Globe,
  Landmark,
  RefreshCw,
  Send,
  Shield,
  ShieldCheck,
  Sparkles,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PrivacyToggle } from "@/components/ui/PrivacyToggle";
import { usePrivacy } from "@/context/PrivacyContext";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api";

interface HistoryEntry {
  id: string;
  title: string;
  detail: string;
  state: "success" | "pending" | "failed" | "retryable" | "queued";
  category: "wallet" | "private" | "swap" | "system";
  asset?: string;
  amountDisplay: string;
  txHash?: string;
  privateFlow: boolean;
  date: string;
}

interface WalletWorkspace {
  user: {
    username?: string;
    stellarPublicKey?: string;
    reputation?: number;
  };
  balances: {
    public: { usdc: string; xlm: string };
    private: { usdc: string; xlm: string };
    composition: {
      usdcPrivateShare: number;
      xlmPrivateShare: number;
    };
  };
  pending: {
    count: number;
    byAsset: {
      usdc: string;
      xlm: string;
    };
    items: Array<{
      id: string;
      asset: string;
      amount: string;
      processed: boolean;
      txHash?: string;
      createdAt: string;
    }>;
  };
  sponsorship: {
    withdrawSelf: Record<
      string,
      {
        supported: boolean;
        sponsored: boolean;
        reason?: string;
      }
    >;
  };
  privateActions: Array<{
    action: string;
    enabled: boolean;
    asset: string | null;
    availableAmount: string;
    sponsorship: {
      supported: boolean;
      sponsored: boolean;
      reason?: string;
    };
  }>;
  recentHistory: HistoryEntry[];
  workspaceGuidance: string[];
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

function getStateVariant(state: HistoryEntry["state"]) {
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

function BalanceCard({
  title,
  tone,
  usdc,
  xlm,
  extra,
}: {
  title: string;
  tone: "public" | "private";
  usdc: string;
  xlm: string;
  extra?: React.ReactNode;
}) {
  const isPrivate = tone === "private";
  return (
    <Card
      variant={isPrivate ? "neon" : "glass"}
      className={isPrivate ? "border-indigo-500/25 bg-gradient-to-br from-indigo-900/30 to-slate-900/70" : ""}
    >
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-400">{title}</p>
          <p className="mt-1 text-xs text-slate-500">
            {isPrivate ? "Shielded notes and queued privacy flows" : "Visible on-chain account balances"}
          </p>
        </div>
        <Badge variant={isPrivate ? "success" : "default"}>
          {isPrivate ? (
            <span className="flex items-center gap-1">
              <Shield className="h-3.5 w-3.5" />
              ZK Notes
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <Globe className="h-3.5 w-3.5" />
              On-chain
            </span>
          )}
        </Badge>
      </div>

      <div className="space-y-3">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">USDC</p>
            <p className="text-2xl font-semibold text-white">{usdc}</p>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">XLM</p>
            <p className="text-2xl font-semibold text-white">{xlm}</p>
          </div>
        </div>
      </div>

      {extra && <div className="mt-4">{extra}</div>}
    </Card>
  );
}

export default function WalletPage() {
  const { isPrivate, togglePrivacy } = usePrivacy();
  const [workspace, setWorkspace] = useState<WalletWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [faucetLoading, setFaucetLoading] = useState(false);
  const [processingPending, setProcessingPending] = useState(false);
  const [withdrawing, setWithdrawing] = useState<"USDC" | "XLM" | null>(null);

  const fetchWorkspace = async () => {
    try {
      const res = await fetch(`${API_URL}/users/workspace`, { credentials: "include" });
      const data = await res.json().catch(() => null);
      setWorkspace(data);
    } catch (error) {
      console.error("[WalletPage] Failed to load wallet workspace", error);
      setWorkspace(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWorkspace();
  }, []);

  useEffect(() => {
    if (!workspace?.user?.stellarPublicKey) {
      return;
    }

    const interval = window.setInterval(() => {
      fetchWorkspace();
    }, 12000);

    return () => window.clearInterval(interval);
  }, [workspace?.user?.stellarPublicKey]);

  const handleXlmFaucet = async () => {
    if (!workspace?.user?.stellarPublicKey) {
      return;
    }

    setFaucetLoading(true);
    try {
      const res = await fetch(`${API_URL}/faucet/xlm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ address: workspace.user.stellarPublicKey }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        window.setTimeout(() => fetchWorkspace(), 3500);
      }
    } finally {
      setFaucetLoading(false);
    }
  };

  const handleTrustline = async () => {
    try {
      const res = await fetch(`${API_URL}/users/trustline`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        window.alert(`Trustline added successfully.\nTransaction: ${data.hash}`);
        window.setTimeout(() => fetchWorkspace(), 3500);
      } else {
        window.alert(`Failed to add trustline: ${data.message || "Unknown error"}`);
      }
    } catch {
      window.alert("Error adding trustline");
    }
  };

  const handleWithdrawSelf = async (asset: "USDC" | "XLM") => {
    if (!workspace) {
      return;
    }

    const amount = Number(asset === "USDC" ? workspace.balances.private.usdc : workspace.balances.private.xlm);
    if (amount <= 0) {
      return;
    }

    if (!window.confirm(`Withdraw ${amount} ${asset} from private balance into the public wallet?`)) {
      return;
    }

    setWithdrawing(asset);
    try {
      const res = await fetch(`${API_URL}/users/withdrawals/self`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ asset, amount }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        window.alert(`Withdrawal failed: ${data.error || data.message || "Unknown error"}`);
      } else {
        window.alert(`Withdrawal submitted.\nTransaction: ${data.txHash || "Pending hash"}`);
        fetchWorkspace();
      }
    } finally {
      setWithdrawing(null);
    }
  };

  const handleProcessPending = async () => {
    setProcessingPending(true);
    try {
      const res = await fetch(`${API_URL}/users/withdrawals/process`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (data.processed > 0) {
        window.alert(`Processed ${data.processed} withdrawal(s).\nTransactions: ${(data.txHashes || []).join(", ")}`);
      }
      fetchWorkspace();
    } finally {
      setProcessingPending(false);
    }
  };

  const composition = useMemo(() => workspace?.balances.composition, [workspace]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  if (!workspace?.user) {
    return (
      <div className="p-8">
        <p>
          Not logged in.{" "}
          <Link href="/" className="text-indigo-400">
            Go home
          </Link>
        </p>
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
            <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Wallet Workspace</p>
            <h1 className="mt-2 bg-gradient-to-r from-white to-slate-400 bg-clip-text text-3xl font-bold text-transparent">
              Advanced Wallet
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
              One place for public balances, private balances, queued withdrawals, sponsorship status, and the most
              recent activity touching your wallet.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant={isPrivate ? "success" : "warning"}>
              {isPrivate ? (
                <span className="flex items-center gap-1">
                  <Shield className="h-3.5 w-3.5" />
                  Private-first
                </span>
              ) : (
                <span className="flex items-center gap-1">
                  <Globe className="h-3.5 w-3.5" />
                  Public-first
                </span>
              )}
            </Badge>
            <Button variant="ghost" onClick={() => fetchWorkspace()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>

        <section className="grid gap-6 md:grid-cols-2">
          <BalanceCard
            title="Public Balance"
            tone="public"
            usdc={workspace.balances.public.usdc}
            xlm={workspace.balances.public.xlm}
            extra={
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">USDC private share</p>
                  <p className="mt-2 text-sm font-medium text-white">{composition?.usdcPrivateShare ?? 0}%</p>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">XLM private share</p>
                  <p className="mt-2 text-sm font-medium text-white">{composition?.xlmPrivateShare ?? 0}%</p>
                </div>
              </div>
            }
          />

          <BalanceCard
            title="Private Balance"
            tone="private"
            usdc={workspace.balances.private.usdc}
            xlm={workspace.balances.private.xlm}
            extra={
              <div className="grid gap-3 md:grid-cols-2">
                <button
                  onClick={() => handleWithdrawSelf("USDC")}
                  disabled={withdrawing === "USDC" || Number(workspace.balances.private.usdc) <= 0}
                  className="rounded-2xl border border-indigo-500/20 bg-indigo-500/10 p-3 text-left transition hover:bg-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <p className="text-xs uppercase tracking-wide text-indigo-200">Withdraw private USDC</p>
                  <p className="mt-2 text-sm text-indigo-50">
                    {withdrawing === "USDC" ? "Processing..." : workspace.sponsorship.withdrawSelf.USDC?.reason || "Withdraw into public balance"}
                  </p>
                </button>
                <button
                  onClick={() => handleWithdrawSelf("XLM")}
                  disabled={withdrawing === "XLM" || Number(workspace.balances.private.xlm) <= 0}
                  className="rounded-2xl border border-indigo-500/20 bg-indigo-500/10 p-3 text-left transition hover:bg-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <p className="text-xs uppercase tracking-wide text-indigo-200">Withdraw private XLM</p>
                  <p className="mt-2 text-sm text-indigo-50">
                    {withdrawing === "XLM" ? "Processing..." : workspace.sponsorship.withdrawSelf.XLM?.reason || "Withdraw into public balance"}
                  </p>
                </button>
              </div>
            }
          />
        </section>

        <section className="grid gap-6 lg:grid-cols-[0.64fr_0.36fr]">
          <Card variant="glass">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Quick Actions</p>
                <h2 className="mt-2 text-xl font-semibold text-white">Wallet controls</h2>
              </div>
              <Badge variant="default">
                <Wallet className="mr-1 h-3.5 w-3.5" />
                Live tools
              </Badge>
            </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Link
                  href="/dashboard"
                  className="rounded-2xl border border-slate-700 bg-slate-950/70 p-4 transition hover:border-indigo-500 hover:bg-indigo-500/10"
                >
                  <Send className="h-6 w-6 text-white" />
                  <p className="mt-3 font-medium text-white">Send Funds</p>
                  <p className="mt-1 text-xs leading-5 text-slate-400">Open the main transfer workspace.</p>
                </Link>

                <Link
                  href="/wallet/fund"
                  className="rounded-2xl border border-slate-700 bg-slate-950/70 p-4 transition hover:border-amber-500 hover:bg-amber-500/10"
                >
                  <Flag className="h-6 w-6 text-white" />
                  <p className="mt-3 font-medium text-white">Funding Desk</p>
                  <p className="mt-1 text-xs leading-5 text-slate-400">Open the staged setup workspace for faucet, trustline, and private seeding.</p>
                </Link>

                <button
                  onClick={handleXlmFaucet}
                disabled={faucetLoading}
                className="rounded-2xl border border-slate-700 bg-slate-950/70 p-4 text-left transition hover:border-cyan-500 hover:bg-cyan-500/10 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Droplet className="h-6 w-6 text-white" />
                <p className="mt-3 font-medium text-white">{faucetLoading ? "Funding..." : "XLM Faucet"}</p>
                <p className="mt-1 text-xs leading-5 text-slate-400">Top up testnet XLM through the app faucet.</p>
              </button>

              <button
                onClick={handleTrustline}
                className="rounded-2xl border border-slate-700 bg-slate-950/70 p-4 text-left transition hover:border-emerald-500 hover:bg-emerald-500/10"
              >
                <ShieldCheck className="h-6 w-6 text-white" />
                <p className="mt-3 font-medium text-white">Add Trustline</p>
                <p className="mt-1 text-xs leading-5 text-slate-400">Prepare the wallet for USDC-based flows.</p>
              </button>

              <a
                href="https://faucet.circle.com/?network=stellar-testnet"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-2xl border border-slate-700 bg-slate-950/70 p-4 transition hover:border-blue-500 hover:bg-blue-500/10"
              >
                <Landmark className="h-6 w-6 text-white" />
                <p className="mt-3 font-medium text-white">Circle Faucet</p>
                <p className="mt-1 text-xs leading-5 text-slate-400">Open the Circle testnet faucet in a new tab.</p>
              </a>
            </div>
          </Card>

          <Card variant="glass" className="flex flex-col items-center justify-center">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">Receive Assets</h3>
            <div className="my-4 rounded-2xl border-2 border-slate-100 bg-white p-3 shadow-inner">
              <QRCodeSVG value={workspace.user.stellarPublicKey ?? ""} size={150} level="M" />
            </div>
            <div className="w-full rounded-2xl border border-slate-800 bg-slate-950/70 p-3 text-center">
              <p className="text-[10px] uppercase tracking-wide text-slate-500">Wallet Address</p>
              <p className="mt-2 break-all font-mono text-xs text-slate-300">{workspace.user.stellarPublicKey}</p>
            </div>
          </Card>
        </section>

        <section className="grid gap-6 lg:grid-cols-[0.38fr_0.62fr]">
          <Card variant="glass">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Pending & Guidance</p>
                <h2 className="mt-2 text-xl font-semibold text-white">Private queue status</h2>
              </div>
              <Badge variant={workspace.pending.count > 0 ? "warning" : "success"}>
                <Clock3 className="mr-1 h-3.5 w-3.5" />
                {workspace.pending.count} queued
              </Badge>
            </div>

            <div className="space-y-3">
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Pending by asset</p>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div>
                    <p className="text-sm text-slate-400">USDC</p>
                    <p className="mt-1 text-xl font-semibold text-white">{workspace.pending.byAsset.usdc}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-400">XLM</p>
                    <p className="mt-1 text-xl font-semibold text-white">{workspace.pending.byAsset.xlm}</p>
                  </div>
                </div>
              </div>

              <button
                onClick={handleProcessPending}
                disabled={processingPending || workspace.pending.count === 0}
                className="w-full rounded-2xl border border-indigo-500/20 bg-indigo-500/10 p-4 text-left transition hover:bg-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <div className="flex items-center gap-3">
                  <ArrowRightLeft className="h-5 w-5 text-indigo-200" />
                  <div>
                    <p className="font-medium text-indigo-50">
                      {processingPending ? "Processing queued withdrawals..." : "Process pending withdrawals"}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-indigo-100/80">
                      Submit the current pending withdrawal queue into public-balance transactions.
                    </p>
                  </div>
                </div>
              </button>

              <div className="space-y-3">
                {workspace.workspaceGuidance.map((entry) => (
                  <div key={entry} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                    <div className="flex items-start gap-3">
                      <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-indigo-300" />
                      <p className="text-sm leading-6 text-slate-300">{entry}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <Card variant="glass">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Recent Activity</p>
                <h2 className="mt-2 text-xl font-semibold text-white">Latest wallet events</h2>
              </div>
              <Link href="/history">
                <Button variant="ghost">Open full history</Button>
              </Link>
            </div>

            <div className="space-y-3">
              {workspace.recentHistory.length === 0 ? (
                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-500">
                  No recent wallet history yet.
                </div>
              ) : (
                workspace.recentHistory.map((entry) => (
                  <div key={entry.id} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <Badge variant={getStateVariant(entry.state)}>{entry.state.toUpperCase()}</Badge>
                          <Badge variant={entry.privateFlow ? "success" : "default"}>
                            {entry.privateFlow ? (
                              <span className="flex items-center gap-1">
                                <Shield className="h-3 w-3" />
                                Private
                              </span>
                            ) : (
                              <span className="flex items-center gap-1">
                                <Globe className="h-3 w-3" />
                                Public
                              </span>
                            )}
                          </Badge>
                        </div>
                        <h3 className="text-lg font-semibold text-white">{entry.title}</h3>
                        <p className="mt-1 text-sm leading-6 text-slate-400">{entry.detail}</p>
                        <div className="mt-3 grid gap-2 md:grid-cols-2">
                          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                            <p className="text-xs uppercase tracking-wide text-slate-500">Amount</p>
                            <p className="mt-1 text-sm font-medium text-white">{entry.amountDisplay}</p>
                          </div>
                          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                            <p className="text-xs uppercase tracking-wide text-slate-500">Time</p>
                            <p className="mt-1 text-sm font-medium text-white">{formatTimestamp(entry.date)}</p>
                          </div>
                        </div>
                      </div>
                      <div className="shrink-0">
                        {entry.txHash ? (
                          <a
                            href={`https://stellar.expert/explorer/testnet/tx/${entry.txHash}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center rounded-xl border border-indigo-500/20 bg-indigo-500/10 px-4 py-2 text-sm text-indigo-200 transition-colors hover:bg-indigo-500/20"
                          >
                            View tx
                            <ExternalLink className="ml-2 h-4 w-4" />
                          </a>
                        ) : (
                          <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-2 text-sm text-slate-500">
                            No transaction hash
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </section>
      </main>
    </div>
  );
}
