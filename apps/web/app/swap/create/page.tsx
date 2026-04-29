'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import {
  AlertCircle,
  ArrowLeft,
  ArrowUpDown,
  CheckCircle,
  Clock3,
  Gauge,
  Globe,
  Layers3,
  RefreshCw,
  Shield,
  Sparkles,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import Prism from '@/components/ui/Prism';
import { usePrivacy } from '@/context/PrivacyContext';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api';

type Asset = 'USDC' | 'XLM';

interface OfferPreview {
  merchant: {
    id: string;
    existingOffers: number;
    activeOffers: number;
    completedAsSeller: number;
    sellerCompletionRate: number;
  };
  listing: {
    assetIn: Asset;
    assetOut: Asset;
    rate: number;
    min: number;
    max: number;
    bandWidth: number;
  };
  marketContext: {
    pairMetrics: {
      activeOffers: number;
      pairOpenRequests: number;
      pairCompletedSwaps: number;
      rateWindow: {
        min: number;
        max: number;
      };
    };
    nearestRates: {
      lower: number | null;
      upper: number | null;
      median: number | null;
    };
    percentileHint: string;
  };
  diagnostics: Array<{
    label: string;
    tone: 'good' | 'caution' | 'risk';
    detail: string;
  }>;
  publishingGuidance: {
    readinessScore: number;
    launchTone: 'good' | 'caution' | 'risk';
    notes: string[];
  };
}

