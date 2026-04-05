import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { TransactionAudit, TransactionAuditState } from '../schemas/transaction-audit.schema';

interface CreateAuditInput {
  userId: string;
  operation: string;
  state?: TransactionAuditState;
  txHash?: string;
  asset?: string;
  amount?: string;
  recipient?: string;
  sponsorshipAttempted?: boolean;
  sponsored?: boolean;
  sponsorshipDetail?: string;
  indexingStatus?: string;
  indexingDetail?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class TransactionAuditService {
  constructor(
    @InjectModel(TransactionAudit.name)
    private readonly transactionAuditModel: Model<TransactionAudit>,
  ) {}

  async create(input: CreateAuditInput) {
    return this.transactionAuditModel.create({
      userId: new Types.ObjectId(input.userId),
      operation: input.operation,
      state: input.state ?? 'pending',
      txHash: input.txHash,
      asset: input.asset,
      amount: input.amount,
      recipient: input.recipient,
      sponsorshipAttempted: input.sponsorshipAttempted ?? false,
      sponsored: input.sponsored ?? false,
      sponsorshipDetail: input.sponsorshipDetail,
      indexingStatus: input.indexingStatus,
      indexingDetail: input.indexingDetail,
      error: input.error,
      metadata: input.metadata ?? {},
    });
  }

  async updateState(
    auditId: string,
    state: TransactionAuditState,
    patch: Partial<CreateAuditInput> = {},
  ) {
    return this.transactionAuditModel.findByIdAndUpdate(
      auditId,
      {
        $set: {
          state,
          txHash: patch.txHash,
          sponsorshipAttempted: patch.sponsorshipAttempted,
          sponsored: patch.sponsored,
          sponsorshipDetail: patch.sponsorshipDetail,
          indexingStatus: patch.indexingStatus,
          indexingDetail: patch.indexingDetail,
          error: patch.error,
          metadata: patch.metadata,
        },
      },
      { new: true },
    ).exec();
  }

  async listRecentForUser(userId: string, limit = 20) {
    return this.transactionAuditModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
      .exec();
  }

  async listRecentForSwap(swapId: string, limit = 20) {
    return this.transactionAuditModel
      .find({ 'metadata.swapId': swapId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
      .exec();
  }
}
