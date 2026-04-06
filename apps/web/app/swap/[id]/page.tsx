"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  ArrowUpDown,
  CheckCircle,
  Clock3,
  Globe,
  Layers3,
  Lock,
  RefreshCw,
  Shield,
  Sparkles,
  Star,
  TrendingUp,
  Wallet,
} from "lucide-react";
import Prism from "@/components/ui/Prism";
import { usePrivacy } from "@/context/PrivacyContext";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api";

interface ExecutionMode {
  mode: "public" | "private";
  label?: string;
  detail: string;
}

interface OfferMetrics {
  openRequests: number;
  activeExecutions: number;
  completedSwaps: number;
  failedSwaps: number;
  recentCompletedSwaps: number;
  averageTicketSize: number;
  completionRate: number;
  lastTradedAt: string | null;
}

interface MerchantMetrics {
  completedAsSeller: number;
  failedAsSeller: number;
  pendingAsSeller: number;
  activeAsSeller: number;
  routedThroughThisOffer: number;
  completionRate: number;
  lastCompletedAt: string | null;
}

interface Offer {
  _id: string;
  assetIn: "USDC" | "XLM";
  assetOut: "USDC" | "XLM";
  rate: number;
  min: number;
  max: number;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
  merchantId: { username: string; _id: string; reputation?: number };
  executionModes: ExecutionMode[];
  merchantMetrics: MerchantMetrics;
  offerMetrics: OfferMetrics;
  requestGuidance: {
    confidenceScore: number;
    backlogLevel: "light" | "moderate" | "heavy";
    recommendedMode: "public" | "private";
    notes: string[];
  };
}

interface OfferInsights {
  offerId: string;
  merchant: {
    id: string;
    username: string;
    reputation: number | null;
  };
  pricing: {
    rate: number;
    min: number;
    max: number;
    spreadBand: string;
  };
  merchantMetrics: MerchantMetrics;
  offerMetrics: OfferMetrics;
  pairMetrics: {
    activeOffers: number;
    pairOpenRequests: number;
    pairCompletedSwaps: number;
    rateWindow: { min: number; max: number };
  };
  requestGuidance: Offer["requestGuidance"];
  flowExpectations: {
    public: string;
    private: string;
  };
}

function formatTimestamp(value?: string | null) {
  if (!value) {
    return "No trades recorded yet";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "No trades recorded yet";
  }

  return date.toLocaleString();
}

function getBacklogTone(level: "light" | "moderate" | "heavy") {
  if (level === "heavy") {
    return {
      label: "Heavy queue",
      variant: "error" as const,
      detail: "Expect the seller to manage multiple requests before yours.",
    };
  }
  if (level === "moderate") {
    return {
      label: "Moderate queue",
      variant: "warning" as const,
      detail: "There is existing demand, but execution should still be manageable.",
    };
  }
  return {
    label: "Light queue",
    variant: "success" as const,
    detail: "Low backlog usually means a cleaner handoff to execution.",
  };
}

function getConfidenceTone(score: number) {
  if (score >= 85) {
    return {
      label: "Strong execution signal",
      variant: "success" as const,
      detail: "Seller and offer history both point to a reliable request path.",
    };
  }
  if (score >= 65) {
    return {
      label: "Balanced execution signal",
      variant: "warning" as const,
      detail: "The trade path looks workable, but you should still watch backlog and mode choice.",
    };
  }
  return {
    label: "Early-stage execution signal",
    variant: "error" as const,
    detail: "The listing is still building its track record, so keep the first trade conservative.",
  };
}

function InsightCard({
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
    <Card variant="glass" className="h-full">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">{title}</p>
          <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
          <p className="mt-2 text-sm leading-6 text-slate-400">{detail}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-slate-950/80 p-3 text-indigo-300">
          {icon}
        </div>
      </div>
    </Card>
  );
}

