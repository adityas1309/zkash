import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CreateOfferDto, OfferQueryDto, UpdateOfferDto } from './dto/offer.dto';
import { Offer } from '../schemas/offer.schema';
import { Swap } from '../schemas/swap.schema';

interface OfferDocumentView {
  _id: Types.ObjectId;
  merchantId: {
    _id: Types.ObjectId;
    username?: string;
    reputation?: number;
  };
  assetIn: 'USDC' | 'XLM';
  assetOut: 'USDC' | 'XLM';
  rate: number;
  min: number;
  max: number;
  active: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface OfferMetrics {
  openRequests: number;
  activeExecutions: number;
  completedSwaps: number;
  failedSwaps: number;
  recentCompletedSwaps: number;
  averageTicketSize: number;
  completionRate: number;
  lastTradedAt: string | null;
}

export interface MerchantMetricsView {
  completedAsSeller: number;
  failedAsSeller: number;
  pendingAsSeller: number;
  activeAsSeller: number;
  routedThroughThisOffer: number;
  completionRate: number;
  lastCompletedAt: string | null;
}

export interface PairMetricsView {
  activeOffers: number;
  pairOpenRequests: number;
  pairCompletedSwaps: number;
  rateWindow: {
    min: number;
    max: number;
  };
}

export interface RequestGuidanceView {
  confidenceScore: number;
  backlogLevel: 'light' | 'moderate' | 'heavy';
  recommendedMode: 'public' | 'private';
  notes: string[];
}

export interface ExecutionModeView {
  mode: 'public' | 'private';
  label: string;
  detail: string;
}

export interface EnrichedOffer {
  _id: Types.ObjectId;
  merchantId: OfferDocumentView['merchantId'];
  assetIn: 'USDC' | 'XLM';
  assetOut: 'USDC' | 'XLM';
  rate: number;
  min: number;
  max: number;
  active: boolean;
  createdAt?: Date;
  updatedAt?: Date;
  executionModes: ExecutionModeView[];
  merchantMetrics: MerchantMetricsView;
  offerMetrics: OfferMetrics;
  requestGuidance: RequestGuidanceView;
}

export interface OfferInsightsView {
  offerId: Types.ObjectId;
  merchant: {
    id: Types.ObjectId;
    username?: string;
    reputation: number | null;
  };
  pricing: {
    rate: number;
    min: number;
    max: number;
    spreadBand: string;
  };
  merchantMetrics: MerchantMetricsView;
  offerMetrics: OfferMetrics;
  pairMetrics: PairMetricsView;
  requestGuidance: RequestGuidanceView;
  flowExpectations: {
    public: string;
    private: string;
  };
}

@Injectable()
export class OffersService {
  constructor(
    @InjectModel(Offer.name) private offerModel: Model<Offer>,
    @InjectModel(Swap.name) private swapModel: Model<Swap>,
  ) {}

  async create(merchantId: Types.ObjectId, data: CreateOfferDto) {
    this.validateOfferPayload(data);
    return this.offerModel.create({ merchantId, ...data });
  }

  async findAll(query: OfferQueryDto | boolean = {}) {
    const mongoQuery = typeof query === 'boolean' ? { active: query } : this.buildOfferQuery(query);
    const offers = await this.offerModel
      .find(mongoQuery)
      .populate('merchantId', 'username reputation')
      .sort({ updatedAt: -1, createdAt: -1 })
      .lean()
      .exec();

    return Promise.all(offers.map((offer) => this.enrichOffer(offer as unknown as OfferDocumentView)));
  }

  async findById(id: string) {
    const offer = await this.offerModel
      .findById(id)
      .populate('merchantId', 'username reputation')
      .lean()
      .exec();

    if (!offer) {
      return null;
    }

    return this.enrichOffer(offer as unknown as OfferDocumentView);
  }

  async getOfferInsights(id: string) {
    const offer = await this.offerModel
      .findById(id)
      .populate('merchantId', 'username reputation')
      .lean()
      .exec();

    if (!offer) {
      throw new NotFoundException('Offer not found');
    }

    return this.buildOfferInsights(offer as unknown as OfferDocumentView);
  }

  async getMarketHighlights() {
    const activeOffers = await this.offerModel.countDocuments({ active: true }).exec();
    const [openRequests, proofsReady, executing, completedLastWeek] = await Promise.all([
      this.swapModel.countDocuments({ status: 'requested' }).exec(),
      this.swapModel.countDocuments({ status: 'proofs_ready' }).exec(),
      this.swapModel.countDocuments({ status: 'executing' }).exec(),
      this.swapModel.countDocuments({
        status: 'completed',
        completedAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      }).exec(),
    ]);

    return {
      activeOffers,
      openRequests,
      proofsReady,
      executing,
      completedLastWeek,
      executionModes: [
        {
          mode: 'public',
          detail: 'Seller signs the direct Stellar payments once both sides are ready.',
        },
        {
          mode: 'private',
          detail: 'Both parties submit exact-value proofs before the shielded swap executes.',
        },
      ],
    };
  }

