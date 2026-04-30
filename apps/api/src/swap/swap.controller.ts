import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Types } from 'mongoose';
import { SessionAuthGuard } from '../auth/guards/session.guard';
import { failureResponse, successResponse } from '../common/responses/transaction-response';
import {
  CompleteSwapDto,
  ExecutePrivateSwapDto,
  RequestSwapDto,
  SubmitSwapProofDto,
  SwapActivityQueryDto,
} from './dto/swap.dto';
import { SwapService } from './swap.service';

@Controller('swap')
export class SwapController {
  constructor(private swapService: SwapService) {}

  @Post('request')
  @UseGuards(SessionAuthGuard)
  request(@Body() body: RequestSwapDto, @Req() req: { user: { _id: Types.ObjectId } }) {
    return this.swapService.request(
      req.user._id,
      new Types.ObjectId(body.bobId),
      body.amountIn,
      body.amountOut,
      new Types.ObjectId(body.offerId),
    );
  }

  @Post(':id/accept')
  @UseGuards(SessionAuthGuard)
  accept(@Param('id') id: string, @Req() req: { user: { _id: Types.ObjectId } }) {
    return this.swapService.accept(id, req.user._id);
  }

  @Post(':id/execute')
  @UseGuards(SessionAuthGuard)
  async execute(@Param('id') id: string, @Req() req: { user: { _id: Types.ObjectId } }) {
    try {
      const result = await this.swapService.executeSwap(id, req.user._id);
      return successResponse('swap_execute_public', 'Public swap submitted successfully.', {
        txHash: result.txHash,
        indexing: {
          status: 'tracked',
          detail: 'Public swap legs settle directly on-chain and can be checked immediately.',
        },
        sponsorship: { attempted: false, sponsored: false },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return failureResponse('swap_execute_public', 'Public swap failed.', {
        error: message,
        indexing: {
          status: 'not_required',
          detail: 'Execution failed before any private indexing dependency was introduced.',
        },
        sponsorship: { attempted: false, sponsored: false },
      });
    }
  }

  @Post(':id/prepare-my-proof')
  @UseGuards(SessionAuthGuard)
  async prepareMyProof(@Param('id') id: string, @Req() req: { user: { _id: Types.ObjectId } }) {
    try {
      const result = await this.swapService.prepareMyProof(id, req.user._id);
      if (!result.ready) {
        return failureResponse('swap_prepare_proof', result.error ?? 'Proof preparation failed.', {
          error: result.error,
          indexing: {
            status: 'pending',
            detail: 'Proof generation depends on exact note availability and indexer freshness.',
          },
          sponsorship: { attempted: false, sponsored: false },
        });
      }

      return successResponse('swap_prepare_proof', 'Proof prepared and stored for this swap.', {
        indexing: {
          status: result.proofStatus === 'ready' ? 'tracked' : 'pending',
          detail:
            result.proofStatus === 'ready'
              ? 'Both proofs are ready and the private swap can execute.'
              : 'Your proof is stored. Waiting for the counterparty proof.',
        },
        sponsorship: { attempted: false, sponsored: false },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return failureResponse('swap_prepare_proof', 'Proof preparation failed.', {
        error: message,
        indexing: {
          status: 'pending',
          detail: 'Proof generation did not complete cleanly.',
        },
        sponsorship: { attempted: false, sponsored: false },
      });
    }
  }

  @Post(':id/submit-proof')
  @UseGuards(SessionAuthGuard)
  async submitProof(
    @Param('id') id: string,
    @Body() body: SubmitSwapProofDto,
    @Req() req: { user: { _id: Types.ObjectId } },
  ) {
    try {
      const result = await this.swapService.submitSwapProof(
        id,
        req.user._id,
        body.proofBytes,
        body.pubSignalsBytes,
        body.nullifier,
      );

      return successResponse('swap_submit_proof', 'Proof submitted successfully.', {
        indexing: {
          status: result.ready ? 'tracked' : 'pending',
          detail: result.ready
            ? 'Both proofs are present and the swap is ready for private execution.'
            : 'Proof accepted. Waiting for the remaining party proof.',
        },
        sponsorship: { attempted: false, sponsored: false },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return failureResponse('swap_submit_proof', 'Proof submission failed.', {
        error: message,
        indexing: {
          status: 'pending',
          detail: 'The proof could not be stored or validated for this swap.',
        },
        sponsorship: { attempted: false, sponsored: false },
      });
    }
  }

  @Post(':id/execute-private')
  @UseGuards(SessionAuthGuard)
  async executePrivate(
    @Param('id') id: string,
    @Req() req: { user: { _id: Types.ObjectId } },
    @Body() body?: ExecutePrivateSwapDto,
  ) {
    try {
      let aliceProof: Uint8Array;
      let alicePubSignals: Uint8Array;
      let aliceNullifier: Uint8Array;
      let bobProof: Uint8Array;
      let bobPubSignals: Uint8Array;
      let bobNullifier: Uint8Array;

      if (
        body?.aliceProof &&
        body?.alicePubSignals &&
        body?.aliceNullifier &&
        body?.bobProof &&
        body?.bobPubSignals &&
        body?.bobNullifier
      ) {
        aliceProof = new Uint8Array(Buffer.from(body.aliceProof, 'base64'));
        alicePubSignals = new Uint8Array(Buffer.from(body.alicePubSignals, 'base64'));
        aliceNullifier = new Uint8Array(Buffer.from(body.aliceNullifier, 'hex'));
        bobProof = new Uint8Array(Buffer.from(body.bobProof, 'base64'));
        bobPubSignals = new Uint8Array(Buffer.from(body.bobPubSignals, 'base64'));
        bobNullifier = new Uint8Array(Buffer.from(body.bobNullifier, 'hex'));
      } else {
        const swap = await this.swapService.findById(id);
        if (
          !swap?.aliceProofBytes ||
          !swap?.alicePubSignalsBytes ||
          !swap?.aliceNullifier ||
          !swap?.bobProofBytes ||
          !swap?.bobPubSignalsBytes ||
          !swap?.bobNullifier
        ) {
          return failureResponse(
            'swap_execute_private',
            'Private swap execution requires proofs from both parties.',
            {
              error:
                'Submit proofs from both parties first, or provide all proof fields in the request body.',
              indexing: {
                status: 'pending',
                detail: 'Proof collection is incomplete, so the private swap cannot execute yet.',
              },
              sponsorship: { attempted: false, sponsored: false },
            },
          );
        }

        aliceProof = new Uint8Array(Buffer.from(swap.aliceProofBytes, 'base64'));
        alicePubSignals = new Uint8Array(Buffer.from(swap.alicePubSignalsBytes, 'base64'));
        aliceNullifier = new Uint8Array(Buffer.from(swap.aliceNullifier, 'hex'));
        bobProof = new Uint8Array(Buffer.from(swap.bobProofBytes, 'base64'));
        bobPubSignals = new Uint8Array(Buffer.from(swap.bobPubSignalsBytes, 'base64'));
        bobNullifier = new Uint8Array(Buffer.from(swap.bobNullifier, 'hex'));
      }

      const result = await this.swapService.executeSwapPrivate(
        id,
        req.user._id,
        aliceProof,
        alicePubSignals,
        aliceNullifier,
        bobProof,
        bobPubSignals,
        bobNullifier,
      );

      return successResponse('swap_execute_private', 'Private swap executed successfully.', {
        txHash: result.txHash,
        indexing: {
          status: 'pending',
          detail:
            'The private swap succeeded. Output notes are stored locally and public auto-withdraw waits on indexer freshness.',
        },
        sponsorship: { attempted: false, sponsored: false },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to execute private swap';
      return failureResponse('swap_execute_private', 'Private swap failed.', {
        error: message,
        indexing: {
          status: 'pending',
          detail: 'Proofs were collected, but execution did not complete cleanly.',
        },
        sponsorship: { attempted: false, sponsored: false },
      });
    }
  }

  @Put(':id/complete')
  @UseGuards(SessionAuthGuard)
  complete(
    @Param('id') id: string,
    @Body() body: CompleteSwapDto,
    @Req() req: { user: { _id: Types.ObjectId } },
  ) {
    return this.swapService.complete(id, req.user._id, body.txHash);
  }

  @Get('my')
  @UseGuards(SessionAuthGuard)
  mySwaps(@Req() req: { user: { _id: Types.ObjectId } }) {
    return this.swapService.findByUser(req.user._id);
  }

  @Get('pending')
  @UseGuards(SessionAuthGuard)
  pending(@Req() req: { user: { _id: Types.ObjectId } }) {
    return this.swapService.findPendingForBob(req.user._id);
  }

  @Get('activity/recent')
  @UseGuards(SessionAuthGuard)
  recentActivity(
    @Req() req: { user: { _id: Types.ObjectId } },
    @Query() query: SwapActivityQueryDto,
  ) {
    return this.swapService.getRecentActivityForUser(req.user._id, query.limit ?? 10);
  }

  @Get(':id/proof-status')
  @UseGuards(SessionAuthGuard)
  async proofStatus(@Param('id') id: string, @Req() req: { user: { _id: Types.ObjectId } }) {
    try {
      const status = await this.swapService.getSwapStatusForUser(id, req.user._id);
      if (!status) {
        return { error: 'Swap not found' };
      }
      return {
        proofReady: status.proofs.ready,
        proofStatus: status.proofs.status,
        hasAliceProof: status.proofs.hasAliceProof,
        hasBobProof: status.proofs.hasBobProof,
        executionStatus: status.execution.status,
        lastError: status.execution.lastError,
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  @Get(':id/status')
  @UseGuards(SessionAuthGuard)
  async swapStatus(@Param('id') id: string, @Req() req: { user: { _id: Types.ObjectId } }) {
    try {
      const status = await this.swapService.getSwapStatusForUser(id, req.user._id);
      if (!status) {
        return { error: 'Swap not found' };
      }
      return status;
    } catch (e) {
      return failureResponse('swap_status', 'Failed to load swap status.', {
        error: e instanceof Error ? e.message : String(e),
        indexing: {
          status: 'tracked',
          detail: 'Status lookup did not complete successfully.',
        },
        sponsorship: { attempted: false, sponsored: false },
      });
    }
  }

  @Get(':id/workspace')
  @UseGuards(SessionAuthGuard)
  async swapWorkspace(@Param('id') id: string, @Req() req: { user: { _id: Types.ObjectId } }) {
    try {
      return await this.swapService.getSwapWorkspaceForUser(id, req.user._id);
    } catch (e) {
      return failureResponse('swap_workspace', 'Failed to load swap workspace.', {
        error: e instanceof Error ? e.message : String(e),
        indexing: {
          status: 'tracked',
          detail: 'Workspace aggregation did not complete successfully.',
        },
        sponsorship: { attempted: false, sponsored: false },
      });
    }
  }
}
