import {
  CANONICAL_EXTERNAL_OBSERVATION_KINDS_V1,
  CANONICAL_PRIMITIVE_OBSERVATION_KINDS_V1,
  DOWNSTREAM_MEASUREMENT_CATEGORIES_V1,
  GATEWAY_PRIMITIVE_DISPOSITION_V1,
} from "@/lib/trader/mi/canonical-observation-v1";
import {
  MARKET_DATA_PROVIDER_IDS,
  NORMALIZED_OBSERVATION_KINDS,
  type MarketDataProviderId,
} from "@/lib/trader/market-data/observation-types";
import { listMarketDataProviders } from "@/lib/trader/market-data/provider-registry";

export const CANONICAL_PROVIDER_PRODUCER_FILES_V1 = {
  htx_spot: [
    "lib/trader/market-data/market-data-gateway.ts",
    "lib/trader/market-data/adapters/htx-depth-adapter.ts",
  ],
  binance_public: ["lib/trader/market-data/market-data-gateway.ts"],
  bybit_public: ["lib/trader/market-data/market-data-gateway.ts"],
  alternative_me: ["lib/trader/market-data/market-data-gateway.ts"],
  coingecko_global: ["lib/trader/market-data/market-data-gateway.ts"],
  fred: ["lib/trader/market-data/adapters/fred-adapter.ts"],
  federal_reserve: ["lib/trader/market-data/adapters/federal-reserve-adapter.ts"],
  cme_fedwatch: ["lib/trader/market-data/adapters/cme-fedwatch-adapter.ts"],
  gdelt: ["lib/trader/market-data/adapters/gdelt-adapter.ts"],
  coindesk_rss: ["lib/trader/market-data/adapters/coindesk-rss-adapter.ts"],
  cointelegraph_rss: ["lib/trader/market-data/adapters/cointelegraph-rss-adapter.ts"],
  decrypt_rss: ["lib/trader/market-data/adapters/decrypt-rss-adapter.ts"],
  binance_announcements: ["lib/trader/market-data/adapters/binance-announcements-adapter.ts"],
  htx_announcements: ["lib/trader/market-data/adapters/htx-announcements-adapter.ts"],
  bybit_announcements: ["lib/trader/market-data/adapters/bybit-announcements-adapter.ts"],
  github_releases: ["lib/trader/market-data/adapters/github-releases-adapter.ts"],
  infura_rpc: ["lib/trader/market-data/adapters/infura-rpc-adapter.ts"],
  trongrid_intelligence: [
    "lib/trader/market-data/adapters/trongrid-intelligence-adapter.ts",
  ],
  mempool_space: ["lib/trader/market-data/adapters/mempool-space-adapter.ts"],
  sec_edgar: ["lib/trader/market-data/adapters/sec-edgar-adapter.ts"],
} as const satisfies Record<MarketDataProviderId, readonly string[]>;

export const CANONICAL_INGRESS_AND_CONSUMER_PATHS_V1 = {
  internalMsv: {
    producer: "lib/trader/mi/record-msv-observation-safe.ts",
    consumer: "lib/trader/mi/observation-service.ts",
    sharedTableReader: "lib/trader/mi/observation-repository-postgres.ts",
    disposition: "CANONICAL_INTERNAL_PRIMITIVE",
    sharedTableDisposition: "INTERNAL_MSV_ONLY_FILTERED",
  },
  normalizedGateway: {
    producer: "lib/trader/market-data/market-data-gateway.ts",
    boundary: "lib/trader/market-data/normalization/gateway-to-canonical-pit.ts",
    consumer: "lib/trader/mi/canonical-pit-service-postgres.ts",
    disposition: "EXPLICIT_RECEIPT_REQUIRED",
  },
  historicalReplay: {
    producer: "lib/trader/market-data/replay/replay-lane-normalizer.ts",
    boundary: "lib/trader/market-data/replay/canonical-pit-replay.ts",
    consumer: "lib/trader/mi/canonical-pit-service-postgres.ts",
    disposition: "SAME_CANONICALIZER_PIT_CUTOFF_REQUIRED",
  },
  persistence: {
    consumer: "lib/trader/mi/canonical-pit-repository-postgres.ts",
    disposition: "SERVICE_ONLY_APPEND_ONLY",
  },
  inertMeasurementLineage: {
    contract: "lib/trader/mi/measurement-lineage-v1.ts",
    consumer: "lib/trader/mi/canonical-pit-repository-postgres.ts",
    disposition: "IDENTITY_AND_LINEAGE_ONLY",
  },
} as const;

