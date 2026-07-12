import { createHash } from "node:crypto";

import { computeReplayReproContentDigest } from "@/lib/trader/research/replay-repro-digest";
import type { StreamingEvidenceReader } from "@/lib/trader/backtest/streaming-evidence";
import type { FusedMarketContext } from "@/lib/trader/market-data/observation-types";
import { countM9InputCycles, iterateM9Cycles } from "@/lib/trader/research/m9-projection-source";
import type { PaperCycleResult } from "@/lib/trader/paper/paper-cycle.types";
import {
  MARKET_DATA_PROVIDER_IDS,
  type MarketDataProviderId,
  type NormalizedObservationKind,
} from "@/lib/trader/market-data/observation-types";
import type { ReplayProviderSidecar } from "@/lib/trader/market-data/replay/provider-sidecar-types";
import { isReplayProviderSidecarV2 } from "@/lib/trader/market-data/replay/provider-sidecar-types";
import { computeSidecarContentDigest } from "@/lib/trader/market-data/replay/sidecar-content-digest";

export const M9_PROVIDER_FUSION_SCHEMA_VERSION = "m9_provider_fusion_v1" as const;

export type ProviderInfluenceClass = "DECISION_INFLUENTIAL" | "DEFERRED_PR3";

export type ProviderInfluenceStage =
  | "CAPTURED"
  | "NORMALIZED"
  | "FUSED"
  | "UNDERSTANDING_COVERAGE"
  | "DECISION_INFLUENTIAL";

export type ProviderInfluenceTrace = {
  reachedStages: ProviderInfluenceStage[];
  influenceClass: ProviderInfluenceClass;
  stopReason: string | null;
};

export type ProviderCoverageMatrixRow = {
  providerId: MarketDataProviderId;
  captured: boolean;
  normalized: boolean;
  freshnessClass: "FRESH" | "DEGRADED" | "STALE" | "NONE";
  health: string;
  fusedCycleCount: number;
  decisionReachable: boolean;
  influenceClass: ProviderInfluenceClass;
  unavailable: boolean;
  futureExcludedCount: number;
  coveragePct: number;
  influence: ProviderInfluenceTrace;
};

export type M9ProviderFusionExport = {
  schemaVersion: typeof M9_PROVIDER_FUSION_SCHEMA_VERSION;
  generatedAt: string;
  organizationId: string;
  strategyId: string;
  strategyVersion: string;
  instrumentId: string;
  sidecarSchemaVersion: string | null;
  sidecarContentDigest: string | null;
  captureAsOfUtc: string | null;
  sampleCycleCount: number;
  coverageMatrix: ProviderCoverageMatrixRow[];
  laneSummary: {
    macroEvidenceCount: number;
    newsEvidenceCount: number;
    blockchainEvidenceCount: number;
    regulatoryEvidenceCount: number;
    protocolEvidenceCount: number;
    degradationReasonCount: number;
  };
  truthfulnessGuards: {
    presentNotFusedViolations: number;
    htxSupremacyMaintained: boolean;
    pr3BoundaryLocked: boolean;
  };
  contentDigest: string;
};

const DECISION_INFLUENTIAL_KINDS = new Set<NormalizedObservationKind>([
  "ohlcv_bar",
  "quote_l1",
  "order_book_snapshot",
  "market_trades_snapshot",
  "cross_exchange_confirmation",
  "fear_greed_index",
  "global_market_stats",
]);

