"use client";

import Link from "next/link";
import Image from "next/image";
import { useUser } from "@/hooks/useUser";
import { Button } from "@/components/ui/Button";

export function Header() {
  const { user, loading } = useUser();

  return (
    <header className="fixed top-8 left-1/2 -translate-x-1/2 z-50 w-full max-w-3xl px-4 sm:px-0">
      <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-full px-6 h-16 flex items-center justify-between shadow-lg">
        <Link href="/dashboard" className="flex items-center gap-3 group">
          <div className="relative w-8 h-8 group-hover:scale-105 transition-transform duration-300">
            <Image
              src="/logo/ZKash-logo.webp"
              alt="Zellar Logo"
              fill
              className="object-contain"
            />
          </div>
          <span className="font-bold text-2xl tracking-tight hidden sm:block text-transparent bg-clip-text bg-gradient-to-r from-white via-indigo-100 to-indigo-200">
            ZKash
          </span>
        </Link>

        <div className="flex items-center gap-4">
          {!loading &&
            (user ? (
              <Link href="/dashboard">
                <Button
                  size="sm"
                  className="hidden sm:flex rounded-full bg-white/10 hover:bg-white/20 text-white border border-white/10 transition-all duration-300 font-medium px-5"
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
                  size="sm"
                  className="hidden sm:flex rounded-full bg-white/10 hover:bg-white/20 text-white border border-white/10 transition-all duration-300 font-medium px-5"
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
