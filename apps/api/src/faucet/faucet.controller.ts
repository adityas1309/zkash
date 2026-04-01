import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { FaucetService } from './faucet.service';
import { SessionAuthGuard } from '../auth/guards/session.guard';
import { FaucetRequestDto } from '../common/dto/wallet.dto';

@Controller('faucet')
export class FaucetController {
  constructor(private faucetService: FaucetService) {}

  @Post('xlm')
  @UseGuards(SessionAuthGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async xlm(@Body() body: FaucetRequestDto) {
    return this.faucetService.requestXlm(body.address);
  }

  @Get('usdc')
  usdc() {
    return { url: this.faucetService.getUsdcFaucetUrl() };
  }
}
