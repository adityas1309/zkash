import { Injectable } from '@nestjs/common';
import { FundingPlanDto } from '../common/dto/wallet.dto';
import { TransactionAuditService } from '../transactions/transaction-audit.service';
import { UsersService } from '../users/users.service';

@Injectable()
export class FaucetService {
  constructor(
    private readonly usersService: UsersService,
    private readonly transactionAuditService: TransactionAuditService,
  ) {}

  async requestXlm(address: string): Promise<{ success: boolean; txHash?: string; error?: string }>;
  async requestXlm(userId: string, address: string): Promise<{ success: boolean; txHash?: string; error?: string }>;
  async requestXlm(
    userIdOrAddress: string,
    maybeAddress?: string,
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const userId = maybeAddress ? userIdOrAddress : undefined;
    const address = maybeAddress ?? userIdOrAddress;
    console.log(`[Faucet] Requesting XLM for ${address}`);
    const audit = userId
      ? await this.transactionAuditService.create({
          userId,
          operation: 'faucet_xlm',
          state: 'pending',
          asset: 'XLM',
          recipient: address,
          indexingStatus: 'not_required',
          indexingDetail: 'Friendbot funding affects the public wallet directly without private indexing.',
          metadata: {
            source: 'friendbot',
          },
        })
      : null;

    try {
      const res = await fetch(`https://friendbot.stellar.org/?addr=${encodeURIComponent(address)}`);
      const data = await res.json();
      console.log(`[Faucet] Response:`, data);
      if (data.hash) {
        if (audit) {
          await this.transactionAuditService.updateState(audit._id.toString(), 'success', {
            txHash: data.hash,
            indexingStatus: 'tracked',
            indexingDetail: 'Testnet XLM funding is confirmed directly on the public wallet route.',
          });
        }
        return { success: true, txHash: data.hash };
      }
      if (audit) {
        await this.transactionAuditService.updateState(audit._id.toString(), 'failed', {
          error: data.detail ?? 'Friendbot failed',
        });
      }
      return { success: false, error: data.detail ?? 'Friendbot failed' };
    } catch (e) {
      console.error(`[Faucet] Error:`, e);
      if (audit) {
        await this.transactionAuditService.updateState(audit._id.toString(), 'failed', {
          error: (e as Error).message,
        });
      }
      return { success: false, error: (e as Error).message };
    }
  }

  getUsdcFaucetUrl(): string {
    return 'https://faucet.circle.com/?network=stellar-testnet';
  }

