'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  Clock3,
  ExternalLink,
  Globe,
  KeyRound,
  LogOut,
  RefreshCw,
  Shield,
  ShieldAlert,
  Sparkles,
  Trash2,
  UserCircle2,
  Wallet,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api';

interface AccountWorkspace {
  session: {
    authenticated: boolean;
    provider: 'google';
    network: {
      mode: 'testnet' | 'mainnet';
      label: string;
    };
    readiness: {
      score: number;
      tone: 'guest' | 'blocked' | 'attention' | 'ready';
      headline: string;
      detail: string;
    };
    memberSince?: string;
  };
  profile: {
    id: string;
    email: string;
    username: string;
    stellarPublicKey: string;
    stellarKeyPreview: string;
    reputation: number;
  };
  wallet: {
    public: {
      xlm: string;
      usdc: string;
      hasXlm: boolean;
      hasUsdcTrustline: boolean;
    };
    private: {
      xlm: string;
      usdc: string;
      hasShieldedBalance: boolean;
    };
    pendingWithdrawals: number;
    composition: {
      publicValueSignals: string[];
      privateValueSignals: string[];
    };
  };
  operations: {
    status: 'ready' | 'degraded';
    trackedPools: number;
    laggingPools: number;
    laggingPoolLabels: string[];
    summary: string;
  };
  activity: {
    total: number;
    completed: number;
    pending: number;
    failed: number;
    privateFlows: number;
    sponsored: number;
    velocity: {
      last24h: {
        total: number;
        successful: number;
        pending: number;
      };
      last7d: {
        total: number;
        successful: number;
        dailyAverage: number;
      };
      momentum: string;
    };
    latestTitles: string[];
  };
  safety: {
    checklist: Array<{
      id: string;
      label: string;
      status: 'complete' | 'attention' | 'blocked';
      detail: string;
      action: string;
    }>;
    recoveryActions: string[];
    keyMaterial: Array<{
      id: string;
      label: string;
      status: 'ready' | 'attention';
      detail: string;
    }>;
  };
  routes: Array<{
    id: string;
    label: string;
    href: string;
    readiness: 'ready' | 'attention' | 'blocked';
    detail: string;
  }>;
  dangerZone: {
    deleteConfirmationLabel: string;
    deleteWarning: string[];
  };
}

function formatTimestamp(value?: string) {
  if (!value) {
    return 'Unknown time';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown time';
  }
  return date.toLocaleString();
}

function getVariant(state: string) {
  if (state === 'complete' || state === 'ready') {
    return 'success' as const;
  }
  if (state === 'blocked' || state === 'degraded') {
    return 'error' as const;
  }
  if (state === 'attention') {
    return 'warning' as const;
  }
  return 'default' as const;
}

