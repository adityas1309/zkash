"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import {
  ArrowLeft,
  ArrowRight,
  Wallet,
  AlertCircle,
  CheckCircle,
  ArrowUpDown,
  Flame,
  RefreshCw,
} from "lucide-react";
import Prism from "@/components/ui/Prism";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api";

interface Offer {
  _id: string;
  assetIn: string;
  assetOut: string;
  rate: number;
  min: number;
  max: number;
  merchantId: { username: string; _id: string; reputation?: number };
}

export default function SwapOfferPage() {
  const params = useParams();
  const router = useRouter();
  const offerId = params.id as string;

  const [offer, setOffer] = useState<Offer | null>(null);
  const [loading, setLoading] = useState(true);
  const [amountIn, setAmountIn] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/offers/${offerId}`)
      .then((r) => r.json())
      .then(setOffer)
      .catch(() => setError("Failed to load offer"))
      .finally(() => setLoading(false));
  }, [offerId]);

  const handleSwap = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!offer) return;

    const amount = parseFloat(amountIn);
    if (isNaN(amount) || amount <= 0) {
      setError("Please enter a valid amount");
      return;
    }
    if (amount < offer.min || amount > offer.max) {
      setError(`Amount must be between ${offer.min} and ${offer.max}`);
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const amountOut = amount * offer.rate;

      const res = await fetch(`${API_URL}/swap/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          bobId: offer.merchantId._id,
          amountIn: amount,
          amountOut,
          offerId: offer._id,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to create swap request");
      }

      setSuccess(true);
      setTimeout(() => router.push("/swap/my"), 2000);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to create swap request",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  if (!offer) {
    return (
      <main className="p-8 max-w-lg mx-auto text-center">
        <Card variant="glass" className="p-8">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">Offer Not Found</h2>
          <p className="text-slate-400 mb-6">
            The offer you are looking for does not exist or has been removed.
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

  const calculatedOut = amountIn
    ? (parseFloat(amountIn) * offer.rate).toFixed(6)
    : "0.00";

  return (
    <div className="min-h-screen w-full relative overflow-hidden flex flex-col items-center pt-8 md:pt-16 pb-20">
      {/* Background glowing effects & Prism */}
      <div className="absolute inset-0 z-0 opacity-40 pointer-events-none">
        <Prism
          animationType="rotate"
          timeScale={0.5}
          height={3.5}
          baseWidth={5.5}
          scale={3.6}
          hueShift={-0.3} // shift toward website's indigo
          colorFrequency={1}
          noise={0.1}
          glow={1}
        />
      </div>
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4/5 h-2/3 bg-indigo-600/20 blur-[120px] rounded-full pointer-events-none z-0" />
      <div className="absolute top-[40%] left-1/2 -translate-x-1/2 w-full max-w-4xl h-32 bg-indigo-500/10 blur-[60px] pointer-events-none z-0" />

      <main className="w-full max-w-[460px] px-4 relative z-10">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold font-secondary text-white">Swap</h1>
        </div>

        {success ? (
          <Card
            variant="glass"
            className="p-8 text-center flex flex-col items-center border border-green-500/30"
          >
            <CheckCircle className="w-16 h-16 mb-4 text-green-400" />
            <h3 className="text-2xl font-bold mb-2 text-white">
              Request Sent!
            </h3>
            <p className="text-slate-400 mb-6">Redirecting to your swaps...</p>
          </Card>
        ) : (
          <div className="space-y-4">
            <form onSubmit={handleSwap}>
              {/* You Pay Section */}
              <div className="bg-slate-900/80 backdrop-blur-md rounded-[32px] p-6 relative border border-white/5 shadow-xl transition-all hover:bg-slate-900">
                <div className="flex justify-between items-center mb-6">
                  <span className="text-slate-400 text-sm font-medium">
                    You Pay
                  </span>
                  <div className="flex items-center gap-2">
                    <Wallet className="w-4 h-4 text-slate-500" />
                    <span className="text-slate-300 text-xs font-mono">
                      {offer.max} {offer.assetIn}
                    </span>
                    <button
                      type="button"
                      onClick={() => setAmountIn(offer.max.toString())}
                      className="bg-black text-white text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide hover:bg-slate-800 transition-colors border border-white/10"
                    >
                      Max
                    </button>
                  </div>
                </div>
                <div className="flex justify-between items-center mb-2">
                  <div className="flex items-center gap-2 pr-3 py-1 bg-slate-800/50 rounded-full cursor-default">
                    <div className="w-10 h-10 rounded-full border border-white/5 p-1 bg-white flex items-center justify-center overflow-hidden">
                      <img
                        src={
                          offer.assetIn === "USDC"
                            ? "https://cryptologos.cc/logos/usd-coin-usdc-logo.svg?v=035"
                            : "https://cryptologos.cc/logos/stellar-xlm-logo.svg?v=035"
                        }
                        alt={offer.assetIn}
                        className="w-full h-full object-contain"
                      />
                    </div>
                    <span className="text-xl font-bold font-secondary text-white ml-1">
                      {offer.assetIn}
                    </span>
                    <ArrowRight className="w-3 h-3 text-slate-500 rotate-90 ml-1" />
                  </div>
                  <div className="text-right flex-1 ml-4 justify-end flex flex-col items-end">
                    <input
                      type="number"
                      step="any"
                      min={offer.min}
                      max={offer.max}
                      value={amountIn}
                      onChange={(e) => setAmountIn(e.target.value)}
                      placeholder="0.00"
                      required
                      className="bg-transparent text-right text-3xl md:text-4xl font-bold font-secondary text-white focus:outline-none w-full placeholder-slate-600 block"
                    />
                    <span className="text-xs text-slate-500 mt-1">
                      ≈ {amountIn ? amountIn : "0.00"} USD
                    </span>
                  </div>
                </div>
              </div>

              {/* Middle Arrow Divider */}
              <div className="relative h-2 z-10 flex justify-center items-center">
                <div className="absolute w-12 h-12 bg-slate-900 rounded-full flex items-center justify-center border-4 border-[#020617] shadow-lg cursor-default">
                  <ArrowUpDown className="w-5 h-5 text-slate-400" />
                </div>
              </div>

              {/* You Receive Section */}
              <div className="bg-slate-900/80 backdrop-blur-md rounded-[32px] p-6 pt-8 relative border border-white/5 shadow-xl transition-all hover:bg-slate-900 mt-[-8px]">
                <div className="flex justify-between items-center mb-6">
                  <span className="text-slate-400 text-sm font-medium">
                    You Receive
                  </span>
                </div>
                <div className="flex justify-between items-center mb-2">
                  <div className="flex items-center gap-2 pr-3 py-1 bg-slate-800/50 rounded-full cursor-default">
                    <div className="w-10 h-10 rounded-full border border-white/5 p-1 bg-white flex items-center justify-center overflow-hidden">
                      <img
                        src={
                          offer.assetOut === "USDC"
                            ? "https://cryptologos.cc/logos/usd-coin-usdc-logo.svg?v=035"
                            : "https://cryptologos.cc/logos/stellar-xlm-logo.svg?v=035"
                        }
                        alt={offer.assetOut}
                        className="w-full h-full object-contain"
                      />
                    </div>
                    <span className="text-xl font-bold font-secondary text-white ml-1">
                      {offer.assetOut}
                    </span>
                    <ArrowRight className="w-3 h-3 text-slate-500 rotate-90 ml-1" />
                  </div>
                  <div className="text-right truncate flex-1 ml-4 flex flex-col items-end">
                    <div className="text-3xl md:text-4xl font-bold font-secondary text-white truncate w-full">
                      {calculatedOut}
                    </div>
                    <span className="text-xs text-slate-500 mt-1">
                      ≈ {calculatedOut} USD
                    </span>
                  </div>
                </div>
              </div>

              {/* Market Info */}
              <div className="mt-6 flex flex-col items-center gap-2 text-xs md:text-[13px] text-slate-400 mb-8">
                <div className="flex items-center gap-1.5">
                  <Flame size={14} className="text-red-400" />
                  <span>Fee:</span>{" "}
                  <span className="text-slate-200 font-medium">
                    0.00 {offer.assetOut}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <RefreshCw size={12} className="text-slate-500" />
                  <span>
                    1 {offer.assetIn} = {offer.rate} {offer.assetOut}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-500">Seller:</span>
                  <span className="text-indigo-400 font-medium tracking-wide">
                    @{offer.merchantId?.username || "Unknown"}
                  </span>
                </div>
              </div>

              {/* Error Handling */}
              {error && (
                <div className="bg-red-900/20 border border-red-500/50 text-red-300 p-3 rounded-lg text-sm flex items-start gap-2 mb-6">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  {error}
                </div>
              )}

              {/* Action Button */}
              <button
                type="submit"
                disabled={submitting}
                className="w-full h-[68px] rounded-full bg-black border border-white/10 text-white font-medium text-lg relative group flex items-center justify-center hover:bg-slate-900 transition-colors disabled:opacity-70 disabled:cursor-not-allowed shadow-2xl"
              >
                {submitting ? (
                  <span className="flex items-center gap-2 font-bold font-secondary">
                    <svg
                      className="animate-spin -ml-1 mr-3 h-5 w-5 text-indigo-400"
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
                    Processing...
                  </span>
                ) : (
                  <>
                    <div className="absolute left-2 w-[52px] h-[52px] bg-slate-800 rounded-full flex items-center justify-center text-white shadow-inner group-hover:bg-slate-700 transition-colors overflow-hidden">
                      <div className="absolute inset-0 bg-gradient-to-tr from-white/10 to-transparent"></div>
                      <CheckCircle className="w-6 h-6 z-10 text-slate-300" />
                    </div>
                    <span className="font-secondary font-bold tracking-wide text-lg text-slate-200 ml-4 group-hover:text-white transition-colors">
                      Click to Swap
                    </span>
                    <div className="absolute right-6 flex items-center opacity-40 space-x-[-2px] text-slate-400 pointer-events-none group-hover:translate-x-1 group-hover:opacity-60 transition-all">
                      <ArrowRight size={18} />
                      <ArrowRight size={18} />
                      <ArrowRight size={18} />
                    </div>
                  </>
                )}
              </button>
            </form>
          </div>
        )}

        <div className="mt-8 text-center text-xs text-slate-600 w-full flex justify-center pb-8">
          <Link
            href="/swap"
            className="inline-flex items-center hover:text-slate-400 transition-colors"
          >
            <ArrowLeft className="mr-1 h-3 w-3" />
            Back to Market
          </Link>
        </div>
      </main>
    </div>
  );
}
