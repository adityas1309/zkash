import { Injectable } from '@nestjs/common';
import { SponsorshipDecision, SponsorshipRequest, SponsoredOperation } from './sponsorship.types';

@Injectable()
export class SponsorshipService {
  private readonly supportedOperations = new Set<SupportedOperation>([
    'public_send',
    'deposit',
    'withdraw_self',
  ]);

  private get maxAmount(): number {
    return Number(process.env.SPONSOR_MAX_AMOUNT ?? '250');
  }

  isConfigured(): boolean {
    return Boolean(process.env.SPONSOR_SECRET_KEY);
  }

  evaluate(request: SponsorshipRequest): SponsorshipDecision {
    const maxAmount = this.maxAmount;
    const recipientRequired = request.operation === 'public_send';

    if (!this.isConfigured()) {
      return {
        supported: false,
        sponsored: false,
        operation: request.operation,
        reason: 'SPONSOR_SECRET_KEY is not configured.',
        policy: { maxAmount, recipientRequired },
      };
    }

    if (!this.supportedOperations.has(request.operation)) {
      return {
        supported: false,
        sponsored: false,
        operation: request.operation,
        reason: 'This operation is not yet covered by sponsorship policy.',
        policy: { maxAmount, recipientRequired },
      };
    }

    if (recipientRequired && !request.recipient) {
      return {
        supported: false,
        sponsored: false,
        operation: request.operation,
        reason: 'Recipient is required for sponsored public sends.',
        policy: { maxAmount, recipientRequired },
      };
    }

    if (
      typeof request.amount === 'number' &&
      Number.isFinite(request.amount) &&
      request.amount > maxAmount
    ) {
      return {
        supported: false,
        sponsored: false,
        operation: request.operation,
        reason: `Amount exceeds sponsorship cap of ${maxAmount}.`,
        policy: { maxAmount, recipientRequired },
      };
    }

    return {
      supported: true,
      sponsored: true,
      operation: request.operation,
      reason: 'Sponsorship is configured and available for this operation.',
      policy: { maxAmount, recipientRequired },
    };
  }

  shouldSponsor(request: SponsorshipRequest): boolean {
    const decision = this.evaluate(request);
    return decision.supported && decision.sponsored;
  }
}

type SupportedOperation = SponsoredOperation;
