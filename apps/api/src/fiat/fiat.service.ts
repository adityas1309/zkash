import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { Asset, Horizon, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import * as crypto from 'crypto';
import Razorpay from 'razorpay';
import { isMainnetContext, getHorizonUrl } from '../network.context';
import { User } from '../schemas/user.schema';
import { UsersService } from '../users/users.service';
import { BankAccountDetailsDto, CreateOrderDto, FiatPlanDto, SellFiatDto } from './dto/create-order.dto';

@Injectable()
export class FiatService {
  private readonly logger = new Logger(FiatService.name);
  private readonly server: Horizon.Server;
  private readonly razorpay: Razorpay | null;

  private readonly adminSecret =
    process.env.FIAT_ADMIN_SECRET || process.env.ADMIN_SECRET_KEY || 'SDHOAMBNLGCE2MV5zk4...';
  private readonly buyRateInrToXlm = Number(process.env.FIAT_BUY_RATE_INR_TO_XLM || '0.1');
  private readonly sellRateXlmToInr = Number(process.env.FIAT_SELL_RATE_XLM_TO_INR || '10');
  private readonly buyFeePercent = Number(process.env.FIAT_BUY_FEE_PERCENT || '1.5');
  private readonly sellFeePercent = Number(process.env.FIAT_SELL_FEE_PERCENT || '1.5');
  private readonly payoutHoldMinutes = Number(process.env.FIAT_PAYOUT_HOLD_MINUTES || '10');

  constructor(private readonly usersService: UsersService) {
    this.server = new Horizon.Server(getHorizonUrl());

    if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
      this.razorpay = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET,
      });
    } else {
      this.razorpay = null;
      this.logger.warn('RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET is missing');
    }
  }

  async getWorkspace(user: User) {
    const walletWorkspace = await this.usersService.getWalletWorkspace(user._id.toString());
    const publicXlm = Number(walletWorkspace.balances.public.xlm || 0);
    const privateXlm = Number(walletWorkspace.balances.private.xlm || 0);
    const totalXlm = publicXlm + privateXlm;

    return {
      user: {
        username: user.username,
        stellarPublicKey: user.stellarPublicKey,
      },
      provider: {
        razorpayConfigured: !!this.razorpay,
        keyIdPresent: !!process.env.RAZORPAY_KEY_ID,
      },
      pricing: {
        buyRateInrToXlm: this.buyRateInrToXlm,
        sellRateXlmToInr: this.sellRateXlmToInr,
        buyFeePercent: this.buyFeePercent,
        sellFeePercent: this.sellFeePercent,
      },
      balances: {
        publicXlm,
        privateXlm,
        totalXlm,
      },
      payoutPolicy: {
        holdMinutes: this.payoutHoldMinutes,
        bankRequirements: [
          'Account number must be 9-18 digits.',
          'IFSC must match the standard Indian bank format.',
          'Sell flow currently deducts XLM first and marks payout as pending.',
        ],
      },
      guidance: [
        this.razorpay
          ? 'Payment provider is configured, so buy-side checkout can proceed through Razorpay test mode.'
          : 'Payment provider is not configured yet, so buy-side checkout will fail until Razorpay keys are present.',
        totalXlm > 0
          ? 'You already hold XLM, so the sell-side payout preview can be evaluated against your visible and private balances.'
          : 'Your XLM balance is empty across public and private views, so the sell-side flow will need fresh inventory before it can succeed.',
        walletWorkspace.pending.count > 0
          ? `There are ${walletWorkspace.pending.count} pending withdrawal actions in the wallet workspace, which can affect how quickly private balances become public.`
          : 'There are no pending private withdrawal actions blocking wallet state right now.',
      ],
    };
  }

  async getPlanningWorkspace(user: User) {
    const workspace = await this.getWorkspace(user);

    return {
      ...workspace,
      readiness: {
        provider: this.razorpay
          ? {
              tone: 'ready',
              label: 'Checkout configured',
              detail: 'Razorpay keys are present, so buy-side checkout can open without additional environment work.',
            }
          : {
              tone: 'blocked',
              label: 'Checkout unavailable',
              detail: 'Razorpay keys are missing, so buy-side checkout remains blocked until provider configuration is restored.',
            },
        inventory: workspace.balances.totalXlm > 0
          ? {
              tone: workspace.balances.publicXlm > 0 ? 'ready' : 'attention',
              label: workspace.balances.publicXlm > 0 ? 'Public sell inventory ready' : 'Inventory is partly private',
              detail:
                workspace.balances.publicXlm > 0
                  ? 'There is visible XLM available to fund at least part of a sell-side payout directly from the public wallet.'
                  : 'Your current XLM lives outside the public wallet, so sell-side payouts may need a private withdrawal step first.',
            }
          : {
              tone: 'blocked',
              label: 'No sell inventory',
              detail: 'You currently hold no XLM inventory across public and private balances, so sell-side payout planning is blocked.',
            },
        payoutRail: {
          tone: 'attention',
          label: `Payout rail holds for ${workspace.payoutPolicy.holdMinutes} minutes`,
          detail: 'Bank settlement remains modeled as a queued payout after XLM collection rather than instant fiat delivery.',
        },
      },
      scenarioCards: [
        {
          id: 'buy_public',
          title: 'Buy into public wallet',
          mode: 'public',
          action: 'buy',
          detail: 'Simpler path for visible wallet funding and easier verification of successful fulfillment.',
        },
        {
          id: 'buy_zk',
          title: 'Buy into private flow',
          mode: 'zk',
          action: 'buy',
          detail: 'Best when the goal is to continue into private send or shielded swap flows after indexing catches up.',
        },
        {
          id: 'sell_visible',
          title: 'Sell visible XLM',
          mode: 'public',
          action: 'sell',
          detail: 'Cleanest sell path when public inventory already covers the requested XLM amount.',
        },
        {
          id: 'sell_withdrawal',
          title: 'Sell after private withdrawal',
          mode: 'zk',
          action: 'sell',
          detail: 'Needed when the sell amount exists mostly in private balances rather than the visible wallet.',
        },
      ],
    };
  }

  async previewBuy(user: User, dto: CreateOrderDto) {
    const normalized = this.normalizeBuyDto(dto);
    const grossXlm = normalized.amount * this.buyRateInrToXlm;
    const feeXlm = grossXlm * (this.buyFeePercent / 100);
    const netXlm = Number((grossXlm - feeXlm).toFixed(7));

    return {
      user: {
        username: user.username,
      },
      payment: {
        amountInInr: normalized.amount,
        currency: normalized.currency,
        mode: normalized.mode,
      },
      conversion: {
        rateInrToXlm: this.buyRateInrToXlm,
        grossXlm: Number(grossXlm.toFixed(7)),
        feePercent: this.buyFeePercent,
        feeXlm: Number(feeXlm.toFixed(7)),
        netXlm,
      },
      destination: {
        mode: normalized.mode,
        fulfillmentType: normalized.mode === 'zk' ? 'private_balance_flow' : 'public_wallet_transfer',
      },
      readiness: {
        providerConfigured: !!this.razorpay,
        walletDestinationReady: !!user.stellarPublicKey,
        recommendation:
          normalized.mode === 'zk'
            ? 'Private buy flow protects the received balance, but the note must still be indexed before every downstream private action can use it.'
            : 'Public buy flow is simpler to observe because the XLM lands directly in the visible wallet.',
      },
      warnings: [
        !this.razorpay ? 'Razorpay is not configured, so this checkout cannot complete until provider keys are added.' : null,
        normalized.mode === 'zk'
          ? 'Shielded fulfillment is modeled as a private balance path. Make sure downstream private actions account for indexing delay.'
          : 'Public fulfillment sends XLM directly to the wallet and exposes the transfer on-chain.',
      ].filter(Boolean),
    };
  }

  async previewSell(user: User, dto: SellFiatDto) {
    const walletWorkspace = await this.usersService.getWalletWorkspace(user._id.toString());
    const publicXlm = Number(walletWorkspace.balances.public.xlm || 0);
    const privateXlm = Number(walletWorkspace.balances.private.xlm || 0);
    const grossInr = dto.amount * this.sellRateXlmToInr;
    const feeInr = grossInr * (this.sellFeePercent / 100);
    const netInr = Number((grossInr - feeInr).toFixed(2));

    return {
      user: {
        username: user.username,
      },
      sale: {
        amountXlm: dto.amount,
        publicXlm,
        privateXlm,
        totalXlm: Number((publicXlm + privateXlm).toFixed(7)),
      },
      payout: {
        grossInr: Number(grossInr.toFixed(2)),
        feePercent: this.sellFeePercent,
        feeInr: Number(feeInr.toFixed(2)),
        netInr,
        estimatedHoldMinutes: this.payoutHoldMinutes,
      },
      bankAccount: {
        maskedAccount: this.maskAccountNumber(dto.accountDetails.accountNo),
        ifsc: dto.accountDetails.ifsc,
      },
      readiness: {
        canFundFromPublicWallet: publicXlm >= dto.amount,
        needsPrivateWithdrawal: publicXlm < dto.amount && publicXlm + privateXlm >= dto.amount,
        inventoryShortfall:
          publicXlm + privateXlm < dto.amount
            ? Number((dto.amount - (publicXlm + privateXlm)).toFixed(7))
            : 0,
      },
      warnings: [
        publicXlm < dto.amount && publicXlm + privateXlm >= dto.amount
          ? 'You have enough XLM overall, but some of it is private and would need to be withdrawn before a public sell transfer can complete cleanly.'
          : null,
        publicXlm + privateXlm < dto.amount
          ? 'Your current XLM inventory is lower than the amount you are trying to sell.'
          : null,
        'Sell flow is currently modeled as a payout initiation after XLM deduction, not an instant bank settlement.',
      ].filter(Boolean),
    };
  }

  async planTrade(user: User, dto: FiatPlanDto) {
    if (dto.action === 'buy') {
      const buyPreview = await this.previewBuy(user, {
        amount: dto.amount,
        currency: 'INR',
        mode: dto.mode ?? 'public',
      });

      return {
        action: 'buy',
        amount: dto.amount,
        mode: dto.mode ?? 'public',
        readiness: {
          tone:
            buyPreview.readiness.providerConfigured && buyPreview.readiness.walletDestinationReady
              ? 'ready'
              : buyPreview.readiness.providerConfigured
                ? 'attention'
                : 'blocked',
          headline:
            buyPreview.readiness.providerConfigured && buyPreview.readiness.walletDestinationReady
              ? 'Buy-side checkout is ready to execute.'
              : buyPreview.readiness.providerConfigured
                ? 'Checkout is available, but destination assumptions still need review.'
                : 'Buy-side checkout is blocked until the payment provider is configured.',
          detail: buyPreview.readiness.recommendation,
        },
        stages: [
          {
            id: 'payment_provider',
            label: 'Open checkout',
            status: buyPreview.readiness.providerConfigured ? 'ready' : 'blocked',
            detail: buyPreview.readiness.providerConfigured
              ? 'Razorpay can create the order and open the checkout modal.'
              : 'Provider keys are missing, so the payment initiation stage cannot start.',
          },
          {
            id: 'fulfillment_route',
            label: 'Select delivery route',
            status: 'ready',
            detail:
              buyPreview.destination.mode === 'zk'
                ? 'XLM is intended for private workflow, so post-payment handling should account for shielded indexing delay.'
                : 'XLM is intended for the visible wallet, so delivery should be easier to verify immediately.',
          },
          {
            id: 'post_fulfillment',
            label: 'Use delivered XLM',
            status: buyPreview.destination.mode === 'zk' ? 'attention' : 'ready',
            detail:
              buyPreview.destination.mode === 'zk'
                ? 'Private delivery is powerful, but downstream private actions may still wait on note indexing or deposit movement.'
                : 'Visible wallet delivery is immediately usable for public sends, trustline setup, or manual deposits.',
          },
        ],
        economics: {
          grossXlm: buyPreview.conversion.grossXlm,
          feeXlm: buyPreview.conversion.feeXlm,
          netXlm: buyPreview.conversion.netXlm,
          feePercent: buyPreview.conversion.feePercent,
        },
        routeCards: [
          {
            route: 'public',
            title: 'Public wallet delivery',
            recommended: dto.mode !== 'zk',
            tone: dto.mode === 'zk' ? 'attention' : 'ready',
            detail:
              'Use this route when the user wants immediate visible inventory for wallet transfers, trustlines, or fiat sell exits.',
          },
          {
            route: 'zk',
            title: 'Private workflow delivery',
            recommended: dto.mode === 'zk',
            tone: dto.mode === 'zk' ? 'ready' : 'attention',
            detail:
              'Use this route when the user intends to continue into shielded send or private swap flows after delivery.',
          },
        ],
        warnings: buyPreview.warnings,
        nextActions: [
          buyPreview.readiness.providerConfigured ? 'Proceed to create the order and open checkout.' : 'Restore Razorpay configuration before attempting checkout.',
          dto.mode === 'zk'
            ? 'Expect a private-handling step after payment verification and allow for indexing visibility.'
            : 'Watch for the public wallet transfer hash after payment verification completes.',
        ],
      };
    }

    const accountDetails = dto.accountDetails ?? {
      accountNo: '',
      ifsc: '',
    };
    const bankValidation = this.validateBankAccountDetails(accountDetails);
    const sellPreview = await this.previewSell(user, {
      amount: dto.amount,
      accountDetails,
    });

    const inventoryShortfall = sellPreview.readiness.inventoryShortfall;
    const publicReady = sellPreview.readiness.canFundFromPublicWallet;
    const needsPrivateWithdrawal = sellPreview.readiness.needsPrivateWithdrawal;

    return {
      action: 'sell',
      amount: dto.amount,
      mode: 'public',
      readiness: {
        tone:
          !bankValidation.valid || inventoryShortfall > 0
            ? 'blocked'
            : needsPrivateWithdrawal
              ? 'attention'
              : 'ready',
        headline:
          !bankValidation.valid
            ? 'Sell-side payout needs a valid bank destination first.'
            : inventoryShortfall > 0
              ? 'Sell-side payout is blocked by insufficient XLM inventory.'
              : needsPrivateWithdrawal
                ? 'Sell-side payout is possible, but some inventory is still private.'
                : 'Sell-side payout is ready to initiate from visible inventory.',
        detail:
          !bankValidation.valid
            ? bankValidation.detail
            : needsPrivateWithdrawal
              ? 'A private withdrawal step should happen before the visible sell transfer can complete cleanly.'
              : 'Inventory and bank routing both look structurally ready for payout initiation.',
      },
      stages: [
        {
          id: 'bank_destination',
          label: 'Validate bank destination',
          status: bankValidation.valid ? 'ready' : 'blocked',
          detail: bankValidation.detail,
        },
        {
          id: 'inventory_source',
          label: 'Prepare XLM inventory',
          status: inventoryShortfall > 0 ? 'blocked' : needsPrivateWithdrawal ? 'attention' : 'ready',
          detail:
            inventoryShortfall > 0
              ? `You are short by ${inventoryShortfall} XLM across total inventory.`
              : needsPrivateWithdrawal
                ? 'Total inventory is sufficient, but some of the required XLM is still private and needs surfacing.'
                : 'Visible XLM already covers the payout inventory requirement.',
        },
        {
          id: 'payout_queue',
          label: 'Enter payout queue',
          status: 'attention',
          detail: `After XLM deduction, bank delivery is still modeled as a queued payout with an estimated ${sellPreview.payout.estimatedHoldMinutes}-minute hold.`,
        },
      ],
      economics: {
        grossInr: sellPreview.payout.grossInr,
        feeInr: sellPreview.payout.feeInr,
        netInr: sellPreview.payout.netInr,
        feePercent: sellPreview.payout.feePercent,
      },
      inventory: {
        publicXlm: sellPreview.sale.publicXlm,
        privateXlm: sellPreview.sale.privateXlm,
        totalXlm: sellPreview.sale.totalXlm,
        inventoryShortfall,
      },
      routeCards: [
        {
          route: 'visible_inventory',
          title: 'Use public XLM inventory',
          recommended: publicReady,
          tone: publicReady ? 'ready' : 'attention',
          detail:
            publicReady
              ? 'Visible inventory is already enough to fund the payout deduction directly.'
              : 'Visible inventory alone is not enough, so this route may need help from a private withdrawal first.',
        },
        {
          route: 'private_withdrawal',
          title: 'Withdraw private XLM first',
          recommended: needsPrivateWithdrawal,
          tone: needsPrivateWithdrawal ? 'attention' : inventoryShortfall > 0 ? 'blocked' : 'default',
          detail:
            needsPrivateWithdrawal
              ? 'This route converts private inventory into a visible payout source before the fiat deduction step.'
              : inventoryShortfall > 0
                ? 'Even a private withdrawal would not fully cover the requested payout size right now.'
                : 'Private withdrawal is optional because visible inventory is already enough.',
        },
      ],
      bankAccount: {
        maskedAccount: sellPreview.bankAccount.maskedAccount,
        ifsc: sellPreview.bankAccount.ifsc,
        validation: bankValidation,
      },
      warnings: sellPreview.warnings,
      nextActions: [
        bankValidation.valid ? 'Keep the bank destination as-is for payout creation.' : 'Correct the bank destination before proceeding.',
        publicReady
          ? 'Proceed with payout initiation from visible inventory.'
          : needsPrivateWithdrawal
            ? 'Move enough XLM into the visible wallet before starting payout.'
            : 'Acquire more XLM inventory before trying to sell this amount.',
      ],
    };
  }

  async createOrder(user: User, dto: CreateOrderDto) {
    const normalized = this.normalizeBuyDto(dto);
    this.logger.log(`Creating Razorpay order for ${user.username}: ${normalized.amount} ${normalized.currency}`);

    if (!this.razorpay) {
      throw new InternalServerErrorException('Payment gateway not configured');
    }

    try {
      const options = {
        amount: Math.round(normalized.amount * 100),
        currency: normalized.currency,
        receipt: `receipt_${Date.now()}`,
        notes: {
          userId: user._id.toString(),
          mode: normalized.mode,
          inrAmount: normalized.amount.toString(),
        },
      };

      const order = await this.razorpay.orders.create(options as any);
      const preview = await this.previewBuy(user, normalized);

      return {
        orderId: order.id,
        keyId: process.env.RAZORPAY_KEY_ID,
        currency: order.currency,
        amount: order.amount,
        mode: normalized.mode,
        preview: {
          netXlm: preview.conversion.netXlm,
          feeXlm: preview.conversion.feeXlm,
          recommendation: preview.readiness.recommendation,
        },
      };
    } catch (error: any) {
      this.logger.error('Failed to create Razorpay order', error);
      throw new BadRequestException(`Order creation failed: ${error.message}`);
    }
  }

  async verifyPayment(
    user: User,
    razorpayOrderId: string,
    razorpayPaymentId: string,
    razorpaySignature: string,
    mode: 'public' | 'zk',
  ) {
    if (!process.env.RAZORPAY_KEY_SECRET) {
      throw new InternalServerErrorException('Razorpay secret missing');
    }

    const generatedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest('hex');

    if (generatedSignature !== razorpaySignature) {
      this.logger.error(`Signature mismatch for order ${razorpayOrderId}`);
      throw new BadRequestException('Invalid payment signature');
    }

    if (!this.razorpay) {
      throw new InternalServerErrorException('Payment gateway not configured');
    }

    let amountPaidInRupees = 0;
    try {
      const order = await this.razorpay.orders.fetch(razorpayOrderId);
      amountPaidInRupees = Number(order.amount) / 100;
    } catch (error) {
      this.logger.warn('Failed to fetch order details during verification', error);
    }

    const grossXlm = amountPaidInRupees * this.buyRateInrToXlm;
    const feeXlm = grossXlm * (this.buyFeePercent / 100);
    const netXlm = (grossXlm - feeXlm).toFixed(7);

    return this.processBuy(user, netXlm, mode, razorpayOrderId);
  }

  async processBuy(user: User, amount: string, mode: 'public' | 'zk', orderId: string) {
    this.logger.log(`Processing buy order ${orderId} for ${user.username} in ${mode} mode`);

    try {
      const sourceSecret = this.adminSecret;
      if (!sourceSecret || sourceSecret.length < 10) {
        throw new Error('Invalid admin secret for fulfiller wallet');
      }

      const sourceKeypair = Keypair.fromSecret(sourceSecret);
      const sourceAccount = await this.server.loadAccount(sourceKeypair.publicKey());
      const isMainnet = isMainnetContext();

      const tx = new TransactionBuilder(sourceAccount, {
        fee: '100',
        networkPassphrase: isMainnet ? Networks.PUBLIC : Networks.TESTNET,
      })
        .addOperation(
          Operation.payment({
            destination: user.stellarPublicKey,
            asset: Asset.native(),
            amount,
          }),
        )
        .setTimeout(30)
        .build();

      tx.sign(sourceKeypair);
      const result = await this.server.submitTransaction(tx);

      return {
        status: 'SUCCESS',
        txHash: result.hash,
        mode,
        message:
          mode === 'zk'
            ? `Payment verified. ${amount} XLM has been fulfilled and can now be moved into your private workflow.`
            : `Payment verified. ${amount} XLM has been sent to your public wallet.`,
      };
    } catch (error: any) {
      this.logger.error('Transfer failed during fiat buy fulfillment', error);
      throw new BadRequestException(`Payment verified but transfer failed: ${error.message}`);
    }
  }

  async initiatePayout(user: User, amount: string, accountDetails: SellFiatDto['accountDetails']) {
    this.logger.log(`Initiating payout of ${amount} XLM for ${user.username}`);

    try {
      const adminKeypair = Keypair.fromSecret(this.adminSecret);
      const adminPublicKey = adminKeypair.publicKey();
      const txHash = await this.usersService.sendPublic(user._id.toString(), adminPublicKey, amount, 'native');
      const preview = await this.previewSell(user, {
        amount: Number(amount),
        accountDetails,
      });

      return {
        status: 'PENDING',
        message: 'Payout initiated. XLM was deducted and the payout is now waiting in the fiat queue.',
        txHash,
        payoutId: `payout_${Date.now()}`,
        preview: {
          grossInr: preview.payout.grossInr,
          netInr: preview.payout.netInr,
          holdMinutes: preview.payout.estimatedHoldMinutes,
        },
      };
    } catch (error: any) {
      this.logger.error('Payout failed during XLM deduction', error);
      throw new BadRequestException(`Payout failed: ${error.message}`);
    }
  }

  private normalizeBuyDto(dto: CreateOrderDto) {
    return {
      amount: dto.amount,
      currency: dto.currency || 'INR',
      mode: dto.mode,
    };
  }

  private maskAccountNumber(accountNo: string) {
    if (accountNo.length <= 4) {
      return accountNo;
    }
    return `${'*'.repeat(Math.max(accountNo.length - 4, 0))}${accountNo.slice(-4)}`;
  }

  private validateBankAccountDetails(accountDetails: Partial<BankAccountDetailsDto>) {
    if (!accountDetails.accountNo || !/^[0-9]{9,18}$/.test(accountDetails.accountNo)) {
      return {
        valid: false,
        detail: 'Account number must contain 9 to 18 digits before payout can be planned confidently.',
      };
    }

    if (!accountDetails.ifsc || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(accountDetails.ifsc)) {
      return {
        valid: false,
        detail: 'IFSC code must match the standard Indian bank format before payout can be planned confidently.',
      };
    }

    return {
      valid: true,
      detail: 'Bank destination looks structurally valid for payout planning.',
    };
  }
}
