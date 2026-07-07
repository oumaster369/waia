import type { InstrumentId } from "@/lib/trader/intelligence/types";
import type {
  MarketDataProviderId,
  NormalizedObservation,
} from "@/lib/trader/market-data/observation-types";

export type AdapterFetchContext = {
  instrumentId?: InstrumentId;
  symbol?: string;
  evaluatedAt: string;
  fetchImpl?: typeof fetch;
};

export interface MarketDataAdapter {
  readonly providerId: MarketDataProviderId;
  fetchObservations(context: AdapterFetchContext): Promise<readonly NormalizedObservation[]>;
}

export async function timedAdapterFetch<T>(
  fn: () => Promise<T>,
): Promise<{ value: T; latencyMs: number }> {
  const started = Date.now();
  const value = await fn();
  return { value, latencyMs: Date.now() - started };
}
