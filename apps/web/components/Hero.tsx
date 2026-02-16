"use client";

import { motion } from "framer-motion";
import { Globe } from "./ui/Globe";
import { Button } from "./ui/Button";
import Link from "next/link";
import { useUser } from "../hooks/useUser";

export function Hero() {
  const { user, loading } = useUser();
  return (
    <div className="relative w-full h-screen overflow-hidden bg-slate-950 flex flex-col items-center justify-center text-center">
      {/* Background Globe - positioned mostly below the fold or behind content */}
      <div className="absolute inset-x-0 bottom-[-40%] sm:bottom-[-25%] md:bottom-[-30%] lg:bottom-[-15%] xl:bottom-[-10%] z-0 pointer-events-none sm:pointer-events-auto opacity-60 sm:opacity-100 transition-opacity duration-1000">
        <Globe className="w-full h-full max-w-[1400px] mx-auto" />
      </div>

      {/* Optional Gradient Overlay for better text readability */}
      <div className="absolute inset-0 bg-gradient-to-b from-slate-950 via-transparent to-slate-950/80 z-0 pointer-events-none" />

      {/* Main Content */}
      <div className="relative z-10 px-4 max-w-5xl mx-auto flex flex-col items-center gap-8 mt-[-15vh]">
        {" "}
        {/* Adjust top margin to optical center */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="flex flex-col gap-4"
        >
          <h1 className="text-6xl md:text-7xl font-bold tracking-tighter text-white drop-shadow-2xl font-secondary">
            Transfer <span className="text-indigo-500">. Convert .</span>{" "}
            Instantly
          </h1>
          <p className="text-xl md:text-2xl text-slate-300 max-w-2xl mx-auto  font-light leading-relaxed">
            Privacy-first P2P payments and swaps on Stellar testnet.
            <br className="hidden md:block" />
            Send USDC and XLM privately without improved security.
          </p>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.4, ease: "backOut" }}
        >
          {user ? (
            <Link href="/dashboard">
              <Button
                size="lg"
                className="rounded-full px-12 py-8 text-xl font-bold shadow-indigo-500/20  transition-transform hover:scale-105 tracking-wide "
              >
                Dashboard
              </Button>
            </Link>
          ) : (
            <Link
              href={
                (process.env.NEXT_PUBLIC_API_URL ?? "/api") + "/auth/google"
              }
            >
              <Button
                size="lg"
                className="rounded-full px-12 py-8 text-xl font-bold shadow-indigo-500/20  transition-transform hover:scale-105 tracking-wide "
              >
                Sign in with Google
              </Button>
            </Link>
          )}
        </motion.div>
      </div>
    </div>
  );
}
