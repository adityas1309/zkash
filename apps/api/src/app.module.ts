import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { NetworkMiddleware } from './network.middleware';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { OffersModule } from './offers/offers.module';
import { SwapModule } from './swap/swap.module';
import { FaucetModule } from './faucet/faucet.module';
import { SorobanModule } from './soroban/soroban.module';
import { IndexerModule } from './indexer/indexer.module';
import { FiatModule } from './fiat/fiat.module';
import { join } from 'path';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.NODE_ENV === 'production' ? undefined : join(__dirname, '../../../../.env')
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const uri = configService.get<string>('MONGODB_URI') || configService.get<string>('MONGO_URI');
        console.log('----------------------------------------------------------------');
        console.log('DEBUG: __dirname:', __dirname);
        console.log('DEBUG: .env path should be:', join(__dirname, '../../../../.env'));
        console.log('DEBUG: MONGODB_URI:', uri);
        console.log('----------------------------------------------------------------');
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
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(NetworkMiddleware).forRoutes('*');
  }
}
