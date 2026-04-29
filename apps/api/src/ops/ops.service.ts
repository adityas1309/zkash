import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MetricsService } from './metrics.service';
import { User } from '../schemas/user.schema';
import { Swap } from '../schemas/swap.schema';
import { Offer } from '../schemas/offer.schema';
import { EncryptedNote } from '../schemas/encrypted-note.schema';
import { PendingWithdrawal } from '../schemas/pending-withdrawal.schema';
import { PoolCommitment } from '../schemas/pool-commitment.schema';
import { IndexerSyncState } from '../schemas/indexer-sync-state.schema';
import { TransactionAudit } from '../schemas/transaction-audit.schema';

@Injectable()
export class OpsService {
  constructor(
    private readonly metrics: MetricsService,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Swap.name) private readonly swapModel: Model<Swap>,
    @InjectModel(Offer.name) private readonly offerModel: Model<Offer>,
    @InjectModel(EncryptedNote.name) private readonly encryptedNoteModel: Model<EncryptedNote>,
    @InjectModel(PendingWithdrawal.name)
    private readonly pendingWithdrawalModel: Model<PendingWithdrawal>,
    @InjectModel(PoolCommitment.name) private readonly poolCommitmentModel: Model<PoolCommitment>,
    @InjectModel(IndexerSyncState.name) private readonly syncStateModel: Model<IndexerSyncState>,
    @InjectModel(TransactionAudit.name)
    private readonly transactionAuditModel: Model<TransactionAudit>,
  ) {}

  async getHealth() {
    return {
      status: 'ok',
      service: 'zkash-api',
      timestamp: new Date().toISOString(),
    };
  }

  async getReadiness() {
    const [syncStates, userCount] = await Promise.all([
      this.syncStateModel.find().sort({ updatedAt: -1 }).lean().exec(),
      this.userModel.countDocuments().exec(),
    ]);

    const lagging = syncStates.filter((state) => state.status !== 'healthy');
    return {
      status: lagging.length > 0 ? 'degraded' : 'ready',
      dependencies: {
        mongodb: 'connected',
        indexer: lagging.length > 0 ? 'degraded' : 'healthy',
      },
      counts: {
        users: userCount,
        trackedPools: syncStates.length,
      },
      lagging,
      timestamp: new Date().toISOString(),
    };
  }

  async getStats() {
    const [
      users,
      swaps,
      offers,
      encryptedNotes,
      pendingWithdrawals,
      commitments,
      syncStates,
      auditEntries,
    ] = await Promise.all([
      this.userModel.countDocuments().exec(),
      this.swapModel.countDocuments().exec(),
      this.offerModel.countDocuments().exec(),
      this.encryptedNoteModel.countDocuments().exec(),
      this.pendingWithdrawalModel.countDocuments({ processed: false }).exec(),
      this.poolCommitmentModel.countDocuments().exec(),
      this.syncStateModel.find().lean().exec(),
      this.transactionAuditModel.countDocuments().exec(),
    ]);

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const activeUsers = await this.userModel
      .countDocuments({ updatedAt: { $gte: twentyFourHoursAgo } })
      .exec();
    this.metrics.setActiveAccounts(activeUsers);

    return {
      users: {
        total: users,
        active24h: activeUsers,
      },
      flows: {
        swaps,
        openOffers: offers,
        encryptedNotes,
        pendingWithdrawals,
        auditedTransactions: auditEntries,
      },
      indexer: {
        commitments,
        pools: syncStates.map((state) => ({
          network: state.network,
          poolAddress: state.poolAddress,
          lastProcessedLedger: state.lastProcessedLedger,
          lastSuccessfulSyncAt: state.lastSuccessfulSyncAt,
          eventCount: state.eventCount,
          commitmentCount: state.commitmentCount,
          status: state.status,
          lastError: state.lastError,
        })),
      },
      timestamp: new Date().toISOString(),
    };
  }

  async getMetricsText() {
    return this.metrics.render();
  }

  async getStatusWorkspace() {
    const [health, readiness, stats, recentAudits] = await Promise.all([
      this.getHealth(),
      this.getReadiness(),
      this.getStats(),
      this.transactionAuditModel
        .find()
        .sort({ createdAt: -1 })
        .limit(20)
        .select(
          'operation state txHash error indexingStatus indexingDetail sponsorshipAttempted sponsored createdAt metadata',
        )
        .lean()
        .exec(),
    ]);

    const laggingPools = readiness.lagging.map((pool) => ({
      poolAddress: pool.poolAddress,
      status: pool.status,
      lastProcessedLedger: pool.lastProcessedLedger,
      lastSuccessfulSyncAt: pool.lastSuccessfulSyncAt
        ? new Date(pool.lastSuccessfulSyncAt).toISOString()
        : undefined,
      lastError: pool.lastError,
    }));

    const poolSummaries = (stats.indexer?.pools ?? []).map((pool) => ({
      network: pool.network,
      poolAddress: pool.poolAddress,
      status: pool.status,
      lastProcessedLedger: pool.lastProcessedLedger,
      lastSuccessfulSyncAt: pool.lastSuccessfulSyncAt,
      eventCount: pool.eventCount ?? 0,
      commitmentCount: pool.commitmentCount ?? 0,
      lastError: pool.lastError,
    }));

    const alertSummary = this.buildAlertSummary(readiness, stats, laggingPools);
    const activitySummary = this.buildActivitySummary(recentAudits as any[]);
    const dependencyBoard = this.buildDependencyBoard(
      readiness,
      stats,
      laggingPools,
      activitySummary,
    );
    const remediationBoard = this.buildRemediationBoard(
      readiness,
      stats,
      laggingPools,
      activitySummary,
    );
    const throughputBoard = this.buildThroughputBoard(stats, activitySummary);
    const routeHealth = this.buildRouteHealth(stats, activitySummary, readiness);
    const incidentFeed = this.buildIncidentFeed(
      laggingPools,
      recentAudits as any[],
      activitySummary,
    );

    return {
      health,
      readiness,
      stats,
      alertSummary,
      activitySummary,
      dependencyBoard,
      remediationBoard,
      throughputBoard,
      routeHealth,
      incidentFeed,
      poolSummaries,
      laggingPools,
      updatedAt: new Date().toISOString(),
    };
  }

  private buildAlertSummary(
    readiness: Awaited<ReturnType<OpsService['getReadiness']>>,
    stats: Awaited<ReturnType<OpsService['getStats']>>,
    laggingPools: Array<{
      poolAddress: string;
      status: string;
      lastProcessedLedger: number;
      lastSuccessfulSyncAt?: string;
      lastError?: string;
    }>,
  ) {
    const pendingWithdrawals = stats.flows?.pendingWithdrawals ?? 0;
    const openOffers = stats.flows?.openOffers ?? 0;
    const swaps = stats.flows?.swaps ?? 0;
    const alerts: Array<{
      severity: 'info' | 'warning' | 'critical';
      title: string;
      detail: string;
    }> = [];

    if (readiness.status !== 'ready') {
      alerts.push({
        severity: laggingPools.length > 1 ? 'critical' : 'warning',
        title: 'Indexer readiness degraded',
        detail:
          laggingPools.length > 0
            ? `${laggingPools.length} tracked pool(s) are not healthy. Latest lagging pool: ${laggingPools[0].poolAddress}.`
            : 'Readiness is degraded even though no lagging pool summary was found.',
      });
    }

    if (pendingWithdrawals >= 5) {
      alerts.push({
        severity: pendingWithdrawals >= 10 ? 'critical' : 'warning',
        title: 'Pending withdrawal queue is growing',
        detail: `${pendingWithdrawals} withdrawal items are waiting for processing or retry.`,
      });
    }

    if (openOffers > 0 && swaps === 0) {
      alerts.push({
        severity: 'info',
        title: 'Market inventory without swap flow',
        detail: `${openOffers} offers are open, but swap count is still at zero. This can indicate a discovery gap or a new market phase.`,
      });
    }

    if (alerts.length === 0) {
      alerts.push({
        severity: 'info',
        title: 'No active operational alerts',
        detail:
          'Health, readiness, queue size, and market flow are all within the normal range tracked by the workspace.',
      });
    }

    return alerts;
  }

  private buildActivitySummary(
    recentAudits: Array<{
      operation?: string;
      state?: string;
      txHash?: string;
      error?: string;
      indexingStatus?: string;
      indexingDetail?: string;
      sponsorshipAttempted?: boolean;
      sponsored?: boolean;
      createdAt?: string | Date;
      metadata?: Record<string, unknown>;
    }>,
  ) {
    const recentFailures = recentAudits.filter((audit) => audit.state === 'failed').length;
    const sponsoredCount = recentAudits.filter((audit) => audit.sponsored).length;
    const swapAuditCount = recentAudits.filter((audit) =>
      String(audit.operation ?? '').startsWith('swap'),
    ).length;
    const walletAuditCount = recentAudits.filter((audit) =>
      ['public_send', 'private_send', 'deposit', 'withdraw_self', 'split_note'].includes(
        String(audit.operation ?? ''),
      ),
    ).length;

    return {
      recentFailures,
      sponsoredCount,
      swapAuditCount,
      walletAuditCount,
      recentAudits: recentAudits.map((audit) => ({
        operation: audit.operation,
        state: audit.state,
        txHash: audit.txHash,
        error: audit.error,
        indexingStatus: audit.indexingStatus,
        indexingDetail: audit.indexingDetail,
        sponsorshipAttempted: !!audit.sponsorshipAttempted,
        sponsored: !!audit.sponsored,
        createdAt: audit.createdAt,
        metadata: audit.metadata ?? {},
      })),
    };
  }

  private buildDependencyBoard(
    readiness: Awaited<ReturnType<OpsService['getReadiness']>>,
    stats: Awaited<ReturnType<OpsService['getStats']>>,
    laggingPools: Array<{
      poolAddress: string;
      status: string;
      lastProcessedLedger: number;
      lastSuccessfulSyncAt?: string;
      lastError?: string;
    }>,
    activitySummary: ReturnType<OpsService['buildActivitySummary']>,
  ) {
    const trackedPools = readiness.counts.trackedPools;
    const activeUsers = stats.users?.active24h ?? 0;
    const pendingWithdrawals = stats.flows?.pendingWithdrawals ?? 0;

    return [
      {
        id: 'mongodb',
        label: 'MongoDB persistence',
        status: readiness.dependencies.mongodb === 'connected' ? 'healthy' : 'degraded',
        summary:
          readiness.dependencies.mongodb === 'connected'
            ? 'Persistence layer is connected and serving the workspace-backed surfaces.'
            : 'Persistence layer is reporting degraded state.',
        metrics: [
          { label: 'Active 24h users', value: String(activeUsers) },
          { label: 'Audited tx', value: String(stats.flows?.auditedTransactions ?? 0) },
        ],
      },
      {
        id: 'indexer',
        label: 'Canonical indexer',
        status:
          laggingPools.length === 0 ? 'healthy' : laggingPools.length > 1 ? 'critical' : 'degraded',
        summary:
          laggingPools.length === 0
            ? `${trackedPools} tracked pools are healthy and fresh enough for normal private-flow visibility.`
            : `${laggingPools.length} tracked pools are lagging, which can delay note visibility, private balances, and action-center freshness.`,
        metrics: [
          { label: 'Tracked pools', value: String(trackedPools) },
          { label: 'Lagging lanes', value: String(laggingPools.length) },
        ],
      },
      {
        id: 'wallet-flow',
        label: 'Wallet flow health',
        status:
          pendingWithdrawals >= 10
            ? 'critical'
            : pendingWithdrawals >= 5 || activitySummary.recentFailures >= 4
              ? 'degraded'
              : 'healthy',
        summary:
          pendingWithdrawals >= 10
            ? 'Withdrawal backlog is large enough to make public balances and user trust feel stale.'
            : pendingWithdrawals >= 5
              ? 'Wallet flow is still usable, but the pending withdrawal queue is rising and needs attention.'
              : 'Wallet flow looks stable from the current queue and failure profile.',
        metrics: [
          { label: 'Pending withdrawals', value: String(pendingWithdrawals) },
          { label: 'Wallet audits', value: String(activitySummary.walletAuditCount) },
        ],
      },
      {
        id: 'market-flow',
        label: 'Market flow health',
        status:
          activitySummary.swapAuditCount >= 8 && activitySummary.recentFailures >= 3
            ? 'degraded'
            : 'healthy',
        summary:
          activitySummary.swapAuditCount >= 8 && activitySummary.recentFailures >= 3
            ? 'Swap traffic is active, but enough recent failures exist to justify queue review before scaling more flow.'
            : 'Swap audit activity is within a manageable band for the current recent window.',
        metrics: [
          { label: 'Swap audits', value: String(activitySummary.swapAuditCount) },
          { label: 'Open offers', value: String(stats.flows?.openOffers ?? 0) },
        ],
      },
    ];
  }

  private buildRemediationBoard(
    readiness: Awaited<ReturnType<OpsService['getReadiness']>>,
    stats: Awaited<ReturnType<OpsService['getStats']>>,
    laggingPools: Array<{
      poolAddress: string;
      status: string;
      lastProcessedLedger: number;
      lastSuccessfulSyncAt?: string;
      lastError?: string;
    }>,
    activitySummary: ReturnType<OpsService['buildActivitySummary']>,
  ) {
    const pendingWithdrawals = stats.flows?.pendingWithdrawals ?? 0;
    const actions: Array<{
      id: string;
      severity: 'critical' | 'warning' | 'info';
      title: string;
      detail: string;
      owner: string;
      destination: string;
      signals: string[];
    }> = [];

    if (laggingPools.length > 0) {
      actions.push({
        id: 'remediate-indexer',
        severity: laggingPools.length > 1 ? 'critical' : 'warning',
        title: 'Investigate lagging pool lanes',
        detail:
          'Private balance freshness is now dependent on lagging indexer lanes catching up. Start by checking the pool summaries and the last recorded sync error.',
        owner: 'ops',
        destination: '/status',
        signals: [
          `${laggingPools.length} lagging pool lane(s)`,
          ...laggingPools.slice(0, 2).map((pool) => pool.poolAddress),
        ],
      });
    }

    if (pendingWithdrawals > 0) {
      actions.push({
        id: 'remediate-withdrawals',
        severity: pendingWithdrawals >= 5 ? 'critical' : 'warning',
        title: 'Drain the pending withdrawal backlog',
        detail:
          'Queued withdrawals are one of the fastest ways for the product to feel broken to users, because balances and history stop matching expectations.',
        owner: 'wallet',
        destination: '/wallet',
        signals: [
          `${pendingWithdrawals} pending withdrawal item(s)`,
          `${stats.flows?.encryptedNotes ?? 0} encrypted note record(s) in circulation`,
        ],
      });
    }

    if (activitySummary.recentFailures > 0) {
      actions.push({
        id: 'remediate-failures',
        severity: activitySummary.recentFailures >= 4 ? 'critical' : 'warning',
        title: 'Review recent failing audits before user retries stack up',
        detail:
          'Repeated failed or retryable audit entries usually turn into duplicate user attempts, so they should be triaged before additional load lands on the same route.',
        owner: 'product',
        destination: '/history',
        signals: [
          `${activitySummary.recentFailures} recent failure(s)`,
          `${activitySummary.walletAuditCount} wallet audit(s) in the recent window`,
        ],
      });
    }

    if ((stats.flows?.openOffers ?? 0) > 0 && (stats.flows?.swaps ?? 0) === 0) {
      actions.push({
        id: 'remediate-market-discovery',
        severity: 'info',
        title: 'Check market discovery and seller response quality',
        detail:
          'Open offers exist without corresponding swap flow, which usually means either discovery is weak or sellers are not moving requests into acceptance quickly enough.',
        owner: 'market',
        destination: '/swap/my',
        signals: [
          `${stats.flows?.openOffers ?? 0} open offer(s)`,
          `${stats.flows?.swaps ?? 0} swap(s) recorded`,
        ],
      });
    }

    if (actions.length === 0) {
      actions.push({
        id: 'remediate-steady-state',
        severity: 'info',
        title: 'System is in a healthy operating band',
        detail:
          'No urgent remediation action is currently required. Continue monitoring queue shape, failure drift, and sponsorship usage while flow grows.',
        owner: 'ops',
        destination: '/status',
        signals: [`readiness=${readiness.status}`, `active24h=${stats.users?.active24h ?? 0}`],
      });
    }

    return actions;
  }

  private buildThroughputBoard(
    stats: Awaited<ReturnType<OpsService['getStats']>>,
    activitySummary: ReturnType<OpsService['buildActivitySummary']>,
  ) {
    const pools = stats.indexer?.pools ?? [];
    const totalEvents = pools.reduce((sum, pool) => sum + (pool.eventCount ?? 0), 0);
    const totalCommitments = pools.reduce((sum, pool) => sum + (pool.commitmentCount ?? 0), 0);
    const swapCount = stats.flows?.swaps ?? 0;
    const auditCount = stats.flows?.auditedTransactions ?? 0;

    return {
      adoption: {
        users: stats.users?.total ?? 0,
        active24h: stats.users?.active24h ?? 0,
        openOffers: stats.flows?.openOffers ?? 0,
        swaps: swapCount,
      },
      privacyFlow: {
        encryptedNotes: stats.flows?.encryptedNotes ?? 0,
        pendingWithdrawals: stats.flows?.pendingWithdrawals ?? 0,
        commitments: totalCommitments,
        events: totalEvents,
      },
      auditFlow: {
        total: auditCount,
        recentFailures: activitySummary.recentFailures,
        walletAudits: activitySummary.walletAuditCount,
        swapAudits: activitySummary.swapAuditCount,
        sponsored: activitySummary.sponsoredCount,
      },
    };
  }

  private buildRouteHealth(
    stats: Awaited<ReturnType<OpsService['getStats']>>,
    activitySummary: ReturnType<OpsService['buildActivitySummary']>,
    readiness: Awaited<ReturnType<OpsService['getReadiness']>>,
  ) {
    const pendingWithdrawals = stats.flows?.pendingWithdrawals ?? 0;
    const swapCount = stats.flows?.swaps ?? 0;
    const openOffers = stats.flows?.openOffers ?? 0;

    return [
      {
        id: 'wallet',
        label: 'Wallet and public send',
        tone:
          pendingWithdrawals >= 8
            ? 'critical'
            : activitySummary.walletAuditCount > 0 && activitySummary.recentFailures >= 3
              ? 'warning'
              : 'healthy',
        summary:
          pendingWithdrawals >= 8
            ? 'Backlog pressure is high enough that balances and wallet trust can drift from user expectations.'
            : 'Public wallet flow is operating in a mostly normal band.',
      },
      {
        id: 'private',
        label: 'Private balance flow',
        tone:
          readiness.lagging.length > 0
            ? 'warning'
            : (stats.flows?.encryptedNotes ?? 0) > 0
              ? 'healthy'
              : 'info',
        summary:
          readiness.lagging.length > 0
            ? 'Shielded note freshness is currently sensitive to indexer lag.'
            : 'Private note flow is available and not currently reporting indexer degradation.',
      },
      {
        id: 'market',
        label: 'Swap and offer flow',
        tone:
          openOffers > 0 && swapCount === 0
            ? 'warning'
            : activitySummary.swapAuditCount >= 8 && activitySummary.recentFailures >= 3
              ? 'warning'
              : swapCount > 0
                ? 'healthy'
                : 'info',
        summary:
          openOffers > 0 && swapCount === 0
            ? 'Discovery exists, but conversion into live swaps still looks weak.'
            : swapCount > 0
              ? 'Swap flow is active and producing measurable lifecycle activity.'
              : 'Market flow is quiet, but not necessarily unhealthy.',
      },
      {
        id: 'sponsorship',
        label: 'Fee sponsorship',
        tone:
          activitySummary.sponsoredCount > 0
            ? 'healthy'
            : activitySummary.walletAuditCount > 0
              ? 'info'
              : 'info',
        summary:
          activitySummary.sponsoredCount > 0
            ? 'Sponsored events are landing in the recent audit stream.'
            : 'No recent sponsored events were observed in the current audit window.',
      },
    ];
  }

  private buildIncidentFeed(
    laggingPools: Array<{
      poolAddress: string;
      status: string;
      lastProcessedLedger: number;
      lastSuccessfulSyncAt?: string;
      lastError?: string;
    }>,
    recentAudits: Array<{
      operation?: string;
      state?: string;
      txHash?: string;
      error?: string;
      indexingStatus?: string;
      indexingDetail?: string;
      sponsored?: boolean;
      createdAt?: string | Date;
      metadata?: Record<string, unknown>;
    }>,
    activitySummary: ReturnType<OpsService['buildActivitySummary']>,
  ) {
    const incidents: Array<{
      id: string;
      severity: 'critical' | 'warning' | 'info';
      title: string;
      detail: string;
      source: string;
      createdAt?: string | Date;
    }> = [];

    for (const pool of laggingPools.slice(0, 4)) {
      incidents.push({
        id: `pool-${pool.poolAddress}`,
        severity: laggingPools.length > 1 ? 'critical' : 'warning',
        title: 'Lagging pool lane detected',
        detail: `${pool.poolAddress} is marked ${pool.status} at ledger ${pool.lastProcessedLedger}.${pool.lastError ? ` ${pool.lastError}` : ''}`,
        source: 'indexer',
        createdAt: pool.lastSuccessfulSyncAt,
      });
    }

    for (const audit of recentAudits
      .filter((item) => item.state === 'failed' || item.state === 'retryable')
      .slice(0, 6)) {
      incidents.push({
        id: `audit-${String(audit.operation ?? 'activity')}-${String(audit.createdAt ?? '')}`,
        severity: audit.state === 'failed' ? 'warning' : 'info',
        title: String(audit.operation ?? 'activity').replaceAll('_', ' '),
        detail: audit.error || audit.indexingDetail || 'Recent audit item needs follow-up.',
        source: 'audit',
        createdAt: audit.createdAt,
      });
    }

    if (activitySummary.sponsoredCount > 0) {
      incidents.push({
        id: 'sponsorship-signal',
        severity: 'info',
        title: 'Sponsored activity observed',
        detail: `${activitySummary.sponsoredCount} recent sponsored audit event(s) were detected in the current window.`,
        source: 'sponsorship',
        createdAt: new Date().toISOString(),
      });
    }

    return incidents
      .sort(
        (left, right) =>
          new Date(right.createdAt ?? 0).getTime() - new Date(left.createdAt ?? 0).getTime(),
      )
      .slice(0, 10);
  }
}
