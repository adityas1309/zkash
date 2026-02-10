import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Offer } from '../schemas/offer.schema';

@Injectable()
export class OffersService {
  constructor(@InjectModel(Offer.name) private offerModel: Model<Offer>) {}

  async create(
    merchantId: Types.ObjectId,
    data: { assetIn: string; assetOut: string; rate: number; min: number; max: number },
  ) {
    return this.offerModel.create({ merchantId, ...data });
  }

  async findAll(activeOnly = true) {
    const query = activeOnly ? { active: true } : {};
    return this.offerModel.find(query).populate('merchantId', 'username reputation').exec();
  }

  async findById(id: string) {
    return this.offerModel.findById(id).populate('merchantId', 'username reputation').exec();
  }

  async update(id: string, data: Partial<Offer>) {
    return this.offerModel.findByIdAndUpdate(id, data, { new: true }).exec();
  }
}
