"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PrivacyToggle } from "@/components/ui/PrivacyToggle";
import { usePrivacy } from "@/context/PrivacyContext";
import {
  ArrowRight,
  BarChart3,
  CheckCircle,
  Clock3,
  Filter,
  Globe,
  Layers3,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Sparkles,
  Star,
  TrendingUp,
  Wallet,
} from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api";

interface ExecutionMode {
  mode: "public" | "private";
  label: string;
  detail: string;
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

interface EnrichedOffer {
  _id: string;
  assetIn: "USDC" | "XLM";
  assetOut: "USDC" | "XLM";
  rate: number;
  min: number;
  max: number;
  active: boolean;
  merchantId?: { username: string; _id: string; reputation?: number };
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

interface MarketHighlights {
  activeOffers: number;
  openRequests: number;
  proofsReady: number;
  executing: number;
  completedLastWeek: number;
  executionModes: Array<{ mode: "public" | "private"; detail: string }>;
}

function formatTimestamp(value?: string | null) {
  if (!value) {
    return "No recent trades";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "No recent trades";
  }
  return date.toLocaleString();
}

function getBacklogTone(level: "light" | "moderate" | "heavy") {
  if (level === "heavy") {
    return {
      variant: "error" as const,
      label: "Heavy queue",
      detail: "Expect the seller to already be juggling several requests.",
    };
  }
  if (level === "moderate") {
    return {
      variant: "warning" as const,
      label: "Moderate queue",
      detail: "There is active demand, but not enough to fully crowd the listing.",
    };
  }
  return {
    variant: "success" as const,
    label: "Light queue",
    detail: "This listing currently has a lighter request backlog.",
  };
}

function getConfidenceTone(score: number) {
  if (score >= 85) {
    return {
      variant: "success" as const,
      label: "High trust signal",
      detail: "The seller and listing both show strong settlement evidence.",
    };
  }
  if (score >= 65) {
    return {
      variant: "warning" as const,
      label: "Medium trust signal",
      detail: "The offer is usable, but you should still watch backlog and mode fit.",
    };
  }
  return {
    variant: "error" as const,
    label: "Early trust signal",
    detail: "The listing still needs more successful settlements to feel proven.",
  };
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

function OfferCard({
  offer,
  isPrivate,
}: {
  offer: EnrichedOffer;
  isPrivate: boolean;
}) {
  const backlogTone = getBacklogTone(offer.requestGuidance.backlogLevel);
  const confidenceTone = getConfidenceTone(offer.requestGuidance.confidenceScore);

  return (
    <Card variant="glass" className="h-full transition-colors hover:bg-slate-800/55">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <span className="text-lg font-semibold text-white">@{offer.merchantId?.username || "Unknown"}</span>
            {offer.merchantId?.reputation !== undefined && (
              <Badge variant="warning" className="px-1.5 py-0.5 text-xs">
                <Star className="mr-1 h-3 w-3 fill-current" />
                {offer.merchantId.reputation}
              </Badge>
            )}
          </div>
          <p className="text-sm leading-6 text-slate-400">
            {confidenceTone.detail}
          </p>
        </div>
        <Badge variant={confidenceTone.variant}>{confidenceTone.label}</Badge>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Quoted rate</p>
            <p className="mt-2 text-3xl font-semibold text-white">
              {offer.rate}
              <span className="ml-2 text-sm font-normal text-slate-400">
                {offer.assetOut}/{offer.assetIn}
              </span>
            </p>
          </div>
          <Badge variant={backlogTone.variant}>{backlogTone.label}</Badge>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">Trade band</p>
            <p className="mt-2 text-sm font-medium text-white">
              {offer.min} - {offer.max} {offer.assetIn}
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">Recommended mode</p>
            <p className="mt-2 flex items-center gap-2 text-sm font-medium text-white">
              {offer.requestGuidance.recommendedMode === "private" ? (
                <Shield className="h-4 w-4 text-emerald-300" />
              ) : (
                <Globe className="h-4 w-4 text-sky-300" />
              )}
              {offer.requestGuidance.recommendedMode === "private" ? "Private flow" : "Public flow"}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Seller completions</p>
          <p className="mt-2 text-xl font-semibold text-white">{offer.merchantMetrics.completedAsSeller}</p>
          <p className="mt-1 text-xs text-slate-400">
            {offer.merchantMetrics.completionRate}% seller-side completion rate
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Offer workload</p>
          <p className="mt-2 text-xl font-semibold text-white">
            {offer.offerMetrics.openRequests + offer.offerMetrics.activeExecutions}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Requests: {offer.offerMetrics.openRequests} | Executing: {offer.offerMetrics.activeExecutions}
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Last trade</p>
          <p className="mt-2 text-sm font-medium text-white">{formatTimestamp(offer.offerMetrics.lastTradedAt)}</p>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-indigo-500/20 bg-indigo-500/10 p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-indigo-100">Execution hint</p>
          <Badge variant={isPrivate ? "success" : "warning"}>
            {isPrivate ? "Private mode selected" : "Public mode selected"}
          </Badge>
        </div>
        <p className="mt-2 text-sm leading-6 text-indigo-50/90">
          {isPrivate
            ? offer.executionModes.find((mode) => mode.mode === "private")?.detail
            : offer.executionModes.find((mode) => mode.mode === "public")?.detail}
        </p>
        <ul className="mt-3 space-y-2 text-sm leading-6 text-indigo-50/90">
          {offer.requestGuidance.notes.slice(0, 2).map((note) => (
            <li key={note} className="flex items-start gap-2">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-indigo-300" />
              <span>{note}</span>
            </li>
          ))}
        </ul>
      </div>

      <Link href={`/swap/${offer._id}`} className="mt-5 block">
        <Button className="w-full">
          Review Offer
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </Link>
    </Card>
  );
}

export default function SwapPage() {
  const { isPrivate, togglePrivacy } = usePrivacy();

  const [offers, setOffers] = useState<EnrichedOffer[]>([]);
  const [highlights, setHighlights] = useState<MarketHighlights | null>(null);
  const [loading, setLoading] = useState(true);
  const [assetInFilter, setAssetInFilter] = useState<"" | "USDC" | "XLM">("");
  const [assetOutFilter, setAssetOutFilter] = useState<"" | "USDC" | "XLM">("");
  const [amountFilter, setAmountFilter] = useState("");
  const [queryError, setQueryError] = useState("");

  const fetchMarket = async () => {
    setLoading(true);
    setQueryError("");
    try {
      const params = new URLSearchParams();
      if (assetInFilter) {
        params.set("assetIn", assetInFilter);
      }
      if (assetOutFilter) {
        params.set("assetOut", assetOutFilter);
      }
      if (amountFilter) {
        params.set("amount", amountFilter);
      }

      const [offersRes, highlightsRes] = await Promise.all([
        fetch(`${API_URL}/offers${params.toString() ? `?${params.toString()}` : ""}`),
        fetch(`${API_URL}/offers/market/highlights`),
      ]);

      const [offersData, highlightsData] = await Promise.all([
        offersRes.json().catch(() => []),
        highlightsRes.json().catch(() => null),
      ]);

      if (!offersRes.ok) {
        throw new Error("Failed to load offers");
      }
      if (!highlightsRes.ok) {
        throw new Error("Failed to load market highlights");
      }

      setOffers(Array.isArray(offersData) ? offersData : []);
      setHighlights(highlightsData);
    } catch (err) {
      setQueryError(err instanceof Error ? err.message : "Failed to load market");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMarket();
  }, []);

  const filteredSummary = useMemo(() => {
    if (!offers.length) {
      return {
        averageRate: 0,
        strongestConfidence: 0,
        lowestBacklog: 0,
      };
    }

    const averageRate =
      offers.reduce((sum, offer) => sum + offer.rate, 0) / offers.length;
    const strongestConfidence = Math.max(...offers.map((offer) => offer.requestGuidance.confidenceScore));
    const lowestBacklog = Math.min(...offers.map((offer) => offer.offerMetrics.openRequests));

    return {
      averageRate: Number(averageRate.toFixed(4)),
      strongestConfidence,
      lowestBacklog,
    };
  }, [offers]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  return (
    <div className="mx-auto mb-8 flex min-h-[50vh] max-w-[1500px] flex-col rounded-[32px] border border-white/5 bg-slate-900/30 p-8 text-white selection:bg-indigo-500/30 lg:p-12">
      <div className="absolute right-8 top-6 z-20">
        <PrivacyToggle checked={isPrivate} onCheckedChange={togglePrivacy} />
      </div>

      <main className="relative z-10 mx-auto w-full max-w-6xl space-y-8 pt-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-slate-500">P2P Market Intelligence</p>
            <h1 className="mt-2 bg-gradient-to-r from-white to-slate-400 bg-clip-text text-3xl font-bold text-transparent">
              Browse execution-ready offers
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
              The marketplace now surfaces seller history, listing backlog, and pair demand so you can choose a trade
              path with more context than just price.
            </p>
          </div>
          <div className="flex gap-3">
            <Link href="/swap/my">
              <Button variant="ghost">
                <Wallet className="mr-2 h-4 w-4" />
                My Swaps
              </Button>
            </Link>
            <Link href="/swap/create">
              <Button variant="primary">
                <Plus className="mr-2 h-4 w-4" />
                Create Offer
              </Button>
            </Link>
          </div>
        </div>

        {queryError && (
          <Card variant="default" className="border-red-500/40 bg-red-900/20 text-red-100">
            {queryError}
          </Card>
        )}

        <section className="grid gap-4 md:grid-cols-4">
          <MetricCard
            title="Active offers"
            value={String(highlights?.activeOffers ?? 0)}
            detail="Listings currently open for new swap requests."
            icon={<Layers3 className="h-5 w-5" />}
          />
          <MetricCard
            title="Open requests"
            value={String(highlights?.openRequests ?? 0)}
            detail="Outstanding requests still waiting on seller acceptance."
            icon={<Clock3 className="h-5 w-5" />}
          />
          <MetricCard
            title="Proofs ready"
            value={String(highlights?.proofsReady ?? 0)}
            detail="Private swaps that have both proofs gathered and are ready to execute."
            icon={<Shield className="h-5 w-5" />}
          />
          <MetricCard
            title="Completed this week"
            value={String(highlights?.completedLastWeek ?? 0)}
            detail="A rough signal for how active the broader market has been recently."
            icon={<TrendingUp className="h-5 w-5" />}
          />
        </section>

        <section className="grid gap-6 lg:grid-cols-[0.78fr_0.22fr]">
          <Card variant="glass">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Filters</p>
                <h2 className="mt-2 text-xl font-semibold text-white">Shape the market view</h2>
              </div>
              <Button variant="ghost" onClick={() => fetchMarket()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh
              </Button>
            </div>

            <div className="grid gap-4 md:grid-cols-4">
              <label className="block">
                <span className="mb-2 block text-xs uppercase tracking-wide text-slate-500">Pay asset</span>
                <select
                  value={assetInFilter}
                  onChange={(event) => setAssetInFilter(event.target.value as "" | "USDC" | "XLM")}
                  className="w-full rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none transition focus:border-indigo-500"
                >
                  <option value="">All</option>
                  <option value="XLM">XLM</option>
                  <option value="USDC">USDC</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-xs uppercase tracking-wide text-slate-500">Receive asset</span>
                <select
                  value={assetOutFilter}
                  onChange={(event) => setAssetOutFilter(event.target.value as "" | "USDC" | "XLM")}
                  className="w-full rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none transition focus:border-indigo-500"
                >
                  <option value="">All</option>
                  <option value="USDC">USDC</option>
                  <option value="XLM">XLM</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-xs uppercase tracking-wide text-slate-500">Request amount</span>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input
                    value={amountFilter}
                    onChange={(event) => setAmountFilter(event.target.value)}
                    placeholder="Amount"
                    type="number"
                    className="w-full rounded-2xl border border-slate-800 bg-slate-950/70 py-3 pl-10 pr-4 text-sm text-white outline-none transition focus:border-indigo-500"
                  />
                </div>
              </label>

              <div className="flex items-end">
                <Button className="w-full" onClick={() => fetchMarket()}>
                  <Filter className="mr-2 h-4 w-4" />
                  Apply Filters
                </Button>
              </div>
            </div>
          </Card>

          <Card variant="glass">
            <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Filtered snapshot</p>
            <div className="mt-4 space-y-4">
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Visible offers</p>
                <p className="mt-2 text-3xl font-semibold text-white">{offers.length}</p>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Average rate</p>
                <p className="mt-2 text-2xl font-semibold text-white">{filteredSummary.averageRate}</p>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Best confidence</p>
                <p className="mt-2 text-2xl font-semibold text-white">{filteredSummary.strongestConfidence}%</p>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Lowest visible backlog</p>
                <p className="mt-2 text-2xl font-semibold text-white">{filteredSummary.lowestBacklog}</p>
              </div>
            </div>
          </Card>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          {(highlights?.executionModes ?? []).map((mode) => (
            <Card key={mode.mode} variant="glass">
              <div className="flex items-start gap-3">
                <div className="rounded-2xl border border-white/10 bg-slate-950/80 p-3 text-indigo-300">
                  {mode.mode === "private" ? <Shield className="h-5 w-5" /> : <Globe className="h-5 w-5" />}
                </div>
                <div>
                  <p className="text-sm font-medium text-white">
                    {mode.mode === "private" ? "Private proof flow" : "Public settlement flow"}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-400">{mode.detail}</p>
                </div>
              </div>
            </Card>
          ))}
        </section>

        <section>
          <div className="mb-4 flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-indigo-400" />
            <h2 className="text-xl font-semibold text-white">Available offers</h2>
          </div>

          {offers.length === 0 ? (
            <Card variant="glass" className="py-12 text-center">
              <div className="flex flex-col items-center gap-4">
                <RefreshCw size={48} className="text-slate-600" />
                <p className="text-lg text-slate-400">No offers match this view.</p>
                <p className="max-w-sm text-sm text-slate-500">
                  Try broadening the filters or publish a new offer to seed the market.
                </p>
                <Link href="/swap/create" className="mt-2">
                  <Button variant="outline">Create New Offer</Button>
                </Link>
              </div>
            </Card>
          ) : (
            <div className="grid gap-5 lg:grid-cols-2">
              {offers.map((offer) => (
                <OfferCard key={offer._id} offer={offer} isPrivate={isPrivate} />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
