export type SponsoredOperation =
  | 'public_send'
  | 'private_send'
  | 'deposit'
  | 'withdraw_self';

export interface SponsorshipDecision {
  supported: boolean;
  sponsored: boolean;
  reason: string;
  operation: SponsoredOperation;
  policy: {
    maxAmount: number;
    recipientRequired: boolean;
  };
}

export interface SponsorshipRequest {
  operation: SponsoredOperation;
  asset: 'USDC' | 'XLM';
  amount?: number;
  recipient?: string;
}
