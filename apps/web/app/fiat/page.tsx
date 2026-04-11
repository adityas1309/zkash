"use client";

import { useEffect, useMemo, useState } from "react";
import { Building, Globe, Info, Landmark, RefreshCw, Shield, Sparkles, Wallet } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PrivacyToggle } from "@/components/ui/PrivacyToggle";
import { usePrivacy } from "@/context/PrivacyContext";
import Prism from "@/components/ui/Prism";
import RazorpayLoader from "@/components/RazorpayLoader";
import { cn } from "@/lib/utils";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api";

interface FiatWorkspace {
  user: {
    username?: string;
    stellarPublicKey?: string;
  };
  provider: {
    razorpayConfigured: boolean;
    keyIdPresent: boolean;
  };
  pricing: {
    buyRateInrToXlm: number;
    sellRateXlmToInr: number;
    buyFeePercent: number;
    sellFeePercent: number;
  };
  balances: {
    publicXlm: number;
    privateXlm: number;
    totalXlm: number;
  };
  payoutPolicy: {
    holdMinutes: number;
    bankRequirements: string[];
  };
  guidance: string[];
}

interface BuyPreview {
  conversion: {
    rateInrToXlm: number;
    grossXlm: number;
    feePercent: number;
    feeXlm: number;
    netXlm: number;
  };
  destination: {
    mode: "public" | "zk";
    fulfillmentType: string;
  };
  readiness: {
    providerConfigured: boolean;
    walletDestinationReady: boolean;
    recommendation: string;
  };
  warnings: string[];
}

interface SellPreview {
  sale: {
    amountXlm: number;
    publicXlm: number;
    privateXlm: number;
    totalXlm: number;
  };
  payout: {
    grossInr: number;
    feePercent: number;
    feeInr: number;
    netInr: number;
    estimatedHoldMinutes: number;
  };
  bankAccount: {
    maskedAccount: string;
    ifsc: string;
  };
  readiness: {
    canFundFromPublicWallet: boolean;
    needsPrivateWithdrawal: boolean;
    inventoryShortfall: number;
  };
  warnings: string[];
}

