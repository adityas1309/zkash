import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { FiatService } from './fiat.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { VerifyPaymentDto } from './dto/verify-payment.dto';
import { SessionAuthGuard } from '../auth/guards/session.guard';

@Controller('fiat')
export class FiatController {
    constructor(private readonly fiatService: FiatService) { }

    @UseGuards(SessionAuthGuard)
    @Post('buy')
    async createBuyOrder(@Req() req: any, @Body() dto: CreateOrderDto) {
        return this.fiatService.createOrder(req.user, dto);
    }

    @UseGuards(SessionAuthGuard)
    @Post('verify-buy')
    async verifyBuy(@Req() req: any, @Body() dto: VerifyPaymentDto & { mode: 'public' | 'zk' }) {
        return this.fiatService.verifyPayment(
            req.user,
            dto.razorpayOrderId,
            dto.razorpayPaymentId,
            dto.razorpaySignature,
            dto.mode
        );
    }

    @UseGuards(SessionAuthGuard)
    @Post('sell')
    async sell(@Req() req: any, @Body() body: any) {
        return this.fiatService.initiatePayout(req.user, body.amount, body.accountDetails);
    }
}
