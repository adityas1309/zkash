"use client";

import Link from "next/link";
import Image from "next/image";
import { usePrivacy } from "@/context/PrivacyContext";
import { PrivacyToggle } from "@/components/ui/PrivacyToggle";
import { motion } from "framer-motion";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Home, Wallet, Repeat, History, LogOut, Banknote } from "lucide-react";
import { useUser } from "@/hooks/useUser";
import { Button } from "@/components/ui/Button";

export function Header() {
  const { isPrivate, togglePrivacy } = usePrivacy();
  const pathname = usePathname();
  const { user, loading } = useUser();

  const navItems = [
    { name: "Dashboard", href: "/dashboard", icon: Home },
    { name: "Wallet", href: "/wallet", icon: Wallet },
    { name: "Swap", href: "/swap", icon: Repeat },
    { name: "Fiat (INR)", href: "/fiat", icon: Banknote },
    { name: "History", href: "/history", icon: History },
  ];

  return (
    <header className="sticky top-0 z-50 border-b border-white/5 bg-transparent backdrop-blur-md">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <Link href="/dashboard" className="flex items-center gap-3 group">
          <div className="relative w-10 h-10 group-hover:scale-105 transition-transform duration-300">
            <Image
              src="/logo/52ac1c71-ffe0-4b8b-a4d1-917df63f8609.png"
              alt="Zellar Logo"
              fill
              className="object-contain"
            />
          </div>
          <span className="font-bold text-2xl tracking-tight hidden sm:block text-transparent bg-clip-text bg-gradient-to-r from-white via-indigo-100 to-indigo-200">
            Zellar
          </span>
        </Link>

        {/* Desktop Nav */}
        {!loading && user && (
          <nav className="hidden md:flex items-center gap-1 bg-slate-900/50 p-1 rounded-full border border-white/5">
            {navItems.map((item) => {
              const isActive = pathname?.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={cn(
                    "px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 flex items-center gap-2",
                    isActive
                      ? "bg-slate-800 text-white shadow-sm"
                      : "text-slate-400 hover:text-white hover:bg-slate-800/50",
                  )}
                >
                  <Icon size={16} />
                  {item.name}
                </Link>
              );
            })}
          </nav>
        )}

        <div className="flex items-center gap-4">
          {!loading &&
            (user ? (
              <>
                <PrivacyToggle
                  checked={isPrivate}
                  onCheckedChange={togglePrivacy}
                  className="hidden sm:flex"
                />

                {/* Mobile Menu Button would go here, omitting for brevity/focus on toggle */}
                <Link
                  href="/api/auth/logout"
                  className="p-2 text-slate-400 hover:text-red-400 transition-colors"
                >
                  <LogOut size={20} />
                </Link>
              </>
            ) : (
              <Link
                href={
                  (process.env.NEXT_PUBLIC_API_URL ?? "/api") + "/auth/google"
                }
              >
                <Button
                  size="md"
                  className="hidden sm:flex rounded-full shadow-indigo-500/20 transition-transform hover:scale-105 text-white"
                >
                  Sign In
                </Button>
              </Link>
            ))}
        </div>
      </div>
    </header>
  );
}
