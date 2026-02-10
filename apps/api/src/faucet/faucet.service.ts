import { Injectable } from '@nestjs/common';

@Injectable()
export class FaucetService {
  async requestXlm(address: string): Promise<{ success: boolean; txHash?: string; error?: string }> {
    console.log(`[Faucet] Requesting XLM for ${address}`);
    try {
      const res = await fetch(`https://friendbot.stellar.org/?addr=${encodeURIComponent(address)}`);
      const data = await res.json();
      console.log(`[Faucet] Response:`, data);
      if (data.hash) return { success: true, txHash: data.hash };
      return { success: false, error: data.detail ?? 'Friendbot failed' };
    } catch (e) {
      console.error(`[Faucet] Error:`, e);
      return { success: false, error: (e as Error).message };
    }
  }

  getUsdcFaucetUrl(): string {
    return 'https://faucet.circle.com/?network=stellar-testnet';
  }
}