export default function AccountPage() {
  const [workspace, setWorkspace] = useState<AccountWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState<string>('');
  const [confirmation, setConfirmation] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteStatus, setDeleteStatus] = useState('');

  const fetchWorkspace = async (showRefresh = false) => {
    if (showRefresh) {
      setRefreshing(true);
    }
    try {
      const response = await fetch(`${API_URL}/auth/account/workspace`, {
        credentials: 'include',
      });
      if (!response.ok) {
        setWorkspace(null);
        return;
      }
      const data = await response.json();
      setWorkspace(data);
      setLastLoadedAt(new Date().toISOString());
    } catch (error) {
      console.error('[AccountPage] Failed to load account workspace', error);
      setWorkspace(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchWorkspace();
  }, []);

  const deleteReady = useMemo(() => {
    return confirmation.trim() === workspace?.dangerZone.deleteConfirmationLabel;
  }, [confirmation, workspace?.dangerZone.deleteConfirmationLabel]);

  const handleDelete = async () => {
    if (!workspace || !deleteReady) {
      return;
    }

    setDeleteLoading(true);
    setDeleteStatus('');
    try {
      const response = await fetch(`${API_URL}/auth/delete-me`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          confirmation,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.success) {
        window.location.href = data.redirectTo || '/';
        return;
      }
      setDeleteStatus(data.error || 'Account deletion failed.');
    } catch (error) {
      setDeleteStatus((error as Error).message || 'Account deletion failed.');
    } finally {
      setDeleteLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="p-8 text-white">
        <p>
          Account workspace is unavailable right now.{' '}
          <Link href="/dashboard" className="text-indigo-400">
            Go back to dashboard
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8 text-white">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Account Center</p>
          <h1 className="mt-2 bg-gradient-to-r from-white to-slate-400 bg-clip-text text-3xl font-bold text-transparent">
            Identity, readiness, and control surfaces in one place
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            Review linked identity, wallet posture, private-flow readiness, operational health, and
            the guarded actions that matter when this project is used as a real testnet product
            instead of a static demo.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Badge
            variant={
              workspace.session.readiness.tone === 'ready'
                ? 'success'
                : workspace.session.readiness.tone === 'attention'
                  ? 'warning'
                  : 'default'
            }
          >
            Readiness {workspace.session.readiness.score}
          </Badge>
          <Badge variant={workspace.operations.status === 'ready' ? 'success' : 'warning'}>
            {workspace.operations.status === 'ready' ? 'Ops healthy' : 'Ops watching'}
          </Badge>
          <Button variant="ghost" onClick={() => fetchWorkspace(true)}>
            <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-4">
        <Card variant="glass">
          <p className="text-xs uppercase tracking-wide text-slate-500">Identity</p>
          <p className="mt-2 text-2xl font-semibold text-white">@{workspace.profile.username}</p>
          <p className="mt-2 text-sm leading-6 text-slate-400">{workspace.profile.email}</p>
        </Card>
        <Card variant="glass">
          <p className="text-xs uppercase tracking-wide text-slate-500">Member since</p>
          <p className="mt-2 text-2xl font-semibold text-white">
            {workspace.session.memberSince
              ? new Date(workspace.session.memberSince).toLocaleDateString()
              : 'Unknown'}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-400">{workspace.session.network.label}</p>
        </Card>
        <Card variant="glass">
          <p className="text-xs uppercase tracking-wide text-slate-500">Private flows</p>
          <p className="mt-2 text-2xl font-semibold text-white">
            {workspace.activity.privateFlows}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Tracked private actions across notes, withdrawals, deposits, and private sends.
          </p>
        </Card>
        <Card variant="glass">
          <p className="text-xs uppercase tracking-wide text-slate-500">Momentum</p>
          <p className="mt-2 text-2xl font-semibold capitalize text-white">
            {workspace.activity.velocity.momentum}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            {workspace.activity.velocity.last24h.total} actions in the last 24 hours.
          </p>
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <Card variant="neon">
          <div className="mb-4 flex items-center gap-2">
            <UserCircle2 className="h-5 w-5 text-indigo-300" />
            <h2 className="text-xl font-semibold text-white">Profile and session</h2>
          </div>
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Session headline</p>
              <p className="mt-3 text-lg font-semibold text-white">
                {workspace.session.readiness.headline}
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                {workspace.session.readiness.detail}
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Connected identity</p>
                <p className="mt-2 text-sm font-medium text-white">{workspace.profile.email}</p>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Google-linked identity is the anchor for decrypting wallet and private-note keys.
                </p>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Stellar key</p>
                <p className="mt-2 text-sm font-medium text-white">
                  {workspace.profile.stellarKeyPreview}
                </p>
                <p className="mt-2 break-all font-mono text-xs text-slate-400">
                  {workspace.profile.stellarPublicKey}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <a
                href={`${API_URL}/auth/logout`}
                className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-700 bg-slate-950/70 px-4 text-sm font-medium text-slate-100 transition hover:border-red-500/30 hover:bg-red-500/10"
              >
                <LogOut className="mr-2 h-4 w-4" />
                Logout
              </a>
              <a
                href={`https://stellar.expert/explorer/testnet/account/${workspace.profile.stellarPublicKey}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-700 bg-slate-950/70 px-4 text-sm font-medium text-slate-100 transition hover:border-indigo-500/30 hover:bg-indigo-500/10"
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                View on Stellar Expert
              </a>
            </div>
          </div>
        </Card>

        <Card variant="glass">
          <div className="mb-4 flex items-center gap-2">
            <Wallet className="h-5 w-5 text-emerald-300" />
            <h2 className="text-xl font-semibold text-white">Wallet posture</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Public wallet</p>
              <p className="mt-3 text-2xl font-semibold text-white">
                {workspace.wallet.public.xlm} XLM
              </p>
              <p className="mt-1 text-sm text-slate-300">{workspace.wallet.public.usdc} USDC</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge variant={workspace.wallet.public.hasXlm ? 'success' : 'warning'}>
                  {workspace.wallet.public.hasXlm ? 'Fee ready' : 'Needs XLM'}
                </Badge>
                <Badge variant={workspace.wallet.public.hasUsdcTrustline ? 'success' : 'warning'}>
                  {workspace.wallet.public.hasUsdcTrustline ? 'USDC ready' : 'Trustline missing'}
                </Badge>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Private wallet</p>
              <p className="mt-3 text-2xl font-semibold text-white">
                {workspace.wallet.private.xlm} XLM
              </p>
              <p className="mt-1 text-sm text-slate-300">{workspace.wallet.private.usdc} USDC</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge
                  variant={workspace.wallet.private.hasShieldedBalance ? 'success' : 'warning'}
                >
                  {workspace.wallet.private.hasShieldedBalance
                    ? 'Shielded seeded'
                    : 'Shielded empty'}
                </Badge>
                <Badge variant={workspace.wallet.pendingWithdrawals > 0 ? 'warning' : 'success'}>
                  {workspace.wallet.pendingWithdrawals > 0
                    ? `${workspace.wallet.pendingWithdrawals} queued`
                    : 'No queue backlog'}
                </Badge>
              </div>
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Public signals</p>
              <div className="mt-3 space-y-3">
                {workspace.wallet.composition.publicValueSignals.map((item) => (
                  <div key={item} className="flex items-start gap-3">
                    <Globe className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
                    <p className="text-sm leading-6 text-slate-300">{item}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Private signals</p>
              <div className="mt-3 space-y-3">
                {workspace.wallet.composition.privateValueSignals.map((item) => (
                  <div key={item} className="flex items-start gap-3">
                    <Shield className="mt-0.5 h-4 w-4 shrink-0 text-indigo-300" />
                    <p className="text-sm leading-6 text-slate-300">{item}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.02fr_0.98fr]">
        <Card variant="glass">
          <div className="mb-4 flex items-center gap-2">
            <Activity className="h-5 w-5 text-amber-300" />
            <h2 className="text-xl font-semibold text-white">Operational and activity signal</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Tracked pools</p>
              <p className="mt-2 text-2xl font-semibold text-white">
                {workspace.operations.trackedPools}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Lagging pools</p>
              <p className="mt-2 text-2xl font-semibold text-white">
                {workspace.operations.laggingPools}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Sponsored actions</p>
              <p className="mt-2 text-2xl font-semibold text-white">
                {workspace.activity.sponsored}
              </p>
            </div>
          </div>
          <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
            <p className="text-sm leading-6 text-slate-300">{workspace.operations.summary}</p>
            {workspace.operations.laggingPoolLabels.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {workspace.operations.laggingPoolLabels.map((pool) => (
                  <Badge key={pool} variant="warning">
                    {pool}
                  </Badge>
                ))}
              </div>
            )}
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">24h velocity</p>
              <p className="mt-2 text-sm font-medium text-white">
                {workspace.activity.velocity.last24h.successful} successful /{' '}
                {workspace.activity.velocity.last24h.total} total
              </p>
              <p className="mt-1 text-sm text-slate-400">
                {workspace.activity.velocity.last24h.pending} still pending.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">7d average</p>
              <p className="mt-2 text-sm font-medium text-white">
                {workspace.activity.velocity.last7d.dailyAverage} actions/day
              </p>
              <p className="mt-1 text-sm text-slate-400">
                {workspace.activity.velocity.last7d.successful} successful actions this week.
              </p>
            </div>
          </div>
          <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Latest activity themes</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {workspace.activity.latestTitles.length ? (
                workspace.activity.latestTitles.map((title) => (
                  <Badge key={title} variant="default">
                    {title}
                  </Badge>
                ))
              ) : (
                <span className="text-sm text-slate-500">No tracked activity yet.</span>
              )}
            </div>
          </div>
        </Card>

        <Card variant="glass">
          <div className="mb-4 flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-indigo-300" />
            <h2 className="text-xl font-semibold text-white">Safety and key posture</h2>
          </div>
          <div className="space-y-3">
            {workspace.safety.keyMaterial.map((item) => (
              <div
                key={item.id}
                className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-white">{item.label}</p>
                  <Badge variant={item.status === 'ready' ? 'success' : 'warning'}>
                    {item.status}
                  </Badge>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-400">{item.detail}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Recovery actions</p>
            <div className="mt-3 space-y-3">
              {workspace.safety.recoveryActions.map((item) => (
                <div key={item} className="flex items-start gap-3">
                  <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-indigo-300" />
                  <p className="text-sm leading-6 text-slate-300">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-[0.96fr_1.04fr]">
        <Card variant="glass">
          <div className="mb-4 flex items-center gap-2">
            <BadgeCheck className="h-5 w-5 text-emerald-300" />
            <h2 className="text-xl font-semibold text-white">Readiness checklist</h2>
          </div>
          <div className="space-y-3">
            {workspace.safety.checklist.map((item) => (
              <div
                key={item.id}
                className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-white">{item.label}</p>
                      <Badge variant={getVariant(item.status)}>{item.status}</Badge>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-400">{item.detail}</p>
                    <p className="mt-2 text-xs uppercase tracking-wide text-indigo-300">
                      {item.action}
                    </p>
                  </div>
                  {item.status === 'complete' ? (
                    <BadgeCheck className="h-5 w-5 shrink-0 text-emerald-300" />
                  ) : item.status === 'blocked' ? (
                    <ShieldAlert className="h-5 w-5 shrink-0 text-rose-300" />
                  ) : (
                    <Clock3 className="h-5 w-5 shrink-0 text-amber-300" />
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card variant="glass">
          <div className="mb-4 flex items-center gap-2">
            <Wallet className="h-5 w-5 text-indigo-300" />
            <h2 className="text-xl font-semibold text-white">Workspace shortcuts</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {workspace.routes.map((route) => (
              <Link
                key={route.id}
                href={route.href}
                className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 transition hover:border-indigo-500/30 hover:bg-slate-900"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-white">{route.label}</p>
                  <Badge variant={getVariant(route.readiness)}>{route.readiness}</Badge>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-400">{route.detail}</p>
              </Link>
            ))}
          </div>
        </Card>
      </section>

      <section>
        <Card variant="glass" className="border-red-500/15">
          <div className="mb-4 flex items-center gap-2">
            <Trash2 className="h-5 w-5 text-rose-300" />
            <h2 className="text-xl font-semibold text-white">Danger zone</h2>
          </div>
          <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
            <div className="space-y-3">
              {workspace.dangerZone.deleteWarning.map((item) => (
                <div
                  key={item}
                  className="flex items-start gap-3 rounded-2xl border border-red-500/10 bg-red-500/5 p-4"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
                  <p className="text-sm leading-6 text-slate-300">{item}</p>
                </div>
              ))}
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Confirmation</p>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Type{' '}
                <span className="font-semibold text-white">
                  {workspace.dangerZone.deleteConfirmationLabel}
                </span>{' '}
                exactly before deletion will unlock.
              </p>
              <div className="mt-4 space-y-4">
                <Input
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  placeholder={`Type ${workspace.dangerZone.deleteConfirmationLabel}`}
                  className="bg-slate-900/50"
                />
                {deleteStatus && (
                  <div className="rounded-2xl border border-red-500/15 bg-red-500/10 p-3 text-sm text-rose-100">
                    {deleteStatus}
                  </div>
                )}
                <Button
                  variant="destructive"
                  onClick={handleDelete}
                  isLoading={deleteLoading}
                  disabled={!deleteReady}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete account
                </Button>
              </div>
            </div>
          </div>
        </Card>
      </section>

      <div className="flex flex-wrap items-center gap-4">
        <Link href="/dashboard">
          <Button variant="ghost" size="sm" className="pl-0 text-slate-500 hover:text-slate-300">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Dashboard
          </Button>
        </Link>
        <div className="text-sm text-slate-500">
          Last account refresh: {formatTimestamp(lastLoadedAt)}
        </div>
      </div>
    </div>
  );
}
