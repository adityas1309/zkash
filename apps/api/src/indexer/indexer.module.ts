import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SorobanModule } from '../soroban/soroban.module';
import { PoolCommitment, PoolCommitmentSchema } from '../schemas/pool-commitment.schema';
import { PoolIndexerService } from './pool-indexer.service';

@Module({
  imports: [
    SorobanModule,
    MongooseModule.forFeature([{ name: PoolCommitment.name, schema: PoolCommitmentSchema }]),
  ],
  providers: [PoolIndexerService],
  exports: [PoolIndexerService],
})
export class IndexerModule {}