  async getFundingWorkspace(userId: string) {
    const [walletWorkspace, history] = await Promise.all([
      this.usersService.getWalletWorkspace(userId),
      this.usersService.getHistory(userId),
    ]);

    const publicXlm = Number(walletWorkspace.balances.public.xlm || 0);
    const publicUsdc = Number(walletWorkspace.balances.public.usdc || 0);
    const privateXlm = Number(walletWorkspace.balances.private.xlm || 0);
    const privateUsdc = Number(walletWorkspace.balances.private.usdc || 0);
    const trustlineReady = publicUsdc > 0 || publicXlm > 0;

    const fundingEvents = history
      .filter((entry) =>
        ['faucet_xlm', 'deposit', 'withdraw_self', 'public_send'].includes(entry.operation) ||
        entry.title.toLowerCase().includes('trustline'),
      )
      .slice(0, 8);

    const readinessChecklist = [
      {
        id: 'xlm_public',
        label: 'Public XLM funding',
        status: publicXlm > 0 ? 'complete' : 'attention',
        detail:
          publicXlm > 0
            ? `The wallet already holds ${walletWorkspace.balances.public.xlm} XLM for fees and direct sends.`
            : 'The wallet still needs testnet XLM before trustline setup, public sends, or shielded deposits can proceed cleanly.',
      },
      {
        id: 'usdc_trustline',
        label: 'USDC trustline readiness',
        status: publicUsdc > 0 ? 'complete' : trustlineReady ? 'attention' : 'blocked',
        detail:
          publicUsdc > 0
            ? `Visible USDC liquidity is already present at ${walletWorkspace.balances.public.usdc}.`
            : trustlineReady
              ? 'There is enough public XLM to attempt trustline setup and then request USDC testnet liquidity.'
              : 'Trustline setup should wait until the public wallet has some XLM to cover network fees.',
      },
      {
        id: 'private_seed',
        label: 'Private balance seeding',
        status: privateXlm > 0 || privateUsdc > 0 ? 'complete' : publicXlm > 0 || publicUsdc > 0 ? 'attention' : 'blocked',
        detail:
          privateXlm > 0 || privateUsdc > 0
            ? `Private balances are already seeded with ${walletWorkspace.balances.private.xlm} XLM and ${walletWorkspace.balances.private.usdc} USDC.`
            : 'The next deposit into the shielded pool will unlock private sends, note shaping, and private swap preparation.',
      },
      {
        id: 'withdrawal_queue',
        label: 'Pending withdrawal backlog',
        status: walletWorkspace.pending.count === 0 ? 'complete' : 'attention',
        detail:
          walletWorkspace.pending.count === 0
            ? 'No queued withdrawals are waiting to surface private balances publicly.'
            : `${walletWorkspace.pending.count} pending withdrawals still need processing or retry attention.`,
      },
    ];

    return {
      user: walletWorkspace.user,
      balances: walletWorkspace.balances,
      pending: walletWorkspace.pending,
      readinessChecklist,
      fundingEvents,
      fundingSignals: {
        publicXlmReady: publicXlm > 0,
        trustlineReady,
        privateSeeded: privateXlm > 0 || privateUsdc > 0,
        usdcFaucetUrl: this.getUsdcFaucetUrl(),
      },
      actionCards: [
        {
          id: 'friendbot',
          title: 'Fund testnet XLM',
          action: 'request_xlm',
          tone: publicXlm > 0 ? 'ready' : 'attention',
          detail:
            publicXlm > 0
              ? 'Friendbot can still top up visible XLM, but the wallet already has enough to proceed with setup steps.'
              : 'Use Friendbot first so trustlines, deposits, and public sends all have fee liquidity.',
        },
        {
          id: 'trustline',
          title: 'Prepare USDC trustline',
          action: 'add_trustline',
          tone: publicUsdc > 0 ? 'ready' : trustlineReady ? 'attention' : 'blocked',
          detail:
            publicUsdc > 0
              ? 'USDC readiness is already established in the visible wallet.'
              : trustlineReady
                ? 'The next step is enabling the USDC trustline before requesting stablecoin testnet liquidity.'
                : 'Trustline setup is blocked until public XLM funding exists.',
        },
        {
          id: 'private_seed',
          title: 'Seed private balances',
          action: 'deposit_private',
          tone: privateXlm > 0 || privateUsdc > 0 ? 'ready' : publicXlm > 0 || publicUsdc > 0 ? 'attention' : 'blocked',
          detail:
            privateXlm > 0 || privateUsdc > 0
              ? 'Private balances are already usable for shielded flows.'
              : 'After public funding and trustline readiness, the next high-value step is a first private deposit.',
        },
      ],
      guidance: [
        publicXlm > 0
          ? 'Visible XLM is already present, so wallet setup can move beyond raw funding and into trustline or deposit prep.'
          : 'Start with Friendbot because most other setup steps depend on at least some visible XLM for network fees.',
        publicUsdc > 0
          ? 'USDC is already usable in the visible wallet, so the next leverage point is deciding whether it should stay public or move private.'
          : 'USDC testnet funding should happen after trustline setup so the stable balance lands in a wallet that can actually hold it.',
        privateXlm > 0 || privateUsdc > 0
          ? 'Private balances already exist, so funding work can focus on replenishment or public/private mix rather than initial setup.'
          : 'A first shielded deposit is still the missing step before private-send and private-swap routes feel ready.',
      ],
    };
  }

