'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePrivacy } from '@/context/PrivacyContext';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Globe,
  Info,
  RefreshCw,
  Send,
  Shield,
  Sparkles,
  UserRoundSearch,
  Wallet,
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api';

interface SendWorkspace {
  user: {
    username?: string;
    stellarPublicKey?: string;
    reputation?: number;
  };
  balances: {
    public: { usdc: string; xlm: string };
    private: { usdc: string; xlm: string };
  };
  privateNotes: Record<
    string,
    {
      count: number;
      largest: number;
      exactFriendly: number[];
    }
  >;
  sponsorship: Record<
    string,
    {
      supported: boolean;
      sponsored: boolean;
      reason: string;
    }
  >;
  recentCounterparties: Array<{
    label: string;
    interactions: number;
    privateFlows: number;
    latestAt?: string;
  }>;
  guidance: string[];
}

interface SendPreview {
  recipient: {
    identifier: string;
    resolved: boolean;
    type: 'user' | 'public_key' | 'unknown';
    username?: string;
    stellarPublicKey?: string;
    reputation?: number | null;
    displayLabel: string;
  };
  amount: number;
  asset: 'USDC' | 'XLM';
  recentRelationship: null | {
    title: string;
    privateFlow: boolean;
    date: string;
  };
  recommendedMode: 'public' | 'private';
  routes: {
    public: {
      mode: 'public';
      available: boolean;
      ready: boolean;
      balance: number;
      missingAmount: number;
      summary: string;
      sponsorship: {
        supported: boolean;
        sponsored: boolean;
        reason: string;
      };
      nextAction: string;
    };
    private: {
      mode: 'private';
      available: boolean;
      ready: boolean;
      exactNoteAvailable: boolean;
      canSplit: boolean;
      totalPrivateBalance: number;
      noteCount: number;
      summary: string;
      sponsorship: {
        supported: boolean;
        sponsored: boolean;
        reason: string;
      };
      nextAction: string;
    };
  };
  guidance: string[];
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

function getToneVariant(value: boolean | undefined) {
  return value ? ('success' as const) : ('warning' as const);
}

function RouteCard({
  title,
  active,
  recommended,
  summary,
  ready,
  nextAction,
  sponsorship,
  extra,
}: {
  title: string;
  active: boolean;
  recommended: boolean;
  summary: string;
  ready: boolean;
  nextAction: string;
  sponsorship: { supported: boolean; sponsored: boolean; reason: string };
  extra: React.ReactNode;
}) {
  return (
    <Card
      variant={active ? 'neon' : 'glass'}
      className={
        active ? 'border-indigo-500/25 bg-gradient-to-br from-indigo-900/30 to-slate-900/70' : ''
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-lg font-semibold text-white">{title}</p>
            {recommended && <Badge variant="success">Recommended</Badge>}
            <Badge variant={ready ? 'success' : 'warning'}>{ready ? 'Ready' : 'Needs prep'}</Badge>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-400">{summary}</p>
        </div>
      </div>

      <div className="mt-4">{extra}</div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Next action</p>
          <p className="mt-2 text-sm font-medium text-white">{nextAction}</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Sponsorship</p>
          <p className="mt-2 text-sm font-medium text-white">
            {sponsorship.supported && sponsorship.sponsored ? 'Available' : 'Unavailable'}
          </p>
          <p className="mt-1 text-sm leading-6 text-slate-400">{sponsorship.reason}</p>
        </div>
      </div>
    </Card>
  );
}

export default function SendPage() {
  const { isPrivate, togglePrivacy } = usePrivacy();
  const [workspace, setWorkspace] = useState<SendWorkspace | null>(null);
  const [preview, setPreview] = useState<SendPreview | null>(null);
  const [recipient, setRecipient] = useState('');
  const [asset, setAsset] = useState<'USDC' | 'XLM'>('XLM');
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [processStep, setProcessStep] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);

  const numericAmount = useMemo(() => {
    const parsed = Number.parseFloat(amount);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [amount]);

  const fetchWorkspace = async () => {
    try {
      const res = await fetch(`${API_URL}/users/send/workspace`, {
        credentials: 'include',
      });
      const data = await res.json().catch(() => null);
      setWorkspace(data);
    } catch (error) {
      console.error('[SendPage] Failed to load send workspace', error);
      setWorkspace(null);
    }
  };

  useEffect(() => {
    fetchWorkspace();
  }, []);

  useEffect(() => {
    if (!recipient || !numericAmount) {
      setPreview(null);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const res = await fetch(`${API_URL}/users/send/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            recipient,
            asset,
            amount: numericAmount,
          }),
          signal: controller.signal,
        });
        const data = await res.json().catch(() => null);
        if (!controller.signal.aborted) {
          setPreview(data);
        }
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          console.error('[SendPage] Failed to load send preview', error);
        }
      } finally {
        if (!controller.signal.aborted) {
          setPreviewLoading(false);
        }
      }
    }, 300);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [recipient, asset, numericAmount]);

  const handleSplit = async (requestAsset: 'USDC' | 'XLM', requestAmount: number) => {
    setProcessStep('Splitting note to match exact amount...');
    const res = await fetch(`${API_URL}/users/split`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ asset: requestAsset, amount: requestAmount }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Split failed');
    }
    setProcessStep('Waiting for split confirmation...');
    await new Promise((resolve) => setTimeout(resolve, 6000));
  };

  const handleDeposit = async (requestAsset: 'USDC' | 'XLM', requestAmount: number) => {
    setProcessStep(`Depositing ${requestAmount} ${requestAsset} from public balance...`);
    const res = await fetch(`${API_URL}/users/deposit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ asset: requestAsset, amount: requestAmount }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
      throw new Error(data.error || 'Deposit failed');
    }
    setProcessStep('Waiting for deposit confirmation...');
    await new Promise((resolve) => setTimeout(resolve, 6000));
  };

  const handleSend = async () => {
    if (!recipient || !amount || !numericAmount) {
      setStatus('Please fill in all fields');
      return;
    }

    setLoading(true);
    setStatus('');
    setProcessStep(isPrivate ? 'Generating proof and submitting...' : 'Sending payment...');

    const runDepositFlow = async (requestAsset: 'USDC' | 'XLM', requestAmount: number) => {
      if (
        window.confirm(
          `Insufficient private balance. Do you want to transfer ${requestAmount} ${requestAsset} from your public pool to continue?`,
        )
      ) {
        await handleDeposit(requestAsset, requestAmount);
        return;
      }
      throw new Error('Cancelled by user.');
    };

    try {
      const attemptSend = async () => {
        const url = isPrivate ? `${API_URL}/users/send/private` : `${API_URL}/users/send`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ recipient, asset, amount }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.success === false) {
          throw new Error(data.error || data.message || 'Send failed');
        }
        return data;
      };

      try {
        const data = await attemptSend();
        setStatus(
          `${data.message ?? 'Payment submitted.'}${data.txHash ? ` TX: ${data.txHash}` : ''}${data.sponsorship?.detail ? ` ${data.sponsorship.detail}` : ''}`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to send';

        if (isPrivate) {
          if (
            message.includes('No private note with EXACT amount') ||
            message.includes('No spendable private note') ||
            message.includes('Splitting not yet supported')
          ) {
            await handleSplit(asset, numericAmount);
            setProcessStep('Retrying payment after split...');
            const data = await attemptSend();
            setStatus(data.message ?? 'Private payment submitted.');
          } else if (message.includes('Insufficient private balance')) {
            await runDepositFlow(asset, numericAmount);
            setProcessStep('Retrying payment after deposit...');
            const data = await attemptSend();
            setStatus(data.message ?? 'Private payment submitted.');
          } else {
            throw error;
          }
        } else {
          throw error;
        }
      }

      setAmount('');
      setRecipient('');
      setPreview(null);
      await fetchWorkspace();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message !== 'Cancelled by user.') {
        setStatus(message);
      }
    } finally {
      setLoading(false);
      setProcessStep('');
    }
  };

  const recommendedMode = preview?.recommendedMode ?? (isPrivate ? 'private' : 'public');
  const visibleRoute = preview?.routes?.[isPrivate ? 'private' : 'public'];

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Send Workspace</p>
          <h1 className="mt-2 bg-gradient-to-r from-white to-slate-400 bg-clip-text text-3xl font-bold text-transparent">
            Preflight a payment before you submit it
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            This workspace resolves the recipient, compares public and private routes, and tells you
            whether the next step is send, split, deposit, or retry.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={isPrivate ? 'success' : 'warning'}>
            {isPrivate ? (
              <span className="flex items-center gap-1">
                <Shield size={12} />
                Private mode
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <Globe size={12} />
                Public mode
              </span>
            )}
          </Badge>
          {previewLoading && (
            <Badge variant="default">
              <RefreshCw className="mr-1 h-3.5 w-3.5 animate-spin" />
              Previewing
            </Badge>
          )}
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-4">
        <Card variant="glass">
          <p className="text-xs uppercase tracking-wide text-slate-500">Public XLM</p>
          <p className="mt-2 text-3xl font-semibold text-white">
            {workspace?.balances.public.xlm ?? '0'}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Visible network balance for public sends and fees.
          </p>
        </Card>
        <Card variant="glass">
          <p className="text-xs uppercase tracking-wide text-slate-500">Public USDC</p>
          <p className="mt-2 text-3xl font-semibold text-white">
            {workspace?.balances.public.usdc ?? '0'}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Stablecoin liquidity available in the public wallet.
          </p>
        </Card>
        <Card variant="glass">
          <p className="text-xs uppercase tracking-wide text-slate-500">Private notes</p>
          <p className="mt-2 text-3xl font-semibold text-white">
            {workspace?.privateNotes?.[asset]?.count ?? 0}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Largest {asset} note: {workspace?.privateNotes?.[asset]?.largest ?? 0}
          </p>
        </Card>
        <Card variant="glass">
          <p className="text-xs uppercase tracking-wide text-slate-500">Recommended route</p>
          <p className="mt-2 text-3xl font-semibold text-white capitalize">{recommendedMode}</p>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Based on visible balance, note readiness, and the current send preflight.
          </p>
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-[0.98fr_1.02fr]">
        <Card variant="neon">
          <div className="space-y-6">
            <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-4">
              <div className="flex items-start gap-3">
                <Info className="mt-0.5 shrink-0 text-slate-400" size={18} />
                <p className="text-sm text-slate-300">
                  You are sending in{' '}
                  <span
                    className={isPrivate ? 'font-bold text-indigo-400' : 'font-bold text-blue-400'}
                  >
                    {isPrivate ? 'Private Mode' : 'Public Mode'}
                  </span>
                  .{' '}
                  {isPrivate
                    ? 'This route depends on exact-value note readiness and may trigger split or deposit preparation.'
                    : 'This route depends on visible wallet balance and can use fee sponsorship when policy allows.'}
                </p>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-400">Recipient</label>
              <Input
                type="text"
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
                placeholder="Username or Stellar Address (G...)"
                disabled={loading}
                className="bg-slate-900/50"
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-1">
                <label className="mb-2 block text-sm font-medium text-slate-400">Asset</label>
                <select
                  value={asset}
                  onChange={(event) => setAsset(event.target.value as 'USDC' | 'XLM')}
                  className="h-12 w-full rounded-xl border border-slate-700 bg-slate-900/50 px-3 text-sm text-slate-200 transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  disabled={loading}
                >
                  <option value="XLM">XLM</option>
                  <option value="USDC">USDC</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="mb-2 block text-sm font-medium text-slate-400">Amount</label>
                <Input
                  type="number"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="0.00"
                  disabled={loading}
                  className="bg-slate-900/50 font-mono"
                />
              </div>
            </div>

            <Button
              onClick={handleSend}
              isLoading={loading}
              className="w-full"
              variant={isPrivate ? 'primary' : 'secondary'}
              disabled={!recipient || !amount}
            >
              <Send className="mr-2 h-4 w-4" />
              {isPrivate ? 'Send Privately' : 'Send Publicly'}
            </Button>

            {processStep && (
              <div className="flex items-center gap-2 rounded-2xl border border-indigo-500/20 bg-indigo-500/10 p-3 text-sm text-indigo-100">
                <RefreshCw className="h-4 w-4 animate-spin" />
                <span>{processStep}</span>
              </div>
            )}

            {status && (
              <Card
                variant={
                  status.toLowerCase().includes('failed') || status.toLowerCase().includes('error')
                    ? 'neon'
                    : 'default'
                }
                className="border-l-4 border-l-indigo-500 p-4"
              >
                <p className="break-all text-sm text-slate-300">{status}</p>
              </Card>
            )}
          </div>
        </Card>

        <div className="space-y-6">
          <Card variant="glass">
            <div className="mb-4 flex items-center gap-2">
              <UserRoundSearch className="h-5 w-5 text-indigo-300" />
              <h2 className="text-xl font-semibold text-white">Recipient preview</h2>
            </div>
            {preview ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={preview.recipient.resolved ? 'success' : 'warning'}>
                    {preview.recipient.resolved ? 'Resolved' : 'Unconfirmed'}
                  </Badge>
                  <Badge variant="default">{preview.recipient.type.replace('_', ' ')}</Badge>
                  {preview.recentRelationship && (
                    <Badge variant={preview.recentRelationship.privateFlow ? 'success' : 'warning'}>
                      Previous activity
                    </Badge>
                  )}
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <p className="text-lg font-semibold text-white">
                    {preview.recipient.displayLabel}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    {preview.recipient.stellarPublicKey ?? preview.recipient.identifier}
                  </p>
                  {preview.recipient.reputation !== null &&
                    preview.recipient.reputation !== undefined && (
                      <p className="mt-2 text-sm text-slate-300">
                        Reputation: {preview.recipient.reputation}
                      </p>
                    )}
                  {preview.recentRelationship && (
                    <p className="mt-3 text-xs text-slate-500">
                      Last seen: {preview.recentRelationship.title} on{' '}
                      {formatTimestamp(preview.recentRelationship.date)}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  {preview.guidance.map((item) => (
                    <div
                      key={item}
                      className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3 text-sm text-slate-300"
                    >
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-500">
                Add a recipient and amount to resolve the destination and compare send routes.
              </div>
            )}
          </Card>

          {preview && (
            <>
              <RouteCard
                title="Public route"
                active={!isPrivate}
                recommended={preview.recommendedMode === 'public'}
                summary={preview.routes.public.summary}
                ready={preview.routes.public.ready}
                nextAction={preview.routes.public.nextAction}
                sponsorship={preview.routes.public.sponsorship}
                extra={
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
                      <p className="text-xs uppercase tracking-wide text-slate-500">
                        Visible balance
                      </p>
                      <p className="mt-2 text-sm font-medium text-white">
                        {preview.routes.public.balance} {asset}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
                      <p className="text-xs uppercase tracking-wide text-slate-500">
                        Missing amount
                      </p>
                      <p className="mt-2 text-sm font-medium text-white">
                        {preview.routes.public.missingAmount} {asset}
                      </p>
                    </div>
                  </div>
                }
              />

              <RouteCard
                title="Private route"
                active={isPrivate}
                recommended={preview.recommendedMode === 'private'}
                summary={preview.routes.private.summary}
                ready={preview.routes.private.ready}
                nextAction={preview.routes.private.nextAction}
                sponsorship={preview.routes.private.sponsorship}
                extra={
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Exact note</p>
                      <p className="mt-2 text-sm font-medium text-white">
                        {preview.routes.private.exactNoteAvailable ? 'Available' : 'Missing'}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Can split</p>
                      <p className="mt-2 text-sm font-medium text-white">
                        {preview.routes.private.canSplit ? 'Yes' : 'No'}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
                      <p className="text-xs uppercase tracking-wide text-slate-500">
                        Private total
                      </p>
                      <p className="mt-2 text-sm font-medium text-white">
                        {preview.routes.private.totalPrivateBalance} {asset}
                      </p>
                    </div>
                  </div>
                }
              />
            </>
          )}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <Card variant="glass">
          <div className="mb-4 flex items-center gap-2">
            <Wallet className="h-5 w-5 text-indigo-300" />
            <h2 className="text-xl font-semibold text-white">Route guidance</h2>
          </div>
          <div className="space-y-3">
            {(workspace?.guidance ?? []).map((item) => (
              <div
                key={item}
                className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-300"
              >
                {item}
              </div>
            ))}
            {visibleRoute && (
              <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/10 p-4 text-sm text-indigo-100">
                Current mode summary: {visibleRoute.summary}
              </div>
            )}
          </div>
        </Card>

        <Card variant="glass">
          <div className="mb-4 flex items-center gap-2">
            <Clock3 className="h-5 w-5 text-yellow-400" />
            <h2 className="text-xl font-semibold text-white">Recent counterparties</h2>
          </div>
          {(workspace?.recentCounterparties?.length ?? 0) > 0 ? (
            <div className="grid gap-3 md:grid-cols-2">
              {workspace!.recentCounterparties.map((counterparty) => (
                <button
                  key={counterparty.label}
                  type="button"
                  onClick={() => setRecipient(counterparty.label)}
                  className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-left transition-colors hover:border-indigo-500/30 hover:bg-slate-900"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-white">@{counterparty.label}</p>
                    <Badge variant={getToneVariant(counterparty.privateFlows > 0)}>
                      {counterparty.privateFlows > 0 ? 'Private touch' : 'Public touch'}
                    </Badge>
                  </div>
                  <p className="mt-2 text-sm text-slate-300">
                    {counterparty.interactions} interactions
                  </p>
                  <p className="mt-2 text-xs text-slate-500">
                    Latest activity: {formatTimestamp(counterparty.latestAt)}
                  </p>
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-500">
              Recent counterparties will appear here after wallet or swap activity starts building
              up.
            </div>
          )}
        </Card>
      </section>

      <div className="flex gap-4">
        <Link href="/wallet">
          <Button variant="ghost" size="sm" className="pl-0 text-slate-500 hover:text-slate-300">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Wallet
          </Button>
        </Link>
        <button
          type="button"
          onClick={() => togglePrivacy()}
          className="inline-flex items-center rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-sm text-slate-200 transition-colors hover:bg-slate-800"
        >
          {isPrivate ? (
            <>
              <Globe className="mr-2 h-4 w-4" />
              Switch to Public
            </>
          ) : (
            <>
              <Shield className="mr-2 h-4 w-4" />
              Switch to Private
            </>
          )}
        </button>
      </div>
    </div>
  );
}