export const CANONICAL_NON_PERSISTENCE_PATHS_V1 = [
  {
    path: "lib/trader/market-data/capture/capture-provider-snapshot.ts",
    disposition: "RAW_CAPTURE_NOT_CANONICAL_OBSERVATION",
  },
  {
    path: "lib/trader/market-data/fusion/context-fusion-v1.ts",
    disposition: "FUSED_CONTEXT_NOT_CANONICAL_PERSISTENCE",
  },
  {
    path: "lib/trader/market-data/replay/historical-ingress-gateway.ts",
    disposition: "FUSED_REPLAY_CONTEXT_NOT_CANONICAL_PERSISTENCE",
  },
  {
    path: "lib/trader/market-data/replay-fused-context-builder.ts",
    disposition: "FUSED_REPLAY_CONTEXT_NOT_CANONICAL_PERSISTENCE",
  },
] as const;

export const CANONICAL_FORBIDDEN_DOWNSTREAM_AUTHORITY_SEGMENTS_V1 = [
  "/forecast/",
  "/decision/",
  "/intelligence/forecast",
  "/intelligence/decision",
  "/risk/",
  "/execution/",
  "/reality/",
  "/holdout/",
  "/live/",
] as const;

export function auditCanonicalSourceConsumerInventoryV1(): string[] {
  const errors: string[] = [];
  const dispositionKinds = Object.keys(GATEWAY_PRIMITIVE_DISPOSITION_V1).sort();
  if (
    JSON.stringify(dispositionKinds) !== JSON.stringify([...NORMALIZED_OBSERVATION_KINDS].sort())
  ) {
    errors.push("NORMALIZED_KIND_DISPOSITION_MISMATCH");
  }

  const providers = listMarketDataProviders();
  if (
    JSON.stringify(providers.map((provider) => provider.id).sort()) !==
    JSON.stringify([...MARKET_DATA_PROVIDER_IDS].sort())
  ) {
    errors.push("PROVIDER_REGISTRY_MISMATCH");
  }
  for (const provider of providers) {
    if (!CANONICAL_PROVIDER_PRODUCER_FILES_V1[provider.id]?.length) {
      errors.push(`PROVIDER_PRODUCER_UNMAPPED:${provider.id}`);
    }
    for (const kind of provider.kinds) {
      if (!GATEWAY_PRIMITIVE_DISPOSITION_V1[kind]) {
        errors.push(`PROVIDER_KIND_UNMAPPED:${provider.id}:${kind}`);
      }
    }
  }

  const producerKinds = new Set(providers.flatMap((provider) => provider.kinds));
  for (const kind of CANONICAL_EXTERNAL_OBSERVATION_KINDS_V1) {
    if (!producerKinds.has(kind)) errors.push(`ADMITTED_KIND_HAS_NO_PRODUCER:${kind}`);
  }
  if (
    CANONICAL_PRIMITIVE_OBSERVATION_KINDS_V1[0] !== "msv_envelope" ||
    CANONICAL_INGRESS_AND_CONSUMER_PATHS_V1.internalMsv.disposition !==
      "CANONICAL_INTERNAL_PRIMITIVE"
  ) {
    errors.push("INTERNAL_MSV_PATH_UNMAPPED");
  }
  for (const category of DOWNSTREAM_MEASUREMENT_CATEGORIES_V1) {
    const disposition = GATEWAY_PRIMITIVE_DISPOSITION_V1[category];
    if (
      disposition.disposition !== "EXCLUDED_UNMODELED" ||
      disposition.downstreamMeasurementCategory !== category
    ) {
      errors.push(`MEASUREMENT_CATEGORY_PRIMITIVE_LEAK:${category}`);
    }
  }
  return errors;
}
