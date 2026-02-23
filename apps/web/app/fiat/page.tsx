"use client";

import { useState, useRef } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ArrowRight, Wallet, Shield, Building, Info } from "lucide-react";
import RazorpayLoader from "@/components/RazorpayLoader";

import { PrivacyToggle } from "@/components/ui/PrivacyToggle";
import { usePrivacy } from "@/context/PrivacyContext";

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
    <div className="w-full relative overflow-hidden bg-slate-900/30 rounded-[32px] border border-white/5 text-white selection:bg-indigo-500/30 font-sans flex flex-col p-8 lg:p-12 mb-8 items-center max-w-[1400px] mx-auto min-h-[50vh]">
      {/* Top Controls */}
      <div className="absolute top-6 right-8 z-20">
        <PrivacyToggle checked={isPrivate} onCheckedChange={togglePrivacy} />
      </div>

      <main className="w-full max-w-5xl mx-auto space-y-12 relative z-10 pt-4">
        <RazorpayLoader onLoad={() => setRazorpayLoaded(true)} />

        {/* Header & Intro */}
        <div className="text-center space-y-4 max-w-2xl mx-auto">
          <h1 className="text-4xl md:text-5xl font-bold text-white">
            Fiat Ramp
          </h1>
          <p className="text-slate-400 text-lg">
            Buy and Sell XLM directly with INR using Razorpay.
          </p>
        </div>

        {/* Main Action Card */}
        <div className="max-w-5xl mx-auto w-full relative group">
          <div className="absolute -inset-1 bg-indigo-500/20 rounded-2xl blur opacity-20 group-hover:opacity-30 transition duration-1000"></div>

          <Card
            variant="glass"
            className="relative p-6 md:p-8 border-white/10 shadow-2xl backdrop-blur-xl"
          >
            <div className="flex gap-4 mb-8 border-b border-slate-700/50 pb-4 justify-center">
              <button
                onClick={() => {
                  setActiveTab("buy");
                  setStatus("");
                }}
                className={`w-full sm:w-auto text-lg font-semibold px-8 py-2.5 rounded-lg transition-all transform hover:scale-105 ${
                  activeTab === "buy"
                    ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/20"
                    : "text-slate-400 hover:text-white hover:bg-white/5"
                }`}
              >
                Buy XLM
              </button>
              <button
                onClick={() => {
                  setActiveTab("sell");
                  setStatus("");
                }}
                className={`w-full sm:w-auto text-lg font-semibold px-8 py-2.5 rounded-lg transition-all transform hover:scale-105 ${
                  activeTab === "sell"
                    ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/20"
                    : "text-slate-400 hover:text-white hover:bg-white/5"
                }`}
              >
                Sell XLM
              </button>
            </div>

            {activeTab === "buy" ? (
              <div className="space-y-6">
                <div>
                  <label className="block text-slate-400 text-sm mb-2 font-medium">
                    Amount (INR)
                  </label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
                      ₹
                    </span>
                    <input
                      type="number"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="w-full bg-slate-900/50 border border-slate-700/50 rounded-xl pl-8 pr-4 py-4 text-white text-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                      placeholder="Enter amount (e.g. 100)"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-slate-400 text-sm mb-3 font-medium">
                    Receive Mode
                  </label>
                  <div className="grid grid-cols-2 gap-4">
                    <div
                      onClick={() => setMode("public")}
                      className={`cursor-pointer border rounded-xl p-4 flex flex-col items-center gap-3 transition-all ${
                        mode === "public"
                          ? "bg-indigo-900/20 border-indigo-500 ring-1 ring-indigo-500/50"
                          : "bg-slate-900/20 border-slate-700/50 hover:bg-slate-800 hover:border-slate-600"
                      }`}
                    >
                      <div
                        className={`p-2 rounded-full ${mode === "public" ? "bg-indigo-500/20" : "bg-slate-800"}`}
                      >
                        <Wallet
                          className={
                            mode === "public"
                              ? "text-indigo-400"
                              : "text-slate-400"
                          }
                          size={20}
                        />
                      </div>
                      <div className="text-center">
                        <span className="block text-sm font-semibold text-white">
                          Public Wallet
                        </span>
                        <span className="block text-xs text-slate-500 mt-1">
                          Standard Account
                        </span>
                      </div>
                    </div>
                    <div
                      onClick={() => setMode("zk")}
                      className={`cursor-pointer border rounded-xl p-4 flex flex-col items-center gap-3 transition-all ${
                        mode === "zk"
                          ? "bg-indigo-900/20 border-indigo-500 ring-1 ring-indigo-500/50"
                          : "bg-slate-900/20 border-slate-700/50 hover:bg-slate-800 hover:border-slate-600"
                      }`}
                    >
                      <div
                        className={`p-2 rounded-full ${mode === "zk" ? "bg-indigo-500/20" : "bg-slate-800"}`}
                      >
                        <Shield
                          className={
                            mode === "zk" ? "text-indigo-400" : "text-slate-400"
                          }
                          size={20}
                        />
                      </div>
                      <div className="text-center">
                        <span className="block text-sm font-semibold text-white">
                          Shielded (ZK)
                        </span>
                        <span className="block text-xs text-slate-500 mt-1">
                          Private Balance
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {status && (
                  <div
                    className={`p-4 rounded-xl text-sm flex items-center gap-2 ${status.includes("Success") ? "bg-indigo-900/20 text-indigo-400 border border-indigo-900/50" : "bg-slate-800 text-slate-300 border border-slate-700"}`}
                  >
                    <div
                      className={`w-2 h-2 rounded-full ${status.includes("Success") ? "bg-indigo-500" : "bg-slate-500"}`}
                    ></div>
                    {status}
                  </div>
                )}

                <Button
                  variant="primary"
                  className="w-full py-4 text-lg font-bold shadow-lg shadow-indigo-500/20 hover:shadow-indigo-500/40 transition-all"
                  onClick={handleBuy}
                  disabled={loading || !amount || parseFloat(amount) <= 0}
                >
                  {loading
                    ? "Processing Payment..."
                    : `Pay ₹${amount || "0"} & Get XLM`}
                </Button>

                <p className="flex items-center justify-center gap-1.5 text-xs text-slate-500">
                  <Shield size={12} /> Secured by Razorpay • Test Mode Encrypted
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                <div>
                  <label className="block text-slate-400 text-sm mb-2 font-medium">
                    Sell Amount (XLM)
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="w-full bg-slate-900/50 border border-slate-700/50 rounded-xl px-4 py-4 text-white text-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                      placeholder="Enter XLM to sell"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 text-sm font-medium">
                      XLM
                    </span>
                  </div>
                </div>

                <div className="bg-slate-900/30 p-5 rounded-xl border border-slate-700/30">
                  <h3 className="text-white font-medium mb-4 flex items-center gap-2 pb-3 border-b border-slate-800/50">
                    <Building size={16} className="text-indigo-400" /> Bank
                    Details
                  </h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-slate-500 text-xs mb-1.5 uppercase tracking-wide">
                        Account Number
                      </label>
                      <input
                        type="text"
                        value={accountNo}
                        onChange={(e) => setAccountNo(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                        placeholder="Enter Account Number"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-500 text-xs mb-1.5 uppercase tracking-wide">
                        IFSC Code
                      </label>
                      <input
                        type="text"
                        value={ifsc}
                        onChange={(e) => setIfsc(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                        placeholder="Enter IFSC Code"
                      />
                    </div>
                  </div>
                </div>

                {status && (
                  <div
                    className={`p-4 rounded-xl text-sm ${status.includes("Success") ? "bg-indigo-900/20 text-indigo-400 border border-indigo-900/50" : "bg-slate-800 text-slate-300 border border-slate-700"}`}
                  >
                    {status}
                  </div>
                )}

                <Button
                  variant="primary"
                  className="w-full py-4 text-lg font-bold shadow-lg shadow-indigo-500/20 hover:shadow-indigo-500/40"
                  onClick={handleSell}
                  disabled={
                    loading || !amount || parseFloat(amount) <= 0 || !accountNo
                  }
                >
                  {loading ? "Processing..." : "Initiate Payout"}
                </Button>
              </div>
            )}
          </Card>
        </div>

        {/* How it Works Section - Moved to Bottom */}
        <div className="pt-8 border-t border-slate-800/50">
          <h3 className="text-xl font-semibold text-white mb-6 text-center">
            How it works
          </h3>
          <div className="grid md:grid-cols-3 gap-6">
            <div className="bg-slate-900/40 p-6 rounded-2xl border border-slate-800/50 hover:border-indigo-500/30 transition-all hover:bg-slate-900/60 group">
              <div className="bg-indigo-500/10 w-12 h-12 rounded-xl flex items-center justify-center text-indigo-400 mb-4 group-hover:scale-110 transition-transform">
                <Wallet size={24} />
              </div>
              <h4 className="text-white font-semibold text-lg mb-2">
                Buying XLM
              </h4>
              <p className="text-slate-400 text-sm leading-relaxed">
                Pay with UPI or Card using Razorpay (Test Mode). We instantly
                transfer XLM directly to your public wallet address.
              </p>
            </div>

            <div className="bg-slate-900/40 p-6 rounded-2xl border border-slate-800/50 hover:border-indigo-500/30 transition-all hover:bg-slate-900/60 group">
              <div className="bg-indigo-500/10 w-12 h-12 rounded-xl flex items-center justify-center text-indigo-400 mb-4 group-hover:scale-110 transition-transform">
                <Shield size={24} />
              </div>
              <h4 className="text-white font-semibold text-lg mb-2">
                Shielded Mode (ZK)
              </h4>
              <p className="text-slate-400 text-sm leading-relaxed">
                For enhanced privacy, choose Shielded Mode. XLM is sent to your
                public wallet first, then you can "Deposit" to shield it.
              </p>
            </div>

            <div className="bg-slate-900/40 p-6 rounded-2xl border border-slate-800/50 hover:border-indigo-500/30 transition-all hover:bg-slate-900/60 group relative overflow-hidden">
              <div className="bg-indigo-500/10 w-12 h-12 rounded-xl flex items-center justify-center text-indigo-400 mb-4 group-hover:scale-110 transition-transform relative z-10">
                <Info size={24} />
              </div>
              <h4 className="text-white font-semibold text-lg mb-2 relative z-10">
                Testnet Information
              </h4>
              <p className="text-slate-400 text-sm leading-relaxed relative z-10">
                Razorpay is in Test Mode active. You can use any mock card
                details or UPI ID. No real money will be deducted.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
