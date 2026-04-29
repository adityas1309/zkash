import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Keypair } from '@stellar/stellar-sdk';
import { SorobanService } from '../soroban/soroban.service';
import { PoolCommitment } from '../schemas/pool-commitment.schema';
import { IndexerSyncState } from '../schemas/indexer-sync-state.schema';
import { getContractAddress, networkStorage } from '../network.context';
import { MetricsService } from '../ops/metrics.service';
import { AppLoggerService } from '../common/logging/app-logger.service';

@Injectable()
export class PoolIndexerService implements OnModuleInit {
  private readonly signerPublicKey: string | null;

  constructor(
    @InjectModel(PoolCommitment.name) private poolCommitmentModel: Model<PoolCommitment>,
    @InjectModel(IndexerSyncState.name) private syncStateModel: Model<IndexerSyncState>,
    private sorobanService: SorobanService,
    private metrics: MetricsService,
    private logger: AppLoggerService,
  ) {
    const secret =
      process.env.INDEXER_SIGNER_SECRET_KEY ??
      process.env.ADMIN_SECRET_KEY ??
      process.env.DEPLOYER_SECRET_KEY;
    this.signerPublicKey = secret ? Keypair.fromSecret(secret).publicKey() : null;
  }

  onModuleInit() {
    // fire-and-forget background sync
    this.start().catch((e) => console.error('[PoolIndexer] init error', e));
  }

  private async start() {
    if (!this.signerPublicKey) {
      this.logger.warnEvent('indexer', 'missing_signer', {
        detail:
          'No INDEXER_SIGNER_SECRET_KEY/ADMIN_SECRET_KEY/DEPLOYER_SECRET_KEY configured; skipping pool sync.',
      });
      return;
    }

    // initial sync
    await this.syncAllOnce();

    // periodic sync
    setInterval(() => {
      this.syncAllOnce().catch((e) => console.error('[PoolIndexer] sync error', e));
    }, 10_000);
  }

  private async syncAllOnce() {
    // Run for Mainnet
    await networkStorage.run({ isMainnet: true }, async () => {
      const usdcPool = getContractAddress('SHIELDED_POOL_ADDRESS');
      const xlmPool = getContractAddress('SHIELDED_POOL_XLM_ADDRESS');
      const mainnetPools = [usdcPool, xlmPool].filter((x) => !!x);
      for (const poolAddress of mainnetPools) {
        await this.syncPool(poolAddress);
      }
    });

    // Run for Testnet
    await networkStorage.run({ isMainnet: false }, async () => {
      const usdcPool = getContractAddress('SHIELDED_POOL_ADDRESS');
      const xlmPool = getContractAddress('SHIELDED_POOL_XLM_ADDRESS');
      const testnetPools = [usdcPool, xlmPool].filter((x) => !!x);
      for (const poolAddress of testnetPools) {
        await this.syncPool(poolAddress);
      }
    });
  }

  private async syncPool(poolAddress: string) {
    const network = networkStorage.getStore()?.isMainnet ? 'mainnet' : 'testnet';
    try {
      const [leaves, latestLedger] = await Promise.all([
        this.sorobanService.getCommitments(poolAddress, this.signerPublicKey!),
        this.sorobanService.server.getLatestLedger(),
      ]);

      if (leaves.length > 0) {
        const ops = leaves.map((leaf, idx) => {
          const commitmentHex = Buffer.from(leaf).toString('hex').toLowerCase();
          return {
            updateOne: {
              filter: { poolAddress, index: idx },
              update: { $set: { poolAddress, index: idx, commitmentHex } },
              upsert: true,
            },
          };
        });
        await this.poolCommitmentModel.bulkWrite(ops, { ordered: false });
      }

      await this.syncStateModel.updateOne(
        { network, poolAddress },
        {
          $set: {
            network,
            poolAddress,
            lastProcessedLedger: Number(latestLedger.sequence ?? 0),
            eventCount: leaves.length,
            commitmentCount: leaves.length,
            status: 'healthy',
            lastSuccessfulSyncAt: new Date(),
            lastError: null,
          },
        },
        { upsert: true },
      );

      this.metrics.setIndexerCommitmentCount(network, poolAddress, leaves.length);
      this.metrics.setIndexerLastSuccessfulSync(
        network,
        poolAddress,
        Math.floor(Date.now() / 1000),
      );
      this.metrics.increment('indexer', 'sync_success');
    } catch (error) {
      this.metrics.incrementError('indexer', 'sync_failure');
      this.logger.errorEvent('indexer', 'sync_failure', error, { network, poolAddress });
      await this.syncStateModel.updateOne(
        { network, poolAddress },
        {
          $set: {
            network,
            poolAddress,
            status: 'degraded',
            lastError: error instanceof Error ? error.message : String(error),
          },
        },
        { upsert: true },
      );
      throw error;
    }
  }
}