  async update(id: string, data: UpdateOfferDto) {
    this.validateOfferPayload(data, true);
    return this.offerModel.findByIdAndUpdate(id, data, { new: true }).exec();
  }

  private buildOfferQuery(query: OfferQueryDto) {
    const mongoQuery: Record<string, unknown> = { active: true };

    if (query.assetIn) {
      mongoQuery.assetIn = query.assetIn;
    }
    if (query.assetOut) {
      mongoQuery.assetOut = query.assetOut;
    }
    if (query.amount !== undefined) {
      mongoQuery.min = { $lte: query.amount };
      mongoQuery.max = { $gte: query.amount };
    }

    return mongoQuery;
  }

  private validateOfferPayload(
    data: Partial<CreateOfferDto> & Partial<UpdateOfferDto> & { assetIn?: 'USDC' | 'XLM'; assetOut?: 'USDC' | 'XLM' },
    partial = false,
  ) {
    const assetIn = data.assetIn;
    const assetOut = data.assetOut;
    if (assetIn && assetOut && assetIn === assetOut) {
      throw new BadRequestException('assetIn and assetOut must be different');
    }

    const min = data.min;
    const max = data.max;
    if (min !== undefined && max !== undefined && max < min) {
      throw new BadRequestException('max must be greater than or equal to min');
    }

    if (!partial && (min === undefined || max === undefined)) {
      throw new BadRequestException('min and max are required');
    }
  }

  private async enrichOffer(offer: OfferDocumentView) {
    const [merchantMetrics, offerMetrics] = await Promise.all([
      this.getMerchantMetrics(offer.merchantId?._id, offer._id),
      this.getOfferMetrics(offer._id),
    ]);

    return {
      _id: offer._id,
      merchantId: offer.merchantId,
      assetIn: offer.assetIn,
      assetOut: offer.assetOut,
      rate: offer.rate,
      min: offer.min,
      max: offer.max,
      active: offer.active,
      createdAt: offer.createdAt,
      updatedAt: offer.updatedAt,
      executionModes: this.getExecutionModes(),
      merchantMetrics,
      offerMetrics,
      requestGuidance: this.buildRequestGuidance(offer, merchantMetrics, offerMetrics),
    };
  }

  private async buildOfferInsights(offer: OfferDocumentView) {
    const [merchantMetrics, offerMetrics, pairMetrics] = await Promise.all([
      this.getMerchantMetrics(offer.merchantId?._id, offer._id),
      this.getOfferMetrics(offer._id),
      this.getPairMetrics(offer.assetIn, offer.assetOut),
    ]);

    return {
      offerId: offer._id,
      merchant: {
        id: offer.merchantId?._id,
        username: offer.merchantId?.username,
        reputation: offer.merchantId?.reputation ?? null,
      },
      pricing: {
        rate: offer.rate,
        min: offer.min,
        max: offer.max,
        spreadBand: this.describeSpreadBand(offer.rate),
      },
      merchantMetrics,
      offerMetrics,
      pairMetrics,
      requestGuidance: this.buildRequestGuidance(offer, merchantMetrics, offerMetrics),
      flowExpectations: {
        public:
          'Public execution keeps both legs visible on-chain and depends on the seller submitting the settlement transaction.',
        private:
          'Private execution requires exact-value notes from both sides and may pause while the canonical indexer catches up.',
      },
    };
  }

  private async getMerchantMetrics(merchantId: Types.ObjectId, offerId: Types.ObjectId): Promise<MerchantMetricsView> {
    const [completedAsSeller, failedAsSeller, pendingAsSeller, activeAsSeller, recentCompletedDocs] =
      await Promise.all([
        this.swapModel.countDocuments({ bobId: merchantId, status: 'completed' }).exec(),
        this.swapModel.countDocuments({ bobId: merchantId, status: 'failed' }).exec(),
        this.swapModel.countDocuments({ bobId: merchantId, status: 'requested' }).exec(),
        this.swapModel
          .countDocuments({
            bobId: merchantId,
            status: { $in: ['proofs_pending', 'proofs_ready', 'executing'] },
          })
          .exec(),
        this.swapModel
          .find({ bobId: merchantId, status: 'completed' })
          .sort({ completedAt: -1 })
          .limit(5)
          .select('completedAt offerId amountIn amountOut')
          .lean()
          .exec(),
      ]);

    const routedThroughThisOffer = recentCompletedDocs.filter(
      (swap) => swap.offerId?.toString() === offerId.toString(),
    ).length;
    const lastCompleted = recentCompletedDocs.find((swap) => !!swap.completedAt)?.completedAt ?? null;
    const totalOutcomes = completedAsSeller + failedAsSeller;

    return {
      completedAsSeller,
      failedAsSeller,
      pendingAsSeller,
      activeAsSeller,
      routedThroughThisOffer,
      completionRate: totalOutcomes > 0 ? Number(((completedAsSeller / totalOutcomes) * 100).toFixed(1)) : 100,
      lastCompletedAt: lastCompleted ? new Date(lastCompleted).toISOString() : null,
    };
  }

