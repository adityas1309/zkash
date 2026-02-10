import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Keypair } from '@stellar/stellar-sdk';
import { SorobanService } from '../soroban/soroban.service';
import { PoolCommitment } from '../schemas/pool-commitment.schema';

@Injectable()
export class PoolIndexerService implements OnModuleInit {
  private readonly signerPublicKey: string | null;
  private readonly pools: string[];

  constructor(
    @InjectModel(PoolCommitment.name) private poolCommitmentModel: Model<PoolCommitment>,
    private sorobanService: SorobanService,
  ) {
    const secret = process.env.INDEXER_SIGNER_SECRET_KEY ?? process.env.ADMIN_SECRET_KEY ?? process.env.DEPLOYER_SECRET_KEY;
    this.signerPublicKey = secret ? Keypair.fromSecret(secret).publicKey() : null;

    const usdcPool = process.env.SHIELDED_POOL_ADDRESS ?? '';
    const xlmPool = process.env.SHIELDED_POOL_XLM_ADDRESS ?? '';
    this.pools = [usdcPool, xlmPool].filter((x) => !!x);
  }

  onModuleInit() {
    // fire-and-forget background sync
    this.start().catch((e) => console.error('[PoolIndexer] init error', e));
  }

  private async start() {
    if (!this.signerPublicKey) {
      console.warn('[PoolIndexer] No INDEXER_SIGNER_SECRET_KEY/ADMIN_SECRET_KEY/DEPLOYER_SECRET_KEY configured; skipping pool sync.');
      return;
    }
    if (this.pools.length === 0) {
      console.warn('[PoolIndexer] No SHIELDED_POOL_ADDRESS configured; skipping pool sync.');
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
    for (const poolAddress of this.pools) {
      await this.syncPool(poolAddress);
    }
  }

  private async syncPool(poolAddress: string) {
    const leaves = await this.sorobanService.getCommitments(poolAddress, this.signerPublicKey!);
    if (leaves.length === 0) return;

    // Upsert each commitment. This is idempotent.
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
}

