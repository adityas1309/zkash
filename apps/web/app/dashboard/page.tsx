"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRightLeft,
  Bolt,
  CheckCircle,
  ChevronLeft,
  Copy,
  Globe,
  History,
  Home,
  Info,
  Landmark,
  Layers3,
  LogOut,
  RefreshCw,
  Send,
  Shield,
  Sparkles,
  Wallet,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PrivacyToggle } from "@/components/ui/PrivacyToggle";
import { NetworkToggle } from "@/components/ui/NetworkToggle";
import Prism from "@/components/ui/Prism";
import { cn } from "@/lib/utils";
import { useNetwork } from "@/context/NetworkContext";
import { usePrivacy } from "@/context/PrivacyContext";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api";

type WalletAsset = "USDC" | "XLM";

interface WorkspaceHistoryEntry {
  id: string;
  title: string;
  detail: string;
  state: "success" | "pending" | "failed" | "retryable" | "queued";
  category: "wallet" | "private" | "swap" | "system";
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
    byAsset: { usdc: string; xlm: string };
  };
  recentHistory: WorkspaceHistoryEntry[];
  workspaceGuidance: string[];
}

interface ReadyPayload {
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
}

interface StatsPayload {
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
}

interface SponsorshipPreview {
  supported: boolean;
  sponsored: boolean;
  reason: string;
}

