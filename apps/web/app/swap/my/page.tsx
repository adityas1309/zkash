'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePrivacy } from '@/context/PrivacyContext';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle,
  Clock3,
  Globe,
  Lock,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Shield,
  Sparkles,
  Store,
  TrendingUp,
  XCircle,
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api';

type SwapStatus =
  | 'requested'
  | 'proofs_pending'
  | 'proofs_ready'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'cancelled';

type ProofStatus =
  | 'awaiting_acceptance'
  | 'awaiting_both'
  | 'awaiting_alice'
  | 'awaiting_bob'
  | 'ready';

type ExecutionStatus = 'not_started' | 'ready' | 'processing' | 'confirmed' | 'failed';
type OfferHealthTone = 'good' | 'caution' | 'risk';
type QueuePressure = 'light' | 'moderate' | 'heavy';

interface User {
  _id: string;
  username: string;
}

interface SwapParty {
  _id: string;
  username: string;
}

interface SwapSummary {
  _id: string;
  aliceId: SwapParty;
  bobId: SwapParty;
  offerId?: string;
  amountIn: number;
  amountOut: number;
  status: SwapStatus;
  proofStatus: ProofStatus;
  executionStatus: ExecutionStatus;
  txHash?: string;
  createdAt: string;
  acceptedAt?: string;
  proofsReadyAt?: string;
  completedAt?: string;
  failedAt?: string;
  lastError?: string;
  participantRole: 'alice' | 'bob' | null;
  proofReady: boolean;
  myProofSubmitted: boolean;
  counterpartyProofSubmitted: boolean;
  lastActorRole?: 'alice' | 'bob';
}

interface SwapAuditEntry {
  id: string;
  operation: string;
  state: 'queued' | 'pending' | 'success' | 'failed' | 'retryable';
  txHash?: string;
  indexingStatus?: string;
  indexingDetail?: string;
  error?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
}

interface SwapStatusDetails {
  swap: SwapSummary;
  participantRole: 'alice' | 'bob';
  proofs: {
    status: ProofStatus;
    hasAliceProof: boolean;
    hasBobProof: boolean;
    ready: boolean;
  };
  execution: {
    status: ExecutionStatus;
    txHash?: string;
    lastError?: string;
  };
  audits: SwapAuditEntry[];
}

interface ApiTransactionResponse {
  success?: boolean;
  message?: string;
  error?: string;
  txHash?: string;
}

interface MerchantOfferWorkspaceItem {
  _id: string;
  assetIn: 'USDC' | 'XLM';
  assetOut: 'USDC' | 'XLM';
  rate: number;
  min: number;
  max: number;
  active: boolean;
  openBuyerRequests: number;
  stalledExecutions: number;
  healthTone: OfferHealthTone;
  healthSummary: string;
  queuePressure: QueuePressure;
  queueMessage: string;
  latestSwapAt: string | null;
  requestGuidance: {
    confidenceScore: number;
    backlogLevel: QueuePressure;
    recommendedMode: 'public' | 'private';
    notes: string[];
  };
  merchantMetrics: {
    completionRate: number;
    pendingAsSeller: number;
    activeAsSeller: number;
    completedAsSeller: number;
  };
  offerMetrics: {
    openRequests: number;
    activeExecutions: number;
    completedSwaps: number;
    failedSwaps: number;
  };
}

interface MerchantWorkspace {
  merchant: {
    id: string;
    username?: string;
    reputation: number;
  };
  summary: {
    offers: {
      total: number;
      active: number;
      paused: number;
    };
    queue: {
      requested: number;
      proofsPending: number;
      proofsReady: number;
      executing: number;
      completed: number;
      failed: number;
    };
    completionRate: number;
    averageTicketSize: number;
    lastCompletedAt: string | null;
  };
  queueHealth: {
    pressure: QueuePressure;
    tone: OfferHealthTone;
    message: string;
    staleFailures: number;
  };
  offerBoard: MerchantOfferWorkspaceItem[];
  actionQueue: Array<{
    swapId: string;
    action:
      | 'accept_request'
      | 'prepare_proof'
      | 'execute_public'
      | 'execute_private'
      | 'review_failure';
    label: string;
    detail: string;
    severity: 'info' | 'caution' | 'critical';
    mode: 'public' | 'private';
    offerId?: string;
    status: string;
    createdAt?: string;
  }>;
  pairCoverage: Array<{
    pair: string;
    activeOffers: number;
    openRequests: number;
    completedSwaps: number;
    recommendation: string;
  }>;
  recentOutcomes: Array<{
    swapId: string;
    offerId?: string;
    status: string;
    amountIn: number;
    amountOut: number;
    txHash?: string;
    completedAt?: string;
    failedAt?: string;
    counterparty?: string;
  }>;
}

