"use client";

import { Header } from "./Header";
import { motion, AnimatePresence } from "framer-motion";
import { usePathname } from "next/navigation";
import { usePrivacy } from "@/context/PrivacyContext";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { isPrivate } = usePrivacy();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 selection:bg-indigo-500/30">
      {/* Background glow effects */}
      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
        <div
          className={`absolute top-[-10%] ${isPrivate ? "right-[-5%] bg-indigo-600/10" : "left-[-5%] bg-blue-600/10"} w-[500px] h-[500px] rounded-full blur-[120px] transition-all duration-1000`}
        />
        <div
          className={`absolute bottom-[-10%] ${isPrivate ? "left-[-5%] bg-purple-600/10" : "right-[-5%] bg-indigo-600/10"} w-[500px] h-[500px] rounded-full blur-[120px] transition-all duration-1000`}
        />
      </div>

      <Header />

      <motion.main
        key={pathname}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.3 }}
        className={`relative z-10 ${pathname === "/" ? "w-full" : "container mx-auto px-4 py-8"}`}
      >
        <AnimatePresence mode="wait">{children}</AnimatePresence>
      </motion.main>
    </div>
  );
}
