"use client";

import { Header } from "./Header";
import { FloatingBottomNav } from "./FloatingBottomNav";
import { motion, AnimatePresence } from "framer-motion";
import { usePathname } from "next/navigation";
import { usePrivacy } from "@/context/PrivacyContext";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { isPrivate } = usePrivacy();

  // Determine if it is the landing page
  const isLandingPage = pathname === "/";

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

      {isLandingPage && <Header />}

      <motion.main
        key={pathname}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.3 }}
        className={`relative z-10 ${isLandingPage ? "w-full" : "w-full min-h-screen pt-4 pb-28 px-4 sm:px-8 flex flex-col justify-center"}`}
      >
        <AnimatePresence mode="wait">{children}</AnimatePresence>
      </motion.main>

      {/* Floating Bottom Navigation for Authenticated Pages */}
      <FloatingBottomNav />
    </div>
  );
}