const PROVIDER_KIND_MAP: Partial<Record<MarketDataProviderId, NormalizedObservationKind[]>> = {
  htx_spot: ["ohlcv_bar", "quote_l1", "order_book_snapshot", "market_trades_snapshot"],
  binance_public: ["cross_exchange_confirmation"],
  bybit_public: ["cross_exchange_confirmation"],
  alternative_me: ["fear_greed_index"],
  coingecko_global: ["global_market_stats"],
  fred: ["macro_series"],
  federal_reserve: ["macro_calendar_event"],
  cme_fedwatch: ["macro_probability"],
  coindesk_rss: ["news_headline"],
  cointelegraph_rss: ["news_headline"],
  decrypt_rss: ["news_headline"],
  gdelt: ["news_event_cluster"],
  binance_announcements: ["exchange_announcement"],
  htx_announcements: ["exchange_announcement"],
  bybit_announcements: ["exchange_announcement"],
  github_releases: ["protocol_release"],
  infura_rpc: ["blockchain_network_stats"],
  trongrid_intelligence: ["blockchain_network_stats"],
  mempool_space: ["mempool_stats"],
  sec_edgar: ["regulatory_filing"],
};

function influenceClassForKinds(kinds: NormalizedObservationKind[]): ProviderInfluenceClass {
  return kinds.some((kind) => DECISION_INFLUENTIAL_KINDS.has(kind))
    ? "DECISION_INFLUENTIAL"
    : "DEFERRED_PR3";
}

function collectObservations(
  fused: FusedMarketContext,
): import("@/lib/trader/market-data/observation-types").NormalizedObservation[] {
  return [
    ...Object.values(fused.mtfBars).flat(),
    fused.primaryQuote,
    fused.orderBookSnapshot,
    fused.marketTradesSnapshot,
    fused.crossExchangeConfirmation,
    fused.fearGreed,
    fused.globalMarket,
    ...(fused.macroEvidence ?? []),
    ...(fused.newsEvidence ?? []),
    ...(fused.blockchainEvidence ?? []),
    ...(fused.regulatoryEvidence ?? []),
    ...(fused.protocolEvidence ?? []),
  ].filter(
    (obs): obs is import("@/lib/trader/market-data/observation-types").NormalizedObservation =>
      obs !== undefined,
  );
}

function freshnessClassFromObservation(
  obs: import("@/lib/trader/market-data/observation-types").NormalizedObservation,
): ProviderCoverageMatrixRow["freshnessClass"] {
  if (obs.health === "UNAVAILABLE") {
    return "NONE";
  }
  if (obs.health === "STALE") {
    return "STALE";
  }
  if (obs.health === "DEGRADED" || obs.freshnessMs > 60_000) {
    return "DEGRADED";
  }
  return "FRESH";
}

function buildInfluenceTrace(input: {
  influenceClass: ProviderInfluenceClass;
  captured: boolean;
  normalized: boolean;
  fused: boolean;
  decisionReachable: boolean;
}): ProviderInfluenceTrace {
  const reachedStages: ProviderInfluenceStage[] = [];
  if (input.captured) {
    reachedStages.push("CAPTURED");
  }
  if (input.normalized) {
    reachedStages.push("NORMALIZED");
  }
  if (input.fused) {
    reachedStages.push("FUSED");
  }
  if (input.fused && input.influenceClass === "DEFERRED_PR3") {
    reachedStages.push("UNDERSTANDING_COVERAGE");
  }
  if (input.decisionReachable) {
    reachedStages.push("DECISION_INFLUENTIAL");
  }

  const stopReason =
    input.influenceClass === "DEFERRED_PR3"
      ? "PR3_BOUNDARY_CONTEXT_LANE"
      : input.decisionReachable
        ? null
        : "NOT_DECISION_REACHABLE";

  return {
    reachedStages,
    influenceClass: input.influenceClass,
    stopReason,
  };
}

