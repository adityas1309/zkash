import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { SessionAuthGuard } from '../auth/guards/session.guard';

@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) { }

  @Get('me')
  @UseGuards(SessionAuthGuard)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async me(@Req() req: any) {
    const u = req.user;
    if (!u) return null;

    // Convert Mongoose document to plain object if it has toObject method
    const userObj = typeof u.toObject === 'function' ? u.toObject() : u;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { stellarSecretKeyEncrypted, zkSpendingKeyEncrypted, zkViewKeyEncrypted, ...safe } = userObj;
    return safe;
  }

  @Get(':username')
  async findByUsername(@Param('username') username: string) {
    const user = await this.usersService.findByUsername(username);
    if (!user) return { error: 'User not found' };
    return {
      username: user.username,
      stellarPublicKey: user.stellarPublicKey,
      reputation: user.reputation,
    };
  }

  @Get('balance/all')
  @UseGuards(SessionAuthGuard)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getBalance(@Req() req: any) {
    return this.usersService.getBalances(req.user._id);
  }

  @Get('balance/private')
  @UseGuards(SessionAuthGuard)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getPrivateBalance(@Req() req: any) {
    return this.usersService.getPrivateBalance(req.user._id);
  }

  @Post('trustline')
  @UseGuards(SessionAuthGuard)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async addTrustline(@Req() req: any) {
    const hash = await this.usersService.addTrustline(req.user._id);
    return { success: true, hash };
  }

  @Post('send')
  @UseGuards(SessionAuthGuard)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async sendPayment(@Req() req: any, @Body() body: { recipient: string; asset: 'USDC' | 'XLM'; amount: string }) {
    if (!body.recipient || !body.asset || !body.amount) {
      return { error: 'Missing fields' };
    }
    try {
      const hash = await this.usersService.sendPayment(req.user._id, body.recipient, body.asset, body.amount);
      return { success: true, hash };
    } catch (e) {
      return { success: false, message: (e as Error).message };
    }
  }

  @Post('send/private')
  @UseGuards(SessionAuthGuard)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async sendPrivate(
    @Req() req: any,
    @Body() body: { recipient: string; asset: 'USDC' | 'XLM'; amount: string },
  ) {
    if (!body?.recipient || !body?.asset || !body?.amount) {
      return { success: false, error: 'Missing recipient, asset, or amount' };
    }
    return this.usersService.sendPrivate(req.user._id, body.recipient, body.asset, body.amount);
  }

  @Post('withdrawals/process')
  @UseGuards(SessionAuthGuard)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async processWithdrawals(@Req() req: any) {
    return this.usersService.processPendingWithdrawals(req.user._id);
  }

  @Post('deposit')
  @UseGuards(SessionAuthGuard)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async deposit(@Req() req: any, @Body() body: { asset: 'USDC' | 'XLM' }) {
    if (!body?.asset || (body.asset !== 'USDC' && body.asset !== 'XLM')) {
      return { success: false, error: 'asset must be USDC or XLM' };
    }
    try {
      const result = await this.usersService.deposit(req.user._id, body.asset);
      if (result.error) return { success: false, error: result.error };
      return { success: true, txHash: result.txHash };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error('[UsersController] deposit failed:', e);
      return { success: false, error: message };
    }
  }
}
