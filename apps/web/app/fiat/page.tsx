"use client";

import { useState } from "react";
import { Wallet, Shield, Building, Info } from "lucide-react";
import RazorpayLoader from "@/components/RazorpayLoader";

import { PrivacyToggle } from "@/components/ui/PrivacyToggle";
import { usePrivacy } from "@/context/PrivacyContext";
import Prism from "@/components/ui/Prism";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api";

export default function FiatPage() {
  const { isPrivate, togglePrivacy } = usePrivacy();

  const [activeTab, setActiveTab] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState<string>("");
  const [mode, setMode] = useState<"public" | "zk">("public");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [razorpayLoaded, setRazorpayLoaded] = useState(false);

  // Sell Logic Form Data
  const [accountNo, setAccountNo] = useState("");
  const [ifsc, setIfsc] = useState("");

  const handleBuy = async () => {
    if (!razorpayLoaded) {
      setStatus("Razorpay SDK not loaded yet. Please refresh.");
      return;
    }
    setLoading(true);
    setStatus("Initializing Payment...");

    try {
      // 1. Create Order
      const token = localStorage.getItem("token");
      const res = await fetch(`${API_URL}/fiat/buy`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          amount: parseFloat(amount),
          currency: "INR",
          mode,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to create order");

      // 2. Open Razorpay Checkout
      const options = {
        key: data.keyId,
        amount: data.amount,
        currency: data.currency,
        name: "PrivateP2P Fiat Ramp",
        description: `Buy XLM (${mode === "zk" ? "Shielded" : "Public"})`,
        order_id: data.orderId,
        handler: function (response: any) {
          verifyPayment(response);
        },
        prefill: {
          name: "User", // could fetch from user context
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

      const rzp1 = new (window as any).Razorpay(options);
      rzp1.on("payment.failed", function (response: any) {
        setStatus(`Payment failed: ${response.error.description}`);
        setLoading(false);
      });

      rzp1.open();
      setStatus("Waiting for payment...");
    } catch (e: any) {
      console.error(e);
      setStatus(`Error: ${e.message}`);
      setLoading(false);
    }
  };

  const verifyPayment = async (response: any) => {
    setStatus("Verifying Payment & Transferring Assets...");
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`${API_URL}/fiat/verify-buy`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          razorpayOrderId: response.razorpay_order_id,
          razorpayPaymentId: response.razorpay_payment_id,
          razorpaySignature: response.razorpay_signature,
          mode,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);

      setStatus(`Success! ${data.message}`);
      setAmount("");
    } catch (e: any) {
      setStatus(`Verification failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSell = async () => {
    setLoading(true);
    setStatus("Initiating Payout...");
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`${API_URL}/fiat/sell`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          amount: parseFloat(amount),
          accountDetails: { accountNo, ifsc },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);

      setStatus(`Success! ${data.message}`);
      setAmount("");
    } catch (e: any) {
      setStatus(`Sell failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full relative overflow-hidden bg-slate-900/30 rounded-[32px] border border-white/5 text-slate-200 font-sans flex flex-col justify-center p-8 lg:p-12">
      {/* Top Controls */}
      <div className="absolute top-6 right-8 z-20">
        <PrivacyToggle checked={isPrivate} onCheckedChange={togglePrivacy} />
      </div>

      {/* Background glowing effects & Prism */}
      <div className="absolute inset-0 z-0 opacity-40">
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

      <div className="w-full max-w-[1400px] mx-auto flex flex-col justify-center items-center relative z-10">
        <RazorpayLoader onLoad={() => setRazorpayLoaded(true)} />

        {/* Center Widget */}
        <div className="flex justify-center relative w-full">
          <div className="w-full max-w-[360px] bg-slate-900/80 backdrop-blur-2xl border border-slate-800 shadow-2xl rounded-[40px] p-6 pb-8 relative overflow-hidden transition-all duration-500 min-h-[620px] flex flex-col">
            {/* Top Indicator */}
            <div className="w-12 h-1.5 bg-slate-800 rounded-full mx-auto mb-8" />

            <div className="flex items-center mb-6">
              <h3 className="text-lg font-bold font-secondary mx-auto">
                Fiat Ramp
              </h3>
            </div>

            {/* Tabs for Buy/Sell */}
            <div className="flex gap-2 mb-6 p-1 rounded-xl bg-slate-800/30 border border-slate-700/50 mix-blend-screen text-center">
              <button
                onClick={() => {
                  setActiveTab("buy");
                  setStatus("");
                  setAmount("");
                }}
                className={cn(
                  "flex-1 py-2.5 text-xs font-semibold rounded-lg transition-all",
                  activeTab === "buy"
                    ? "bg-slate-700 text-white shadow-sm"
                    : "text-slate-400 hover:text-white",
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
                  activeTab === "sell"
                    ? "bg-slate-700 text-white shadow-sm"
                    : "text-slate-400 hover:text-white",
                )}
              >
                Sell XLM
              </button>
            </div>

            {activeTab === "buy" ? (
              <div className="flex-1 flex flex-col animate-in fade-in duration-300">
                <div className="space-y-5 flex-1 pl-1">
                  <div className="p-3 rounded-xl bg-slate-800/30 border border-slate-700/50 flex items-start gap-2">
                    <Info
                      className="text-slate-400 shrink-0 mt-0.5"
                      size={14}
                    />
                    <p className="text-[11px] text-slate-300 leading-tight">
                      Pay with UPI or Card (Test Mode). XLM is instantly
                      transferred to your selected wallet mode.
                    </p>
                  </div>

                  <div>
                    <label className="block text-slate-400 text-xs font-medium mb-1.5 ml-1">
                      Amount (INR)
                    </label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-[14px] text-slate-500 text-sm font-medium z-10 transition-colors pointer-events-none">
                        ₹
                      </span>
                      <Input
                        type="number"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="0.00"
                        disabled={loading}
                        className="bg-slate-900/50 rounded-xl border-slate-700/50 font-mono h-12 text-sm pl-8 relative"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-slate-400 text-xs font-medium mb-1.5 ml-1">
                      Receive Mode
                    </label>
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
                        <Wallet
                          className={
                            mode === "public"
                              ? "text-indigo-400"
                              : "text-slate-500"
                          }
                          size={18}
                        />
                        <div className="text-center">
                          <span className="block text-xs font-semibold text-slate-200">
                            Public
                          </span>
                          <span className="block text-[10px] text-slate-500 mt-0.5">
                            Standard
                          </span>
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
                        <Shield
                          className={
                            mode === "zk" ? "text-indigo-400" : "text-slate-500"
                          }
                          size={18}
                        />
                        <div className="text-center">
                          <span className="block text-xs font-semibold text-slate-200">
                            Shielded
                          </span>
                          <span className="block text-[10px] text-slate-500 mt-0.5">
                            Private
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

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
                      className="w-full h-12 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-none hover:shadow-none"
                    >
                      {loading
                        ? "Processing..."
                        : `Pay ₹${amount || "0"} & Get XLM`}
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col animate-in fade-in duration-300">
                <div className="space-y-5 flex-1 pl-1">
                  <div className="p-3 rounded-xl bg-slate-800/30 border border-slate-700/50 flex items-start gap-2">
                    <Building
                      className="text-slate-400 shrink-0 mt-0.5"
                      size={14}
                    />
                    <p className="text-[11px] text-slate-300 leading-tight">
                      Enter bank details to receive your payout. Funds are
                      typically deposited within minutes.
                    </p>
                  </div>

                  <div>
                    <label className="block text-slate-400 text-xs font-medium mb-1.5 ml-1">
                      Sell Amount (XLM)
                    </label>
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
                    <label className="block text-slate-400 text-xs font-medium mb-1.5 ml-1">
                      Account Number
                    </label>
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
                    <label className="block text-slate-400 text-xs font-medium mb-1.5 ml-1">
                      IFSC Code
                    </label>
                    <Input
                      type="text"
                      value={ifsc}
                      onChange={(e) => setIfsc(e.target.value)}
                      placeholder="Enter IFSC Code"
                      disabled={loading}
                      className="bg-slate-900/50 rounded-xl border-slate-700/50 text-sm h-12 uppercase"
                    />
                  </div>

                  {status && (
                    <div
                      className={cn(
                        "p-3 rounded-xl border-l-4 text-xs font-medium mt-4",
                        status.toLowerCase().includes("success") ||
                          status.toLowerCase().includes("initiating")
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
                      disabled={
                        loading ||
                        !amount ||
                        parseFloat(amount) <= 0 ||
                        !accountNo
                      }
                      className="w-full h-12 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-none hover:shadow-none"
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
        </div>
      </div>
    </div>
  );
}
