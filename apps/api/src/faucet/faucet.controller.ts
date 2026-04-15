import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { FaucetService } from './faucet.service';
import { SessionAuthGuard } from '../auth/guards/session.guard';
import { FaucetRequestDto, FundingPlanDto } from '../common/dto/wallet.dto';

@Controller('faucet')
export class FaucetController {
  constructor(private faucetService: FaucetService) {}

  @Get('workspace')
  @UseGuards(SessionAuthGuard)
  async workspace(@Req() req: any) {
    return this.faucetService.getFundingWorkspace(req.user._id.toString());
  }

  @Post('plan')
  @UseGuards(SessionAuthGuard)
  async plan(@Req() req: any, @Body() body: FundingPlanDto) {
    return this.faucetService.planFunding(req.user._id.toString(), body);
  }

  @Post('xlm')
  @UseGuards(SessionAuthGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async xlm(@Req() req: any, @Body() body: FaucetRequestDto) {
    return this.faucetService.requestXlm(req.user._id.toString(), body.address);
  }

  @Get('usdc')
  usdc() {
    return { url: this.faucetService.getUsdcFaucetUrl() };
  }
}
