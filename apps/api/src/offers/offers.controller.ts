import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { OffersService } from './offers.service';
import { SessionAuthGuard } from '../auth/guards/session.guard';
import { Types } from 'mongoose';

@Controller('offers')
export class OffersController {
  constructor(private offersService: OffersService) {}

  @Get()
  findAll() {
    return this.offersService.findAll();
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.offersService.findById(id);
  }

  @Post()
  @UseGuards(SessionAuthGuard)
  create(
    @Body() body: { assetIn: string; assetOut: string; rate: number; min: number; max: number },
    @Req() req: { user: { _id: Types.ObjectId } },
  ) {
    return this.offersService.create(req.user._id, body);
  }

  @Put(':id')
  @UseGuards(SessionAuthGuard)
  update(@Param('id') id: string, @Body() body: { active?: boolean }) {
    return this.offersService.update(id, body);
  }
}