const statusVariantMap: Record<SwapStatus, 'warning' | 'default' | 'success' | 'error'> = {
  requested: 'warning',
  proofs_pending: 'default',
  proofs_ready: 'default',
  executing: 'warning',
  completed: 'success',
  failed: 'error',
  cancelled: 'error',
};

const proofLabelMap: Record<ProofStatus, string> = {
  awaiting_acceptance: 'Waiting for seller acceptance',
  awaiting_both: 'Waiting for both proofs',
  awaiting_alice: 'Waiting for buyer proof',
  awaiting_bob: 'Waiting for seller proof',
  ready: 'Both proofs ready',
};

const executionLabelMap: Record<ExecutionStatus, string> = {
  not_started: 'Execution not started',
  ready: 'Ready to execute',
  processing: 'Executing on-chain',
  confirmed: 'Execution confirmed',
  failed: 'Execution failed',
};

function formatRelativeTimestamp(value?: string | null) {
  if (!value) {
    return 'Not available';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Not available';
  }

  return date.toLocaleString();
}

function getAssetNeedForProof(swap: SwapSummary) {
  if (swap.participantRole === 'alice') {
    return { asset: 'XLM' as const, amount: swap.amountIn };
  }
  return { asset: 'USDC' as const, amount: swap.amountOut };
}

function getCounterpartyLabel(swap: SwapSummary) {
  return swap.participantRole === 'alice' ? swap.bobId?.username : swap.aliceId?.username;
}

function getSwapDirectionLabel(swap: SwapSummary) {
  if (swap.participantRole === 'bob') {
    return `Sell ${swap.amountOut} USDC for ${swap.amountIn} XLM`;
  }
  return `Buy ${swap.amountOut} USDC with ${swap.amountIn} XLM`;
}

function getToneVariant(tone: OfferHealthTone | 'info') {
  if (tone === 'good') {
    return 'success' as const;
  }
  if (tone === 'caution') {
    return 'warning' as const;
  }
  if (tone === 'risk') {
    return 'error' as const;
  }
  return 'default' as const;
}

function getSeverityVariant(severity: 'info' | 'caution' | 'critical') {
  if (severity === 'critical') {
    return 'error' as const;
  }
  if (severity === 'caution') {
    return 'warning' as const;
  }
  return 'default' as const;
}

function AuditTimeline({ audits }: { audits: SwapAuditEntry[] }) {
  if (!audits.length) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-500">
        No audit events recorded yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {audits.slice(0, 4).map((audit) => (
        <div key={audit.id} className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-white">
                {audit.operation.replaceAll('_', ' ')}
              </p>
              <p className="text-xs text-slate-400">{formatRelativeTimestamp(audit.createdAt)}</p>
            </div>
            <Badge
              variant={
                audit.state === 'success'
                  ? 'success'
                  : audit.state === 'failed'
                    ? 'error'
                    : audit.state === 'retryable'
                      ? 'warning'
                      : 'default'
              }
            >
              {audit.state.toUpperCase()}
            </Badge>
          </div>
          {audit.indexingDetail && (
            <p className="mt-2 text-xs text-slate-400">{audit.indexingDetail}</p>
          )}
          {audit.error && <p className="mt-2 text-xs text-red-300">{audit.error}</p>}
        </div>
      ))}
    </div>
  );
}