  private async getOfferMetrics(offerId: Types.ObjectId): Promise<OfferMetrics> {
    const [openRequests, activeExecutions, completedSwaps, failedSwaps, recentCompletedDocs] = await Promise.all([
      this.swapModel.countDocuments({ offerId, status: 'requested' }).exec(),
      this.swapModel
        .countDocuments({
          offerId,
          status: { $in: ['proofs_pending', 'proofs_ready', 'executing'] },
        })
        .exec(),
      this.swapModel.countDocuments({ offerId, status: 'completed' }).exec(),
      this.swapModel.countDocuments({ offerId, status: 'failed' }).exec(),
      this.swapModel
        .find({ offerId, status: 'completed' })
        .sort({ completedAt: -1 })
        .select('amountIn amountOut completedAt')
        .lean()
        .exec(),
    ]);

    const recentCompletedSwaps = recentCompletedDocs.filter((swap) => {
      if (!swap.completedAt) {
        return false;
      }
      return Date.now() - new Date(swap.completedAt).getTime() <= 7 * 24 * 60 * 60 * 1000;
    }).length;

    const averageTicketSize =
      recentCompletedDocs.length > 0
        ? Number(
            (
              recentCompletedDocs.reduce((sum, swap) => sum + (Number(swap.amountIn) || 0), 0) /
              recentCompletedDocs.length
            ).toFixed(4),
          )
        : 0;
    const totalOutcomes = completedSwaps + failedSwaps;

    return {
      openRequests,
      activeExecutions,
      completedSwaps,
      failedSwaps,
      recentCompletedSwaps,
      averageTicketSize,
      completionRate: totalOutcomes > 0 ? Number(((completedSwaps / totalOutcomes) * 100).toFixed(1)) : 100,
      lastTradedAt: recentCompletedDocs[0]?.completedAt
        ? new Date(recentCompletedDocs[0].completedAt).toISOString()
        : null,
    };
  }

  private async getPairMetrics(assetIn: 'USDC' | 'XLM', assetOut: 'USDC' | 'XLM'): Promise<PairMetricsView> {
    const pairOffers = await this.offerModel.find({ assetIn, assetOut, active: true }).lean().exec();
    const offerIds = pairOffers.map((offer) => offer._id);

    const [pairOpenRequests, pairCompletedSwaps] = offerIds.length
      ? await Promise.all([
          this.swapModel.countDocuments({ offerId: { $in: offerIds }, status: 'requested' }).exec(),
          this.swapModel.countDocuments({ offerId: { $in: offerIds }, status: 'completed' }).exec(),
        ])
      : [0, 0];

    const rateValues = pairOffers.map((offer) => Number(offer.rate) || 0).filter((value) => value > 0);
    const minRate = rateValues.length ? Math.min(...rateValues) : 0;
    const maxRate = rateValues.length ? Math.max(...rateValues) : 0;

    return {
      activeOffers: pairOffers.length,
      pairOpenRequests,
      pairCompletedSwaps,
      rateWindow: {
        min: minRate,
        max: maxRate,
      },
    };
  }

  private buildRequestGuidance(
    offer: OfferDocumentView,
    merchantMetrics: MerchantMetricsView,
    offerMetrics: OfferMetrics,
  ): RequestGuidanceView {
    const confidenceScore = Math.max(
      5,
      Math.min(
        99,
        Math.round(
          merchantMetrics.completionRate * 0.55 +
            offerMetrics.completionRate * 0.25 +
            Math.min(offerMetrics.completedSwaps * 3, 20),
        ),
      ),
    );

    const backlogLevel =
      offerMetrics.openRequests >= 5
        ? 'heavy'
        : offerMetrics.openRequests >= 2
          ? 'moderate'
          : 'light';

    return {
      confidenceScore,
      backlogLevel,
      recommendedMode:
        offerMetrics.activeExecutions > 0 || offerMetrics.openRequests > 0 ? 'private' : 'public',
      notes: [
        backlogLevel === 'heavy'
          ? 'This offer already has a busy request queue. Expect the seller to process in batches.'
          : 'Request backlog is low, so seller response time should be easier to manage.',
        merchantMetrics.completedAsSeller > 0
          ? 'This seller has completed swaps before, which gives you a stronger execution signal than a fresh listing.'
          : 'This seller does not yet have completed swap history on record, so treat the first request as a trust-building trade.',
        offer.assetIn === 'XLM'
          ? 'You will fund the request in XLM terms, and the final USDC amount depends on the listed rate.'
          : 'You will fund the request in USDC terms, and the private path requires an exact-value shielded note if you toggle privacy on.',
      ],
    };
  }

  private getExecutionModes(): ExecutionModeView[] {
    return [
      {
        mode: 'public',
        label: 'Public settlement',
        detail: 'Seller executes both legs directly with Stellar payments after acceptance.',
      },
      {
        mode: 'private',
        label: 'Private shielded settlement',
        detail: 'Both parties need exact-value proofs before the anonymous swap can execute.',
      },
    ];
  }

  private describeSpreadBand(rate: number) {
    if (rate < 0.5) {
      return 'deep discount';
    }
    if (rate < 1) {
      return 'below parity';
    }
    if (rate <= 1.5) {
      return 'balanced range';
    }
    return 'premium range';
  }
}
