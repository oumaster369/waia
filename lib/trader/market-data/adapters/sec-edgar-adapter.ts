import { SecEdgarClient } from "@/lib/trader/connectors/sec-edgar/sec-edgar-client";
import {
  type AdapterFetchContext,
  type MarketDataAdapter,
  timedAdapterFetch,
} from "@/lib/trader/market-data/adapters/market-data-adapter";
import {
  buildProvenanceRef,
  normalizeRegulatoryFilingObservation,
  normalizeUnavailableObservation,
} from "@/lib/trader/market-data/normalization/normalize-observation";
import type { NormalizedObservation } from "@/lib/trader/market-data/observation-types";

const SEC_EDGAR_WATCH_CIK = "0001679788";

export type SecEdgarAdapterConfig = {
  userAgent?: string;
  fetchImpl?: typeof fetch;
};

export class SecEdgarAdapter implements MarketDataAdapter {
  readonly providerId = "sec_edgar" as const;
  private readonly client: SecEdgarClient;

  constructor(config: SecEdgarAdapterConfig = {}) {
    this.client = new SecEdgarClient({
      userAgent: config.userAgent,
      fetchImpl: config.fetchImpl,
    });
  }

  async fetchObservations(context: AdapterFetchContext): Promise<readonly NormalizedObservation[]> {
    const symbol = context.symbol ?? "GLOBAL";
    try {
      const timed = await timedAdapterFetch(() =>
        this.client.listRecentFilings(SEC_EDGAR_WATCH_CIK, 5),
      );
      if (timed.value.length === 0) {
        throw new Error("[sec-edgar] no filings returned");
      }
      return timed.value.map((filing) => {
        const eventTimeUtc = filing.filingDate
          ? `${filing.filingDate}T00:00:00.000Z`
          : context.evaluatedAt;
        return normalizeRegulatoryFilingObservation({
          cik: SEC_EDGAR_WATCH_CIK,
          accessionNumber: filing.accessionNumber,
          form: filing.form,
          filingDate: filing.filingDate,
          provenance: buildProvenanceRef({
            providerId: "sec_edgar",
            venue: "sec_edgar",
            feedKind: "regulatory_filing",
            symbol,
            eventTimeUtc,
          }),
          latencyMs: timed.latencyMs,
          evaluatedAt: context.evaluatedAt,
          eventTimeUtc,
        });
      });
    } catch (error) {
      return [
        normalizeUnavailableObservation({
          kind: "regulatory_filing",
          provenance: buildProvenanceRef({
            providerId: "sec_edgar",
            venue: "sec_edgar",
            feedKind: "regulatory_filing",
            symbol,
            eventTimeUtc: context.evaluatedAt,
          }),
          evaluatedAt: context.evaluatedAt,
          reason: error instanceof Error ? error.message : String(error),
        }),
      ];
    }
  }
}