function ActiveSwapCard({
  swap,
  details,
  isPrivate,
  actionLoading,
  processStep,
  onExecutePublic,
  onPrepareProof,
  onExecutePrivate,
}: {
  swap: SwapSummary;
  details?: SwapStatusDetails;
  isPrivate: boolean;
  actionLoading: string | null;
  processStep?: string;
  onExecutePublic: () => void;
  onPrepareProof: () => void;
  onExecutePrivate: () => void;
}) {
  const counterparty = getCounterpartyLabel(swap);
  const proofState = details?.proofs.status ?? swap.proofStatus;
  const executionState = details?.execution.status ?? swap.executionStatus;
  const latestAudit = details?.audits?.[0];

  const renderAction = () => {
    if (swap.status === 'requested') {
      return (
        <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/10 p-3 text-sm text-yellow-100">
          Waiting for the seller to accept this request.
        </div>
      );
    }

    if (swap.status === 'failed') {
      return (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-100">
          {swap.lastError ||
            details?.execution.lastError ||
            'The last execution attempt failed. Review the audit trail below.'}
        </div>
      );
    }

    if (isPrivate) {
      if (proofState === 'ready') {
        return (
          <Button
            onClick={onExecutePrivate}
            isLoading={actionLoading === swap._id}
            className="w-full"
            variant="primary"
          >
            <Shield className="mr-2 h-4 w-4" />
            Execute Private Swap
          </Button>
        );
      }

      if (!swap.myProofSubmitted) {
        return (
          <Button
            onClick={onPrepareProof}
            isLoading={actionLoading === swap._id}
            className="w-full"
            variant="primary"
          >
            <Shield className="mr-2 h-4 w-4" />
            Prepare My Proof
          </Button>
        );
      }

      return (
        <div className="rounded-xl border border-blue-500/20 bg-blue-500/10 p-3 text-sm text-blue-100">
          Your proof is stored. Waiting for the counterparty proof before private execution.
        </div>
      );
    }

    if (swap.participantRole === 'bob' && executionState !== 'confirmed') {
      return (
        <Button
          onClick={onExecutePublic}
          isLoading={actionLoading === swap._id}
          className="w-full"
          variant="primary"
        >
          <Globe className="mr-2 h-4 w-4" />
          Execute Public Swap
        </Button>
      );
    }

    return (
      <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-3 text-sm text-slate-300">
        Public execution is handled by the seller. Switch to private mode if both parties want the
        ZK path.
      </div>
    );
  };

  return (
    <Card variant="neon" className="overflow-hidden">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-slate-400">
            Counterparty:{' '}
            <span className="font-medium text-indigo-300">@{counterparty || 'Unknown'}</span>
          </p>
          <h3 className="mt-2 text-xl font-semibold text-white">{getSwapDirectionLabel(swap)}</h3>
          <p className="mt-2 text-xs text-slate-500">
            Created {formatRelativeTimestamp(swap.createdAt)}
          </p>
        </div>
        <Badge variant={statusVariantMap[swap.status]}>
          {swap.status.replaceAll('_', ' ').toUpperCase()}
        </Badge>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Proof Stage</p>
          <p className="mt-2 text-sm font-medium text-white">{proofLabelMap[proofState]}</p>
          <p className="mt-1 text-xs text-slate-400">
            My proof: {swap.myProofSubmitted ? 'submitted' : 'missing'} | Counterparty:{' '}
            {swap.counterpartyProofSubmitted ? 'submitted' : 'missing'}
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Execution</p>
          <p className="mt-2 text-sm font-medium text-white">{executionLabelMap[executionState]}</p>
          <p className="mt-1 text-xs text-slate-400">
            {swap.txHash ? `Tx: ${swap.txHash.slice(0, 12)}...` : 'No on-chain hash yet'}
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Mode Hint</p>
          <p className="mt-2 text-sm font-medium text-white">
            {isPrivate ? 'Private execution path' : 'Public execution path'}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {isPrivate
              ? 'Proof collection and private execution rely on exact private notes.'
              : 'Seller executes both public legs directly on-chain.'}
          </p>
        </div>
      </div>

      {processStep && actionLoading === swap._id && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-indigo-500/20 bg-indigo-500/10 p-3 text-sm text-indigo-100">
          <RefreshCw className="h-4 w-4 animate-spin" />
          <span>{processStep}</span>
        </div>
      )}

      {latestAudit?.error && (
        <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-100">
          {latestAudit.error}
        </div>
      )}

      <div className="mt-4">{renderAction()}</div>

      <div className="mt-5">
        <p className="mb-3 text-xs uppercase tracking-wide text-slate-500">Recent Audit Trail</p>
        <AuditTimeline audits={details?.audits ?? []} />
      </div>
    </Card>
  );
}