function RequestReview({
  offer,
  insights,
  amountIn,
  amountOut,
  isPrivate,
}: {
  offer: Offer;
  insights: OfferInsights;
  amountIn: number;
  amountOut: number;
  isPrivate: boolean;
}) {
  const queueTone = getBacklogTone(insights.requestGuidance.backlogLevel);
  const confidenceTone = getConfidenceTone(insights.requestGuidance.confidenceScore);

  return (
    <Card variant="neon" className="mt-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Request Review</p>
          <h3 className="mt-2 text-xl font-semibold text-white">Before you submit</h3>
        </div>
        <Badge variant={confidenceTone.variant}>{confidenceTone.label}</Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Funding leg</p>
          <p className="mt-2 text-xl font-semibold text-white">
            {amountIn.toFixed(4)} {offer.assetIn}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            This is the amount your request will fund on creation. The listed seller is offering {offer.assetOut} at a
            rate of {offer.rate} {offer.assetOut} per {offer.assetIn}.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Expected receive leg</p>
          <p className="mt-2 text-xl font-semibold text-white">
            {amountOut.toFixed(4)} {offer.assetOut}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            If the seller accepts and execution completes, this is the amount the current quote targets before any
            manual retries or private proof steps.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">Queue pressure</p>
            <Badge variant={queueTone.variant}>{queueTone.label}</Badge>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-400">{queueTone.detail}</p>
          <p className="mt-3 text-sm text-white">
            Open requests: {insights.offerMetrics.openRequests} | Active executions: {insights.offerMetrics.activeExecutions}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Mode expectation</p>
          <p className="mt-2 flex items-center gap-2 text-sm font-medium text-white">
            {isPrivate ? <Shield className="h-4 w-4 text-emerald-300" /> : <Globe className="h-4 w-4 text-sky-300" />}
            {isPrivate ? "Private swap flow selected" : "Public swap flow selected"}
          </p>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            {isPrivate ? insights.flowExpectations.private : insights.flowExpectations.public}
          </p>
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-indigo-500/20 bg-indigo-500/10 p-4">
        <p className="text-sm font-medium text-indigo-100">Execution notes</p>
        <ul className="mt-3 space-y-2 text-sm leading-6 text-indigo-50/90">
          {insights.requestGuidance.notes.map((note) => (
            <li key={note} className="flex items-start gap-2">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-indigo-300" />
              <span>{note}</span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

export default function SwapOfferPage() {
  const params = useParams();
  const router = useRouter();
  const { isPrivate } = usePrivacy();
  const offerId = params.id as string;

  const [offer, setOffer] = useState<Offer | null>(null);
  const [insights, setInsights] = useState<OfferInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [amountIn, setAmountIn] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const [offerRes, insightsRes] = await Promise.all([
          fetch(`${API_URL}/offers/${offerId}`),
          fetch(`${API_URL}/offers/${offerId}/insights`),
        ]);

        const [offerData, insightsData] = await Promise.all([
          offerRes.json().catch(() => null),
          insightsRes.json().catch(() => null),
        ]);

        if (!offerRes.ok || !offerData) {
          throw new Error("Failed to load offer");
        }
        if (!insightsRes.ok || !insightsData) {
          throw new Error("Failed to load offer insights");
        }

        setOffer(offerData);
        setInsights(insightsData);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load offer");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [offerId]);

  const parsedAmountIn = useMemo(() => {
    const numeric = Number.parseFloat(amountIn);
    return Number.isFinite(numeric) ? numeric : 0;
  }, [amountIn]);

  const amountOut = useMemo(() => {
    if (!offer) {
      return 0;
    }
    return parsedAmountIn * offer.rate;
  }, [offer, parsedAmountIn]);

  const amountState = useMemo(() => {
    if (!offer) {
      return { valid: false, detail: "Offer unavailable." };
    }
    if (!amountIn) {
      return { valid: false, detail: `Enter an amount between ${offer.min} and ${offer.max} ${offer.assetIn}.` };
    }
    if (!Number.isFinite(parsedAmountIn) || parsedAmountIn <= 0) {
      return { valid: false, detail: "Please enter a positive number." };
    }
    if (parsedAmountIn < offer.min) {
      return { valid: false, detail: `This listing starts at ${offer.min} ${offer.assetIn}.` };
    }
    if (parsedAmountIn > offer.max) {
      return { valid: false, detail: `This listing caps requests at ${offer.max} ${offer.assetIn}.` };
    }
    return { valid: true, detail: "Request amount is within the published trading band." };
  }, [amountIn, offer, parsedAmountIn]);

  const handleSwap = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!offer || !amountState.valid) {
      setError(amountState.detail);
      return;
    }

    setSubmitting(true);
    setError("");
    setSuccessMessage("");

    try {
      const res = await fetch(`${API_URL}/swap/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          bobId: offer.merchantId._id,
          amountIn: parsedAmountIn,
          amountOut,
          offerId: offer._id,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || data.error || "Failed to create swap request");
      }

      setSuccessMessage(
        isPrivate
          ? "Request sent. The seller can accept, then both sides can begin proof collection for private execution."
          : "Request sent. The seller can accept, then complete public execution on-chain.",
      );
      setTimeout(() => router.push("/swap/my"), 2200);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create swap request");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  if (!offer || !insights) {
    return (
      <main className="mx-auto max-w-lg p-8 text-center">
        <Card variant="glass" className="p-8">
          <AlertCircle className="mx-auto mb-4 h-12 w-12 text-red-400" />
          <h2 className="mb-2 text-xl font-bold text-white">Offer Not Found</h2>
          <p className="mb-6 text-slate-400">
            The offer you are looking for does not exist, is inactive, or could not be loaded cleanly.
          </p>
          <Link href="/swap">
            <Button variant="outline">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Market
            </Button>
          </Link>
        </Card>
      </main>
    );
  }

  const queueTone = getBacklogTone(insights.requestGuidance.backlogLevel);
  const confidenceTone = getConfidenceTone(insights.requestGuidance.confidenceScore);

  return (
    <div className="relative flex min-h-screen w-full flex-col items-center overflow-hidden pb-20 pt-8 md:pt-16">
      <div className="pointer-events-none absolute inset-0 z-0 opacity-40">
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

      <main className="relative z-10 w-full max-w-6xl px-4">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Offer Planning</p>
            <h1 className="mt-2 text-3xl font-bold text-white">
              Request {offer.assetOut} from @{offer.merchantId?.username || "Unknown"}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
              This page combines the quoted price with recent seller and offer execution signals so you can decide
              whether to request a public settlement or a private proof flow.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant={confidenceTone.variant}>{confidenceTone.label}</Badge>
            <Badge variant={queueTone.variant}>{queueTone.label}</Badge>
            <Badge variant={isPrivate ? "success" : "warning"}>
              {isPrivate ? (
                <span className="flex items-center gap-1">
                  <Shield className="h-3.5 w-3.5" />
                  Private Mode
                </span>
              ) : (
                <span className="flex items-center gap-1">
                  <Globe className="h-3.5 w-3.5" />
                  Public Mode
                </span>
              )}
            </Badge>
          </div>
        </div>

        <section className="mb-6 grid gap-4 md:grid-cols-4">
          <InsightCard
            title="Seller completion rate"
            value={`${insights.merchantMetrics.completionRate}%`}
            detail="Based on completed versus failed settlements recorded for this seller as the executing side."
            icon={<TrendingUp className="h-5 w-5" />}
          />
          <InsightCard
            title="Offer completed swaps"
            value={String(insights.offerMetrics.completedSwaps)}
            detail="Number of historical settlements already routed through this exact listing."
            icon={<CheckCircle className="h-5 w-5" />}
          />
          <InsightCard
            title="Open request queue"
            value={String(insights.offerMetrics.openRequests)}
            detail="Requests still waiting on acceptance or movement into proof/execution stages."
            icon={<Clock3 className="h-5 w-5" />}
          />
          <InsightCard
            title="Pair coverage"
            value={String(insights.pairMetrics.activeOffers)}
            detail={`Active listings currently available for ${offer.assetIn}/${offer.assetOut}.`}
            icon={<Layers3 className="h-5 w-5" />}
          />
        </section>

        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-6">
            {successMessage ? (
              <Card
                variant="glass"
                className="flex flex-col items-center border border-green-500/30 p-8 text-center"
              >
                <CheckCircle className="mb-4 h-16 w-16 text-green-400" />
                <h3 className="text-2xl font-bold text-white">Request Sent</h3>
                <p className="mt-3 max-w-xl text-slate-400">{successMessage}</p>
              </Card>
            ) : (
              <form onSubmit={handleSwap}>
                <div className="rounded-[32px] border border-white/5 bg-slate-900/80 p-6 shadow-xl backdrop-blur-md transition-all hover:bg-slate-900">
                  <div className="mb-6 flex items-center justify-between gap-4">
                    <div>
                      <span className="text-sm font-medium text-slate-400">You Pay</span>
                      <p className="mt-1 text-xs text-slate-500">Request amount must stay inside the merchant band.</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Wallet className="h-4 w-4 text-slate-500" />
                      <span className="text-xs font-mono text-slate-300">
                        {offer.min} - {offer.max} {offer.assetIn}
                      </span>
                      <button
                        type="button"
                        onClick={() => setAmountIn(offer.max.toString())}
                        className="rounded-full border border-white/10 bg-black px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white transition-colors hover:bg-slate-800"
                      >
                        Max
                      </button>
                    </div>
                  </div>

                  <div className="mb-2 flex items-center justify-between gap-4">
                    <div className="flex cursor-default items-center gap-2 rounded-full bg-slate-800/50 px-3 py-1">
                      <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-white/5 bg-white p-1">
                        <img
                          src={
                            offer.assetIn === "USDC"
                              ? "https://cryptologos.cc/logos/usd-coin-usdc-logo.svg?v=035"
                              : "https://cryptologos.cc/logos/stellar-xlm-logo.svg?v=035"
                          }
                          alt={offer.assetIn}
                          className="h-full w-full object-contain"
                        />
                      </div>
                      <span className="ml-1 text-xl font-bold text-white">{offer.assetIn}</span>
                      <ArrowRight className="ml-1 h-3 w-3 rotate-90 text-slate-500" />
                    </div>
                    <div className="ml-4 flex flex-1 flex-col items-end justify-end text-right">
                      <input
                        type="number"
                        step="any"
                        min={offer.min}
                        max={offer.max}
                        value={amountIn}
                        onChange={(event) => setAmountIn(event.target.value)}
                        placeholder="0.00"
                        required
                        className="block w-full bg-transparent text-right text-3xl font-bold text-white placeholder-slate-600 focus:outline-none md:text-4xl"
                      />
                      <span className="mt-1 text-xs text-slate-500">{amountState.detail}</span>
                    </div>
                  </div>
                </div>

                <div className="relative z-10 flex h-2 items-center justify-center">
                  <div className="absolute flex h-12 w-12 cursor-default items-center justify-center rounded-full border-4 border-[#020617] bg-slate-900 shadow-lg">
                    <ArrowUpDown className="h-5 w-5 text-slate-400" />
                  </div>
                </div>

                <div className="-mt-2 rounded-[32px] border border-white/5 bg-slate-900/80 p-6 pt-8 shadow-xl backdrop-blur-md transition-all hover:bg-slate-900">
                  <div className="mb-6 flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-400">You Receive</span>
                    <Badge variant="default">{insights.pricing.spreadBand.toUpperCase()}</Badge>
                  </div>

                  <div className="mb-2 flex items-center justify-between gap-4">
                    <div className="flex cursor-default items-center gap-2 rounded-full bg-slate-800/50 px-3 py-1">
                      <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-white/5 bg-white p-1">
                        <img
                          src={
                            offer.assetOut === "USDC"
                              ? "https://cryptologos.cc/logos/usd-coin-usdc-logo.svg?v=035"
                              : "https://cryptologos.cc/logos/stellar-xlm-logo.svg?v=035"
                          }
                          alt={offer.assetOut}
                          className="h-full w-full object-contain"
                        />
                      </div>
                      <span className="ml-1 text-xl font-bold text-white">{offer.assetOut}</span>
                      <ArrowRight className="ml-1 h-3 w-3 rotate-90 text-slate-500" />
                    </div>
                    <div className="ml-4 flex flex-1 flex-col items-end text-right">
                      <div className="w-full truncate text-3xl font-bold text-white md:text-4xl">
                        {amountOut.toFixed(6)}
                      </div>
                      <span className="mt-1 text-xs text-slate-500">
                        1 {offer.assetIn} = {offer.rate} {offer.assetOut}
                      </span>
                    </div>
                  </div>
                </div>

                {error && (
                  <div className="mb-6 mt-6 flex items-start gap-2 rounded-lg border border-red-500/50 bg-red-900/20 p-3 text-sm text-red-300">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    {error}
                  </div>
                )}

                <RequestReview
                  offer={offer}
                  insights={insights}
                  amountIn={parsedAmountIn}
                  amountOut={amountOut}
                  isPrivate={isPrivate}
                />

                <div className="mt-8">
                  <button
                    type="submit"
                    disabled={submitting || !amountState.valid}
                    className="relative flex h-[68px] w-full items-center justify-center rounded-full border border-white/10 bg-black text-lg font-medium text-white shadow-2xl transition-colors hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {submitting ? (
                      <span className="flex items-center gap-2 font-bold">
                        <svg
                          className="-ml-1 mr-3 h-5 w-5 animate-spin text-indigo-400"
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          ></circle>
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                          ></path>
                        </svg>
                        Creating request...
                      </span>
                    ) : (
                      <>
                        <div className="absolute left-2 flex h-[52px] w-[52px] items-center justify-center overflow-hidden rounded-full bg-slate-800 text-white shadow-inner transition-colors group-hover:bg-slate-700">
                          <div className="absolute inset-0 bg-gradient-to-tr from-white/10 to-transparent"></div>
                          {isPrivate ? (
                            <Shield className="z-10 h-6 w-6 text-slate-300" />
                          ) : (
                            <Globe className="z-10 h-6 w-6 text-slate-300" />
                          )}
                        </div>
                        <span className="ml-4 font-bold tracking-wide text-slate-200 transition-colors group-hover:text-white">
                          {isPrivate ? "Create Private Swap Request" : "Create Public Swap Request"}
                        </span>
                        <div className="pointer-events-none absolute right-6 flex items-center space-x-[-2px] text-slate-400 opacity-40 transition-all group-hover:translate-x-1 group-hover:opacity-60">
                          <ArrowRight size={18} />
                          <ArrowRight size={18} />
                          <ArrowRight size={18} />
                        </div>
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>

          <div className="space-y-6">
            <Card variant="glass">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Seller profile</p>
                  <h3 className="mt-2 text-xl font-semibold text-white">@{offer.merchantId?.username || "Unknown"}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    Reputation is one signal, but actual settlement history gives better evidence for whether a request
                    tends to move cleanly through acceptance and execution.
                  </p>
                </div>
                {offer.merchantId?.reputation !== undefined && (
                  <Badge variant="warning">
                    <Star className="mr-1 h-3 w-3 fill-current" />
                    {offer.merchantId.reputation}
                  </Badge>
                )}
              </div>

              <div className="mt-5 grid gap-3">
                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Completed as seller</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{insights.merchantMetrics.completedAsSeller}</p>
                  <p className="mt-2 text-sm text-slate-400">
                    Last seller-side completion: {formatTimestamp(insights.merchantMetrics.lastCompletedAt)}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Current seller load</p>
                  <p className="mt-2 text-2xl font-semibold text-white">
                    {insights.merchantMetrics.pendingAsSeller + insights.merchantMetrics.activeAsSeller}
                  </p>
                  <p className="mt-2 text-sm text-slate-400">
                    Pending requests: {insights.merchantMetrics.pendingAsSeller} | Active execution flow:{" "}
                    {insights.merchantMetrics.activeAsSeller}
                  </p>
                </div>
              </div>
            </Card>

            <Card variant="glass">
              <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Offer health</p>
              <div className="mt-4 space-y-4">
                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-white">Offer completion rate</p>
                    <Badge variant={insights.offerMetrics.completionRate >= 80 ? "success" : "warning"}>
                      {insights.offerMetrics.completionRate}%
                    </Badge>
                  </div>
                  <p className="mt-2 text-sm text-slate-400">
                    Completed: {insights.offerMetrics.completedSwaps} | Failed: {insights.offerMetrics.failedSwaps}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <p className="text-sm font-medium text-white">Average request size</p>
                  <p className="mt-2 text-2xl font-semibold text-white">
                    {insights.offerMetrics.averageTicketSize || 0} {offer.assetIn}
                  </p>
                  <p className="mt-2 text-sm text-slate-400">
                    Recent completed trades on this listing help estimate whether your chosen size matches prior flow.
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <p className="text-sm font-medium text-white">Last trade on this listing</p>
                  <p className="mt-2 text-sm text-slate-300">{formatTimestamp(insights.offerMetrics.lastTradedAt)}</p>
                </div>
              </div>
            </Card>

            <Card variant="glass">
              <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Pair demand</p>
              <div className="mt-4 space-y-4">
                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <p className="text-sm font-medium text-white">{offer.assetIn}/{offer.assetOut} market window</p>
                  <p className="mt-2 text-sm text-slate-400">
                    Rate range across active listings: {insights.pairMetrics.rateWindow.min} - {insights.pairMetrics.rateWindow.max}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <p className="text-sm font-medium text-white">Open pair requests</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{insights.pairMetrics.pairOpenRequests}</p>
                  <p className="mt-2 text-sm text-slate-400">
                    Use this as a rough demand signal for how busy this trading pair is overall.
                  </p>
                </div>
              </div>
            </Card>

            <Card variant="glass">
              <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Execution modes</p>
              <div className="mt-4 space-y-3">
                {offer.executionModes.map((mode) => (
                  <div key={mode.mode} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                    <div className="flex items-center gap-2 text-white">
                      {mode.mode === "private" ? (
                        <Shield className="h-4 w-4 text-emerald-300" />
                      ) : (
                        <Globe className="h-4 w-4 text-sky-300" />
                      )}
                      <span className="font-medium">{mode.label || mode.mode}</span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-400">{mode.detail}</p>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>

        <div className="mt-8 flex justify-center text-xs text-slate-600">
          <Link href="/swap" className="inline-flex items-center transition-colors hover:text-slate-400">
            <ArrowLeft className="mr-1 h-3 w-3" />
            Back to Market
          </Link>
        </div>
      </main>
    </div>
  );
}
