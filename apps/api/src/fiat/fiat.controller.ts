import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../auth/guards/session.guard';
import { CreateOrderDto, SellFiatDto } from './dto/create-order.dto';
import { VerifyPaymentDto } from './dto/verify-payment.dto';
import { FiatService } from './fiat.service';

@Controller('fiat')
export class FiatController {
  constructor(private readonly fiatService: FiatService) {}

  @UseGuards(SessionAuthGuard)
  @Get('workspace')
  async getWorkspace(@Req() req: any) {
    return this.fiatService.getWorkspace(req.user);
  }

  @UseGuards(SessionAuthGuard)
  @Post('preview-buy')
  async previewBuy(@Req() req: any, @Body() dto: CreateOrderDto) {
    return this.fiatService.previewBuy(req.user, dto);
  }

  @UseGuards(SessionAuthGuard)
  @Post('preview-sell')
  async previewSell(@Req() req: any, @Body() dto: SellFiatDto) {
    return this.fiatService.previewSell(req.user, dto);
  }

  @UseGuards(SessionAuthGuard)
  @Post('buy')
  async createBuyOrder(@Req() req: any, @Body() dto: CreateOrderDto) {
    return this.fiatService.createOrder(req.user, dto);
  }

  @UseGuards(SessionAuthGuard)
  @Post('verify-buy')
  async verifyBuy(@Req() req: any, @Body() dto: VerifyPaymentDto) {
    return this.fiatService.verifyPayment(
      req.user,
      dto.razorpayOrderId,
      dto.razorpayPaymentId,
      dto.razorpaySignature,
      dto.mode,
    );
  }

  @UseGuards(SessionAuthGuard)
  @Post('sell')
  async sell(@Req() req: any, @Body() dto: SellFiatDto) {
    return this.fiatService.initiatePayout(req.user, dto.amount.toString(), dto.accountDetails);
  }
}
