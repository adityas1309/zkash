import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { FaucetService } from './faucet.service';
import { SessionAuthGuard } from '../auth/guards/session.guard';

@Controller('faucet')
export class FaucetController {
  constructor(private faucetService: FaucetService) {}

  @Post('xlm')
  @UseGuards(SessionAuthGuard)
  async xlm(@Body() body: { address: string }) {
    return this.faucetService.requestXlm(body.address);
  }

  @Get('usdc')
  usdc() {
    return { url: this.faucetService.getUsdcFaucetUrl() };
  }
}
