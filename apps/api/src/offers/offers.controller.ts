import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Types } from 'mongoose';
import { SessionAuthGuard } from '../auth/guards/session.guard';
import { CreateOfferDto, OfferQueryDto, UpdateOfferDto } from './dto/offer.dto';
import { OffersService } from './offers.service';

@Controller('offers')
export class OffersController {
  constructor(private offersService: OffersService) {}

  @Get('market/highlights')
  getMarketHighlights() {
    return this.offersService.getMarketHighlights();
  }

  @Get('workspace')
  @UseGuards(SessionAuthGuard)
  workspace(@Req() req: { user: { _id: Types.ObjectId } }) {
    return this.offersService.getWorkspace(req.user._id);
  }

  @Get()
  findAll(@Query() query: OfferQueryDto) {
    return this.offersService.findAll(query);
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.offersService.findById(id);
  }

  @Get(':id/insights')
  findInsights(@Param('id') id: string) {
    return this.offersService.getOfferInsights(id);
  }

  @Post('preview')
  @UseGuards(SessionAuthGuard)
  preview(@Body() body: CreateOfferDto, @Req() req: { user: { _id: Types.ObjectId } }) {
    return this.offersService.previewCreate(req.user._id, body);
  }

  @Post()
  @UseGuards(SessionAuthGuard)
  create(@Body() body: CreateOfferDto, @Req() req: { user: { _id: Types.ObjectId } }) {
    return this.offersService.create(req.user._id, body);
  }

  @Put(':id')
  @UseGuards(SessionAuthGuard)
  update(
    @Param('id') id: string,
    @Body() body: UpdateOfferDto,
    @Req() req: { user: { _id: Types.ObjectId } },
  ) {
    return this.offersService.update(id, req.user._id, body);
  }
}
