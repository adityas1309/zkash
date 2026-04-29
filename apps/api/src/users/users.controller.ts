import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UsersService } from './users.service';
import { SessionAuthGuard } from '../auth/guards/session.guard';
import {
  BalanceActionDto,
  SendPaymentDto,
  SendPreviewDto,
  SponsorshipPreviewDto,
} from '../common/dto/wallet.dto';
import { failureResponse, successResponse } from '../common/responses/transaction-response';

@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get('me')
  @UseGuards(SessionAuthGuard)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async me(@Req() req: any) {
    const u = req.user;
    if (!u) return null;

    // Convert Mongoose document to plain object if it has toObject method
    const userObj = typeof u.toObject === 'function' ? u.toObject() : u;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { stellarSecretKeyEncrypted, zkSpendingKeyEncrypted, zkViewKeyEncrypted, ...safe } =
      userObj;
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

  @Get('workspace')
  @UseGuards(SessionAuthGuard)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getWalletWorkspace(@Req() req: any) {
    return this.usersService.getWalletWorkspace(req.user._id);
  }

  @Get('send/workspace')
  @UseGuards(SessionAuthGuard)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getSendWorkspace(@Req() req: any) {
    return this.usersService.getSendWorkspace(req.user._id);
  }

  @Get('actions/workspace')
  @UseGuards(SessionAuthGuard)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getActionWorkspace(@Req() req: any) {
    return this.usersService.getActionCenterWorkspace(req.user._id);
  }

  @Get('contacts/workspace')
  @UseGuards(SessionAuthGuard)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getContactsWorkspace(@Req() req: any) {
    return this.usersService.getContactsWorkspace(req.user._id);
  }

  @Get('portfolio/workspace')
  @UseGuards(SessionAuthGuard)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getPortfolioWorkspace(@Req() req: any) {
    return this.usersService.getPortfolioWorkspace(req.user._id);
  }

  @Get('playbook/workspace')
  @UseGuards(SessionAuthGuard)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getPlaybookWorkspace(@Req() req: any) {
    return this.usersService.getPlaybookWorkspace(req.user._id);
  }

  @Get('settlement/workspace')
  @UseGuards(SessionAuthGuard)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getSettlementWorkspace(@Req() req: any) {
    return this.usersService.getSettlementWorkspace(req.user._id);
  }

  @Get('liquidity/workspace')
  @UseGuards(SessionAuthGuard)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getLiquidityWorkspace(@Req() req: any) {
    return this.usersService.getLiquidityWorkspace(req.user._id);
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
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async sendPayment(@Req() req: any, @Body() body: SendPaymentDto) {
    try {
      const result = await this.usersService.sendPayment(
        req.user._id,
        body.recipient,
        body.asset,
        body.amount,
      );
      return successResponse('public_send', 'Public payment submitted successfully.', {
        txHash: result.txHash,
        indexing: { status: 'not_required' },
        sponsorship: {
          attempted: true,
          sponsored: result.sponsored,
          detail: result.sponsorshipDetail,
        },
      });
    } catch (e) {
      return failureResponse('public_send', 'Public payment failed.', {
        error: (e as Error).message,
        sponsorship: { attempted: true, sponsored: false },
      });
    }
  }

  @Post('send/private')
  @UseGuards(SessionAuthGuard)
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async sendPrivate(@Req() req: any, @Body() body: SendPaymentDto) {
    const result = await this.usersService.sendPrivate(
      req.user._id,
      body.recipient,
      body.asset,
      body.amount,
    );
    if (!result.success) {
      return failureResponse('private_send', result.error ?? 'Private payment failed.', {
        error: result.error,
        indexing: {
          status: 'pending',
          detail: 'Recipient withdrawal indexing may still be pending.',
        },
        sponsorship: { attempted: false, sponsored: false },
      });
    }

    return successResponse(
      'private_send',
      'Private payment submitted. Recipient can process withdrawal after indexing.',
      {
        indexing: {
          status: 'pending',
          detail: 'Recipient withdrawal will appear after the indexer processes the commitment.',
        },
        sponsorship: { attempted: false, sponsored: false },
      },
    );
  }

  @Post('withdrawals/process')
  @UseGuards(SessionAuthGuard)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async processWithdrawals(@Req() req: any) {
    return this.usersService.processPendingWithdrawals(req.user._id);
  }

  @Post('withdrawals/self')
  @UseGuards(SessionAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async withdrawSelf(@Req() req: any, @Body() body: BalanceActionDto) {
    const result = await this.usersService.withdrawSelf(req.user._id, body.asset, body.amount);
    if (!result.success) {
      return failureResponse('withdraw_self', result.error ?? 'Private withdrawal failed.', {
        error: result.error,
        indexing: {
          status: 'tracked',
          detail: 'Public balance should reflect the withdrawal once the chain confirms it.',
        },
        sponsorship: { attempted: false, sponsored: false },
      });
    }

    return successResponse('withdraw_self', 'Private balance withdrawn to the public wallet.', {
      txHash: result.txHash,
      indexing: {
        status: 'tracked',
        detail: 'Public balance will refresh after on-chain confirmation.',
      },
      sponsorship: { attempted: false, sponsored: false },
    });
  }

  @Post('deposit')
  @UseGuards(SessionAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async deposit(@Req() req: any, @Body() body: BalanceActionDto) {
    try {
      const result = await this.usersService.deposit(req.user._id, body.asset, body.amount);
      if (result.error) {
        return failureResponse('deposit', 'Deposit failed.', {
          error: result.error,
          indexing: {
            status: 'lagging',
            detail: 'Private balance will not update until the deposit is confirmed and indexed.',
          },
          sponsorship: { attempted: false, sponsored: false },
        });
      }
      return successResponse('deposit', 'Deposit submitted to the shielded pool.', {
        txHash: result.txHash,
        indexing: {
          status: 'pending',
          detail: 'Private balance will update once the canonical indexer syncs the new note.',
        },
        sponsorship: { attempted: false, sponsored: false },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error('[UsersController] deposit failed:', e);
      return failureResponse('deposit', 'Deposit failed.', {
        error: message,
        indexing: {
          status: 'lagging',
          detail:
            'The request did not complete cleanly; no private balance update should be assumed.',
        },
        sponsorship: { attempted: false, sponsored: false },
      });
    }
  }

  @Post('split')
  @UseGuards(SessionAuthGuard)
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async splitNote(@Req() req: any, @Body() body: BalanceActionDto) {
    const result = await this.usersService.splitNote(req.user._id, body.asset, body.amount);
    if (!result.success) {
      return failureResponse('split_note', result.error ?? 'Split failed.', {
        error: result.error,
        indexing: {
          status: 'pending',
          detail: 'If any withdrawal leg was sent, private balances may take time to settle.',
        },
        sponsorship: { attempted: false, sponsored: false },
      });
    }
    return successResponse('split_note', 'Note split completed and exact-value note recreated.', {
      indexing: { status: 'pending', detail: 'The recreated note will appear after indexer sync.' },
      sponsorship: { attempted: false, sponsored: false },
    });
  }

  @Post('sponsorship/preview')
  @UseGuards(SessionAuthGuard)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async previewSponsorship(@Req() req: any, @Body() body: SponsorshipPreviewDto) {
    return this.usersService.previewSponsorship(req.user._id, body);
  }

  @Post('send/preview')
  @UseGuards(SessionAuthGuard)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async previewSend(@Req() req: any, @Body() body: SendPreviewDto) {
    return this.usersService.previewSend(req.user._id, body);
  }

  @Get('history')
  @UseGuards(SessionAuthGuard)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getHistory(@Req() req: any) {
    return this.usersService.getHistory(req.user._id);
  }

  @Get('history/workspace')
  @UseGuards(SessionAuthGuard)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getHistoryWorkspace(@Req() req: any) {
    return this.usersService.getHistoryWorkspace(req.user._id);
  }
}
