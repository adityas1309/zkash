import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { NetworkMiddleware } from './network.middleware';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { OffersModule } from './offers/offers.module';
import { SwapModule } from './swap/swap.module';
import { FaucetModule } from './faucet/faucet.module';
import { SorobanModule } from './soroban/soroban.module';
import { IndexerModule } from './indexer/indexer.module';
import { FiatModule } from './fiat/fiat.module';
import { OpsModule } from './ops/ops.module';
import { join } from 'path';
import { validateEnvironment } from './common/env';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.NODE_ENV === 'production' ? undefined : join(__dirname, '../../../../.env'),
      validate: (env) => {
        validateEnvironment(env);
        return env;
      },
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 120,
      },
    ]),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const uri = configService.get<string>('MONGODB_URI') || configService.get<string>('MONGO_URI');
        return {
          uri: uri ?? 'mongodb://localhost:27017/lop',
        };
      },
    }),
    AuthModule,
    UsersModule,
    OffersModule,
    SwapModule,
    FaucetModule,
    SorobanModule,
    IndexerModule,
    FiatModule,
    OpsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(NetworkMiddleware).forRoutes('*');
  }
}