  async planFunding(userId: string, body: FundingPlanDto) {
    const workspace = await this.getFundingWorkspace(userId);
    const publicBalance = Number(body.asset === 'USDC' ? workspace.balances.public.usdc : workspace.balances.public.xlm);
    const privateBalance = Number(body.asset === 'USDC' ? workspace.balances.private.usdc : workspace.balances.private.xlm);
    const targetMap = {
      public_send: {
        headline: `Prepare ${body.asset} for visible wallet usage`,
        detail:
          publicBalance > 0
            ? `There is already visible ${body.asset} liquidity for direct public usage.`
            : `Visible ${body.asset} still needs to be funded before public send usage is ready.`,
      },
      private_flow: {
        headline: `Prepare ${body.asset} for private flow`,
        detail:
          privateBalance > 0
            ? `Private ${body.asset} liquidity already exists for shielded activity.`
            : `Private ${body.asset} still needs a deposit or incoming private transfer before shielded activity is ready.`,
      },
      swap_readiness: {
        headline: `Prepare ${body.asset} for swap readiness`,
        detail:
          body.asset === 'XLM'
            ? 'Swap readiness improves when visible XLM covers fees and one route also seeds exact-note private preparation.'
            : 'USDC swap readiness depends on trustline setup publicly and deposit or note shaping privately.',
      },
      fiat_sell: {
        headline: `Prepare ${body.asset} for fiat exit`,
        detail:
          body.asset === 'XLM'
            ? 'Fiat sell readiness depends on having enough visible XLM or a clear private-withdrawal step first.'
            : 'Fiat exit currently uses XLM inventory, so USDC needs a conversion path before it can fund a fiat sell route.',
      },
    } as const;

    const tone =
      body.target === 'public_send'
        ? publicBalance > 0 ? 'ready' : 'attention'
        : body.target === 'private_flow'
          ? privateBalance > 0 ? 'ready' : publicBalance > 0 ? 'attention' : 'blocked'
          : body.target === 'fiat_sell'
            ? body.asset === 'XLM'
              ? publicBalance > 0 ? 'ready' : privateBalance > 0 ? 'attention' : 'blocked'
              : 'blocked'
            : publicBalance > 0 || privateBalance > 0 ? 'attention' : 'blocked';

    return {
      asset: body.asset,
      target: body.target,
      readiness: {
        tone,
        ...targetMap[body.target],
      },
      stages: [
        {
          id: 'friendbot',
          label: 'Fund testnet XLM',
          status: workspace.fundingSignals.publicXlmReady ? 'ready' : 'attention',
          detail: workspace.fundingSignals.publicXlmReady
            ? 'Public XLM already exists, so the wallet can pay fees for trustline and on-chain setup actions.'
            : 'Friendbot funding is the first step because it unlocks fee-paying setup operations.',
        },
        {
          id: 'trustline',
          label: 'Enable USDC trustline',
          status:
            body.asset === 'USDC'
              ? Number(workspace.balances.public.usdc) > 0
                ? 'ready'
                : workspace.fundingSignals.trustlineReady
                  ? 'attention'
                  : 'blocked'
              : 'ready',
          detail:
            body.asset === 'USDC'
              ? Number(workspace.balances.public.usdc) > 0
                ? 'USDC is already present publicly, which implies trustline readiness exists.'
                : workspace.fundingSignals.trustlineReady
                  ? 'The wallet has enough XLM to attempt the trustline and then receive USDC testnet liquidity.'
                  : 'Trustline setup is still blocked until some XLM reaches the visible wallet.'
              : 'XLM does not require a trustline, so this stage is already satisfied.',
        },
        {
          id: 'private_seed',
          label: 'Seed private balance',
          status:
            body.target === 'private_flow' || body.target === 'swap_readiness'
              ? workspace.fundingSignals.privateSeeded
                ? 'ready'
                : Number(workspace.balances.public[body.asset.toLowerCase() as 'usdc' | 'xlm']) > 0
                  ? 'attention'
                  : 'blocked'
              : 'ready',
          detail:
            body.target === 'private_flow' || body.target === 'swap_readiness'
              ? workspace.fundingSignals.privateSeeded
                ? 'Private balance is already seeded and can participate in shielded routes.'
                : `A deposit from the visible ${body.asset} wallet is still needed before private routes become practical.`
              : 'Private seeding is optional for this target rather than required.',
        },
        {
          id: 'route_execution',
          label: 'Execute target route',
          status: tone,
          detail: targetMap[body.target].detail,
        },
      ],
      nextActions: [
        !workspace.fundingSignals.publicXlmReady ? 'Use Friendbot to fund visible XLM first.' : 'Visible XLM setup is already good enough to proceed.',
        body.asset === 'USDC' && Number(workspace.balances.public.usdc) === 0
          ? 'Add the USDC trustline before trying to source stablecoin liquidity.'
          : `No additional ${body.asset} trustline work is required for the selected route.`,
        body.target === 'private_flow' || body.target === 'swap_readiness'
          ? workspace.fundingSignals.privateSeeded
            ? 'Private balances are already ready for shielded routes.'
            : `Make a first ${body.asset} deposit into the shielded pool after public setup is complete.`
          : 'Private seeding is optional for this route.',
      ],
      actionCards: workspace.actionCards,
      recentFundingEvents: workspace.fundingEvents.slice(0, 4),
    };
  }
}
