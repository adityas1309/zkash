import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { Asset, Horizon, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import * as crypto from 'crypto';
import Razorpay from 'razorpay';
import { isMainnetContext, getHorizonUrl } from '../network.context';
import { User } from '../schemas/user.schema';
import { UsersService } from '../users/users.service';
import { CreateOrderDto, SellFiatDto } from './dto/create-order.dto';

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
}
