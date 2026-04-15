import { Module } from '@nestjs/common';
import { FaucetService } from './faucet.service';
import { FaucetController } from './faucet.controller';
import { UsersModule } from '../users/users.module';
import { TransactionsModule } from '../transactions/transactions.module';

@Module({
  imports: [UsersModule, TransactionsModule],
  controllers: [FaucetController],
  providers: [FaucetService],
})
export class FaucetModule {}
