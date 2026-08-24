import type { InformationAcquisitionSelectionV1 } from "@/lib/trader/intelligence/information-inquiry/contracts-v1";
import {
  MarketDataGateway,
  type GatewayPollResult,
} from "@/lib/trader/market-data/market-data-gateway";
import { BTC_USDT } from "@/lib/trader/intelligence/types";
import { EXPAND_MIN_BARS } from "@/lib/trader/market-data/fixture-bar-replay-source";
import type {
  BarPollSource,
  HtxBarPollOptions,
  MarketSnapshot,
} from "@/lib/trader/market-data/types";
import type { FusedMarketContext } from "@/lib/trader/market-data/observation-types";

export const DEFAULT_HTX_POLL_CYCLE_ID_PREFIX = "htx-poll";
export const DEFAULT_HTX_KLINE_SIZE = 25;
export const DEFAULT_HTX_KLINE_PERIOD = "1min";

export class HtxBarPollSource implements BarPollSource {
  private readonly gateway: MarketDataGateway;
  private readonly cycleIdPrefix: string;
  private lastFusedContext: FusedMarketContext | undefined;

  constructor(options: HtxBarPollOptions = {}) {
    this.gateway = new MarketDataGateway({
      internalSymbol: options.internalSymbol ?? BTC_USDT,
      htxRestHost: options.restHost,
      fetchImpl: options.fetchImpl,
      disableOptionalProviders: options.disableOptionalProviders ?? false,
      coingeckoApiKey: process.env.COINGECKO_API_KEY,
    });
    this.cycleIdPrefix = options.cycleIdPrefix ?? DEFAULT_HTX_POLL_CYCLE_ID_PREFIX;
  }

  getFusedContext(): FusedMarketContext | undefined {
    return this.lastFusedContext;
  }

  reset(): void {
    this.gateway.reset();
    this.lastFusedContext = undefined;
  }

  async fetchSnapshot(): Promise<MarketSnapshot> {
    const bundle = await this.gateway.pollEvaluationBundle({
      cycleIdPrefix: this.cycleIdPrefix,
    });

    if (bundle.snapshot.bars.length < EXPAND_MIN_BARS) {
      throw new Error(
        `[market-data] gateway poll returned ${bundle.snapshot.bars.length} bars; need at least ${EXPAND_MIN_BARS}`,
      );
    }

    this.lastFusedContext = bundle.fusedContext;
    return bundle.snapshot;
  }

  async fetchEvaluationBundle(): Promise<{
    snapshot: MarketSnapshot;
    fusedContext: FusedMarketContext;
  }> {
    const bundle = await this.gateway.pollEvaluationBundle({
      cycleIdPrefix: this.cycleIdPrefix,
    });
    this.lastFusedContext = bundle.fusedContext;
    return {
      snapshot: bundle.snapshot,
      fusedContext: bundle.fusedContext,
    };
  }

  async fetchMandatoryEvaluationBundle(): Promise<GatewayPollResult> {
    const bundle = await this.gateway.pollEvaluationBundle({
      cycleIdPrefix: this.cycleIdPrefix,
    });
    this.lastFusedContext = bundle.fusedContext;
    return bundle;
  }

  async fetchSelectedEvaluationBundle(input: {
    mandatoryBundle: GatewayPollResult;
    selection: InformationAcquisitionSelectionV1;
  }): Promise<GatewayPollResult> {
    const bundle = await this.gateway.acquireSelectedInformation(input);
    this.lastFusedContext = bundle.fusedContext;
    return bundle;
  }
}
