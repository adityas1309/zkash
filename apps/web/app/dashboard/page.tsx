"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Wallet,
  Repeat,
  History,
  LogOut,
  Copy,
  Check,
  Home,
  ArrowDownToLine,
  ArrowRightLeft,
  Settings,
  Send,
  Shield,
  Globe,
  Info,
  ChevronLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePrivacy } from "@/context/PrivacyContext";
import { PrivacyToggle } from "@/components/ui/PrivacyToggle";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api";

export default function DashboardPage() {
  const { isPrivate, togglePrivacy } = usePrivacy();

  // --- User & Balances State ---
  const [user, setUser] = useState<{
    username?: string;
    stellarPublicKey?: string;
  } | null>(null);
  const [balance, setBalance] = useState<{ usdc: string; xlm: string }>({
    usdc: "0",
    xlm: "0",
  });
  const [copied, setCopied] = useState(false);
  const [privateBalance, setPrivateBalance] = useState<{
    usdc: string;
    xlm: string;
  }>({ usdc: "0", xlm: "0" });
  const [loading, setLoading] = useState(true);
  const [usernameCopied, setUsernameCopied] = useState(false);

  // --- Widget State ---
  const [activeView, setActiveView] = useState<"home" | "send">("home");

  // --- Send State ---
  const [recipient, setRecipient] = useState("");
  const [asset, setAsset] = useState<"USDC" | "XLM">("XLM");
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState("");
  const [sendLoading, setSendLoading] = useState(false);
  const [processStep, setProcessStep] = useState("");

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
    fetch(`${API_URL}/users/me`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => {
        setUser(u);
        if (u) {
          fetchBalance();
          fetchPrivateBalance();
          // Auto-process withdrawals
          fetch(`${API_URL}/users/withdrawals/process`, {
            method: "POST",
            credentials: "include",
          }).catch(console.error);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => {
      fetchBalance();
      fetchPrivateBalance();
    }, 5000);
    return () => clearInterval(interval);
  }, [user]);

  const copyToClipboard = async () => {
    if (user?.stellarPublicKey) {
      await navigator.clipboard.writeText(user.stellarPublicKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const copyUsername = async () => {
    if (user?.username) {
      await navigator.clipboard.writeText(user.username);
      setUsernameCopied(true);
      setTimeout(() => setUsernameCopied(false), 2000);
    }
  };

  const formatAddress = (address: string) => {
    if (!address) return "";
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };

  // --- Send Functions ---
  const handleSplit = async (asset: "USDC" | "XLM", amount: number) => {
    setProcessStep("Splitting note to match exact amount...");
    try {
      const res = await fetch(`${API_URL}/users/split`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ asset, amount }),
      });
      const data = await res.json();
      if (!res.ok || !data.success)
        throw new Error(data.error || "Split failed");

      // Wait a bit for the transaction to be confirmed and indexed
      setProcessStep("Waiting for split confirmation...");
      await new Promise((r) => setTimeout(r, 6000));
      return true;
    } catch (e) {
      throw e;
    }
  };

  const handleDeposit = async (asset: "USDC" | "XLM", amount: number) => {
    setProcessStep(`Depositing ${amount} ${asset} from public balance...`);
    try {
      const res = await fetch(`${API_URL}/users/deposit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ asset, amount }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        // Wait for deposit to be indexed
        setProcessStep("Waiting for deposit confirmation...");
        await new Promise((r) => setTimeout(r, 6000));
        return true;
      } else {
        throw new Error(data.error || "Deposit failed");
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        msg.includes("fetch") || msg.includes("Failed")
          ? "Deposit failed. The network may be slow."
          : `Deposit failed: ${msg}`,
      );
    }
  };

  const handleSend = async () => {
    if (!recipient || !amount) {
      setStatus("Please fill in all fields");
      return;
    }

    setSendLoading(true);
    setStatus("");
    setProcessStep(
      isPrivate ? "Generating proof and submitting..." : "Sending payment...",
    );

    const runDepositFlow = async (
      reqAsset: "USDC" | "XLM",
      reqAmount: number,
    ) => {
      if (
        confirm(
          `Insufficient private balance. Do you want to transfer ${reqAmount} ${reqAsset} from your public pool to continue?`,
        )
      ) {
        console.log("Insufficient balance, attempting auto-deposit...");
        await handleDeposit(reqAsset, reqAmount);
        return true;
      }
      throw new Error("Cancelled by user.");
    };

    try {
      const attemptSend = async () => {
        if (isPrivate) {
          const res = await fetch(`${API_URL}/users/send/private`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ recipient, asset, amount }),
          });
          const data = await res.json();

          if (!data.success) {
            throw new Error(data.error || "Unknown error");
          }
          return data;
        } else {
          const res = await fetch(`${API_URL}/users/send`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ recipient, asset, amount }),
          });
          const data = await res.json();
          if (!data.success) {
            throw new Error(data.message || "Unknown error");
          }
          return data;
        }
      };

      try {
        const data = await attemptSend();
        if (isPrivate) {
          setStatus(
            "Private payment submitted. Recipient can process withdrawals on their wallet.",
          );
        } else {
          setStatus(`Payment successful! TX: ${data.hash}`);
        }
        fetchBalance();
        fetchPrivateBalance();
        setAmount("");
        setRecipient("");
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to send";
        const numAmount = parseFloat(amount);

        if (isPrivate) {
          if (
            msg.includes("No private note with EXACT amount") ||
            msg.includes("No spendable private note") ||
            msg.includes("Splitting not yet supported")
          ) {
            console.log("Exact note missing, attempting auto-split...");
            try {
              await handleSplit(asset, numAmount);
            } catch (splitErr: unknown) {
              const splitMsg =
                splitErr instanceof Error ? splitErr.message : String(splitErr);
              if (splitMsg.includes("Insufficient private balance")) {
                await runDepositFlow(asset, numAmount);
              } else {
                throw splitErr;
              }
            }

            setProcessStep("Retrying payment after split...");
            const retryData = await attemptSend();
            setStatus(
              "Private payment submitted. Recipient can process withdrawals on their wallet.",
            );
            fetchBalance();
            fetchPrivateBalance();
            setAmount("");
            setRecipient("");
          } else if (msg.includes("Insufficient private balance")) {
            await runDepositFlow(asset, numAmount);
            setProcessStep("Retrying payment after deposit...");
            const retryData = await attemptSend();
            setStatus(
              "Private payment submitted. Recipient can process withdrawals on their wallet.",
            );
            fetchBalance();
            fetchPrivateBalance();
            setAmount("");
            setRecipient("");
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== "Cancelled by user.") {
        setStatus(msg);
      }
      console.error(e);
    } finally {
      setSendLoading(false);
      setProcessStep("");
    }
  };

  if (loading)
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400">
        Loading...
      </div>
    );

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="text-center space-y-4">
          <p className="text-slate-400">Not logged in.</p>
          <Link
            href="/"
            className="inline-block px-6 py-2 bg-indigo-600 rounded-full text-white hover:bg-indigo-500 transition-colors"
          >
            Go home
          </Link>
        </div>
      </div>
    );
  }

  // Calculate totals
  const totalUsdc = isPrivate
    ? Number(privateBalance.usdc)
    : Number(balance.usdc);
  const totalXlm = isPrivate ? Number(privateBalance.xlm) : Number(balance.xlm);
  const totalDisplay = isPrivate
    ? "$***.**"
    : `$${Math.max(totalUsdc, 0).toFixed(2)}`; // Mock displaying USDC as primary fiat value for total
  // NOTE: For a real app we would price XLM in USD to add to totalUsdc, but here we just show a representative value.

  return (
    <div className="w-full relative overflow-hidden bg-slate-900/30 rounded-[32px] border border-white/5 text-slate-200 font-sans flex flex-col justify-center p-8 lg:p-12">
      {/* Top Controls */}
      <div className="absolute top-6 right-8 z-20">
        <PrivacyToggle checked={isPrivate} onCheckedChange={togglePrivacy} />
      </div>

      {/* Background glowing effects */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4/5 h-2/3 bg-indigo-600/20 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute top-[40%] left-1/2 -translate-x-1/2 w-full max-w-4xl h-32 bg-indigo-500/10 blur-[60px] pointer-events-none" />

      <div className="w-full max-w-[1400px] mx-auto grid grid-cols-1 xl:grid-cols-3 gap-12 items-center relative z-10">
        {/* Left Side Text */}
        <div className="hidden lg:block space-y-4 px-8">
          <h1 className="text-5xl xl:text-6xl font-sans font-bold leading-tight tracking-tight">
            Safety Invest <br />
            in Crypto
          </h1>
          <p className="text-slate-400 max-w-sm text-sm">
            Discover a user-friendly platform for trading over 3,000+ assets
          </p>
          <div className="flex items-center gap-4 mt-8 opacity-50">
            {/* Mock logos for decoration */}
            <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center border border-slate-700">
              <span className="font-bold text-xs">₿</span>
            </div>
            <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center border border-slate-700">
              <span className="font-bold text-xs">S</span>
            </div>
            <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center border border-slate-700">
              <span className="font-bold text-xs">E</span>
            </div>
            <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center border border-slate-700">
              <span className="font-bold text-[10px]">USDC</span>
            </div>
          </div>
        </div>

        {/* Center Widget */}
        <div className="flex justify-center relative">
          <div className="w-full max-w-[360px] bg-slate-900/80 backdrop-blur-2xl border border-slate-800 shadow-2xl rounded-[40px] p-6 pb-8 relative overflow-hidden transition-all duration-500 min-h-[620px] flex flex-col">
            {/* Top Indicator */}
            <div className="w-12 h-1.5 bg-slate-800 rounded-full mx-auto mb-8" />

            {activeView === "home" ? (
              <div className="flex-1 flex flex-col animate-in fade-in zoom-in-95 duration-300">
                {/* Total Balance */}
                <div className="text-center mb-8">
                  <p className="text-4xl font-secondary font-bold tracking-tight bg-gradient-to-br from-white to-slate-400 bg-clip-text text-transparent">
                    {totalDisplay}
                  </p>
                  <p className="text-sm text-slate-500 mt-2 font-mono flex items-center justify-center gap-2">
                    {user.stellarPublicKey && (
                      <>
                        <span className="w-4 h-4 rounded-full bg-indigo-500/20 flex items-center justify-center">
                          <span className="w-2 h-2 rounded-full bg-indigo-400"></span>
                        </span>
                        {formatAddress(user.stellarPublicKey)}
                      </>
                    )}
                  </p>
                </div>

                {/* Sub Balances */}
                <div className="bg-slate-800/40 rounded-3xl p-5 mb-8 border border-white/5 space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-[#2775ca]/10 flex items-center justify-center p-1.5 border border-[#2775ca]/20 shadow-inner opacity-90">
                        <img
                          src="https://cryptologos.cc/logos/usd-coin-usdc-logo.svg?v=035"
                          alt="USDC"
                          className="w-full h-full object-contain"
                        />
                      </div>
                      <div>
                        <p className="text-xl font-bold font-secondary text-white">
                          {isPrivate ? "******" : balance.usdc}
                        </p>
                        <p className="text-slate-400 text-sm font-medium">
                          USDC
                        </p>
                      </div>
                    </div>
                    {isPrivate && (
                      <div className="text-right">
                        <p className="text-base font-bold text-indigo-400">
                          {privateBalance.usdc}
                        </p>
                        <p className="text-slate-500 text-xs uppercase tracking-wider font-semibold">
                          Private
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="h-px w-full bg-slate-700/50" />
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-white/5 flex items-center justify-center p-2 border border-white/10 shadow-inner opacity-90 text-white">
                        <img
                          src="https://cryptologos.cc/logos/stellar-xlm-logo.svg?v=035"
                          alt="XLM"
                          className="w-full h-full object-contain brightness-0 invert"
                        />
                      </div>
                      <div>
                        <p className="text-xl font-bold font-secondary text-white">
                          {isPrivate ? "******" : balance.xlm}
                        </p>
                        <p className="text-slate-400 text-sm font-medium">
                          XLM
                        </p>
                      </div>
                    </div>
                    {isPrivate && (
                      <div className="text-right">
                        <p className="text-base font-bold text-indigo-400">
                          {privateBalance.xlm}
                        </p>
                        <p className="text-slate-500 text-xs uppercase tracking-wider font-semibold">
                          Private
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Send / Receive Actions */}
                <div className="flex items-center gap-3 mb-auto">
                  <Link
                    href="/wallet"
                    className="flex-1 bg-slate-800/50 hover:bg-slate-800 border border-white/5 py-4 rounded-2xl flex items-center justify-center gap-2 text-sm font-medium transition-colors"
                  >
                    Receive <ArrowDownToLine size={16} />
                  </Link>
                  <button
                    onClick={() => setActiveView("send")}
                    className="flex-1 bg-slate-800/50 hover:bg-slate-800 border border-white/5 py-4 rounded-2xl flex items-center justify-center gap-2 text-sm font-medium transition-colors"
                  >
                    Transfer <ArrowRightLeft size={16} />
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col animate-in slide-in-from-right-4 fade-in duration-300">
                <div className="flex items-center mb-6">
                  <button
                    onClick={() => setActiveView("home")}
                    className="p-2 -ml-2 rounded-full hover:bg-white/5 text-slate-400 transition-colors"
                  >
                    <ChevronLeft size={20} />
                  </button>
                  <h3 className="text-lg font-bold font-secondary mx-auto pr-6">
                    Send Funds
                  </h3>
                </div>

                <div className="space-y-5 flex-1 pl-1">
                  <div className="p-3 rounded-xl bg-slate-800/30 border border-slate-700/50 flex items-start gap-2">
                    <Info
                      className="text-slate-400 shrink-0 mt-0.5"
                      size={14}
                    />
                    <p className="text-[11px] text-slate-300 leading-tight">
                      You are sending in{" "}
                      <span
                        className={
                          isPrivate
                            ? "text-indigo-400 font-bold"
                            : "text-blue-400 font-bold"
                        }
                      >
                        {isPrivate ? "Private Mode" : "Public Mode"}
                      </span>
                      .{" "}
                      {isPrivate
                        ? "Hidden using ZK proofs."
                        : "Visible on chain."}
                    </p>
                  </div>

                  <div>
                    <label className="block text-slate-400 text-xs font-medium mb-1.5 ml-1">
                      Recipient
                    </label>
                    <Input
                      type="text"
                      value={recipient}
                      onChange={(e) => setRecipient(e.target.value)}
                      placeholder="Username or Stellar Addr"
                      disabled={sendLoading}
                      className="bg-slate-900/50 rounded-xl border-slate-700/50 text-sm h-12"
                    />
                  </div>

                  <div className="flex gap-3">
                    <div className="w-1/3">
                      <label className="block text-slate-400 text-xs font-medium mb-1.5 ml-1">
                        Asset
                      </label>
                      <select
                        value={asset}
                        onChange={(e) =>
                          setAsset(e.target.value as "USDC" | "XLM")
                        }
                        className="w-full h-12 rounded-xl border border-slate-700/50 bg-slate-900/50 px-3 text-sm focus:outline-none focus:border-indigo-500 transition-all text-slate-200"
                        disabled={sendLoading}
                      >
                        <option value="XLM">XLM</option>
                        <option value="USDC">USDC</option>
                      </select>
                    </div>
                    <div className="flex-1">
                      <label className="block text-slate-400 text-xs font-medium mb-1.5 ml-1">
                        Amount
                      </label>
                      <Input
                        type="number"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="0.00"
                        disabled={sendLoading}
                        className="bg-slate-900/50 rounded-xl border-slate-700/50 font-mono h-12 text-sm"
                      />
                    </div>
                  </div>

                  {status && (
                    <div
                      className={cn(
                        "p-3 rounded-xl border-l-4 text-xs font-medium mt-4",
                        status.includes("success") ||
                          status.includes("submitted")
                          ? "bg-emerald-500/10 border-emerald-500 text-emerald-200"
                          : "bg-red-500/10 border-red-500 text-red-200",
                      )}
                    >
                      <p className="break-words">{status}</p>
                    </div>
                  )}
                  {processStep && (
                    <div className="p-3 rounded-xl bg-indigo-500/10 border-l-4 border-indigo-500 text-indigo-200 text-xs font-medium mt-4 flex items-center gap-2">
                      <span className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin shrink-0"></span>
                      {processStep}
                    </div>
                  )}

                  <div className="mt-auto pt-6">
                    <Button
                      onClick={handleSend}
                      isLoading={sendLoading}
                      className="w-full h-12 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium"
                      disabled={!recipient || !amount}
                    >
                      <Send className="mr-2 h-4 w-4" />
                      {isPrivate ? "Send Privately" : "Send Publicly"}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* User Info / Receive */}
            <div className="mt-auto pt-6">
              <div className="bg-slate-800/50 rounded-2xl p-4 flex flex-col items-center justify-center border border-white/5 space-y-3">
                <p className="text-sm font-medium text-slate-400">
                  User:{" "}
                  <span className="text-white font-bold">
                    @{user?.username || "Unknown"}
                  </span>
                </p>
                <div className="bg-slate-900/50 p-3 rounded-lg border border-white/5 w-full flex items-center relative group overflow-hidden">
                  <p className="text-xs font-mono text-slate-400 truncate w-full text-center pr-6">
                    {user?.stellarPublicKey || "Loading address..."}
                  </p>
                  {user?.stellarPublicKey && (
                    <button
                      onClick={() => {
                        if (user.stellarPublicKey) {
                          navigator.clipboard.writeText(user.stellarPublicKey);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        }
                      }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-indigo-400 hover:text-indigo-300 transition-all p-1.5 bg-indigo-500/10 rounded-md opacity-0 group-hover:opacity-100 backdrop-blur-md"
                      title="Copy Address"
                    >
                      {copied ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Side Text */}
        <div className="hidden lg:flex flex-col items-end space-y-4 px-8 text-right">
          <h2 className="text-5xl xl:text-6xl font-sans font-bold leading-tight tracking-tight">
            Fast & Secure <br /> Platform
          </h2>
          <p className="text-slate-400 max-w-sm text-sm">
            Trade and Invest with Confidence. Unlock the Future Finance with
            Secure.
          </p>
          <div className="mt-8">
            <Link
              href="/wallet"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-slate-800 border border-slate-700 hover:border-indigo-500 transition-colors text-sm font-medium"
            >
              <Wallet size={16} className="text-indigo-400" />
              Advanced Wallet
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
