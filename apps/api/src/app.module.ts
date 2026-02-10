import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { OffersModule } from './offers/offers.module';
import { SwapModule } from './swap/swap.module';
import { FaucetModule } from './faucet/faucet.module';
import { SorobanModule } from './soroban/soroban.module';
import { IndexerModule } from './indexer/indexer.module';
import { join } from 'path';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: join(__dirname, '../../../.env') }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>('MONGODB_URI') ?? 'mongodb://localhost:27017/lop',
      }),
    }),
    AuthModule,
    UsersModule,
    OffersModule,
    SwapModule,
    FaucetModule,
    SorobanModule,
    IndexerModule,
  ],
})
export class AppModule { }
