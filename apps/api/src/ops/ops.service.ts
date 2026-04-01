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
    const [users, swaps, offers, encryptedNotes, pendingWithdrawals, commitments, syncStates] = await Promise.all([
      this.userModel.countDocuments().exec(),
      this.swapModel.countDocuments().exec(),
      this.offerModel.countDocuments().exec(),
      this.encryptedNoteModel.countDocuments().exec(),
      this.pendingWithdrawalModel.countDocuments({ processed: false }).exec(),
      this.poolCommitmentModel.countDocuments().exec(),
      this.syncStateModel.find().lean().exec(),
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
}
