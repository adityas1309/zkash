'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useUser } from '@/hooks/useUser';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

export function Header() {
  const { user, loading, workspace } = useUser();
  const nextAction = workspace.nextActions[0];

  return (
    <header className="fixed top-8 left-1/2 -translate-x-1/2 z-50 w-full max-w-3xl px-4 sm:px-0">
      <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-[28px] px-6 py-4 shadow-lg">
        <Link href="/dashboard" className="flex items-center gap-3 group">
          <div className="relative w-8 h-8 group-hover:scale-105 transition-transform duration-300">
            <Image src="/logo/ZKash-logo.webp" alt="Zellar Logo" fill className="object-contain" />
          </div>
          <span className="font-bold text-2xl tracking-tight hidden sm:block text-transparent bg-clip-text bg-gradient-to-r from-white via-indigo-100 to-indigo-200">
            ZKash
          </span>
        </Link>

        <div className="mt-4 flex flex-col gap-3 sm:mt-0 sm:flex-row sm:items-center sm:justify-between">
          <div className="hidden min-w-0 flex-1 sm:block">
            {!loading && (
              <>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={
                      workspace.readiness.tone === 'ready'
                        ? 'success'
                        : workspace.readiness.tone === 'attention'
                          ? 'warning'
                          : 'default'
                    }
                  >
                    {workspace.network.label}
                  </Badge>
                  {user && (
                    <Badge variant={workspace.ops.status === 'ready' ? 'success' : 'warning'}>
                      {workspace.ops.status === 'ready' ? 'Ops Ready' : 'Ops Degraded'}
                    </Badge>
                  )}
                </div>
                <p className="mt-2 truncate text-xs text-slate-300">
                  {user
                    ? nextAction || 'Workspace is ready for the next flow.'
                    : 'Sign in to generate your wallet and readiness checklist.'}
                </p>
              </>
            )}
          </div>

          {!loading &&
            (user ? (
              <div className="flex items-center gap-3">
                <Link href="/contacts">
                  <Button
                    size="sm"
                    className="hidden sm:flex rounded-full bg-white/10 hover:bg-white/20 text-white border border-white/10 transition-all duration-300 font-medium px-5"
                  >
                    Contacts
                  </Button>
                </Link>
                <Link href="/portfolio">
                  <Button
                    size="sm"
                    className="hidden sm:flex rounded-full bg-white/10 hover:bg-white/20 text-white border border-white/10 transition-all duration-300 font-medium px-5"
                  >
                    Portfolio
                  </Button>
                </Link>
                <Link href="/playbook">
                  <Button
                    size="sm"
                    className="hidden sm:flex rounded-full bg-white/10 hover:bg-white/20 text-white border border-white/10 transition-all duration-300 font-medium px-5"
                  >
                    Playbook
                  </Button>
                </Link>
                <Link href="/settlement">
                  <Button
                    size="sm"
                    className="hidden sm:flex rounded-full bg-white/10 hover:bg-white/20 text-white border border-white/10 transition-all duration-300 font-medium px-5"
                  >
                    Settlement
                  </Button>
                </Link>
                <Link href="/liquidity">
                  <Button
                    size="sm"
                    className="hidden sm:flex rounded-full bg-white/10 hover:bg-white/20 text-white border border-white/10 transition-all duration-300 font-medium px-5"
                  >
                    Liquidity
                  </Button>
                </Link>
                <Link href="/actions">
                  <Button
                    size="sm"
                    className="hidden sm:flex rounded-full bg-white/10 hover:bg-white/20 text-white border border-white/10 transition-all duration-300 font-medium px-5"
                  >
                    Actions
                  </Button>
                </Link>
                <Link href="/account">
                  <Button
                    size="sm"
                    className="hidden sm:flex rounded-full bg-white/10 hover:bg-white/20 text-white border border-white/10 transition-all duration-300 font-medium px-5"
                  >
                    Account
                  </Button>
                </Link>
                <Link href="/status">
                  <Button
                    size="sm"
                    className="hidden sm:flex rounded-full bg-white/10 hover:bg-white/20 text-white border border-white/10 transition-all duration-300 font-medium px-5"
                  >
                    Status
                  </Button>
                </Link>
                <Link href="/dashboard">
                  <Button
                    size="sm"
                    className="rounded-full bg-white/10 hover:bg-white/20 text-white border border-white/10 transition-all duration-300 font-medium px-5"
                  >
                    Dashboard
                  </Button>
                </Link>
              </div>
            ) : (
              <Link href="/auth/google">
                <Button
                  size="sm"
                  className="rounded-full bg-white/10 hover:bg-white/20 text-white border border-white/10 transition-all duration-300 font-medium px-5"
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
