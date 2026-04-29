'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Globe,
  RefreshCw,
  Shield,
  Sparkles,
  Users,
  Wallet,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api';

interface ContactsWorkspace {
  user: {
    username?: string;
    stellarPublicKey?: string;
    reputation?: number;
  };
  summary: {
    contacts: number;
    privatePreferred: number;
    publicPreferred: number;
    blocked: number;
    attention: number;
  };
  routeBreakdown: {
    publicPreferred: number;
    privatePreferred: number;
    blocked: number;
    attention: number;
  };
  highlights: string[];
  actionBoard: Array<{
    id: string;
    severity: 'critical' | 'warning' | 'info';
    title: string;
    detail: string;
    href: string;
  }>;
  contacts: Array<{
    counterparty: string;
    username: string;
    reputation: number | null;
    stellarPublicKey?: string;
    interactions: number;
    privateFlows: number;
    swapFlows: number;
    pendingTouches: number;
    failedTouches: number;
    sponsoredTouches: number;
    trustScore: number;
    preferredAsset: 'USDC' | 'XLM';
    recommendedRoute: 'public' | 'private';
    routeReadiness: 'ready' | 'attention' | 'blocked';
    categories: string[];
    latestAt?: string;
    latestTitle?: string;
    notes: string[];
    routeSummary: {
      public: string;
      private: string;
    };
  }>;
  recentCounterparties: Array<{
    label: string;
    interactions: number;
    privateFlows: number;
    latestAt?: string;
  }>;
  updatedAt: string;
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

function variantFor(value: string) {
  if (value === 'critical' || value === 'blocked') {
    return 'error' as const;
  }
  if (value === 'warning' || value === 'attention') {
    return 'warning' as const;
  }
  if (value === 'ready' || value === 'success') {
    return 'success' as const;
  }
  return 'default' as const;
}

export default function ContactsPage() {
  const [workspace, setWorkspace] = useState<ContactsWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchWorkspace = async (showRefresh = false) => {
    if (showRefresh) {
      setRefreshing(true);
    }
    try {
      const response = await fetch(`${API_URL}/users/contacts/workspace`, {
        credentials: 'include',
      });
      const data = await response.json().catch(() => null);
      setWorkspace(response.ok ? data : null);
    } catch (error) {
      console.error('[ContactsPage] Failed to load contacts workspace', error);
      setWorkspace(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchWorkspace();
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  if (!workspace) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <Card variant="glass" className="text-center">
          <AlertTriangle className="mx-auto mb-4 h-12 w-12 text-red-400" />
          <h1 className="text-2xl font-semibold text-white">Contacts workspace unavailable</h1>
          <p className="mt-3 text-slate-400">
            The counterparty intelligence workspace could not be loaded.
          </p>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl space-y-8 p-4 md:p-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Contacts Workspace</p>
          <h1 className="mt-2 bg-gradient-to-r from-white to-slate-400 bg-clip-text text-3xl font-bold text-transparent">
            Reuse trusted counterparties instead of starting every send cold
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            This workspace turns repeated wallet and swap relationships into route recommendations,
            trust signals, failure awareness, and faster follow-up actions.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={workspace.summary.blocked > 0 ? 'warning' : 'success'}>
            {workspace.summary.contacts} tracked contacts
          </Badge>
          <Button variant="ghost" onClick={() => fetchWorkspace(true)}>
            <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-4">
        <Card variant="glass">
          <p className="text-xs uppercase tracking-wide text-slate-500">Private preferred</p>
          <p className="mt-2 text-3xl font-semibold text-white">
            {workspace.summary.privatePreferred}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Contacts that currently look better for shielded routes.
          </p>
        </Card>
        <Card variant="glass">
          <p className="text-xs uppercase tracking-wide text-slate-500">Public preferred</p>
          <p className="mt-2 text-3xl font-semibold text-white">
            {workspace.summary.publicPreferred}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Contacts whose current route shape still favors visible sends.
          </p>
        </Card>
        <Card variant="glass">
          <p className="text-xs uppercase tracking-wide text-slate-500">Blocked routes</p>
          <p className="mt-2 text-3xl font-semibold text-white">{workspace.summary.blocked}</p>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Counterparty paths still blocked by funding or note readiness gaps.
          </p>
        </Card>
        <Card variant="glass">
          <p className="text-xs uppercase tracking-wide text-slate-500">Needs attention</p>
          <p className="mt-2 text-3xl font-semibold text-white">{workspace.summary.attention}</p>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Relationships that are viable but still need a cleaner route posture.
          </p>
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-[0.96fr_1.04fr]">
        <Card variant="neon">
          <div className="mb-4 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-indigo-300" />
            <h2 className="text-xl font-semibold text-white">Relationship highlights</h2>
          </div>
          <div className="space-y-3">
            {workspace.highlights.map((item) => (
              <div
                key={item}
                className="flex items-start gap-3 rounded-2xl border border-slate-800 bg-slate-950/70 p-4"
              >
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                <p className="text-sm leading-6 text-slate-300">{item}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card variant="glass">
          <div className="mb-4 flex items-center gap-2">
            <Wallet className="h-5 w-5 text-cyan-300" />
            <h2 className="text-xl font-semibold text-white">Action board</h2>
          </div>
          <div className="space-y-3">
            {workspace.actionBoard.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                className="block rounded-2xl border border-slate-800 bg-slate-950/70 p-4 transition hover:border-indigo-500/30 hover:bg-slate-900"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={variantFor(item.severity)}>{item.severity}</Badge>
                  </div>
                  <ArrowRight className="h-4 w-4 text-slate-500" />
                </div>
                <h3 className="mt-3 text-sm font-semibold text-white">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-400">{item.detail}</p>
              </Link>
            ))}
          </div>
        </Card>
      </section>

      <section>
        <div className="mb-4 flex items-center gap-2">
          <Users className="h-5 w-5 text-indigo-300" />
          <h2 className="text-xl font-semibold text-white">Counterparty board</h2>
        </div>
        <div className="grid gap-5">
          {workspace.contacts.map((contact) => (
            <Card key={contact.counterparty} variant="glass">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xl font-semibold text-white">@{contact.username}</p>
                    <Badge variant={variantFor(contact.routeReadiness)}>
                      {contact.routeReadiness}
                    </Badge>
                    <Badge variant={contact.recommendedRoute === 'private' ? 'success' : 'warning'}>
                      {contact.recommendedRoute}
                    </Badge>
                    <Badge variant="default">Trust {contact.trustScore}</Badge>
                    {contact.reputation !== null && (
                      <Badge variant="default">Rep {contact.reputation}</Badge>
                    )}
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    Latest touch: {contact.latestTitle || 'Unknown'} on{' '}
                    {formatTimestamp(contact.latestAt)}
                  </p>
                  {contact.stellarPublicKey && (
                    <p className="mt-2 break-all font-mono text-xs text-slate-500">
                      {contact.stellarPublicKey}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Link href={`/wallet/send`}>
                    <Button variant="ghost">
                      <Wallet className="mr-2 h-4 w-4" />
                      Send
                    </Button>
                  </Link>
                  {contact.stellarPublicKey && (
                    <a
                      href={`https://stellar.expert/explorer/testnet/account/${contact.stellarPublicKey}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-700 bg-slate-950/70 px-4 text-sm font-medium text-slate-100 transition hover:border-indigo-500/30 hover:bg-indigo-500/10"
                    >
                      <ExternalLink className="mr-2 h-4 w-4" />
                      Explorer
                    </a>
                  )}
                </div>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-4">
                <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Interactions</p>
                  <p className="mt-2 text-lg font-semibold text-white">{contact.interactions}</p>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Private flows</p>
                  <p className="mt-2 text-lg font-semibold text-white">{contact.privateFlows}</p>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Swap flows</p>
                  <p className="mt-2 text-lg font-semibold text-white">{contact.swapFlows}</p>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Failure touches</p>
                  <p className="mt-2 text-lg font-semibold text-white">{contact.failedTouches}</p>
                </div>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <div className="flex items-center gap-2 text-white">
                    <Globe className="h-4 w-4 text-sky-300" />
                    <p className="font-semibold">Public route</p>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-400">
                    {contact.routeSummary.public}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <div className="flex items-center gap-2 text-white">
                    <Shield className="h-4 w-4 text-emerald-300" />
                    <p className="font-semibold">Private route</p>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-400">
                    {contact.routeSummary.private}
                  </p>
                </div>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-3">
                {contact.notes.map((note) => (
                  <div
                    key={note}
                    className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-sm text-slate-300"
                  >
                    {note}
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <Card variant="glass">
          <div className="mb-4 flex items-center gap-2">
            <Shield className="h-5 w-5 text-emerald-300" />
            <h2 className="text-xl font-semibold text-white">Recent send candidates</h2>
          </div>
          <div className="space-y-3">
            {workspace.recentCounterparties.map((item) => (
              <div
                key={item.label}
                className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-white">@{item.label}</p>
                  <Badge variant={item.privateFlows > 0 ? 'success' : 'default'}>
                    {item.interactions} touches
                  </Badge>
                </div>
                <p className="mt-2 text-sm text-slate-400">
                  Latest activity: {formatTimestamp(item.latestAt)}
                </p>
              </div>
            ))}
          </div>
        </Card>

        <Card variant="glass">
          <div className="mb-4 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-indigo-300" />
            <h2 className="text-xl font-semibold text-white">Route breakdown</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Public preferred</p>
              <p className="mt-2 text-2xl font-semibold text-white">
                {workspace.routeBreakdown.publicPreferred}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Private preferred</p>
              <p className="mt-2 text-2xl font-semibold text-white">
                {workspace.routeBreakdown.privatePreferred}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Blocked</p>
              <p className="mt-2 text-2xl font-semibold text-white">
                {workspace.routeBreakdown.blocked}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Attention</p>
              <p className="mt-2 text-2xl font-semibold text-white">
                {workspace.routeBreakdown.attention}
              </p>
            </div>
          </div>
        </Card>
      </section>

      <div className="flex flex-wrap items-center gap-4">
        <Link href="/dashboard">
          <Button variant="ghost">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Dashboard
          </Button>
        </Link>
        <Link href="/wallet/send">
          <Button variant="ghost">
            <Wallet className="mr-2 h-4 w-4" />
            Send planner
          </Button>
        </Link>
        <div className="text-sm text-slate-500">
          Last refresh: {formatTimestamp(workspace.updatedAt)}
        </div>
      </div>
    </main>
  );
}
