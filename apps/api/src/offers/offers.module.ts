import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Offer, OfferSchema } from '../schemas/offer.schema';
import { OffersService } from './offers.service';
import { OffersController } from './offers.controller';

@Module({
  imports: [MongooseModule.forFeature([{ name: Offer.name, schema: OfferSchema }])],
  controllers: [OffersController],
  providers: [OffersService],
  exports: [OffersService],
})
export class OffersModule {}
