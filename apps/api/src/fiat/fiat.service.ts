import { Injectable, Logger, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { User } from '../schemas/user.schema';
import { Keypair, Networks, TransactionBuilder, Operation, Asset, Horizon } from '@stellar/stellar-sdk';
import { CreateOrderDto } from './dto/create-order.dto';
import Razorpay from 'razorpay';
import * as crypto from 'crypto';

@Injectable()
export class FiatService {
  private readonly logger = new Logger(FiatService.name);
  private server: Horizon.Server;
  private razorpay: any;

  // Mock Admin Key (Testnet Faucet/Fulfiller)
  private adminSecret = process.env.FIAT_ADMIN_SECRET || process.env.ADMIN_SECRET_KEY || 'SDHOAMBNLGCE2MV5zk4...';

  constructor(private usersService: UsersService) {
    const rpcUrl = process.env.RPC_URL || '';
    const horizonUrl = rpcUrl.includes('horizon') ? rpcUrl : 'https://horizon-testnet.stellar.org';
    this.server = new Horizon.Server(horizonUrl);

    if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
      this.razorpay = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET,
      });
    } else {
      this.logger.warn('RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET is missing!');
    }
  }

  async createOrder(user: User, dto: CreateOrderDto) {
    this.logger.log(`Creating Razorpay order for ${user.username}: ${dto.amount} ${dto.currency}`);

    if (!this.razorpay) {
      throw new InternalServerErrorException('Payment gateway not configured');
    }

    try {
      const options = {
        amount: Math.round(dto.amount * 100), // Amount in smallest currency unit (paise)
        currency: dto.currency || 'INR',
        receipt: `receipt_${Date.now()}`,
        notes: {
          userId: user._id.toString(),
          mode: dto.mode
        }
      };

      const order = await this.razorpay.orders.create(options);

      this.logger.log(`Razorpay Order Created: ${order.id}`);

      return {
        orderId: order.id,
        keyId: process.env.RAZORPAY_KEY_ID, // Send Key ID to frontend
        currency: order.currency,
        amount: order.amount,
        mode: dto.mode
      };
    } catch (e: any) {
      this.logger.error('Failed to create Razorpay order', e);
      throw new BadRequestException(`Order creation failed: ${e.message}`);
    }
  }

  async verifyPayment(user: User, razorpayOrderId: string, razorpayPaymentId: string, razorpaySignature: string, mode: 'public' | 'zk') {
    this.logger.log(`Verifying payment for Order ${razorpayOrderId}, Payment ${razorpayPaymentId}`);

    if (!process.env.RAZORPAY_KEY_SECRET) {
      throw new InternalServerErrorException('Razorpay secret missing');
    }

    const generatedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(razorpayOrderId + '|' + razorpayPaymentId)
      .digest('hex');

    if (generatedSignature !== razorpaySignature) {
      this.logger.error(`Signature Mismatch: Generated ${generatedSignature} vs Received ${razorpaySignature}`);
      throw new BadRequestException('Invalid payment signature');
    }

    this.logger.log('Payment Signature Verified. Proceeding to fulfillment.');

    // FULFILLMENT (Send XLM)
    // 1 INR ~ 0.1 XLM (Roughly)
    // We should fetch the order amount from Razorpay or DB.
    // For MVP, we'll fetch order details from Razorpay to get the amount paid.

    let amountPaidInRupees = 0;
    try {
      const order = await this.razorpay.orders.fetch(razorpayOrderId);
      if (order.status !== 'paid' && order.status !== 'attempted') {
        this.logger.warn(`Razorpay Order Status is ${order.status}`);
      }
      amountPaidInRupees = Number(order.amount) / 100;
    } catch (e) {
      this.logger.warn('Failed to fetch order details, relying on passed context (risky in prod)', e);
      // Fallback or fail
    }

    // Exchange Rate: Simple fixed rate for demo: 1 INR = 0.1 XLM
    // Example: 100 INR = 10 XLM
    const xlmAmount = (amountPaidInRupees * 0.1).toFixed(7);

    return this.processBuy(user, xlmAmount, mode, razorpayOrderId);
  }

  async processBuy(user: User, amount: string, mode: 'public' | 'zk', orderId: string) {
    this.logger.log(`Processing buy: Sending ${amount} XLM to ${user.username} (Mode: ${mode})`);

    try {
      const sourceSecret = this.adminSecret;
      // Ensure we have a valid secret (Testnet)
      if (!sourceSecret || sourceSecret.length !== 56) {
        throw new Error('Invalid Admin Secret for Fulfiller Wallet');
      }

      const sourceKeypair = Keypair.fromSecret(sourceSecret);
      const sourceAccount = await this.server.loadAccount(sourceKeypair.publicKey());

      const tx = new TransactionBuilder(sourceAccount, {
        fee: '100',
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(Operation.payment({
          destination: user.stellarPublicKey,
          asset: Asset.native(),
          amount: amount,
        }))
        .setTimeout(30)
        .build();

      tx.sign(sourceKeypair);
      const result = await this.server.submitTransaction(tx);

      this.logger.log(`Transfer successful: ${result.hash}`);

      return {
        status: 'SUCCESS',
        txHash: result.hash,
        message: `Successfully sent ${amount} XLM to your public wallet.`
      };

    } catch (e: any) {
      this.logger.error('Transfer failed', e);
      // Even if transfer fails, payment success is recorded. 
      // In prod, we'd save "Pending Fulfillment" status in DB and retry.
      throw new BadRequestException(`Payment verified but Transfer failed: ${e.message}`);
    }
  }

  async initiatePayout(user: User, amount: string, accountDetails: any) {
    this.logger.log(`Initiating payout of ${amount} XLM for ${user.username}`);

    // DEDUCT XLM FROM USER (Send to Admin)
    try {
      const adminKeypair = Keypair.fromSecret(this.adminSecret);
      const adminPublicKey = adminKeypair.publicKey();

      this.logger.log(`Transferring ${amount} XLM from ${user.username} to Admin (${adminPublicKey})...`);
      const txHash = await this.usersService.sendPublic(user._id.toString(), adminPublicKey, amount, 'native');
      this.logger.log(`Deduction successful: ${txHash}`);

      // Mock Payout for Razorpay (requires Payouts account)
      return {
        status: 'PENDING',
        message: 'Payout initiated. XLM deducted. Funds will be credited to your bank account shortly.',
        txHash: txHash,
        payoutId: `payout_${Date.now()}`
      };
    } catch (e: any) {
      this.logger.error('Payout failed during XLM deduction', e);
      throw new BadRequestException(`Payout failed: ${e.message}`);
    }
  }
}
