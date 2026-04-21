"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Home, Wallet, Repeat, Banknote, LogOut, UserCircle2, Wrench, Users, PieChart, Rocket } from "lucide-react";

export function FloatingBottomNav() {
  const pathname = usePathname();
  const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api";

  // Only show bottom nav for authenticated routes, we assume if it's not '/' it's an authenticated dashboard route due to requirement.
  if (pathname === "/") return null;

  const navItems = [
    { name: "Home", href: "/dashboard", icon: Home },
    { name: "Wallet", href: "/wallet", icon: Wallet },
    { name: "Swap", href: "/swap", icon: Repeat },
    { name: "Fiat", href: "/fiat", icon: Banknote },
    { name: "Contacts", href: "/contacts", icon: Users },
    { name: "Portfolio", href: "/portfolio", icon: PieChart },
    { name: "Playbook", href: "/playbook", icon: Rocket },
    { name: "Actions", href: "/actions", icon: Wrench },
    { name: "Account", href: "/account", icon: UserCircle2 },
  ];

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-10 fade-in duration-500">
      <div className="bg-slate-900/80 backdrop-blur-2xl border border-white/10 shadow-2xl shadow-indigo-500/10 rounded-full px-6 py-3 flex items-center justify-between gap-2 sm:gap-6 min-w-[320px] sm:min-w-[400px]">
        {navItems.map((item) => {
          const isActive = pathname?.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "p-3 rounded-full transition-all duration-300 relative group",
                isActive
                  ? "bg-indigo-500/20 text-indigo-400"
                  : "text-slate-500 hover:text-slate-200 hover:bg-slate-800",
              )}
            >
              <Icon
                size={20}
                className={
                  isActive
                    ? "scale-110"
                    : "scale-100 group-hover:scale-110 transition-transform"
                }
              />
              {/* Tooltip for desktop */}
              <span className="absolute -top-10 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-xs py-1 px-2 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
                {item.name}
              </span>
            </Link>
          );
        })}

        <div className="w-px h-8 bg-white/10 mx-1 border-r border-transparent"></div>

        <a
          href={`${API_URL}/auth/logout`}
          className="p-3 rounded-full text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all duration-300 relative group"
        >
          <LogOut
            size={20}
            className="group-hover:scale-110 transition-transform"
          />
          <span className="absolute -top-10 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-xs py-1 px-2 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
            Logout
          </span>
        </a>
      </div>
    </div>
  );
}
