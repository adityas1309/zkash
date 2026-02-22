"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { Send, Droplet, ShieldCheck, Landmark } from "lucide-react";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "https://lop-main.onrender.com";

export default function WalletPage() {
  const [user, setUser] = useState<{
    username?: string;
    stellarPublicKey?: string;
  } | null>(null);
  const [balance, setBalance] = useState<{ usdc: string; xlm: string }>({
    usdc: "0",
    xlm: "0",
  });
  const [privateBalance, setPrivateBalance] = useState<{
    usdc: string;
    xlm: string;
  }>({ usdc: "0", xlm: "0" });

  const [loading, setLoading] = useState(true);
  const [faucetLoading, setFaucetLoading] = useState(false);
  const [withdrawing, setWithdrawing] = useState<"USDC" | "XLM" | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/users/me`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => {
        setUser(u);
        if (u) {
          fetchBalance();
          fetchPrivateBalance();
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const fetchBalance = () => {
    fetch(`${API_URL}/users/balance/all`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => setBalance(data))
      .catch(console.error);
  };

  const fetchPrivateBalance = () => {
    fetch(`${API_URL}/users/balance/private`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => setPrivateBalance(data))
      .catch(console.error);
  };

  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => {
      fetchBalance();
      fetchPrivateBalance();
    }, 5000);
    return () => clearInterval(interval);
  }, [user]);

  // Auto-process withdrawals
  useEffect(() => {
    if (!user) return;

    const process = async () => {
      try {
        const res = await fetch(`${API_URL}/users/withdrawals/process`, {
          method: "POST",
          credentials: "include",
        });
        const data = await res.json();
        if (data.processed > 0) {
          console.log(
            `Auto-processed ${data.processed} withdrawals. TX: ${data.txHashes?.join(", ")}`,
          );
          fetchBalance();
          fetchPrivateBalance();
        }
      } catch (e) {
        console.error("Auto-process error:", e);
      }
    };

    // Run immediately on load
    process();

    // Then poll every 10s
    const interval = setInterval(process, 10000);
    return () => clearInterval(interval);
  }, [user]);

  const handleXlmFaucet = async () => {
    if (!user?.stellarPublicKey) return;
    setFaucetLoading(true);
    try {
      const res = await fetch(`${API_URL}/faucet/xlm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ address: user.stellarPublicKey }),
      });
      const data = await res.json();
      if (data.success) {
        setTimeout(fetchBalance, 4000);
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
      const data = await res.json();
      if (data.success) {
        alert("Trustline added! Transaction: " + data.hash);
        setTimeout(fetchBalance, 4000);
      } else {
        alert("Failed: " + (data.message || "Unknown error"));
      }
    } catch (e) {
      alert("Error adding trustline");
    }
  };

  const handleWithdrawSelf = async (asset: "USDC" | "XLM") => {
    const amount =
      asset === "USDC"
        ? Number(privateBalance.usdc)
        : Number(privateBalance.xlm);
    if (amount <= 0) return;

    if (!confirm(`Withdraw ${amount} ${asset} from Private to Public balance?`))
      return;

    setWithdrawing(asset);
    try {
      const res = await fetch(`${API_URL}/users/withdrawals/self`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ asset, amount }),
      });
      const data = await res.json();
      if (data.success) {
        alert(`Withdrawal successful! TX: ${data.txHash}`);
        fetchBalance();
        fetchPrivateBalance();
      } else {
        alert(`Withdrawal failed: ${data.error}`);
      }
    } catch (e: any) {
      alert(`Withdrawal error: ${e.message}`);
    } finally {
      setWithdrawing(null);
    }
  };

  if (loading) return <div className="p-8">Loading...</div>;
  if (!user) {
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
    <div className="min-h-screen  text-white selection:bg-indigo-500/30">
      {/* <nav className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <h1 className="text-xl font-bold bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent">
            Wallet
          </h1>
          <Link
            href="/dashboard"
            className="text-sm text-slate-400 hover:text-white transition-colors flex items-center gap-2"
          >
            Dashboard
          </Link>
        </div>
      </nav> */}

      <main className="max-w-5xl mx-auto p-6 space-y-8">
        {/* Balance Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Public Balance */}
          <div className="relative group overflow-hidden rounded-2xl bg-slate-800 border border-slate-700 p-6 transition-all hover:border-slate-600 shadow-xl">
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-slate-400 font-medium flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]" />
                Public Balance
              </h2>
              <span className="text-xs font-mono text-slate-500 border border-slate-700 rounded px-2 py-0.5">
                On-chain
              </span>
            </div>

            <div className="space-y-4">
              <div className="flex items-baseline justify-between">
                <span className="text-2xl font-bold font-secondary tracking-tight">
                  {balance.usdc}
                </span>
                <span className="text-sm font-medium text-slate-400">USDC</span>
              </div>
              <div className="h-px bg-slate-700/50" />
              <div className="flex items-baseline justify-between">
                <span className="text-2xl font-bold font-secondary tracking-tight">
                  {balance.xlm}
                </span>
                <span className="text-sm font-medium text-slate-400">XLM</span>
              </div>
            </div>
          </div>

          {/* Private Balance */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-900/40 to-slate-800 border border-indigo-500/30 p-6 shadow-2xl shadow-indigo-900/10">
            <div className="absolute top-0 right-0 p-3 opacity-10 pointer-events-none">
              <svg
                className="w-24 h-24 text-indigo-400"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm.31-8.86c-1.77-.45-2.34-.94-2.34-1.67 0-.84.79-1.43 2.1-1.43 1.38 0 1.9.66 1.94 1.64h1.71c-.05-1.34-.87-2.57-2.49-2.95V5h-2.93v2.63c-1.71.47-3.15 1.73-3.15 3.23 0 2.18 1.99 2.84 3.99 3.32 2.03.5 2.4.97 2.4 1.76 0 1.1-.95 1.58-2.48 1.58-1.57 0-2.5-.56-2.53-1.84h-1.71c.08 1.96 1.49 2.89 3.09 3.3v2.71h2.93v-2.75c1.98-.53 3.38-1.93 3.38-3.74 0-2.42-2.18-3.26-4.03-3.79z" />
              </svg>
            </div>

            <div className="flex items-center justify-between mb-6 relative z-10">
              <h2 className="text-indigo-200 font-medium flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-indigo-400 shadow-[0_0_12px_rgba(129,140,248,0.8)] animate-pulse" />
                Private Balance
              </h2>
              <span className="text-xs font-mono text-indigo-300/80 border border-indigo-500/30 rounded px-2 py-0.5 bg-indigo-500/10">
                ZK Notes
              </span>
            </div>

            <div className="space-y-4 relative z-10">
              <div className="group">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-indigo-300/70 ">
                    Encrypted USDC
                  </span>
                  {Number(privateBalance.usdc) > 0 && (
                    <button
                      onClick={() => handleWithdrawSelf("USDC")}
                      disabled={withdrawing === "USDC"}
                      className="text-[10px] uppercase font-bold tracking-wider text-indigo-300 hover:text-white transition-colors"
                    >
                      {withdrawing === "USDC" ? "Processing..." : "Withdraw"}
                    </button>
                  )}
                </div>
                <div className="flex items-baseline justify-between p-2 rounded-lg bg-indigo-950/30 border border-indigo-500/10 transition-colors group-hover:border-indigo-500/20">
                  <span className="text-xl font-bold font-secondary text-white">
                    {privateBalance.usdc}
                  </span>
                  <span className="text-xs font-bold text-indigo-400">
                    USDC
                  </span>
                </div>
              </div>

              <div className="group">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-indigo-300/70">
                    Encrypted XLM
                  </span>
                  {Number(privateBalance.xlm) > 0 && (
                    <button
                      onClick={() => handleWithdrawSelf("XLM")}
                      disabled={withdrawing === "XLM"}
                      className="text-[10px] uppercase font-bold tracking-wider text-indigo-300 hover:text-white transition-colors"
                    >
                      {withdrawing === "XLM" ? "Processing..." : "Withdraw"}
                    </button>
                  )}
                </div>
                <div className="flex items-baseline justify-between p-2 rounded-lg bg-indigo-950/30 border border-indigo-500/10 transition-colors group-hover:border-indigo-500/20">
                  <span className="text-xl font-bold font-secondary text-white">
                    {privateBalance.xlm}
                  </span>
                  <span className="text-xs font-bold text-indigo-400">XLM</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Actions Panel */}
          <div className="lg:col-span-2 bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden shadow-sm">
            <div className="p-4 border-b border-slate-700 bg-slate-800/50">
              <h3 className="font-semibold text-slate-200">Quick Actions</h3>
            </div>
            <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Link
                href="/wallet/send"
                className="flex flex-col items-center justify-center p-4 rounded-xl bg-slate-700/30 hover:bg-indigo-600 hover:text-white border border-slate-700 hover:border-indigo-500 transition-all group gap-2"
              >
                <Send className="w-6 h-6 text-white group-hover:text-white transition-colors" />
                <span className="text-xs font-medium">Send Funds</span>
              </Link>

              <button
                onClick={handleXlmFaucet}
                disabled={faucetLoading}
                className="flex flex-col items-center justify-center p-4 rounded-xl bg-slate-700/30 hover:bg-cyan-600 hover:text-white border border-slate-700 hover:border-cyan-500 transition-all group gap-2 disabled:opacity-50"
              >
                <Droplet className="w-6 h-6 text-white group-hover:text-white transition-colors" />
                <span className="text-xs font-medium">
                  {faucetLoading ? "Loading..." : "XLM Faucet"}
                </span>
              </button>

              <button
                onClick={handleTrustline}
                className="flex flex-col items-center justify-center p-4 rounded-xl bg-slate-700/30 hover:bg-emerald-600 hover:text-white border border-slate-700 hover:border-emerald-500 transition-all group gap-2"
              >
                <ShieldCheck className="w-6 h-6 text-white group-hover:text-white transition-colors" />
                <span className="text-xs font-medium">Add Trustline</span>
              </button>

              <a
                href="https://faucet.circle.com/?network=stellar-testnet"
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col items-center justify-center p-4 rounded-xl bg-slate-700/30 hover:bg-blue-600 hover:text-white border border-slate-700 hover:border-blue-500 transition-all group gap-2"
              >
                <Landmark className="w-6 h-6 text-white group-hover:text-white transition-colors" />
                <span className="text-xs font-medium">Circle Faucet</span>
              </a>
            </div>
          </div>

          {/* Receive QR */}
          <div className="bg-white rounded-2xl p-6 shadow-xl flex flex-col items-center justify-center">
            <h3 className="text-slate-800 text-sm font-bold uppercase tracking-wider mb-4">
              Receive Assets
            </h3>
            <div className="p-3 bg-white border-2 border-slate-100 rounded-xl shadow-inner mb-4">
              <QRCodeSVG
                value={user.stellarPublicKey ?? ""}
                size={140}
                level="M"
              />
            </div>
            <div className="w-full">
              <p className="text-[10px] uppercase text-slate-400 font-bold text-center mb-1">
                Your Wallet Address
              </p>
              <div className="bg-slate-100 rounded p-2 text-center border border-slate-200">
                <p className="text-xs font-mono text-slate-600 break-all leading-tight">
                  {user.stellarPublicKey}
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
