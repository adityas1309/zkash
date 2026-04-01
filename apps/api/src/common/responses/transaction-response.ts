export type TransactionState =
  | 'success'
  | 'queued'
  | 'pending'
  | 'fallback'
  | 'rejected'
  | 'failed';

export interface TransactionResponse {
  success: boolean;
  state: TransactionState;
  operation: string;
  message: string;
  txHash?: string;
  indexing?: {
    status: 'not_required' | 'pending' | 'tracked' | 'lagging';
    detail?: string;
  };
  sponsorship?: {
    attempted: boolean;
    sponsored: boolean;
    detail?: string;
  };
  error?: string;
}

export function successResponse(
  operation: string,
  message: string,
  extras: Partial<TransactionResponse> = {},
): TransactionResponse {
  return {
    success: true,
    state: 'success',
    operation,
    message,
    ...extras,
  };
}

export function failureResponse(
  operation: string,
  message: string,
  extras: Partial<TransactionResponse> = {},
): TransactionResponse {
  return {
    success: false,
    state: 'failed',
    operation,
    message,
    error: extras.error ?? message,
    ...extras,
  };
}
