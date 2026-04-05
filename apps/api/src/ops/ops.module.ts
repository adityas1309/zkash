import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OpsController } from './ops.controller';
import { OpsService } from './ops.service';
import { MetricsService } from './metrics.service';
import { AppLoggerService } from '../common/logging/app-logger.service';
import { User, UserSchema } from '../schemas/user.schema';
import { Swap, SwapSchema } from '../schemas/swap.schema';
import { Offer, OfferSchema } from '../schemas/offer.schema';
import { EncryptedNote, EncryptedNoteSchema } from '../schemas/encrypted-note.schema';
import { PendingWithdrawal, PendingWithdrawalSchema } from '../schemas/pending-withdrawal.schema';
import { PoolCommitment, PoolCommitmentSchema } from '../schemas/pool-commitment.schema';
import { IndexerSyncState, IndexerSyncStateSchema } from '../schemas/indexer-sync-state.schema';
import { TransactionAudit, TransactionAuditSchema } from '../schemas/transaction-audit.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Swap.name, schema: SwapSchema },
      { name: Offer.name, schema: OfferSchema },
      { name: EncryptedNote.name, schema: EncryptedNoteSchema },
      { name: PendingWithdrawal.name, schema: PendingWithdrawalSchema },
      { name: PoolCommitment.name, schema: PoolCommitmentSchema },
      { name: IndexerSyncState.name, schema: IndexerSyncStateSchema },
      { name: TransactionAudit.name, schema: TransactionAuditSchema },
    ]),
  ],
  controllers: [OpsController],
  providers: [OpsService, MetricsService, AppLoggerService],
  exports: [OpsService, MetricsService, AppLoggerService],
})
export class OpsModule {}
