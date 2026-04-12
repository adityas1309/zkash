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
    @InjectModel(PendingWithdrawal.name) private readonly pendingWithdrawalModel: Model<PendingWithdrawal>,
    @InjectModel(PoolCommitment.name) private readonly poolCommitmentModel: Model<PoolCommitment>,
    @InjectModel(IndexerSyncState.name) private readonly syncStateModel: Model<IndexerSyncState>,
    @InjectModel(TransactionAudit.name) private readonly transactionAuditModel: Model<TransactionAudit>,
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
    const [users, swaps, offers, encryptedNotes, pendingWithdrawals, commitments, syncStates, auditEntries] = await Promise.all([
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
    const activeUsers = await this.userModel.countDocuments({ updatedAt: { $gte: twentyFourHoursAgo } }).exec();
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
        .select('operation state txHash error indexingStatus indexingDetail sponsorshipAttempted sponsored createdAt metadata')
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

    return {
      health,
      readiness,
      stats,
      alertSummary,
      activitySummary,
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
        detail: 'Health, readiness, queue size, and market flow are all within the normal range tracked by the workspace.',
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
    const swapAuditCount = recentAudits.filter((audit) => String(audit.operation ?? '').startsWith('swap')).length;
    const walletAuditCount = recentAudits.filter((audit) =>
      ['public_send', 'private_send', 'deposit', 'withdraw_self', 'split_note'].includes(String(audit.operation ?? '')),
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
}
