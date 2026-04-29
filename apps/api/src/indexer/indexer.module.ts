import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SorobanModule } from '../soroban/soroban.module';
import { PoolCommitment, PoolCommitmentSchema } from '../schemas/pool-commitment.schema';
import { IndexerSyncState, IndexerSyncStateSchema } from '../schemas/indexer-sync-state.schema';
import { PoolIndexerService } from './pool-indexer.service';
import { OpsModule } from '../ops/ops.module';

@Module({
  imports: [
    SorobanModule,
    OpsModule,
    MongooseModule.forFeature([
      { name: PoolCommitment.name, schema: PoolCommitmentSchema },
      { name: IndexerSyncState.name, schema: IndexerSyncStateSchema },
    ]),
  ],
  providers: [PoolIndexerService],
  exports: [PoolIndexerService],
})
export class IndexerModule {}
