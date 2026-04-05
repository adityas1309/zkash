import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TransactionAudit, TransactionAuditSchema } from '../schemas/transaction-audit.schema';
import { TransactionAuditService } from './transaction-audit.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TransactionAudit.name, schema: TransactionAuditSchema },
    ]),
  ],
  providers: [TransactionAuditService],
  exports: [TransactionAuditService, MongooseModule],
})
export class TransactionsModule {}