export default function FiatPage() {
  const { isPrivate, togglePrivacy } = usePrivacy();
  const [workspace, setWorkspace] = useState<FiatWorkspace | null>(null);
  const [activeTab, setActiveTab] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState<string>("");
  const [mode, setMode] = useState<"public" | "zk">("public");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [razorpayLoaded, setRazorpayLoaded] = useState(false);
  const [buyPreview, setBuyPreview] = useState<BuyPreview | null>(null);
  const [sellPreview, setSellPreview] = useState<SellPreview | null>(null);

  const [accountNo, setAccountNo] = useState("");
  const [ifsc, setIfsc] = useState("");

  const numericAmount = useMemo(() => {
    const parsed = Number.parseFloat(amount);
    return Number.isFinite(parsed) ? parsed : 0;
  }, [amount]);

  const fetchWorkspace = async () => {
    try {
      const response = await fetch(`${API_URL}/fiat/workspace`, {
        credentials: "include",
      });
      const data = await response.json().catch(() => null);
      if (response.ok) {
        setWorkspace(data);
      } else {
        setWorkspace(null);
      }
    } catch (error) {
      console.error("[FiatPage] Failed to load workspace", error);
      setWorkspace(null);
    }
  };

  useEffect(() => {
    fetchWorkspace();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    if (activeTab === "buy" && numericAmount > 0) {
      fetch(`${API_URL}/fiat/preview-buy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          amount: numericAmount,
          currency: "INR",
          mode,
        }),
        signal: controller.signal,
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => setBuyPreview(data))
        .catch((error) => {
          if ((error as Error).name !== "AbortError") {
            console.error(error);
          }
        });
    }

    return () => controller.abort();
  }, [activeTab, numericAmount, mode]);

  useEffect(() => {
    const controller = new AbortController();
    if (activeTab === "sell" && numericAmount > 0 && accountNo && ifsc) {
      fetch(`${API_URL}/fiat/preview-sell`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          amount: numericAmount,
          accountDetails: {
            accountNo,
            ifsc: ifsc.toUpperCase(),
          },
        }),
        signal: controller.signal,
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => setSellPreview(data))
        .catch((error) => {
          if ((error as Error).name !== "AbortError") {
            console.error(error);
          }
        });
    }

    return () => controller.abort();
  }, [activeTab, numericAmount, accountNo, ifsc]);

  const handleBuy = async () => {
    if (!razorpayLoaded) {
      setStatus("Razorpay SDK not loaded yet. Please refresh.");
      return;
    }
    setLoading(true);
    setStatus("Initializing payment...");

    try {
      const response = await fetch(`${API_URL}/fiat/buy`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          amount: numericAmount,
          currency: "INR",
          mode,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "Failed to create order");
      }

      const options = {
        key: data.keyId,
        amount: data.amount,
        currency: data.currency,
        name: "PrivateP2P Fiat Ramp",
        description: `Buy XLM (${mode === "zk" ? "Shielded" : "Public"})`,
        order_id: data.orderId,
        handler: function (razorpayResponse: any) {
          verifyPayment(razorpayResponse);
        },
        prefill: {
          name: workspace?.user?.username || "User",
          email: "user@example.com",
          contact: "9999999999",
        },
        theme: {
          color: "#4F46E5",
        },
        modal: {
          ondismiss: function () {
            setLoading(false);
            setStatus("Payment cancelled by user.");
          },
        },
      };

      const instance = new (window as any).Razorpay(options);
      instance.on("payment.failed", function (paymentFailure: any) {
        setStatus(`Payment failed: ${paymentFailure.error.description}`);
        setLoading(false);
      });

      instance.open();
      setStatus(
        `Waiting for payment...${data.preview?.netXlm ? ` Expected delivery: ${data.preview.netXlm} XLM.` : ""}`,
      );
    } catch (error: any) {
      console.error(error);
      setStatus(`Error: ${error.message}`);
      setLoading(false);
    }
  };

  const verifyPayment = async (response: any) => {
    setStatus("Verifying payment and transferring assets...");
    try {
      const res = await fetch(`${API_URL}/fiat/verify-buy`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          razorpayOrderId: response.razorpay_order_id,
          razorpayPaymentId: response.razorpay_payment_id,
          razorpaySignature: response.razorpay_signature,
          mode,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || "Verification failed");
      }

      setStatus(`Success! ${data.message}`);
      setAmount("");
      fetchWorkspace();
    } catch (error: any) {
      setStatus(`Verification failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSell = async () => {
    setLoading(true);
    setStatus("Initiating payout...");
    try {
      const response = await fetch(`${API_URL}/fiat/sell`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          amount: numericAmount,
          accountDetails: {
            accountNo,
            ifsc: ifsc.toUpperCase(),
          },
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || data.error || "Sell failed");
      }

      setStatus(
        `Success! ${data.message}${data.preview?.netInr ? ` Estimated payout: INR ${data.preview.netInr}.` : ""}`,
      );
      setAmount("");
      fetchWorkspace();
    } catch (error: any) {
      setStatus(`Sell failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex w-full flex-col justify-center overflow-hidden rounded-[32px] border border-white/5 bg-slate-900/30 p-8 font-sans text-slate-200 lg:p-12">
      <div className="absolute top-6 right-8 z-20">
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
        <RazorpayLoader onLoad={() => setRazorpayLoaded(true)} />

        <div className="mb-8 grid w-full gap-4 md:grid-cols-4">
          <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500 mb-2">Provider</p>
            <p className="text-lg font-bold text-white">
              {workspace?.provider.razorpayConfigured ? "Configured" : "Missing"}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500 mb-2">Buy Rate</p>
            <p className="text-lg font-bold text-white">{workspace?.pricing.buyRateInrToXlm ?? 0}</p>
            <p className="text-[11px] text-slate-400">XLM per INR</p>
          </div>
          <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500 mb-2">Sell Inventory</p>
            <p className="text-lg font-bold text-white">{workspace?.balances.totalXlm ?? 0}</p>
            <p className="text-[11px] text-slate-400">Total XLM</p>
          </div>
          <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500 mb-2">Payout Hold</p>
            <p className="text-lg font-bold text-white">{workspace?.payoutPolicy.holdMinutes ?? 0}m</p>
          </div>
        </div>

        <div className="flex justify-center relative w-full gap-6">
          <div className="w-full max-w-[380px] bg-slate-900/80 backdrop-blur-2xl border border-slate-800 shadow-2xl rounded-[40px] p-6 pb-8 relative overflow-hidden transition-all duration-500 min-h-[680px] flex flex-col">
            <div className="w-12 h-1.5 bg-slate-800 rounded-full mx-auto mb-8" />

            <div className="flex items-center mb-6">
              <h3 className="text-lg font-bold font-secondary mx-auto">Fiat Ramp</h3>
            </div>

            <div className="flex gap-2 mb-6 p-1 rounded-xl bg-slate-800/30 border border-slate-700/50 text-center">
              <button
                onClick={() => {
                  setActiveTab("buy");
                  setStatus("");
                  setAmount("");
                }}
                className={cn(
                  "flex-1 py-2.5 text-xs font-semibold rounded-lg transition-all",
                  activeTab === "buy" ? "bg-slate-700 text-white shadow-sm" : "text-slate-400 hover:text-white",
                )}
              >
                Buy XLM
              </button>
              <button
                onClick={() => {
                  setActiveTab("sell");
                  setStatus("");
                  setAmount("");
                }}
                className={cn(
                  "flex-1 py-2.5 text-xs font-semibold rounded-lg transition-all",
                  activeTab === "sell" ? "bg-slate-700 text-white shadow-sm" : "text-slate-400 hover:text-white",
                )}
              >
                Sell XLM
              </button>
            </div>

            {activeTab === "buy" ? (
              <div className="flex-1 flex flex-col animate-in fade-in duration-300">
                <div className="space-y-5 flex-1 pl-1">
                  <div className="p-3 rounded-xl bg-slate-800/30 border border-slate-700/50 flex items-start gap-2">
                    <Info className="text-slate-400 shrink-0 mt-0.5" size={14} />
                    <p className="text-[11px] text-slate-300 leading-tight">
                      Pay with Razorpay test checkout. The preview below estimates your XLM after fees and explains how
                      the selected wallet mode changes the fulfillment path.
                    </p>
                  </div>

                  <div>
                    <label className="block text-slate-400 text-xs font-medium mb-1.5 ml-1">Amount (INR)</label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-[14px] text-slate-500 text-sm font-medium z-10 pointer-events-none">
                        INR
                      </span>
                      <Input
                        type="number"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="0.00"
                        disabled={loading}
                        className="bg-slate-900/50 rounded-xl border-slate-700/50 font-mono h-12 text-sm pl-12"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-slate-400 text-xs font-medium mb-1.5 ml-1">Receive Mode</label>
                    <div className="grid grid-cols-2 gap-3">
                      <div
                        onClick={() => setMode("public")}
                        className={cn(
                          "cursor-pointer rounded-xl p-3 flex flex-col items-center gap-2 transition-all border",
                          mode === "public"
                            ? "bg-indigo-500/10 border-indigo-500 ring-1 ring-indigo-500/50"
                            : "bg-slate-900/50 border-slate-700/50 hover:bg-slate-800",
                        )}
                      >
                        <Wallet className={mode === "public" ? "text-indigo-400" : "text-slate-500"} size={18} />
                        <div className="text-center">
                          <span className="block text-xs font-semibold text-slate-200">Public</span>
                          <span className="block text-[10px] text-slate-500 mt-0.5">Visible wallet</span>
                        </div>
                      </div>
                      <div
                        onClick={() => setMode("zk")}
                        className={cn(
                          "cursor-pointer rounded-xl p-3 flex flex-col items-center gap-2 transition-all border",
                          mode === "zk"
                            ? "bg-indigo-500/10 border-indigo-500 ring-1 ring-indigo-500/50"
                            : "bg-slate-900/50 border-slate-700/50 hover:bg-slate-800",
                        )}
                      >
                        <Shield className={mode === "zk" ? "text-indigo-400" : "text-slate-500"} size={18} />
                        <div className="text-center">
                          <span className="block text-xs font-semibold text-slate-200">Shielded</span>
                          <span className="block text-[10px] text-slate-500 mt-0.5">Private flow</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {buyPreview && (
                    <div className="rounded-2xl border border-slate-700 bg-slate-900/50 p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Buy Preview</p>
                        <span className="text-[11px] text-slate-400">
                          Net {buyPreview.conversion.netXlm} XLM
                        </span>
                      </div>
                      <p className="text-sm text-slate-300">
                        Gross {buyPreview.conversion.grossXlm} XLM minus {buyPreview.conversion.feeXlm} XLM fee (
                        {buyPreview.conversion.feePercent}%).
                      </p>
                      <p className="text-xs text-slate-400 leading-relaxed">
                        {buyPreview.readiness.recommendation}
                      </p>
                      {buyPreview.warnings.map((warning) => (
                        <div key={warning} className="rounded-xl border border-yellow-500/20 bg-yellow-500/10 p-3 text-xs text-yellow-100">
                          {warning}
                        </div>
                      ))}
                    </div>
                  )}

                  {status && (
                    <div
                      className={cn(
                        "p-3 rounded-xl border-l-4 text-xs font-medium mt-4",
                        status.toLowerCase().includes("success") ||
                          status.toLowerCase().includes("verifying") ||
                          status.toLowerCase().includes("waiting") ||
                          status.toLowerCase().includes("initializing")
                          ? "bg-indigo-500/10 border-indigo-500 text-indigo-200"
                          : "bg-red-500/10 border-red-500 text-red-200",
                      )}
                    >
                      <p className="break-words">{status}</p>
                    </div>
                  )}

                  <div className="mt-auto pt-6">
                    <Button
                      onClick={handleBuy}
                      isLoading={loading}
                      disabled={loading || !amount || parseFloat(amount) <= 0}
                      className="w-full h-12 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium"
                    >
                      {loading ? "Processing..." : `Pay INR ${amount || "0"} & Get XLM`}
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col animate-in fade-in duration-300">
                <div className="space-y-5 flex-1 pl-1">
                  <div className="p-3 rounded-xl bg-slate-800/30 border border-slate-700/50 flex items-start gap-2">
                    <Building className="text-slate-400 shrink-0 mt-0.5" size={14} />
                    <p className="text-[11px] text-slate-300 leading-tight">
                      Sell preview checks whether your current XLM inventory can fund the payout and estimates the bank
                      amount after fees and holding policy.
                    </p>
                  </div>

                  <div>
                    <label className="block text-slate-400 text-xs font-medium mb-1.5 ml-1">Sell Amount (XLM)</label>
                    <div className="relative">
                      <Input
                        type="number"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="0.00"
                        disabled={loading}
                        className="bg-slate-900/50 rounded-xl border-slate-700/50 font-mono h-12 text-sm pr-12"
                      />
                      <span className="absolute right-4 top-[14px] text-slate-500 text-xs font-medium z-10 pointer-events-none">
                        XLM
                      </span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-slate-400 text-xs font-medium mb-1.5 ml-1">Account Number</label>
                    <Input
                      type="text"
                      value={accountNo}
                      onChange={(e) => setAccountNo(e.target.value)}
                      placeholder="Enter Account No."
                      disabled={loading}
                      className="bg-slate-900/50 rounded-xl border-slate-700/50 text-sm h-12"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-400 text-xs font-medium mb-1.5 ml-1">IFSC Code</label>
                    <Input
                      type="text"
                      value={ifsc}
                      onChange={(e) => setIfsc(e.target.value.toUpperCase())}
                      placeholder="Enter IFSC Code"
                      disabled={loading}
                      className="bg-slate-900/50 rounded-xl border-slate-700/50 text-sm h-12 uppercase"
                    />
                  </div>

                  {sellPreview && (
                    <div className="rounded-2xl border border-slate-700 bg-slate-900/50 p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Sell Preview</p>
                        <span className="text-[11px] text-slate-400">Net INR {sellPreview.payout.netInr}</span>
                      </div>
                      <p className="text-sm text-slate-300">
                        Gross INR {sellPreview.payout.grossInr} minus INR {sellPreview.payout.feeInr} fee (
                        {sellPreview.payout.feePercent}%).
                      </p>
                      <p className="text-xs text-slate-400 leading-relaxed">
                        Public XLM: {sellPreview.sale.publicXlm} | Private XLM: {sellPreview.sale.privateXlm} | Total: {sellPreview.sale.totalXlm}
                      </p>
                      {sellPreview.warnings.map((warning) => (
                        <div key={warning} className="rounded-xl border border-yellow-500/20 bg-yellow-500/10 p-3 text-xs text-yellow-100">
                          {warning}
                        </div>
                      ))}
                    </div>
                  )}

                  {status && (
                    <div
                      className={cn(
                        "p-3 rounded-xl border-l-4 text-xs font-medium mt-4",
                        status.toLowerCase().includes("success") || status.toLowerCase().includes("initiating")
                          ? "bg-indigo-500/10 border-indigo-500 text-indigo-200"
                          : "bg-red-500/10 border-red-500 text-red-200",
                      )}
                    >
                      <p className="break-words">{status}</p>
                    </div>
                  )}

                  <div className="mt-auto pt-6">
                    <Button
                      onClick={handleSell}
                      isLoading={loading}
                      disabled={loading || !amount || parseFloat(amount) <= 0 || !accountNo || !ifsc}
                      className="w-full h-12 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium"
                    >
                      {loading ? "Processing..." : "Initiate Payout"}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            <div className="mt-auto pt-6 border-t border-slate-800/50 flex justify-center p-4 -mb-4 -mx-2 opacity-60">
              <p className="flex items-center gap-1.5 text-[10px] text-slate-400">
                <Shield size={10} /> Secured by Razorpay
              </p>
            </div>
          </div>

          <div className="w-full max-w-[420px] rounded-[32px] border border-white/5 bg-slate-900/70 p-6 backdrop-blur-xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Workspace</p>
                <h2 className="mt-2 text-xl font-semibold text-white">Ramp context</h2>
              </div>
              <button
                onClick={() => fetchWorkspace()}
                className="rounded-xl border border-white/10 bg-slate-950/60 p-2 text-slate-300 transition-colors hover:bg-slate-800"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Provider readiness</p>
                <p className="mt-2 text-sm text-white">
                  {workspace?.provider.razorpayConfigured ? "Razorpay checkout is configured." : "Razorpay keys are missing."}
                </p>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Wallet inventory</p>
                <p className="mt-2 text-sm text-white">
                  Public {workspace?.balances.publicXlm ?? 0} XLM | Private {workspace?.balances.privateXlm ?? 0} XLM
                </p>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Bank payout policy</p>
                <p className="mt-2 text-sm text-white">
                  Estimated hold: {workspace?.payoutPolicy.holdMinutes ?? 0} minutes
                </p>
                <div className="mt-3 space-y-2">
                  {(workspace?.payoutPolicy.bankRequirements ?? []).map((item) => (
                    <div key={item} className="flex items-start gap-2 text-xs text-slate-400">
                      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-300" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                {(workspace?.guidance ?? []).map((item) => (
                  <div key={item} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                    <div className="flex items-start gap-3">
                      <Info className="mt-0.5 h-4 w-4 shrink-0 text-indigo-300" />
                      <p className="text-sm leading-6 text-slate-300">{item}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
