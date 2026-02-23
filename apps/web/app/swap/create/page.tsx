"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ArrowLeft, CheckCircle, AlertCircle, Plus } from "lucide-react";
import Prism from "@/components/ui/Prism";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export default function CreateOfferPage() {
  const router = useRouter();
  const [assetIn, setAssetIn] = useState("XLM");
  const [assetOut, setAssetOut] = useState("USDC");
  const [rate, setRate] = useState("");
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    setLoading(true);
    setStatus("");
    setError("");

    try {
      const res = await fetch(`${API_URL}/offers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          assetIn,
          assetOut,
          rate: parseFloat(rate),
          min: parseFloat(min),
          max: parseFloat(max),
        }),
      });

      if (res.ok) {
        setStatus("Offer created successfully!");
        setTimeout(() => router.push("/swap"), 1500);
      } else {
        const text = await res.text();
        setError("Failed: " + text);
      }
    } catch (err: unknown) {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleSwapAssets = () => {
    setAssetIn(assetOut);
    setAssetOut(assetIn);
  };

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
          <h1 className="text-2xl font-bold font-secondary text-white">
            Create Offer
          </h1>
          <p className="text-slate-400 mt-2 text-sm">
            Set your rates and limits to trade
          </p>
        </div>

        {status && status.includes("success") ? (
          <Card
            variant="glass"
            className="p-8 text-center flex flex-col items-center border border-green-500/30"
          >
            <CheckCircle className="w-16 h-16 mb-4 text-green-400" />
            <h3 className="text-2xl font-bold mb-2 text-white">
              Offer Created!
            </h3>
            <p className="text-slate-400 mb-6">Redirecting to the market...</p>
          </Card>
        ) : (
          <div className="space-y-4">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleCreate();
              }}
            >
              {/* You Sell Section */}
              <div className="bg-slate-900/80 backdrop-blur-md rounded-[32px] p-6 relative border border-white/5 shadow-xl transition-all hover:bg-slate-900">
                <div className="flex justify-between items-center mb-6">
                  <span className="text-slate-400 text-sm font-medium">
                    You Sell
                  </span>
                  <span className="text-indigo-400 text-xs font-medium bg-indigo-500/10 px-2 py-0.5 rounded">
                    Exchange Rate
                  </span>
                </div>
                <div className="flex justify-between items-center mb-2">
                  <div className="flex items-center gap-2 pr-3 py-1 bg-slate-800/50 rounded-full shrink-0">
                    <div className="w-10 h-10 rounded-full border border-white/5 p-1 bg-white flex items-center justify-center overflow-hidden">
                      <img
                        src={
                          assetIn === "USDC"
                            ? "https://cryptologos.cc/logos/usd-coin-usdc-logo.svg?v=035"
                            : "https://cryptologos.cc/logos/stellar-xlm-logo.svg?v=035"
                        }
                        alt={assetIn}
                        className="w-full h-full object-contain"
                      />
                    </div>
                    <select
                      value={assetIn}
                      onChange={(e) => setAssetIn(e.target.value)}
                      className="bg-transparent text-xl font-bold font-secondary text-white focus:outline-none appearance-none cursor-pointer pr-4"
                    >
                      <option value="USDC" className="bg-slate-900 text-base">
                        USDC
                      </option>
                      <option value="XLM" className="bg-slate-900 text-base">
                        XLM
                      </option>
                    </select>
                    <div className="absolute ml-[95px] pointer-events-none">
                      <svg
                        width="10"
                        height="6"
                        viewBox="0 0 10 6"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          d="M1 1L5 5L9 1"
                          stroke="#94A3B8"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </div>
                  </div>
                  <div className="text-right flex-1 ml-4 justify-end flex flex-col items-end w-full">
                    <input
                      type="number"
                      placeholder="0.00"
                      value={rate}
                      onChange={(e) => setRate(e.target.value)}
                      required
                      step="any"
                      className="bg-transparent text-right text-3xl md:text-4xl font-bold font-secondary text-white focus:outline-none w-full placeholder-slate-600 block"
                    />
                    <span className="text-xs text-slate-500 mt-1">
                      Amount per 1 {assetIn}
                    </span>
                  </div>
                </div>
              </div>

              {/* Middle Swap Divider */}
              <div className="relative h-2 z-20 flex justify-center items-center">
                <button
                  type="button"
                  onClick={handleSwapAssets}
                  className="absolute w-12 h-12 bg-slate-900 hover:bg-slate-800 transition-colors rounded-full flex items-center justify-center border-4 border-[#020617] shadow-lg focus:outline-none group"
                  title="Swap assets"
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-slate-400 group-hover:text-white transition-colors rotate-90"
                  >
                    <path d="M17 2l4 4-4 4" />
                    <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
                    <path d="M7 22l-4-4 4-4" />
                    <path d="M21 13v1a4 4 0 0 1-4 4H3" />
                  </svg>
                </button>
              </div>

              {/* You Receive Section with Min/Max Limits */}
              <div className="bg-slate-900/80 backdrop-blur-md rounded-[32px] p-6 pt-10 relative border border-white/5 shadow-xl transition-all hover:bg-slate-900 mt-[-8px]">
                <div className="flex justify-between items-center mb-6">
                  <span className="text-slate-400 text-sm font-medium">
                    Limits Outline
                  </span>
                  <span className="text-slate-500 text-xs font-medium">
                    Min & Max in {assetIn}
                  </span>
                </div>
                <div className="flex justify-between items-center mb-2 w-full">
                  {/* Min Input Left */}
                  <div className="w-[30%] text-left flex flex-col items-start pr-2">
                    <input
                      type="number"
                      placeholder="Min"
                      value={min}
                      onChange={(e) => setMin(e.target.value)}
                      required
                      step="any"
                      className="bg-transparent text-left text-2xl font-bold font-secondary text-white focus:outline-none w-full placeholder-slate-600 block leading-tight"
                    />
                    <span className="text-[10px] text-slate-500 mt-1 uppercase tracking-wider font-semibold">
                      Min Limit
                    </span>
                  </div>

                  {/* Token Selector Middle */}
                  <div className="w-[40%] flex justify-center items-center relative z-10">
                    <div className="flex flex-col items-center">
                      <div className="flex items-center gap-1.5 pr-2 py-1 bg-slate-800/50 rounded-full">
                        <div className="w-8 h-8 rounded-full border border-white/5 p-1 bg-white flex items-center justify-center overflow-hidden">
                          <img
                            src={
                              assetOut === "USDC"
                                ? "https://cryptologos.cc/logos/usd-coin-usdc-logo.svg?v=035"
                                : "https://cryptologos.cc/logos/stellar-xlm-logo.svg?v=035"
                            }
                            alt={assetOut}
                            className="w-full h-full object-contain"
                          />
                        </div>
                        <select
                          value={assetOut}
                          onChange={(e) => setAssetOut(e.target.value)}
                          className="bg-transparent text-lg font-bold font-secondary text-white focus:outline-none appearance-none cursor-pointer pr-3"
                        >
                          <option
                            value="USDC"
                            className="bg-slate-900 text-base"
                          >
                            USDC
                          </option>
                          <option
                            value="XLM"
                            className="bg-slate-900 text-base"
                          >
                            XLM
                          </option>
                        </select>
                        <div className="absolute ml-[75px] pointer-events-none">
                          <svg
                            width="8"
                            height="5"
                            viewBox="0 0 10 6"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <path
                              d="M1 1L5 5L9 1"
                              stroke="#94A3B8"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </div>
                      </div>
                      <span className="text-[10px] text-slate-500 mt-1.5 uppercase tracking-wider font-semibold">
                        You Receive
                      </span>
                    </div>
                  </div>

                  {/* Max Input Right */}
                  <div className="w-[30%] text-right flex flex-col items-end pl-2">
                    <input
                      type="number"
                      placeholder="Max"
                      value={max}
                      onChange={(e) => setMax(e.target.value)}
                      required
                      step="any"
                      className="bg-transparent text-right text-2xl font-bold font-secondary text-white focus:outline-none w-full placeholder-slate-600 block leading-tight"
                    />
                    <span className="text-[10px] text-slate-500 mt-1 uppercase tracking-wider font-semibold">
                      Max Limit
                    </span>
                  </div>
                </div>
              </div>

              {/* Error Handling */}
              {error && (
                <div className="bg-red-900/20 border border-red-500/50 text-red-300 p-3 rounded-lg text-sm flex items-start gap-2 mb-6 mt-6">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  {error}
                </div>
              )}

              <div className="mt-8">
                {/* Action Button */}
                <button
                  type="submit"
                  disabled={loading || !rate || !min || !max}
                  className="w-full h-[68px] rounded-full bg-black border border-white/10 text-white font-medium text-lg relative group flex items-center justify-center hover:bg-slate-900 transition-colors disabled:opacity-70 disabled:cursor-not-allowed shadow-2xl"
                >
                  {loading ? (
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
                        Click to Publish
                      </span>
                    </>
                  )}
                </button>
              </div>
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