function formatAddress(address?: string) {
  if (!address) {
    return "";
  }
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
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

function getHistoryStateTone(state: WorkspaceHistoryEntry["state"]) {
  if (state === "success") {
    return "text-emerald-300 bg-emerald-500/10 border-emerald-500/30";
  }
  if (state === "failed") {
    return "text-red-300 bg-red-500/10 border-red-500/30";
  }
  if (state === "retryable") {
    return "text-yellow-300 bg-yellow-500/10 border-yellow-500/30";
  }
  return "text-slate-300 bg-slate-500/10 border-slate-500/30";
}

export default function DashboardPage() {
  const { isPrivate, togglePrivacy } = usePrivacy();
  const { network } = useNetwork();

  const [workspace, setWorkspace] = useState<WalletWorkspace | null>(null);
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [readiness, setReadiness] = useState<ReadyPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeView, setActiveView] = useState<"home" | "send">("home");
  const [copied, setCopied] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [asset, setAsset] = useState<WalletAsset>("XLM");
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState("");
  const [sendLoading, setSendLoading] = useState(false);
  const [processStep, setProcessStep] = useState("");
  const [sponsorship, setSponsorship] = useState<SponsorshipPreview | null>(null);

  const fetchDashboardData = async () => {
    try {
      const [workspaceRes, statsRes, readyRes] = await Promise.all([
        fetch(`${API_URL}/users/workspace`, { credentials: "include" }),
        fetch(`${API_URL}/stats`, { credentials: "include" }),
        fetch(`${API_URL}/ready`, { credentials: "include" }),
      ]);

      const [workspaceData, statsData, readyData] = await Promise.all([
        workspaceRes.json().catch(() => null),
        statsRes.json().catch(() => null),
        readyRes.json().catch(() => null),
      ]);

      setWorkspace(workspaceRes.ok ? workspaceData : null);
      setStats(statsRes.ok ? statsData : null);
      setReadiness(readyRes.ok ? readyData : null);
    } catch (error) {
      console.error("[DashboardPage] Failed to fetch dashboard data", error);
      setWorkspace(null);
      setStats(null);
      setReadiness(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, [network]);

  useEffect(() => {
    if (!workspace?.user?.stellarPublicKey) {
      return;
    }
    const interval = window.setInterval(() => {
      fetchDashboardData();
    }, 12000);
    return () => window.clearInterval(interval);
  }, [workspace?.user?.stellarPublicKey, network]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_URL}/users/sponsorship/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        asset,
        operation: isPrivate ? "private_send" : "public_send",
        recipient,
        amount: Number(amount || 0),
      }),
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data) {
          setSponsorship(data);
        }
      })
      .catch((error) => {
        if ((error as Error).name !== "AbortError") {
          console.error(error);
        }
      });

    return () => controller.abort();
  }, [asset, amount, isPrivate, recipient]);

  const copyToClipboard = async () => {
    if (workspace?.user?.stellarPublicKey) {
      await navigator.clipboard.writeText(workspace.user.stellarPublicKey);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleSplit = async (requestAsset: WalletAsset, requestAmount: number) => {
    setProcessStep("Splitting note to match exact amount...");
    const response = await fetch(`${API_URL}/users/split`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ asset: requestAsset, amount: requestAmount }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) {
      throw new Error(data.error || "Split failed");
    }
    setProcessStep("Waiting for split confirmation...");
    await new Promise((resolve) => setTimeout(resolve, 6000));
  };

  const handleDeposit = async (requestAsset: WalletAsset, requestAmount: number) => {
    setProcessStep(`Depositing ${requestAmount} ${requestAsset} from public balance...`);
    const response = await fetch(`${API_URL}/users/deposit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ asset: requestAsset, amount: requestAmount }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) {
      throw new Error(data.error || "Deposit failed");
    }
    setProcessStep("Waiting for deposit confirmation...");
    await new Promise((resolve) => setTimeout(resolve, 6000));
  };

  const handleSend = async () => {
    if (!recipient || !amount) {
      setStatus("Please fill in all fields");
      return;
    }

    setSendLoading(true);
    setStatus("");
    setProcessStep(isPrivate ? "Generating proof and submitting..." : "Sending payment...");

    const runDepositFlow = async (requestAsset: WalletAsset, requestAmount: number) => {
      if (
        window.confirm(
          `Insufficient private balance. Do you want to transfer ${requestAmount} ${requestAsset} from your public pool to continue?`,
        )
      ) {
        await handleDeposit(requestAsset, requestAmount);
        return;
      }
      throw new Error("Cancelled by user.");
    };

    try {
      const attemptSend = async () => {
        const url = isPrivate ? `${API_URL}/users/send/private` : `${API_URL}/users/send`;
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ recipient, asset, amount }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.success === false) {
          throw new Error(data.error || data.message || "Send failed");
        }
        return data;
      };

      try {
        const data = await attemptSend();
        setStatus(
          `${data.message ?? "Payment submitted."}${data.txHash ? ` TX: ${data.txHash}` : ""}${data.sponsorship?.detail ? ` ${data.sponsorship.detail}` : ""}`,
        );
        await fetchDashboardData();
        setAmount("");
        setRecipient("");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to send";
        const numericAmount = Number.parseFloat(amount);

        if (isPrivate) {
          if (
            message.includes("No private note with EXACT amount") ||
            message.includes("No spendable private note") ||
            message.includes("Splitting not yet supported")
          ) {
            await handleSplit(asset, numericAmount);
            setProcessStep("Retrying payment after split...");
            const data = await attemptSend();
            setStatus(data.message ?? "Private payment submitted.");
            await fetchDashboardData();
            setAmount("");
            setRecipient("");
          } else if (message.includes("Insufficient private balance")) {
            await runDepositFlow(asset, numericAmount);
            setProcessStep("Retrying payment after deposit...");
            const data = await attemptSend();
            setStatus(data.message ?? "Private payment submitted.");
            await fetchDashboardData();
            setAmount("");
            setRecipient("");
          } else {
            throw error;
          }
        } else {
          throw error;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message !== "Cancelled by user.") {
        setStatus(message);
      }
      console.error(error);
    } finally {
      setSendLoading(false);
      setProcessStep("");
    }
  };

  const publicUsdc = Number(workspace?.balances.public.usdc ?? 0);
  const privateUsdc = Number(workspace?.balances.private.usdc ?? 0);
  const publicXlm = Number(workspace?.balances.public.xlm ?? 0);
  const privateXlm = Number(workspace?.balances.private.xlm ?? 0);

  const activeUsdc = isPrivate ? privateUsdc : publicUsdc;
  const activeXlm = isPrivate ? privateXlm : publicXlm;
  const totalDisplay = isPrivate ? "$***.**" : `$${Math.max(activeUsdc, 0).toFixed(2)}`;

  const readinessTone = readiness?.status === "ready" ? "text-emerald-400" : "text-yellow-300";

  const opsCards = useMemo(
    () => [
      {
        label: "Active 24h",
        value: stats?.users?.active24h ?? 0,
      },
      {
        label: "Open Offers",
        value: stats?.flows?.openOffers ?? 0,
      },
      {
        label: "Audited Tx",
        value: stats?.flows?.auditedTransactions ?? 0,
      },
      {
        label: "Indexed",
        value: stats?.indexer?.commitments ?? 0,
      },
    ],
    [stats],
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-400">
        Loading...
      </div>
    );
  }

  if (!workspace?.user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4">
        <div className="space-y-4 text-center">
          <p className="text-slate-400">Not logged in.</p>
          <Link
            href="/"
            className="inline-block rounded-full bg-indigo-600 px-6 py-2 text-white transition-colors hover:bg-indigo-500"
          >
            Go home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex w-full flex-col justify-center overflow-hidden rounded-[32px] border border-white/5 bg-slate-900/30 p-8 font-sans text-slate-200 lg:p-12">
      <div className="absolute left-8 top-6 z-20">
        <NetworkToggle />
      </div>
      <div className="absolute right-8 top-6 z-20">
        <PrivacyToggle checked={isPrivate} onCheckedChange={togglePrivacy} />
      </div>

      <div className="absolute inset-0 z-0 opacity-40">
        <Prism
          animationType="rotate"
          timeScale={0.5}
          height={3.5}
          baseWidth={5.5}
          scale={3.6}
          hueShift={-0.3}
          colorFrequency={1}
          noise={0.1}
          glow={1}
        />
      </div>
      <div className="pointer-events-none absolute left-1/2 top-1/2 z-0 h-2/3 w-4/5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-600/20 blur-[120px]" />
      <div className="pointer-events-none absolute left-1/2 top-[40%] z-0 h-32 w-full max-w-4xl -translate-x-1/2 bg-indigo-500/10 blur-[60px]" />

      <div className="relative z-10 mx-auto flex w-full max-w-[1400px] flex-col justify-center items-center">
        <div className="relative flex justify-center">
          <div className="relative flex min-h-[690px] w-full max-w-[380px] flex-col overflow-hidden rounded-[40px] border border-slate-800 bg-slate-900/80 p-6 pb-8 shadow-2xl backdrop-blur-2xl transition-all duration-500">
            <div className="mx-auto mb-8 h-1.5 w-12 rounded-full bg-slate-800" />

            {activeView === "home" ? (
              <div className="animate-in fade-in zoom-in-95 flex flex-1 flex-col duration-300">
                <div className="mb-8 text-center">
                  <p className="bg-gradient-to-br from-white to-slate-400 bg-clip-text text-4xl font-bold tracking-tight text-transparent">
                    {totalDisplay}
                  </p>
                  <p className="mt-2 flex h-5 items-center justify-center gap-2 font-mono text-sm text-slate-500">
                    <span className={cn("h-2 w-2 rounded-full", readiness?.status === "ready" ? "bg-emerald-400" : "bg-yellow-300")} />
                    {formatAddress(workspace.user.stellarPublicKey)}
                  </p>
                </div>

                <div className="mb-6 rounded-3xl border border-white/5 bg-slate-800/40 p-5">
                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full border border-[#2775ca]/20 bg-[#2775ca]/10 p-1.5 shadow-inner opacity-90">
                          <img
                            src="https://cryptologos.cc/logos/usd-coin-usdc-logo.svg?v=035"
                            alt="USDC"
                            className="h-full w-full object-contain"
                          />
                        </div>
                        <div>
                          <p className="text-xl font-bold text-white">{isPrivate ? "******" : workspace.balances.public.usdc}</p>
                          <p className="text-sm font-medium text-slate-400">USDC</p>
                        </div>
                      </div>
                      {isPrivate && (
                        <div className="text-right">
                          <p className="text-base font-bold text-indigo-400">{workspace.balances.private.usdc}</p>
                          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Private</p>
                        </div>
                      )}
                    </div>
                    <div className="h-px w-full bg-slate-700/50" />
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 p-2 shadow-inner opacity-90 text-white">
                          <img
                            src="https://cryptologos.cc/logos/stellar-xlm-logo.svg?v=035"
                            alt="XLM"
                            className="h-full w-full object-contain brightness-0 invert"
                          />
                        </div>
                        <div>
                          <p className="text-xl font-bold text-white">{isPrivate ? "******" : workspace.balances.public.xlm}</p>
                          <p className="text-sm font-medium text-slate-400">XLM</p>
                        </div>
                      </div>
                      {isPrivate && (
                        <div className="text-right">
                          <p className="text-base font-bold text-indigo-400">{workspace.balances.private.xlm}</p>
                          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Private</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mb-6 rounded-3xl border border-white/5 bg-slate-800/30 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Ops Snapshot</p>
                    <span className={cn("text-[11px]", readinessTone)}>
                      {readiness?.status === "ready" ? "Ready" : "Degraded"}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {opsCards.map((card) => (
                      <div key={card.label} className="rounded-2xl bg-slate-900/60 p-3 text-center">
                        <p className="text-lg font-bold text-white">{card.value}</p>
                        <p className="text-[11px] text-slate-400">{card.label}</p>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-2xl border border-slate-700 bg-slate-900/50 p-3">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Pending private queue</p>
                    <p className="mt-2 text-sm text-white">
                      {workspace.pending.count} queued withdrawals | {workspace.pending.byAsset.usdc} USDC | {workspace.pending.byAsset.xlm} XLM
                    </p>
                  </div>
                </div>

                <div className="mb-auto flex items-center gap-3">
                  <Link
                    href="/wallet"
                    className="flex-1 rounded-2xl border border-white/5 bg-slate-800/50 py-4 text-sm font-medium transition-colors hover:bg-slate-800 flex items-center justify-center gap-2"
                  >
                    Wallet <Wallet size={16} />
                  </Link>
                  <button
                    onClick={() => setActiveView("send")}
                    className="flex-1 rounded-2xl border border-white/5 bg-slate-800/50 py-4 text-sm font-medium transition-colors hover:bg-slate-800 flex items-center justify-center gap-2"
                  >
                    Transfer <ArrowRightLeft size={16} />
                  </button>
                </div>
              </div>
            ) : (
              <div className="animate-in slide-in-from-right-4 fade-in flex flex-1 flex-col duration-300">
                <div className="mb-6 flex items-center">
                  <button
                    onClick={() => setActiveView("home")}
                    className="-ml-2 rounded-full p-2 text-slate-400 transition-colors hover:bg-white/5"
                  >
                    <ChevronLeft size={20} />
                  </button>
                  <h3 className="mx-auto pr-6 text-lg font-bold">Send Funds</h3>
                </div>

                <div className="flex-1 space-y-5 pl-1">
                  <div className="flex items-start gap-2 rounded-xl border border-slate-700/50 bg-slate-800/30 p-3">
                    <Info className="mt-0.5 shrink-0 text-slate-400" size={14} />
                    <p className="text-[11px] leading-tight text-slate-300">
                      You are sending in{" "}
                      <span className={isPrivate ? "font-bold text-indigo-400" : "font-bold text-blue-400"}>
                        {isPrivate ? "Private Mode" : "Public Mode"}
                      </span>
                      . {isPrivate ? "This route depends on exact private notes and proof generation." : "This route settles visibly on-chain."}
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-700/50 bg-slate-900/50 p-3">
                    <p className="mb-1 text-[11px] uppercase tracking-[0.18em] text-slate-500">Fee Sponsorship</p>
                    <p className={cn("text-xs leading-relaxed", sponsorship?.sponsored ? "text-emerald-300" : "text-slate-300")}>
                      {sponsorship?.reason ?? "Checking whether this action can be sponsored..."}
                    </p>
                  </div>

                  <div>
                    <label className="ml-1 mb-1.5 block text-xs font-medium text-slate-400">Recipient</label>
                    <Input
                      type="text"
                      value={recipient}
                      onChange={(event) => setRecipient(event.target.value)}
                      placeholder="Username or Stellar Addr"
                      disabled={sendLoading}
                      className="h-12 rounded-xl border-slate-700/50 bg-slate-900/50 text-sm"
                    />
                  </div>

                  <div className="flex gap-3">
                    <div className="w-1/3">
                      <label className="ml-1 mb-1.5 block text-xs font-medium text-slate-400">Asset</label>
                      <select
                        value={asset}
                        onChange={(event) => setAsset(event.target.value as WalletAsset)}
                        className="h-12 w-full rounded-xl border border-slate-700/50 bg-slate-900/50 px-3 text-sm text-slate-200 transition-all focus:border-indigo-500 focus:outline-none"
                        disabled={sendLoading}
                      >
                        <option value="XLM">XLM</option>
                        <option value="USDC">USDC</option>
                      </select>
                    </div>
                    <div className="flex-1">
                      <label className="ml-1 mb-1.5 block text-xs font-medium text-slate-400">Amount</label>
                      <Input
                        type="number"
                        value={amount}
                        onChange={(event) => setAmount(event.target.value)}
                        placeholder="0.00"
                        disabled={sendLoading}
                        className="h-12 rounded-xl border-slate-700/50 bg-slate-900/50 text-sm font-mono"
                      />
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-700 bg-slate-900/50 p-3">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Current sending balance</p>
                    <p className="mt-2 text-sm text-white">
                      {isPrivate
                        ? `${workspace.balances.private[asset.toLowerCase() as "usdc" | "xlm"]} ${asset} available privately`
                        : `${workspace.balances.public[asset.toLowerCase() as "usdc" | "xlm"]} ${asset} available publicly`}
                    </p>
                  </div>

                  {status && (
                    <div
                      className={cn(
                        "mt-4 rounded-xl border-l-4 p-3 text-xs font-medium",
                        status.toLowerCase().includes("failed") || status.toLowerCase().includes("error")
                          ? "border-red-500 bg-red-500/10 text-red-200"
                          : "border-emerald-500 bg-emerald-500/10 text-emerald-200",
                      )}
                    >
                      <p className="break-words">{status}</p>
                    </div>
                  )}

                  {processStep && (
                    <div className="mt-4 flex items-center gap-2 rounded-xl border-l-4 border-indigo-500 bg-indigo-500/10 p-3 text-xs font-medium text-indigo-200">
                      <span className="h-3 w-3 shrink-0 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin"></span>
                      {processStep}
                    </div>
                  )}

                  <div className="pt-6">
                    <Button
                      onClick={handleSend}
                      isLoading={sendLoading}
                      className="h-12 w-full rounded-2xl bg-indigo-600 font-medium text-white hover:bg-indigo-500"
                      disabled={!recipient || !amount}
                    >
                      <Send className="mr-2 h-4 w-4" />
                      {isPrivate ? "Send Privately" : "Send Publicly"}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            <div className="mt-auto pt-6">
              <div className="space-y-3 rounded-2xl border border-white/5 bg-slate-800/50 p-4">
                <p className="text-center text-sm font-medium text-slate-400">
                  User: <span className="font-bold text-white">@{workspace.user.username || "Unknown"}</span>
                </p>
                <div className="relative flex w-full items-center overflow-hidden rounded-lg border border-white/5 bg-slate-900/50 p-3 group">
                  <p className="w-full truncate pr-6 text-center font-mono text-xs text-slate-400">
                    {workspace.user.stellarPublicKey || "Loading address..."}
                  </p>
                  {workspace.user.stellarPublicKey && (
                    <button
                      onClick={copyToClipboard}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md bg-indigo-500/10 p-1.5 text-indigo-400 opacity-0 transition-all backdrop-blur-md group-hover:opacity-100 hover:text-indigo-300"
                      title="Copy Address"
                    >
                      {copied ? <CheckCircle size={14} /> : <Copy size={14} />}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 grid w-full max-w-[1400px] gap-6 lg:grid-cols-[0.55fr_0.45fr]">
          <div className="rounded-[28px] border border-white/5 bg-slate-900/60 p-6 backdrop-blur-xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Guidance & Status</p>
                <h2 className="mt-2 text-xl font-semibold text-white">Operational view</h2>
              </div>
              <span className={cn("text-sm font-medium", readinessTone)}>
                {readiness?.status === "ready" ? "All systems ready" : "Indexer needs attention"}
              </span>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {workspace.workspaceGuidance.map((entry) => (
                <div key={entry} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <div className="flex items-start gap-3">
                    <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-indigo-300" />
                    <p className="text-sm leading-6 text-slate-300">{entry}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Indexer readiness</p>
              <p className="mt-2 text-sm text-white">
                MongoDB: {readiness?.dependencies.mongodb ?? "unknown"} | Indexer: {readiness?.dependencies.indexer ?? "unknown"}
              </p>
              {readiness?.lagging?.length ? (
                <div className="mt-3 space-y-2">
                  {readiness.lagging.slice(0, 2).map((pool) => (
                    <div key={pool.poolAddress} className="rounded-xl border border-yellow-500/20 bg-yellow-500/10 p-3 text-sm text-yellow-100">
                      <p className="font-medium">{pool.poolAddress.slice(0, 10)}...{pool.poolAddress.slice(-6)}</p>
                      <p className="mt-1 text-xs leading-5">
                        Status: {pool.status} | Last ledger: {pool.lastProcessedLedger} | {pool.lastError || "Waiting for healthy sync"}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate-400">Tracked pools are syncing without lagging alerts.</p>
              )}
            </div>
          </div>

          <div className="rounded-[28px] border border-white/5 bg-slate-900/60 p-6 backdrop-blur-xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Recent Activity</p>
                <h2 className="mt-2 text-xl font-semibold text-white">Latest events</h2>
              </div>
              <Link href="/history" className="text-sm text-indigo-300 hover:text-indigo-200">
                View full history
              </Link>
            </div>

            <div className="space-y-3">
              {workspace.recentHistory.length === 0 ? (
                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-500">
                  No recent activity yet.
                </div>
              ) : (
                workspace.recentHistory.slice(0, 5).map((entry) => (
                  <div key={entry.id} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className={cn("rounded-full border px-2 py-1 text-[11px] uppercase tracking-wide", getHistoryStateTone(entry.state))}>
                            {entry.state}
                          </span>
                          <span className="rounded-full border border-slate-700 bg-slate-900/80 px-2 py-1 text-[11px] uppercase tracking-wide text-slate-400">
                            {entry.privateFlow ? "private" : entry.category}
                          </span>
                        </div>
                        <p className="text-sm font-medium text-white">{entry.title}</p>
                        <p className="mt-1 text-xs leading-5 text-slate-400">{entry.detail}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-slate-500">{entry.amountDisplay}</p>
                        <p className="mt-1 text-[11px] text-slate-500">{formatTimestamp(entry.date)}</p>
                      </div>
                    </div>
                    {entry.txHash && (
                      <a
                        href={`https://stellar.expert/explorer/testnet/tx/${entry.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 inline-flex items-center gap-1 text-xs text-indigo-300 hover:text-indigo-200"
                      >
                        View transaction
                      </a>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="mt-8 flex w-full max-w-[1400px] flex-wrap gap-3">
          <Link href="/wallet">
            <Button variant="ghost">
              <Wallet className="mr-2 h-4 w-4" />
              Wallet Workspace
            </Button>
          </Link>
          <Link href="/swap">
            <Button variant="ghost">
              <Layers3 className="mr-2 h-4 w-4" />
              Market Board
            </Button>
          </Link>
          <Link href="/history">
            <Button variant="ghost">
              <History className="mr-2 h-4 w-4" />
              Activity Timeline
            </Button>
          </Link>
          <Link href="/actions">
            <Button variant="ghost">
              <Bolt className="mr-2 h-4 w-4" />
              Action Center
            </Button>
          </Link>
          <Link href="/">
            <Button variant="ghost">
              <Home className="mr-2 h-4 w-4" />
              Home
            </Button>
          </Link>
          <Link href="/auth/google">
            <Button variant="ghost">
              <LogOut className="mr-2 h-4 w-4" />
              Re-auth
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