function parseNumber(value: string) {
  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function getToneVariant(tone: 'good' | 'caution' | 'risk') {
  if (tone === 'good') {
    return 'success' as const;
  }
  if (tone === 'caution') {
    return 'warning' as const;
  }
  return 'error' as const;
}

function getPercentileLabel(position: string) {
  switch (position) {
    case 'first_listing':
      return 'First visible listing';
    case 'aggressive_low':
      return 'Aggressive discount';
    case 'discount_edge':
      return 'Discount edge';
    case 'aggressive_high':
      return 'Aggressive premium';
    case 'premium_edge':
      return 'Premium edge';
    default:
      return 'Balanced band';
  }
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

export default function CreateOfferPage() {
  const router = useRouter();
  const { isPrivate } = usePrivacy();

  const [assetIn, setAssetIn] = useState<Asset>('XLM');
  const [assetOut, setAssetOut] = useState<Asset>('USDC');
  const [rate, setRate] = useState('');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [preview, setPreview] = useState<OfferPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [error, setError] = useState('');

  const numericRate = useMemo(() => parseNumber(rate), [rate]);
  const numericMin = useMemo(() => parseNumber(min), [min]);
  const numericMax = useMemo(() => parseNumber(max), [max]);

  const draftState = useMemo(() => {
    if (!numericRate || numericRate <= 0) {
      return {
        valid: false,
        detail: 'Set a positive exchange rate for the listing.',
      };
    }
    if (!numericMin || numericMin <= 0) {
      return {
        valid: false,
        detail: 'Set a positive minimum request size.',
      };
    }
    if (!numericMax || numericMax <= 0) {
      return {
        valid: false,
        detail: 'Set a positive maximum request size.',
      };
    }
    if (numericMax < numericMin) {
      return {
        valid: false,
        detail: 'Maximum size must be greater than or equal to the minimum size.',
      };
    }
    if (assetIn === assetOut) {
      return {
        valid: false,
        detail: 'Input and output assets must be different.',
      };
    }
    return {
      valid: true,
      detail: 'Draft is structurally valid. Preview will estimate how publishable it looks.',
    };
  }, [assetIn, assetOut, numericMax, numericMin, numericRate]);

  const fetchPreview = async () => {
    if (!draftState.valid || numericRate === null || numericMin === null || numericMax === null) {
      setPreview(null);
      return;
    }

    setPreviewLoading(true);
    setError('');

    try {
      const res = await fetch(`${API_URL}/offers/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          assetIn,
          assetOut,
          rate: numericRate,
          min: numericMin,
          max: numericMax,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        throw new Error(data?.message || data?.error || 'Failed to preview offer');
      }

      setPreview(data);
    } catch (err: unknown) {
      setPreview(null);
      setError(err instanceof Error ? err.message : 'Failed to preview offer');
    } finally {
      setPreviewLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetchPreview();
    }, 350);

    return () => window.clearTimeout(timer);
  }, [assetIn, assetOut, numericRate, numericMin, numericMax]);

  const handleCreate = async () => {
    if (!draftState.valid || numericRate === null || numericMin === null || numericMax === null) {
      setError(draftState.detail);
      return;
    }

    setSubmitting(true);
    setSuccessMessage('');
    setError('');

    try {
      const res = await fetch(`${API_URL}/offers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          assetIn,
          assetOut,
          rate: numericRate,
          min: numericMin,
          max: numericMax,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || data.error || 'Failed to create offer');
      }

      setSuccessMessage(
        'Offer created successfully. The listing is live on the market and will now appear with its execution diagnostics.',
      );
      setTimeout(() => router.push('/swap'), 1800);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create offer');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSwapAssets = () => {
    setAssetIn(assetOut);
    setAssetOut(assetIn);
  };

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
            <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Listing Planner</p>
            <h1 className="mt-2 text-3xl font-bold text-white">Create a market-ready offer</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
              This workspace previews how your listing fits the current market before you publish
              it: pair saturation, rate placement, seller readiness, and whether the ticket band
              feels usable.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant={isPrivate ? 'success' : 'warning'}>
              {isPrivate ? (
                <span className="flex items-center gap-1">
                  <Shield className="h-3.5 w-3.5" />
                  Private-first market context
                </span>
              ) : (
                <span className="flex items-center gap-1">
                  <Globe className="h-3.5 w-3.5" />
                  Public-first market context
                </span>
              )}
            </Badge>
            {previewLoading && (
              <Badge variant="default">
                <RefreshCw className="mr-1 h-3.5 w-3.5 animate-spin" />
                Previewing
              </Badge>
            )}
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="space-y-6">
            {successMessage ? (
              <Card variant="glass" className="border border-green-500/30 p-8 text-center">
                <CheckCircle className="mx-auto mb-4 h-16 w-16 text-green-400" />
                <h3 className="text-2xl font-bold text-white">Offer Published</h3>
                <p className="mt-3 text-slate-400">{successMessage}</p>
              </Card>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  handleCreate();
                }}
              >
                <div className="rounded-[32px] border border-white/5 bg-slate-900/80 p-6 shadow-xl backdrop-blur-md transition-all hover:bg-slate-900">
                  <div className="mb-6 flex items-center justify-between gap-4">
                    <div>
                      <span className="text-sm font-medium text-slate-400">You Sell</span>
                      <p className="mt-1 text-xs text-slate-500">
                        This defines what buyers bring into your listing.
                      </p>
                    </div>
                    <Badge variant="default">Rate anchor</Badge>
                  </div>

                  <div className="mb-2 flex items-center justify-between gap-4">
                    <div className="shrink-0 rounded-full bg-slate-800/50 px-3 py-1">
                      <div className="flex items-center gap-2">
                        <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-white/5 bg-white p-1">
                          <img
                            src={
                              assetIn === 'USDC'
                                ? 'https://cryptologos.cc/logos/usd-coin-usdc-logo.svg?v=035'
                                : 'https://cryptologos.cc/logos/stellar-xlm-logo.svg?v=035'
                            }
                            alt={assetIn}
                            className="h-full w-full object-contain"
                          />
                        </div>
                        <select
                          value={assetIn}
                          onChange={(event) => setAssetIn(event.target.value as Asset)}
                          className="cursor-pointer appearance-none bg-transparent pr-4 text-xl font-bold text-white focus:outline-none"
                        >
                          <option value="USDC" className="bg-slate-900 text-base">
                            USDC
                          </option>
                          <option value="XLM" className="bg-slate-900 text-base">
                            XLM
                          </option>
                        </select>
                      </div>
                    </div>

                    <div className="ml-4 flex w-full flex-1 flex-col items-end text-right">
                      <input
                        type="number"
                        placeholder="0.00"
                        value={rate}
                        onChange={(event) => setRate(event.target.value)}
                        required
                        step="any"
                        className="block w-full bg-transparent text-right text-3xl font-bold text-white placeholder-slate-600 focus:outline-none md:text-4xl"
                      />
                      <span className="mt-1 text-xs text-slate-500">
                        Amount of {assetOut} per 1 {assetIn}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="relative z-20 flex h-2 items-center justify-center">
                  <button
                    type="button"
                    onClick={handleSwapAssets}
                    className="absolute flex h-12 w-12 items-center justify-center rounded-full border-4 border-[#020617] bg-slate-900 shadow-lg transition-colors hover:bg-slate-800"
                    title="Swap assets"
                  >
                    <ArrowUpDown className="h-5 w-5 text-slate-400" />
                  </button>
                </div>

                <div className="-mt-2 rounded-[32px] border border-white/5 bg-slate-900/80 p-6 pt-10 shadow-xl backdrop-blur-md transition-all hover:bg-slate-900">
                  <div className="mb-6 flex items-center justify-between gap-4">
                    <div>
                      <span className="text-sm font-medium text-slate-400">Buyer Receives</span>
                      <p className="mt-1 text-xs text-slate-500">
                        This is the asset your listing pays out.
                      </p>
                    </div>
                    <Badge variant="default">Trade band</Badge>
                  </div>

                  <div className="mb-5 flex items-center justify-between gap-4">
                    <div className="rounded-full bg-slate-800/50 px-3 py-1">
                      <div className="flex items-center gap-2">
                        <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-white/5 bg-white p-1">
                          <img
                            src={
                              assetOut === 'USDC'
                                ? 'https://cryptologos.cc/logos/usd-coin-usdc-logo.svg?v=035'
                                : 'https://cryptologos.cc/logos/stellar-xlm-logo.svg?v=035'
                            }
                            alt={assetOut}
                            className="h-full w-full object-contain"
                          />
                        </div>
                        <select
                          value={assetOut}
                          onChange={(event) => setAssetOut(event.target.value as Asset)}
                          className="cursor-pointer appearance-none bg-transparent pr-4 text-xl font-bold text-white focus:outline-none"
                        >
                          <option value="USDC" className="bg-slate-900 text-base">
                            USDC
                          </option>
                          <option value="XLM" className="bg-slate-900 text-base">
                            XLM
                          </option>
                        </select>
                      </div>
                    </div>

                    <div className="text-right">
                      <p className="text-sm text-slate-500">Preview state</p>
                      <p className="mt-1 text-sm font-medium text-white">{draftState.detail}</p>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                      <p className="text-xs uppercase tracking-wide text-slate-500">
                        Minimum request size
                      </p>
                      <input
                        type="number"
                        placeholder="Min"
                        value={min}
                        onChange={(event) => setMin(event.target.value)}
                        required
                        step="any"
                        className="mt-3 block w-full bg-transparent text-3xl font-bold text-white placeholder-slate-600 focus:outline-none"
                      />
                      <p className="mt-2 text-xs text-slate-500">
                        Smaller requests below this size will be rejected.
                      </p>
                    </div>

                    <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                      <p className="text-xs uppercase tracking-wide text-slate-500">
                        Maximum request size
                      </p>
                      <input
                        type="number"
                        placeholder="Max"
                        value={max}
                        onChange={(event) => setMax(event.target.value)}
                        required
                        step="any"
                        className="mt-3 block w-full bg-transparent text-3xl font-bold text-white placeholder-slate-600 focus:outline-none"
                      />
                      <p className="mt-2 text-xs text-slate-500">
                        Larger requests above this size will be rejected.
                      </p>
                    </div>
                  </div>
                </div>

                {error && (
                  <div className="mb-6 mt-6 flex items-start gap-2 rounded-lg border border-red-500/50 bg-red-900/20 p-3 text-sm text-red-300">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    {error}
                  </div>
                )}

                <div className="mt-8">
                  <button
                    type="submit"
                    disabled={submitting || !draftState.valid}
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
                        Publishing offer...
                      </span>
                    ) : (
                      <>
                        <div className="absolute left-2 flex h-[52px] w-[52px] items-center justify-center overflow-hidden rounded-full bg-slate-800 text-white shadow-inner">
                          <div className="absolute inset-0 bg-gradient-to-tr from-white/10 to-transparent"></div>
                          <CheckCircle className="z-10 h-6 w-6 text-slate-300" />
                        </div>
                        <span className="ml-4 font-bold tracking-wide text-slate-200">
                          Publish Offer
                        </span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>

          <div className="space-y-6">
            <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-1">
              <MetricCard
                title="Draft rate"
                value={numericRate ? numericRate.toString() : '0'}
                detail={`Quoted in ${assetOut} per 1 ${assetIn}.`}
                icon={<TrendingUp className="h-5 w-5" />}
              />
              <MetricCard
                title="Ticket band"
                value={
                  numericMin !== null && numericMax !== null
                    ? `${Math.max(numericMax - numericMin, 0).toFixed(4)}`
                    : '0'
                }
                detail="Difference between the minimum and maximum accepted request sizes."
                icon={<Layers3 className="h-5 w-5" />}
              />
            </section>

            <Card variant="glass">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-500">
                    Publishing preview
                  </p>
                  <h3 className="mt-2 text-xl font-semibold text-white">
                    How the market will read this listing
                  </h3>
                </div>
                {preview && (
                  <Badge variant={getToneVariant(preview.publishingGuidance.launchTone)}>
                    {preview.publishingGuidance.launchTone === 'good'
                      ? 'Ready'
                      : preview.publishingGuidance.launchTone === 'caution'
                        ? 'Adjustable'
                        : 'Risky'}
                  </Badge>
                )}
              </div>

              {!preview ? (
                <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm leading-6 text-slate-400">
                  Complete the draft fields to generate a market preview for this listing.
                </div>
              ) : (
                <div className="mt-5 space-y-4">
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-white">Publishing readiness</p>
                      <div className="flex items-center gap-2">
                        <Gauge className="h-4 w-4 text-indigo-300" />
                        <span className="text-xl font-semibold text-white">
                          {preview.publishingGuidance.readinessScore}
                        </span>
                      </div>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-400">
                      {preview.publishingGuidance.notes[0]}
                    </p>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Pair board</p>
                      <p className="mt-2 text-2xl font-semibold text-white">
                        {preview.marketContext.pairMetrics.activeOffers}
                      </p>
                      <p className="mt-2 text-sm text-slate-400">
                        Active listings on {assetIn}/{assetOut}
                      </p>
                    </div>

                    <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                      <p className="text-xs uppercase tracking-wide text-slate-500">
                        Rate placement
                      </p>
                      <p className="mt-2 text-lg font-semibold text-white">
                        {getPercentileLabel(preview.marketContext.percentileHint)}
                      </p>
                      <p className="mt-2 text-sm text-slate-400">
                        Median visible rate: {preview.marketContext.nearestRates.median ?? 'n/a'}
                      </p>
                    </div>

                    <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                      <p className="text-xs uppercase tracking-wide text-slate-500">
                        Seller coverage
                      </p>
                      <p className="mt-2 text-2xl font-semibold text-white">
                        {preview.merchant.activeOffers}
                      </p>
                      <p className="mt-2 text-sm text-slate-400">
                        Active listings already running for this seller.
                      </p>
                    </div>

                    <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Pair demand</p>
                      <p className="mt-2 text-2xl font-semibold text-white">
                        {preview.marketContext.pairMetrics.pairOpenRequests}
                      </p>
                      <p className="mt-2 text-sm text-slate-400">
                        Open requests already competing for attention on this pair.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </Card>

            {preview && (
              <>
                <Card variant="glass">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Diagnostics</p>
                  <div className="mt-4 space-y-3">
                    {preview.diagnostics.map((diagnostic) => (
                      <div
                        key={diagnostic.label}
                        className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium text-white">{diagnostic.label}</p>
                          <Badge variant={getToneVariant(diagnostic.tone)}>
                            {diagnostic.tone === 'good'
                              ? 'Healthy'
                              : diagnostic.tone === 'caution'
                                ? 'Watch'
                                : 'Risk'}
                          </Badge>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-slate-400">{diagnostic.detail}</p>
                      </div>
                    ))}
                  </div>
                </Card>

                <Card variant="glass">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Launch notes</p>
                  <div className="mt-4 space-y-3">
                    {preview.publishingGuidance.notes.map((note) => (
                      <div
                        key={note}
                        className="flex items-start gap-3 rounded-2xl border border-indigo-500/20 bg-indigo-500/10 p-4"
                      >
                        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-indigo-300" />
                        <p className="text-sm leading-6 text-indigo-50/90">{note}</p>
                      </div>
                    ))}
                  </div>
                </Card>
              </>
            )}
          </div>
        </div>

        <div className="mt-8 flex justify-center text-xs text-slate-600">
          <Link
            href="/swap"
            className="inline-flex items-center transition-colors hover:text-slate-400"
          >
            <ArrowLeft className="mr-1 h-3 w-3" />
            Back to Market
          </Link>
        </div>
      </main>
    </div>
  );
}