export function buildProviderCoverageMatrix(input: {
  fusedSamples: readonly FusedMarketContext[];
  providerSidecar?: ReplayProviderSidecar;
}): ProviderCoverageMatrixRow[] {
  const perProvider = new Map<
    MarketDataProviderId,
    {
      fusedCycleCount: number;
      healths: Set<string>;
      freshnessClasses: Set<string>;
      futureExcludedCount: number;
      kinds: Set<NormalizedObservationKind>;
    }
  >();

  for (const fused of input.fusedSamples) {
    for (const obs of collectObservations(fused)) {
      const providerId = obs.provenance.providerId;
      const entry = perProvider.get(providerId) ?? {
        fusedCycleCount: 0,
        healths: new Set<string>(),
        freshnessClasses: new Set<string>(),
        futureExcludedCount: 0,
        kinds: new Set<NormalizedObservationKind>(),
      };
      entry.kinds.add(obs.kind);
      entry.healths.add(obs.health);
      entry.freshnessClasses.add(freshnessClassFromObservation(obs));
      if (obs.health !== "UNAVAILABLE") {
        entry.fusedCycleCount += 1;
      }
      if (obs.payload.reason === "FUTURE_EVIDENCE_EXCLUDED") {
        entry.futureExcludedCount += 1;
      }
      perProvider.set(providerId, entry);
    }
  }

  const captureOutcomes =
    input.providerSidecar && isReplayProviderSidecarV2(input.providerSidecar)
      ? input.providerSidecar.captureOutcomes
      : undefined;

  return MARKET_DATA_PROVIDER_IDS.map((providerId) => {
    const expectedKinds = PROVIDER_KIND_MAP[providerId] ?? [];
    const observed = perProvider.get(providerId);
    const influenceClass = influenceClassForKinds(observed ? [...observed.kinds] : expectedKinds);
    const captureOutcome = captureOutcomes?.[providerId];
    const captured = captureOutcome === "CAPTURED_HEALTHY";
    const normalized = captured || (observed?.kinds.size ?? 0) > 0;
    const fused = (observed?.fusedCycleCount ?? 0) > 0;
    const unavailable = !fused && (captureOutcome === "UNAVAILABLE" || !captureOutcome);
    const decisionReachable = influenceClass === "DECISION_INFLUENTIAL" && fused && captured;
    const coveragePct = captured && fused ? 100 : captured ? 50 : fused ? 25 : 0;

    const freshnessClass =
      observed && observed.freshnessClasses.size > 0
        ? ([...observed.freshnessClasses].sort()[0] as ProviderCoverageMatrixRow["freshnessClass"])
        : "NONE";

    return {
      providerId,
      captured,
      normalized,
      freshnessClass,
      health: observed ? [...observed.healths].sort().join("|") : "NONE",
      fusedCycleCount: observed?.fusedCycleCount ?? 0,
      decisionReachable,
      influenceClass,
      unavailable,
      futureExcludedCount: observed?.futureExcludedCount ?? 0,
      coveragePct,
      influence: buildInfluenceTrace({
        influenceClass,
        captured,
        normalized,
        fused,
        decisionReachable,
      }),
    };
  });
}

/**
 * Content digest excluding `generatedAt` (identity/provenance, not content — DEE-397 /
 * ADR-0021), so two replays over identical inputs produce an identical digest.
 */
export function computeProviderFusionContentDigest(
  exportDoc: Omit<M9ProviderFusionExport, "contentDigest">,
): string {
  return computeReplayReproContentDigest(exportDoc);
}

