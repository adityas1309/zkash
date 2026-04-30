import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FiatService } from './fiat.service';
import { FiatController } from './fiat.controller';
import { UsersModule } from '../users/users.module';
import { FiatOrder, FiatOrderSchema } from '../schemas/fiat-order.schema';

@Module({
  imports: [
    UsersModule,
    MongooseModule.forFeature([{ name: FiatOrder.name, schema: FiatOrderSchema }]),
  ],
  controllers: [FiatController],
  providers: [FiatService],
})
export class FiatModule {}
