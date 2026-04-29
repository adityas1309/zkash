'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useAuthWorkspace } from '@/hooks/useAuthWorkspace';
import { ArrowRight, CheckCircle2, Shield, Wallet } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export default function AuthGooglePage() {
  const { workspace } = useAuthWorkspace();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      window.location.href = `${API_URL}/auth/google`;
    }, 900);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="mx-auto flex min-h-screen max-w-5xl items-center justify-center px-4 py-12">
      <div className="grid w-full gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="rounded-[32px] border border-white/10 bg-slate-900/80 p-8 shadow-2xl backdrop-blur-md">
          <div className="flex items-center gap-3">
            <Badge variant="default">{workspace.network.label}</Badge>
            <Badge
              variant={
                workspace.readiness.tone === 'ready'
                  ? 'success'
                  : workspace.readiness.tone === 'attention'
                    ? 'warning'
                    : 'default'
              }
            >
              Readiness {workspace.readiness.score}
            </Badge>
          </div>
          <h1 className="mt-5 text-4xl font-bold text-white">Connecting your account</h1>
          <p className="mt-3 text-base leading-7 text-slate-300">
            Google sign-in provisions the wallet keys for this workspace and restores your setup
            state across public and private flows.
          </p>
          <div className="mt-8 rounded-3xl border border-indigo-500/20 bg-indigo-500/10 p-6">
            <p className="text-sm font-medium text-indigo-200">What happens next</p>
            <div className="mt-4 space-y-4">
              <div className="flex gap-3">
                <div className="mt-0.5 rounded-2xl border border-white/10 bg-white/5 p-2 text-indigo-300">
                  <Shield className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-medium text-white">Secure wallet recovery context</p>
                  <p className="mt-1 text-sm leading-6 text-slate-400">
                    Your Stellar and private note secrets are derived into the authenticated
                    workspace and restored after sign-in.
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="mt-0.5 rounded-2xl border border-white/10 bg-white/5 p-2 text-emerald-300">
                  <Wallet className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-medium text-white">Readiness checklist unlocked</p>
                  <p className="mt-1 text-sm leading-6 text-slate-400">
                    After the callback, you will see whether XLM funding, the USDC trustline, and
                    private deposits are still missing.
                  </p>
                </div>
              </div>
            </div>
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href={`${API_URL}/auth/google`}>
              <Button className="rounded-full px-6">
                Continue to Google
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </a>
            <Link href="/">
              <Button variant="ghost" className="rounded-full px-6">
                Back to home
              </Button>
            </Link>
          </div>
        </div>

        <div className="rounded-[32px] border border-white/10 bg-slate-900/70 p-8 shadow-2xl backdrop-blur-md">
          <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Current setup state</p>
          <div className="mt-5 space-y-3">
            {workspace.checklist.length ? (
              workspace.checklist.map((item) => (
                <div
                  key={item.id}
                  className="rounded-2xl border border-white/10 bg-slate-950/60 p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-white">{item.label}</p>
                    <Badge
                      variant={
                        item.status === 'complete'
                          ? 'success'
                          : item.status === 'attention'
                            ? 'warning'
                            : 'default'
                      }
                    >
                      {item.status.toUpperCase()}
                    </Badge>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-400">{item.detail}</p>
                  <p className="mt-2 text-xs uppercase tracking-wide text-indigo-300">
                    {item.action}
                  </p>
                </div>
              ))
            ) : (
              <>
                {workspace.nextActions.map((item) => (
                  <div
                    key={item}
                    className="rounded-2xl border border-white/10 bg-slate-950/60 p-4"
                  >
                    <div className="flex items-center gap-3">
                      <CheckCircle2 className="h-4 w-4 text-indigo-300" />
                      <p className="text-sm leading-6 text-slate-300">{item}</p>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