export function buildM9ProviderFusionExport(input: {
  organizationId: string;
  strategyId: string;
  strategyVersion: string;
  instrumentId: string;
  fusedSamples?: readonly FusedMarketContext[];
  cycleResults?: readonly PaperCycleResult[];
  projectionReader?: StreamingEvidenceReader;
  providerSidecar?: ReplayProviderSidecar;
  generatedAt?: string;
}): M9ProviderFusionExport {
  const fusedSamples =
    input.fusedSamples ??
    [...iterateM9Cycles(input)]
      .map((cycle) => cycle.evaluation.fusedContext)
      .filter((fused): fused is FusedMarketContext => fused !== undefined);

  const coverageMatrix = buildProviderCoverageMatrix({
    fusedSamples,
    providerSidecar: input.providerSidecar,
  });

  const sample = fusedSamples[0];
  const laneSummary = {
    macroEvidenceCount: sample?.macroEvidence?.length ?? 0,
    newsEvidenceCount: sample?.newsEvidence?.length ?? 0,
    blockchainEvidenceCount: sample?.blockchainEvidence?.length ?? 0,
    regulatoryEvidenceCount: sample?.regulatoryEvidence?.length ?? 0,
    protocolEvidenceCount: sample?.protocolEvidence?.length ?? 0,
    degradationReasonCount: sample?.degradationReasons.length ?? 0,
  };

  const sidecarContentDigest = input.providerSidecar
    ? computeSidecarContentDigest(input.providerSidecar)
    : null;

  const truthfulnessGuards = {
    presentNotFusedViolations: coverageMatrix.filter(
      (row) =>
        row.captured && !row.fusedCycleCount && row.influenceClass === "DECISION_INFLUENTIAL",
    ).length,
    htxSupremacyMaintained: fusedSamples.every(
      (fused) => fused.primaryQuote?.provenance.providerId === "htx_spot",
    ),
    pr3BoundaryLocked: coverageMatrix
      .filter((row) => row.influenceClass === "DEFERRED_PR3")
      .every((row) => row.influence.stopReason === "PR3_BOUNDARY_CONTEXT_LANE"),
  };

  const withoutDigest: Omit<M9ProviderFusionExport, "contentDigest"> = {
    schemaVersion: M9_PROVIDER_FUSION_SCHEMA_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    organizationId: input.organizationId,
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    instrumentId: input.instrumentId,
    sidecarSchemaVersion: input.providerSidecar?.schemaVersion ?? null,
    sidecarContentDigest,
    captureAsOfUtc:
      input.providerSidecar && isReplayProviderSidecarV2(input.providerSidecar)
        ? input.providerSidecar.captureAsOfUtc
        : null,
    sampleCycleCount: input.fusedSamples?.length ?? countM9InputCycles(input),
    coverageMatrix,
    laneSummary,
    truthfulnessGuards,
  };

  return {
    ...withoutDigest,
    contentDigest: computeProviderFusionContentDigest(withoutDigest),
  };
}

export function buildM9ProviderCoverageMatrixMarkdown(exportDoc: M9ProviderFusionExport): string {
  const lines = [
    "# M9 Provider Coverage Matrix",
    "",
    `Generated: ${exportDoc.generatedAt}`,
    `Sidecar digest: ${exportDoc.sidecarContentDigest ?? "none"}`,
    "",
  ];

  for (const row of exportDoc.coverageMatrix) {
    lines.push(
      `- **${row.providerId}** — influence=${row.influenceClass}; captured=${row.captured}; fusedCycles=${row.fusedCycleCount}; health=${row.health}; coveragePct=${row.coveragePct}; futureExcluded=${row.futureExcludedCount}; stages=${row.influence.reachedStages.join("→")}`,
    );
  }

  lines.push(
    "",
    "## Truthfulness guards",
    `- presentNotFusedViolations: ${exportDoc.truthfulnessGuards.presentNotFusedViolations}`,
    `- htxSupremacyMaintained: ${exportDoc.truthfulnessGuards.htxSupremacyMaintained}`,
    `- pr3BoundaryLocked: ${exportDoc.truthfulnessGuards.pr3BoundaryLocked}`,
  );

  return `${lines.join("\n")}\n`;
}

export function assertProviderFusionRequirements(exportDoc: M9ProviderFusionExport): void {
  if (exportDoc.truthfulnessGuards.presentNotFusedViolations > 0) {
    throw new Error(
      `[m9] provider fusion guard failed: presentNotFusedViolations=${exportDoc.truthfulnessGuards.presentNotFusedViolations}`,
    );
  }
  if (!exportDoc.truthfulnessGuards.htxSupremacyMaintained) {
    throw new Error("[m9] provider fusion guard failed: HTX supremacy not maintained");
  }
  for (const row of exportDoc.coverageMatrix) {
    if (row.influenceClass !== "DECISION_INFLUENTIAL") {
      continue;
    }
    if (row.fusedCycleCount < 1) {
      throw new Error(
        `[m9] provider fusion guard failed: decision-influential ${row.providerId} not fused in any cycle`,
      );
    }
  }
}

export function computeArtifactFileDigest(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