function OfferBoardCard({
  offer,
  updating,
  onToggle,
}: {
  offer: MerchantOfferWorkspaceItem;
  updating: boolean;
  onToggle: (offerId: string, nextActive: boolean) => void;
}) {
  return (
    <Card variant="glass" className="border border-white/5 bg-slate-900/70">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={offer.active ? 'success' : 'default'}>
              {offer.active ? 'LIVE' : 'PAUSED'}
            </Badge>
            <Badge variant={getToneVariant(offer.healthTone)}>
              {offer.healthTone.toUpperCase()}
            </Badge>
            <Badge
              variant={offer.requestGuidance.recommendedMode === 'private' ? 'success' : 'warning'}
            >
              {offer.requestGuidance.recommendedMode.toUpperCase()} BIAS
            </Badge>
          </div>
          <div>
            <h3 className="text-xl font-semibold text-white">
              {offer.assetIn} to {offer.assetOut}
            </h3>
            <p className="mt-1 text-sm text-slate-400">
              Rate {offer.rate} | Ticket {offer.min} to {offer.max}
            </p>
          </div>
          <p className="max-w-2xl text-sm leading-6 text-slate-400">{offer.healthSummary}</p>
        </div>

        <div className="flex flex-col gap-3 md:items-end">
          <Button
            variant={offer.active ? 'ghost' : 'primary'}
            onClick={() => onToggle(offer._id, !offer.active)}
            isLoading={updating}
          >
            {offer.active ? (
              <PauseCircle className="mr-2 h-4 w-4" />
            ) : (
              <PlayCircle className="mr-2 h-4 w-4" />
            )}
            {offer.active ? 'Pause listing' : 'Reactivate listing'}
          </Button>
          <p className="text-xs text-slate-500">
            Latest linked flow: {formatRelativeTimestamp(offer.latestSwapAt)}
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Queue pressure</p>
          <p className="mt-2 text-lg font-semibold text-white">
            {offer.queuePressure.toUpperCase()}
          </p>
          <p className="mt-1 text-xs text-slate-400">{offer.queueMessage}</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Open requests</p>
          <p className="mt-2 text-lg font-semibold text-white">{offer.openBuyerRequests}</p>
          <p className="mt-1 text-xs text-slate-400">Buyer intake still waiting to be cleared.</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Active executions</p>
          <p className="mt-2 text-lg font-semibold text-white">
            {offer.offerMetrics.activeExecutions}
          </p>
          <p className="mt-1 text-xs text-slate-400">Swaps already beyond request intake.</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Seller completion</p>
          <p className="mt-2 text-lg font-semibold text-white">
            {offer.merchantMetrics.completionRate}%
          </p>
          <p className="mt-1 text-xs text-slate-400">Trust signal based on seller-side outcomes.</p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {offer.requestGuidance.notes.slice(0, 2).map((note) => (
          <div
            key={note}
            className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-300"
          >
            {note}
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function MySwapsPage() {
  const { isPrivate } = usePrivacy();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [pendingSwaps, setPendingSwaps] = useState<SwapSummary[]>([]);
  const [allSwaps, setAllSwaps] = useState<SwapSummary[]>([]);
  const [recentActivity, setRecentActivity] = useState<SwapSummary[]>([]);
  const [statusMap, setStatusMap] = useState<Record<string, SwapStatusDetails>>({});
  const [merchantWorkspace, setMerchantWorkspace] = useState<MerchantWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [offerLoading, setOfferLoading] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [processStep, setProcessStep] = useState('');

  const fetchStatuses = async (swaps: SwapSummary[]) => {
    const relevant = swaps.filter(
      (swap) => swap.status !== 'completed' && swap.status !== 'cancelled',
    );
    const entries = await Promise.all(
      relevant.map(async (swap) => {
        const res = await fetch(`${API_URL}/swap/${swap._id}/status`, {
          credentials: 'include',
        });
        const data = await res.json();
        return [swap._id, data] as const;
      }),
    );

    const nextMap: Record<string, SwapStatusDetails> = {};
    for (const [swapId, payload] of entries) {
      if (payload?.swap?._id) {
        nextMap[swapId] = payload as SwapStatusDetails;
      }
    }
    setStatusMap(nextMap);
  };

  const fetchData = async () => {
    try {
      const [userRes, pendingRes, myRes, recentRes, workspaceRes] = await Promise.all([
        fetch(`${API_URL}/users/me`, { credentials: 'include' }),
        fetch(`${API_URL}/swap/pending`, { credentials: 'include' }),
        fetch(`${API_URL}/swap/my`, { credentials: 'include' }),
        fetch(`${API_URL}/swap/activity/recent?limit=6`, { credentials: 'include' }),
        fetch(`${API_URL}/offers/workspace`, { credentials: 'include' }),
      ]);

      const [userData, pendingData, myData, recentData, workspaceData] = await Promise.all([
        userRes.ok ? userRes.json() : null,
        pendingRes.ok ? pendingRes.json() : [],
        myRes.ok ? myRes.json() : [],
        recentRes.ok ? recentRes.json() : [],
        workspaceRes.ok ? workspaceRes.json() : null,
      ]);

      setCurrentUser(userData);
      setPendingSwaps(Array.isArray(pendingData) ? pendingData : []);
      setAllSwaps(Array.isArray(myData) ? myData : []);
      setRecentActivity(Array.isArray(recentData) ? recentData : []);
      setMerchantWorkspace(workspaceData);
      await fetchStatuses(Array.isArray(myData) ? myData : []);
    } catch {
      setError('Failed to load swap desk.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleAccept = async (swapId: string) => {
    setActionLoading(swapId);
    setError('');
    setSuccess('');

    try {
      const res = await fetch(`${API_URL}/swap/${swapId}/accept`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || 'Failed to accept swap');
      }
      setSuccess('Swap accepted. Proof collection can start now.');
      await fetchData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to accept swap');
    } finally {
      setActionLoading(null);
    }
  };

  const handleExecute = async (swapId: string) => {
    setActionLoading(swapId);
    setError('');
    setSuccess('');

    try {
      const res = await fetch(`${API_URL}/swap/${swapId}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      const data = (await res.json().catch(() => ({}))) as ApiTransactionResponse;
      if (!res.ok || data.success === false) {
        throw new Error(data.error || data.message || 'Failed to execute swap');
      }
      setSuccess(data.message || 'Public swap completed successfully.');
      await fetchData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to execute swap');
    } finally {
      setActionLoading(null);
    }
  };

  const handleExecutePrivate = async (swapId: string) => {
    setActionLoading(swapId);
    setError('');
    setSuccess('');
    setProcessStep('Executing private swap...');

    try {
      const res = await fetch(`${API_URL}/swap/${swapId}/execute-private`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      const data = (await res.json().catch(() => ({}))) as ApiTransactionResponse;
      if (!res.ok || data.success === false) {
        throw new Error(data.error || data.message || 'Failed to execute private swap');
      }
      setSuccess(data.message || 'Private swap executed successfully.');
      await fetchData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to execute private swap');
    } finally {
      setActionLoading(null);
      setProcessStep('');
    }
  };

  const handleSplit = async (asset: 'USDC' | 'XLM', amount: number) => {
    setProcessStep(`Splitting ${asset} note to create an exact ${amount} amount...`);
    const res = await fetch(`${API_URL}/users/split`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ asset, amount }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Split failed');
    }
    await new Promise((resolve) => setTimeout(resolve, 6000));
  };

  const handleDeposit = async (asset: 'USDC' | 'XLM', amount: number) => {
    setProcessStep(`Depositing ${amount} ${asset} into the private pool...`);
    const res = await fetch(`${API_URL}/users/deposit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ asset, amount }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
      throw new Error(data.error || 'Deposit failed');
    }
    await new Promise((resolve) => setTimeout(resolve, 6000));
  };

  const handlePrepareProof = async (swap: SwapSummary) => {
    const requirement = getAssetNeedForProof(swap);
    setActionLoading(swap._id);
    setError('');
    setSuccess('');
    setProcessStep('Preparing proof...');

    try {
      const attemptPrepare = async () => {
        const res = await fetch(`${API_URL}/swap/${swap._id}/prepare-my-proof`, {
          method: 'POST',
          credentials: 'include',
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.success === false) {
          throw new Error(data.error || data.message || 'Failed to prepare proof');
        }
        return data;
      };

      try {
        const data = await attemptPrepare();
        setSuccess(
          data.message || (data.ready ? 'Both proofs are ready.' : 'Your proof is stored.'),
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to prepare proof';
        if (message.includes('EXACT amount')) {
          await handleSplit(requirement.asset, requirement.amount);
          setProcessStep('Retrying proof preparation after note split...');
          const data = await attemptPrepare();
          setSuccess(data.message || 'Proof stored after splitting the note.');
        } else if (
          message.includes('Insufficient private balance') ||
          message.includes('No private note with EXACT amount')
        ) {
          if (
            window.confirm(
              `Private proof needs ${requirement.amount} ${requirement.asset}. Deposit from public balance now?`,
            )
          ) {
            await handleDeposit(requirement.asset, requirement.amount);
            setProcessStep('Retrying proof preparation after deposit...');
            const data = await attemptPrepare();
            setSuccess(data.message || 'Proof stored after deposit.');
          } else {
            throw new Error('Proof preparation cancelled before deposit.');
          }
        } else {
          throw err;
        }
      }

      await fetchData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to prepare proof';
      if (message !== 'Proof preparation cancelled before deposit.') {
        setError(message);
      }
    } finally {
      setActionLoading(null);
      setProcessStep('');
    }
  };

  const handleToggleOffer = async (offerId: string, nextActive: boolean) => {
    setOfferLoading(offerId);
    setError('');
    setSuccess('');

    try {
      const res = await fetch(`${API_URL}/offers/${offerId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ active: nextActive }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || data.error || 'Failed to update offer');
      }
      setSuccess(
        nextActive
          ? 'Offer reactivated and visible to the market.'
          : 'Offer paused to reduce additional seller queue pressure.',
      );
      await fetchData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update offer');
    } finally {
      setOfferLoading(null);
    }
  };

  const activeSwaps = useMemo(
    () =>
      allSwaps.filter((swap) =>
        ['proofs_pending', 'proofs_ready', 'executing', 'failed'].includes(swap.status),
      ),
    [allSwaps],
  );

  const buyerRequests = useMemo(
    () =>
      allSwaps.filter((swap) => swap.participantRole === 'alice' && swap.status === 'requested'),
    [allSwaps],
  );

  const completedSwaps = useMemo(
    () => allSwaps.filter((swap) => swap.status === 'completed'),
    [allSwaps],
  );

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-7xl p-4 md:p-8">
      <div className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="bg-gradient-to-r from-white to-slate-400 bg-clip-text text-3xl font-bold text-transparent">
            Seller Swap Desk
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Signed in as{' '}
            <span className="text-indigo-300">
              @{currentUser?.username || merchantWorkspace?.merchant.username || 'Unknown'}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={isPrivate ? 'success' : 'warning'} className="px-3 py-1">
            {isPrivate ? (
              <span className="flex items-center gap-1">
                <Shield size={14} />
                Private Mode
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <Globe size={14} />
                Public Mode
              </span>
            )}
          </Badge>
          <Button variant="ghost" onClick={() => fetchData()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <Card
          variant="default"
          className="mb-6 flex items-start gap-3 border-red-500/40 bg-red-900/20"
        >
          <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
          <p className="text-red-100">{error}</p>
        </Card>
      )}

      {success && (
        <Card
          variant="default"
          className="mb-6 flex items-start gap-3 border-green-500/40 bg-green-900/20"
        >
          <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-green-400" />
          <p className="text-green-100">{success}</p>
        </Card>
      )}

      <section className="mb-8 grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card variant="neon">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-slate-500">
                Seller command center
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-white">
                Board health and queue readiness
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                {merchantWorkspace?.queueHealth.message}
              </p>
            </div>
            <Badge variant={getToneVariant(merchantWorkspace?.queueHealth.tone ?? 'caution')}>
              {(merchantWorkspace?.queueHealth.pressure ?? 'moderate').toUpperCase()} PRESSURE
            </Badge>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Live offers</p>
              <p className="mt-2 text-3xl font-semibold text-white">
                {merchantWorkspace?.summary.offers.active ?? 0}
              </p>
              <p className="mt-2 text-xs text-slate-400">
                Paused: {merchantWorkspace?.summary.offers.paused ?? 0}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Incoming requests</p>
              <p className="mt-2 text-3xl font-semibold text-white">
                {merchantWorkspace?.summary.queue.requested ?? 0}
              </p>
              <p className="mt-2 text-xs text-slate-400">
                Proof queue: {merchantWorkspace?.summary.queue.proofsPending ?? 0}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Execution ready</p>
              <p className="mt-2 text-3xl font-semibold text-white">
                {merchantWorkspace?.summary.queue.proofsReady ?? 0}
              </p>
              <p className="mt-2 text-xs text-slate-400">
                Executing: {merchantWorkspace?.summary.queue.executing ?? 0}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Seller completion</p>
              <p className="mt-2 text-3xl font-semibold text-white">
                {merchantWorkspace?.summary.completionRate ?? 0}%
              </p>
              <p className="mt-2 text-xs text-slate-400">
                Avg ticket: {merchantWorkspace?.summary.averageTicketSize ?? 0}
              </p>
            </div>
          </div>
        </Card>

        <Card variant="glass" className="border border-white/5 bg-slate-900/80">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-400" />
            <h2 className="text-lg font-semibold text-white">Action queue</h2>
          </div>
          <div className="mt-5 space-y-3">
            {merchantWorkspace?.actionQueue.length ? (
              merchantWorkspace.actionQueue.map((entry) => (
                <div
                  key={`${entry.swapId}-${entry.action}`}
                  className="rounded-xl border border-slate-800 bg-slate-950/70 p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-white">{entry.label}</p>
                      <p className="mt-1 text-xs leading-5 text-slate-400">{entry.detail}</p>
                    </div>
                    <Badge variant={getSeverityVariant(entry.severity)}>
                      {entry.mode.toUpperCase()}
                    </Badge>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    {formatRelativeTimestamp(entry.createdAt)}
                  </p>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-500">
                No urgent seller actions right now.
              </div>
            )}
          </div>
        </Card>
      </section>

      <section className="mb-8">
        <div className="mb-4 flex items-center gap-2">
          <Store className="h-5 w-5 text-indigo-400" />
          <h2 className="text-xl font-semibold text-white">Offer inventory</h2>
        </div>
        {merchantWorkspace?.offerBoard.length ? (
          <div className="grid gap-5">
            {merchantWorkspace.offerBoard.map((offer) => (
              <OfferBoardCard
                key={offer._id}
                offer={offer}
                updating={offerLoading === offer._id}
                onToggle={handleToggleOffer}
              />
            ))}
          </div>
        ) : (
          <Card variant="glass" className="py-8 text-center text-slate-500">
            You do not have any offers yet. Publish one from the listing planner to build your
            seller board.
          </Card>
        )}
      </section>

      <section className="mb-8 grid gap-4 lg:grid-cols-2">
        <Card variant="glass">
          <div className="mb-4 flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-emerald-400" />
            <h2 className="text-lg font-semibold text-white">Pair coverage</h2>
          </div>
          <div className="space-y-3">
            {merchantWorkspace?.pairCoverage.map((pair) => (
              <div
                key={pair.pair}
                className="rounded-xl border border-slate-800 bg-slate-950/70 p-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-white">{pair.pair}</p>
                  <Badge variant={pair.activeOffers > 0 ? 'success' : 'default'}>
                    {pair.activeOffers} active
                  </Badge>
                </div>
                <p className="mt-2 text-xs text-slate-400">
                  Open requests: {pair.openRequests} | Completed swaps: {pair.completedSwaps}
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-300">{pair.recommendation}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card variant="glass">
          <div className="mb-4 flex items-center gap-2">
            <Clock3 className="h-5 w-5 text-yellow-400" />
            <h2 className="text-lg font-semibold text-white">Recent seller outcomes</h2>
          </div>
          <div className="space-y-3">
            {merchantWorkspace?.recentOutcomes.length ? (
              merchantWorkspace.recentOutcomes.map((outcome) => (
                <div
                  key={outcome.swapId}
                  className="rounded-xl border border-slate-800 bg-slate-950/70 p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-white">
                        {outcome.amountIn} XLM for {outcome.amountOut} USDC
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        Counterparty: @{outcome.counterparty || 'Unknown'} |{' '}
                        {formatRelativeTimestamp(outcome.completedAt || outcome.failedAt)}
                      </p>
                    </div>
                    <Badge variant={outcome.status === 'completed' ? 'success' : 'error'}>
                      {outcome.status.toUpperCase()}
                    </Badge>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-500">
                No seller outcomes have been recorded yet.
              </div>
            )}
          </div>
        </Card>
      </section>

      <section className="mb-8 grid gap-4 md:grid-cols-4">
        <Card variant="glass">
          <p className="text-xs uppercase tracking-wide text-slate-500">Pending requests</p>
          <p className="mt-2 text-3xl font-semibold text-white">{pendingSwaps.length}</p>
        </Card>
        <Card variant="glass">
          <p className="text-xs uppercase tracking-wide text-slate-500">Active swaps</p>
          <p className="mt-2 text-3xl font-semibold text-white">{activeSwaps.length}</p>
        </Card>
        <Card variant="glass">
          <p className="text-xs uppercase tracking-wide text-slate-500">Proofs ready</p>
          <p className="mt-2 text-3xl font-semibold text-white">
            {allSwaps.filter((swap) => swap.proofStatus === 'ready').length}
          </p>
        </Card>
        <Card variant="glass">
          <p className="text-xs uppercase tracking-wide text-slate-500">Completed</p>
          <p className="mt-2 text-3xl font-semibold text-white">{completedSwaps.length}</p>
        </Card>
      </section>

      <section className="mb-8">
        <div className="mb-4 flex items-center gap-2">
          <Clock3 className="h-5 w-5 text-yellow-400" />
          <h2 className="text-xl font-semibold text-white">Incoming Requests</h2>
        </div>
        {pendingSwaps.length === 0 ? (
          <Card variant="glass" className="py-8 text-center text-slate-500">
            No one is waiting on your acceptance right now.
          </Card>
        ) : (
          <div className="grid gap-4">
            {pendingSwaps.map((swap) => (
              <Card key={swap._id} variant="default" className="border-l-4 border-l-yellow-500">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm text-slate-400">Buyer</p>
                    <p className="mt-1 text-lg font-medium text-white">
                      @{swap.aliceId?.username || 'Unknown'}
                    </p>
                    <p className="mt-2 text-slate-300">
                      {swap.amountIn} XLM for {swap.amountOut} USDC
                    </p>
                    <p className="mt-2 text-xs text-slate-500">
                      {formatRelativeTimestamp(swap.createdAt)}
                    </p>
                  </div>
                  <div className="flex flex-col items-start gap-2 md:items-end">
                    <Badge variant="warning">REQUESTED</Badge>
                    <Button
                      onClick={() => handleAccept(swap._id)}
                      isLoading={actionLoading === swap._id}
                      variant="primary"
                    >
                      Accept Swap
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="mb-8">
        <div className="mb-4 flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-indigo-400" />
          <h2 className="text-xl font-semibold text-white">Active Lifecycle</h2>
        </div>
        {activeSwaps.length === 0 ? (
          <Card variant="glass" className="py-8 text-center text-slate-500">
            No swaps are in proof collection or execution right now.
          </Card>
        ) : (
          <div className="grid gap-5">
            {activeSwaps.map((swap) => (
              <ActiveSwapCard
                key={swap._id}
                swap={swap}
                details={statusMap[swap._id]}
                isPrivate={isPrivate}
                actionLoading={actionLoading}
                processStep={processStep}
                onExecutePublic={() => handleExecute(swap._id)}
                onPrepareProof={() => handlePrepareProof(swap)}
                onExecutePrivate={() => handleExecutePrivate(swap._id)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="mb-8">
        <div className="mb-4 flex items-center gap-2">
          <Lock className="h-5 w-5 text-slate-400" />
          <h2 className="text-xl font-semibold text-white">My Requested Swaps</h2>
        </div>
        {buyerRequests.length === 0 ? (
          <Card variant="glass" className="py-8 text-center text-slate-500">
            You have not created any swap requests that are still waiting on acceptance.
          </Card>
        ) : (
          <div className="grid gap-4">
            {buyerRequests.map((swap) => (
              <Card key={swap._id} variant="glass">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm text-slate-400">Seller</p>
                    <p className="mt-1 text-lg font-medium text-white">
                      @{swap.bobId?.username || 'Unknown'}
                    </p>
                    <p className="mt-2 text-slate-300">
                      {swap.amountIn} XLM for {swap.amountOut} USDC
                    </p>
                    <p className="mt-2 text-xs text-slate-500">
                      {formatRelativeTimestamp(swap.createdAt)}
                    </p>
                  </div>
                  <div className="flex flex-col items-start gap-2 md:items-end">
                    <Badge variant={statusVariantMap[swap.status]}>
                      {swap.status.replaceAll('_', ' ').toUpperCase()}
                    </Badge>
                    <p className="max-w-xs text-xs text-slate-400">
                      The seller must accept before either side can start proof collection or
                      execution.
                    </p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="mb-8">
        <div className="mb-4 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-slate-400" />
          <h2 className="text-xl font-semibold text-white">Recent Activity</h2>
        </div>
        {recentActivity.length === 0 ? (
          <Card variant="glass" className="py-8 text-center text-slate-500">
            No recent swap activity yet.
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {recentActivity.map((swap) => (
              <Card key={swap._id} variant="glass">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm text-slate-400">
                      {swap.participantRole === 'bob' ? 'Sale' : 'Purchase'}
                    </p>
                    <p className="mt-1 font-medium text-white">{getSwapDirectionLabel(swap)}</p>
                    <p className="mt-2 text-xs text-slate-500">
                      {formatRelativeTimestamp(swap.completedAt || swap.createdAt)}
                    </p>
                  </div>
                  <Badge variant={statusVariantMap[swap.status]}>
                    {swap.status.replaceAll('_', ' ').toUpperCase()}
                  </Badge>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <div className="mt-8 flex flex-wrap gap-4">
        <Link href="/swap">
          <Button variant="ghost">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Browse Offers
          </Button>
        </Link>
        <Link href="/swap/create">
          <Button variant="ghost">
            <Store className="mr-2 h-4 w-4" />
            Create Offer
          </Button>
        </Link>
        <Link href="/dashboard">
          <Button variant="ghost">Dashboard</Button>
        </Link>
      </div>
    </main>
  );
}
