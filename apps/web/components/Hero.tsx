"use client";

import { motion } from "framer-motion";
import { Globe } from "./ui/Globe";
import { Button } from "./ui/Button";
import Link from "next/link";
import { Badge } from "./ui/Badge";
import { Shield, Wallet, Layers3, Activity } from "lucide-react";
import { useUser } from "../hooks/useUser";

export function Hero() {
  const { user, loading, workspace } = useUser();
  const checklist = workspace.checklist.slice(0, 4);

  return (
    <div className="relative w-full h-screen overflow-hidden bg-slate-950 flex flex-col items-center justify-center text-center">
      <div className="absolute inset-x-0 bottom-[-40%] sm:bottom-[-25%] md:bottom-[-30%] lg:bottom-[-15%] xl:bottom-[-10%] z-0 pointer-events-none sm:pointer-events-auto opacity-60 sm:opacity-100 transition-opacity duration-1000">
        <Globe className="w-full h-full max-w-[1400px] mx-auto" />
      </div>

      <div className="absolute inset-0 bg-gradient-to-b from-slate-950 via-transparent to-slate-950 z-0 pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-full h-32 bg-gradient-to-t from-slate-950 to-transparent z-[5] pointer-events-none" />

      <div className="relative z-10 px-4 max-w-6xl mx-auto flex flex-col items-center gap-8 mt-[-10vh]">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="flex flex-col items-center gap-4"
        >
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Badge variant="default">{workspace.network.label}</Badge>
            <Badge
              variant={
                workspace.readiness.tone === "ready"
                  ? "success"
                  : workspace.readiness.tone === "attention"
                    ? "warning"
                    : "default"
              }
            >
              Readiness {workspace.readiness.score}
            </Badge>
            {user && (
              <Badge variant={workspace.ops.status === "ready" ? "success" : "warning"}>
                {workspace.ops.status === "ready" ? "Indexer Healthy" : `${workspace.ops.laggingPools} Lagging Pools`}
              </Badge>
            )}
          </div>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tighter text-white drop-shadow-2xl font-secondary">
            {workspace.readiness.headline}
          </h1>
          <p className="text-lg md:text-2xl text-slate-300 max-w-3xl mx-auto font-light leading-relaxed">
            {workspace.readiness.detail}
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.4, ease: "backOut" }}
          className="flex flex-wrap items-center justify-center gap-4"
        >
          {user ? (
            <>
              <Link href="/dashboard">
                <Button
                  size="lg"
                  className="rounded-full px-12 py-8 text-xl font-bold shadow-indigo-500/20 transition-transform hover:scale-105 tracking-wide"
                >
                  Open Dashboard
                </Button>
              </Link>
              <Link href="/status">
                <Button
                  size="lg"
                  variant="ghost"
                  className="rounded-full px-10 py-8 text-xl font-bold border border-white/10 bg-white/5 hover:bg-white/10 tracking-wide"
                >
                  Check Status
                </Button>
              </Link>
            </>
          ) : (
            <Link href="/auth/google">
              <Button
                size="lg"
                className="rounded-full px-12 py-8 text-xl font-bold shadow-indigo-500/20 transition-transform hover:scale-105 tracking-wide"
              >
                Sign in with Google
              </Button>
            </Link>
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.3 }}
          className="grid w-full max-w-5xl gap-4 md:grid-cols-4"
        >
          <div className="rounded-[28px] border border-white/10 bg-slate-900/70 p-5 text-left backdrop-blur-md">
            <div className="mb-3 inline-flex rounded-2xl border border-white/10 bg-white/5 p-3 text-indigo-300">
              <Wallet className="h-5 w-5" />
            </div>
            <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Public wallet</p>
            <p className="mt-2 text-2xl font-semibold text-white">{workspace.wallet.public.xlm} XLM</p>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              {user ? "Available for trustlines, fees, and direct public transfers." : "Wallet balances appear here after authentication."}
            </p>
          </div>
          <div className="rounded-[28px] border border-white/10 bg-slate-900/70 p-5 text-left backdrop-blur-md">
            <div className="mb-3 inline-flex rounded-2xl border border-white/10 bg-white/5 p-3 text-emerald-300">
              <Shield className="h-5 w-5" />
            </div>
            <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Private flow</p>
            <p className="mt-2 text-2xl font-semibold text-white">
              {workspace.wallet.private.hasShieldedBalance ? "Seeded" : "Unseeded"}
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              {workspace.wallet.private.hasShieldedBalance
                ? `${workspace.wallet.private.xlm} XLM and ${workspace.wallet.private.usdc} USDC already live in shielded flow.`
                : "A first deposit unlocks private send, note splitting, and private swaps."}
            </p>
          </div>
          <div className="rounded-[28px] border border-white/10 bg-slate-900/70 p-5 text-left backdrop-blur-md">
            <div className="mb-3 inline-flex rounded-2xl border border-white/10 bg-white/5 p-3 text-sky-300">
              <Layers3 className="h-5 w-5" />
            </div>
            <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Checklist</p>
            <p className="mt-2 text-2xl font-semibold text-white">
              {workspace.checklist.filter((item) => item.status === "complete").length}
              <span className="text-base font-medium text-slate-400"> / {Math.max(workspace.checklist.length, 4)}</span>
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              Setup steps mapped to actual wallet and indexer readiness instead of a generic onboarding script.
            </p>
          </div>
          <div className="rounded-[28px] border border-white/10 bg-slate-900/70 p-5 text-left backdrop-blur-md">
            <div className="mb-3 inline-flex rounded-2xl border border-white/10 bg-white/5 p-3 text-amber-300">
              <Activity className="h-5 w-5" />
            </div>
            <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Ops signal</p>
            <p className="mt-2 text-2xl font-semibold text-white">{workspace.ops.status === "ready" ? "Healthy" : "Watching"}</p>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              {workspace.ops.status === "ready"
                ? `${workspace.ops.trackedPools} tracked pools with no lagging sync lane right now.`
                : `${workspace.ops.laggingPools} lagging pool lanes may slow private balance updates.`}
            </p>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.45 }}
          className="grid w-full max-w-5xl gap-4 lg:grid-cols-[1.1fr_0.9fr]"
        >
          <div className="rounded-[28px] border border-white/10 bg-slate-900/75 p-6 text-left backdrop-blur-md">
            <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Next actions</p>
            <div className="mt-4 space-y-3">
              {workspace.nextActions.map((item, index) => (
                <div key={item} className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                  <p className="text-xs uppercase tracking-wide text-indigo-300">Step {index + 1}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-200">{item}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-[28px] border border-white/10 bg-slate-900/75 p-6 text-left backdrop-blur-md">
            <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Readiness checklist</p>
            <div className="mt-4 space-y-3">
              {checklist.length ? (
                checklist.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-white">{item.label}</p>
                      <Badge
                        variant={
                          item.status === "complete"
                            ? "success"
                            : item.status === "attention"
                              ? "warning"
                              : "default"
                        }
                      >
                        {item.status.toUpperCase()}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-400">{item.detail}</p>
                    <p className="mt-2 text-xs uppercase tracking-wide text-indigo-300">{item.action}</p>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-sm text-slate-400">
                  Authenticate to unlock the personalized setup checklist.
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
