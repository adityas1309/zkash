'use client';

import { Hero } from '@/components/Hero';
import { Footer } from '@/components/layout/Footer';
import { PrivacySection } from '@/components/PrivacySection';
import { StatsSection } from '@/components/StatsSection';
import { useAuthWorkspace } from '@/hooks/useAuthWorkspace';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Shield, Wallet, BadgeCheck, Activity } from 'lucide-react';

export default function Home() {
  const { workspace } = useAuthWorkspace();

  return (
    <main className="flex min-h-screen flex-col items-center justify-between">
      <Hero />
      <section className="relative z-10 mx-auto -mt-10 w-full max-w-6xl px-4">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card variant="glass">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Wallet funding</p>
                <p className="mt-2 text-3xl font-semibold text-white">
                  {workspace.wallet.public.xlm} XLM
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Public balance available for fees, trustline setup, and deposits.
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/80 p-3 text-indigo-300">
                <Wallet className="h-5 w-5" />
              </div>
            </div>
          </Card>
          <Card variant="glass">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Trustline state</p>
                <p className="mt-2 text-3xl font-semibold text-white">
                  {workspace.wallet.public.hasUsdcTrustline ? 'Ready' : 'Missing'}
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  USDC flow stays blocked until the public wallet can hold the asset.
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/80 p-3 text-emerald-300">
                <BadgeCheck className="h-5 w-5" />
              </div>
            </div>
          </Card>
          <Card variant="glass">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Private readiness</p>
                <p className="mt-2 text-3xl font-semibold text-white">
                  {workspace.wallet.private.hasShieldedBalance ? 'Seeded' : 'Waiting'}
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  The first shielded deposit unlocks private send, split, and private swap
                  preparation.
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/80 p-3 text-sky-300">
                <Shield className="h-5 w-5" />
              </div>
            </div>
          </Card>
          <Card variant="glass">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Ops health</p>
                <p className="mt-2 text-3xl font-semibold text-white">
                  {workspace.ops.status === 'ready' ? 'Healthy' : 'Watching'}
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  {workspace.ops.status === 'ready'
                    ? `${workspace.ops.trackedPools} pools are tracked without lag.`
                    : `${workspace.ops.laggingPools} pool lanes are lagging and may slow note visibility.`}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/80 p-3 text-amber-300">
                <Activity className="h-5 w-5" />
              </div>
            </div>
          </Card>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {workspace.checklist.slice(0, 4).map((item) => (
            <Badge
              key={item.id}
              variant={
                item.status === 'complete'
                  ? 'success'
                  : item.status === 'attention'
                    ? 'warning'
                    : 'default'
              }
            >
              {item.label}
            </Badge>
          ))}
        </div>
      </section>
      <PrivacySection />
      <StatsSection />
      <Footer />
    </main>
  );
}
