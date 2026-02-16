"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Wallet, Repeat, History, LogOut, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api";

export default function DashboardPage() {
  const [user, setUser] = useState<{
    username?: string;
    stellarPublicKey?: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/users/me`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => {
        setUser(u);
        if (u) {
          // Auto-process withdrawals
          fetch(`${API_URL}/users/withdrawals/process`, {
            method: "POST",
            credentials: "include",
          }).catch(console.error);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const copyToClipboard = async () => {
    if (user?.stellarPublicKey) {
      await navigator.clipboard.writeText(user.stellarPublicKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (loading)
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-400">
        Loading...
      </div>
    );

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
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

  return (
    <main className="min-h-screen p-4 md:p-8 max-w-5xl mx-auto space-y-8">
      {/* Hero Section */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
          Dashboard
        </h1>
        <p className="text-slate-400">Welcome back, {user.username}</p>
      </div>

      <div className=" mx-auto">
        {/* User Details Card */}
        <div className="rounded-2xl bg-slate-800/50 border border-white/5 p-6 space-y-6 backdrop-blur-sm">
          <h2 className="text-slate-300 font-medium flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-indigo-400" />
            Account Details
          </h2>

          <div className="space-y-4">
            <div className="space-y-1">
              <p className="text-xs text-slate-500 uppercase tracking-wider">
                Username
              </p>
              <div className="bg-indigo-500/10 rounded-lg p-3 border border-indigo-500/20">
                <p className="font-mono text-lg text-indigo-300 font-medium">
                  {user.username}
                </p>
              </div>
              <p className="text-[10px] text-slate-500">
                Users can send money to this username directly.
              </p>
            </div>

            <div className="space-y-1">
              <p className="text-xs text-slate-500 uppercase tracking-wider">
                Stellar Address
              </p>
              <div className="group relative bg-black/20 rounded-lg p-3 border border-white/5 hover:border-white/10 transition-colors">
                <p className="font-mono text-sm text-slate-300 break-all pr-8">
                  {user.stellarPublicKey}
                </p>
                <button
                  onClick={copyToClipboard}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-500 hover:text-white transition-colors"
                  title="Copy address"
                >
                  {copied ? (
                    <Check size={16} className="text-emerald-400" />
                  ) : (
                    <Copy size={16} />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Link
          href="/wallet"
          className="group flex flex-col items-center justify-center p-6 rounded-2xl bg-slate-800/50 border border-white/5 hover:bg-indigo-600 hover:border-indigo-500 transition-all duration-300"
        >
          <div className="p-3 rounded-full bg-indigo-500/10 group-hover:bg-white/10 mb-3 transition-colors">
            <Wallet className="w-6 h-6 text-indigo-400 group-hover:text-white" />
          </div>
          <span className="text-sm font-medium text-slate-300 group-hover:text-white">
            Wallet
          </span>
        </Link>

        <Link
          href="/swap"
          className="group flex flex-col items-center justify-center p-6 rounded-2xl bg-slate-800/50 border border-white/5 hover:bg-indigo-600 hover:border-indigo-500 transition-all duration-300"
        >
          <div className="p-3 rounded-full bg-cyan-500/10 group-hover:bg-white/10 mb-3 transition-colors">
            <Repeat className="w-6 h-6 text-cyan-400 group-hover:text-white" />
          </div>
          <span className="text-sm font-medium text-slate-300 group-hover:text-white">
            P2P Swap
          </span>
        </Link>

        <Link
          href="/history"
          className="group flex flex-col items-center justify-center p-6 rounded-2xl bg-slate-800/50 border border-white/5 hover:bg-indigo-600 hover:border-indigo-500 transition-all duration-300"
        >
          <div className="p-3 rounded-full bg-purple-500/10 group-hover:bg-white/10 mb-3 transition-colors">
            <History className="w-6 h-6 text-purple-400 group-hover:text-white" />
          </div>
          <span className="text-sm font-medium text-slate-300 group-hover:text-white">
            History
          </span>
        </Link>

        <a
          href={`${API_URL}/auth/logout`}
          className="group flex flex-col items-center justify-center p-6 rounded-2xl bg-slate-800/50 border border-white/5 hover:bg-red-900/50 hover:border-red-500/50 transition-all duration-300"
        >
          <div className="p-3 rounded-full bg-red-500/10 group-hover:bg-white/10 mb-3 transition-colors">
            <LogOut className="w-6 h-6 text-red-400 group-hover:text-white" />
          </div>
          <span className="text-sm font-medium text-slate-300 group-hover:text-white">
            Logout
          </span>
        </a>
      </div>
    </main>
  );
}
