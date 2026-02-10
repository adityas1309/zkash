import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { SwapService } from './swap.service';
import { SessionAuthGuard } from '../auth/guards/session.guard';
import { Types } from 'mongoose';

@Controller('swap')
export class SwapController {
  constructor(private swapService: SwapService) { }

  @Post('request')
  @UseGuards(SessionAuthGuard)
  request(
    @Body() body: { bobId: string; amountIn: number; amountOut: number },
    @Req() req: { user: { _id: Types.ObjectId } },
  ) {
    return this.swapService.request(
      req.user._id,
      new Types.ObjectId(body.bobId),
      body.amountIn,
      body.amountOut,
    );
  }

  @Post(':id/accept')
  @UseGuards(SessionAuthGuard)
  accept(@Param('id') id: string, @Req() req: { user: { _id: Types.ObjectId } }) {
    return this.swapService.accept(id, req.user._id);
  }

  @Post(':id/execute')
  @UseGuards(SessionAuthGuard)
  async execute(
    @Param('id') id: string,
    @Req() req: { user: { _id: Types.ObjectId } },
  ) {
    return this.swapService.executeSwap(id, req.user._id);
  }

  @Post(':id/prepare-my-proof')
  @UseGuards(SessionAuthGuard)
  async prepareMyProof(
    @Param('id') id: string,
    @Req() req: { user: { _id: Types.ObjectId } },
  ) {
    try {
      return await this.swapService.prepareMyProof(id, req.user._id);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error('[SwapController] prepareMyProof error:', e);
      return { ready: false, error: message };
    }
  }

  @Post(':id/submit-proof')
  @UseGuards(SessionAuthGuard)
  async submitProof(
    @Param('id') id: string,
    @Body() body: { proofBytes: string; pubSignalsBytes: string; nullifier: string },
    @Req() req: { user: { _id: Types.ObjectId } },
  ) {
    if (!body.proofBytes || !body.pubSignalsBytes || !body.nullifier) {
      return { error: 'Missing proofBytes, pubSignalsBytes, or nullifier' };
    }
    return this.swapService.submitSwapProof(
      id,
      req.user._id,
      body.proofBytes,
      body.pubSignalsBytes,
      body.nullifier,
    );
  }

  @Post(':id/execute-private')
  @UseGuards(SessionAuthGuard)
  async executePrivate(
    @Param('id') id: string,
    @Body()
    body?: {
      aliceProof?: string;
      alicePubSignals?: string;
      aliceNullifier?: string;
      bobProof?: string;
      bobPubSignals?: string;
      bobNullifier?: string;
    },
  ) {
    try {
      let aliceProof: Uint8Array;
      let alicePubSignals: Uint8Array;
      let aliceNullifier: Uint8Array;
      let bobProof: Uint8Array;
      let bobPubSignals: Uint8Array;
      let bobNullifier: Uint8Array;

      if (body?.aliceProof && body?.alicePubSignals && body?.aliceNullifier &&
        body?.bobProof && body?.bobPubSignals && body?.bobNullifier) {
        aliceProof = new Uint8Array(Buffer.from(body.aliceProof, 'base64'));
        alicePubSignals = new Uint8Array(Buffer.from(body.alicePubSignals, 'base64'));
        aliceNullifier = new Uint8Array(Buffer.from(body.aliceNullifier, 'hex'));
        bobProof = new Uint8Array(Buffer.from(body.bobProof, 'base64'));
        bobPubSignals = new Uint8Array(Buffer.from(body.bobPubSignals, 'base64'));
        bobNullifier = new Uint8Array(Buffer.from(body.bobNullifier, 'hex'));
      } else {
        const swap = await this.swapService.findById(id);
        if (!swap?.aliceProofBytes || !swap?.alicePubSignalsBytes || !swap?.aliceNullifier ||
          !swap?.bobProofBytes || !swap?.bobPubSignalsBytes || !swap?.bobNullifier) {
          return { error: 'Submit proofs from both parties first, or provide all proof fields in body' };
        }
        aliceProof = new Uint8Array(Buffer.from(swap.aliceProofBytes!, 'base64'));
        alicePubSignals = new Uint8Array(Buffer.from(swap.alicePubSignalsBytes!, 'base64'));
        aliceNullifier = new Uint8Array(Buffer.from(swap.aliceNullifier!, 'hex'));
        bobProof = new Uint8Array(Buffer.from(swap.bobProofBytes!, 'base64'));
        bobPubSignals = new Uint8Array(Buffer.from(swap.bobPubSignalsBytes!, 'base64'));
        bobNullifier = new Uint8Array(Buffer.from(swap.bobNullifier!, 'hex'));
      }
      return await this.swapService.executeSwapPrivate(
        id,
        aliceProof,
        alicePubSignals,
        aliceNullifier,
        bobProof,
        bobPubSignals,
        bobNullifier,
      );
    } catch (err) {
      console.error('[SwapController] executePrivate error:', err);
      return { error: err instanceof Error ? err.message : 'Failed to execute private swap' };
    }
  }

  @Put(':id/complete')
  @UseGuards(SessionAuthGuard)
  complete(@Param('id') id: string, @Body() body: { txHash: string }) {
    return this.swapService.complete(id, body.txHash);
  }

  @Get('my')
  @UseGuards(SessionAuthGuard)
  async mySwaps(@Req() req: { user: { _id: Types.ObjectId } }) {
    const swaps = await this.swapService.findByUser(req.user._id);
    return swaps.map((s: any) => ({
      _id: s._id,
      aliceId: s.aliceId,
      bobId: s.bobId,
      amountIn: s.amountIn,
      amountOut: s.amountOut,
      status: s.status,
      txHash: s.txHash,
      createdAt: s.createdAt,
      proofReady: !!(s.aliceProofBytes && s.bobProofBytes),
      hasMyProof: req.user._id.equals(s.aliceId?._id ?? s.aliceId)
        ? !!s.aliceProofBytes
        : !!s.bobProofBytes,
    }));
  }

  @Get('pending')
  @UseGuards(SessionAuthGuard)
  pending(@Req() req: { user: { _id: Types.ObjectId } }) {
    return this.swapService.findPendingForBob(req.user._id);
  }

  @Get(':id/proof-status')
  @UseGuards(SessionAuthGuard)
  async proofStatus(@Param('id') id: string) {
    const swap = await this.swapService.findById(id);
    if (!swap) return { error: 'Swap not found' };
    return {
      proofReady: !!(swap.aliceProofBytes && swap.bobProofBytes),
      hasAliceProof: !!swap.aliceProofBytes,
      hasBobProof: !!swap.bobProofBytes,
    };
  }
}
