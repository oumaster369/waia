import { createHash } from "node:crypto";
import type { HistoricalIntelligenceProfile } from "@/lib/trader/intelligence/historical-profile/historical-profile.types";
import {
  HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1,
  HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1_DIGEST,
} from "@/lib/trader/intelligence/historical-profile/htr-historical-intelligence-profile-v1";
import type { MarketHypothesis } from "@/lib/trader/intelligence/hypothesis/hypothesis.types";
import { deriveHypothesisRecordId } from "@/lib/trader/intelligence/hypothesis/hypothesis-link";
import type { DecisionChain, MarketStateSnapshot } from "@/lib/trader/intelligence/mi-core.types";
import { TIMEFRAME_EVIDENCE_LANE_AUTHORITY_MATRIX_V1_DIGEST } from "@/lib/trader/intelligence/matrix/timeframe-evidence-lane-authority-matrix-v1";
import {
  CYCLE_ENVELOPE_SCHEMA_VERSION,
  CONVICTION_RECORD_SCHEMA_VERSION,
  HYPOTHESIS_RECORD_SCHEMA_VERSION,
  type IntelligenceCycleBundle,
  type TraderIntelligenceConvictionRecord,
  type TraderIntelligenceCycleEnvelopeRecord,
  type TraderIntelligenceHypothesisRecord,
} from "@/lib/trader/intelligence/records/intelligence-records.types";
import type { IntelligenceCycleBundleRepository } from "@/lib/trader/intelligence/records/repository-adapters";
import { persistIntelligenceCycleBundle } from "@/lib/trader/intelligence/records/atomic-cycle-bundle-repository-postgres";
import {
  buildEvidenceDigest,
  buildHypothesisLinkDigestInput,
  buildThesisDigest,
  canonicalDecimalFromNumber,
  computeConvictionRecordContentDigest,
  computeCycleEnvelopeContentDigest,
  computeHypothesisRecordContentDigest,
  deriveConvictionRecordId,
  deriveCycleEnvelopeId,
  sortHypothesesByTypeCodePoint,
} from "@/lib/trader/intelligence/records/serialize-intelligence-records";
import { resolveUniversalTerminalReason } from "@/lib/trader/intelligence/terminal-reason/universal-terminal-reason";
import { canonicalizeSemanticJsonString } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";
import { parseCanonicalCausalLineageV1 } from "@/lib/trader/intelligence/causal-lineage/canonical-causal-lineage-v1";

export type BuildIntelligenceCycleBundleInput = Readonly<{
  organizationId: string;
  runId: string;
  cycleId: string;
  symbol: string;
  accountId: string | null;
  analyticalTimeframe: string;
  marketStateSnapshot: MarketStateSnapshot;
  decisionChain: DecisionChain;
  profile?: HistoricalIntelligenceProfile;
  matrixDigest?: string;
}>;

function computeInputSemanticDigest(snapshot: MarketStateSnapshot): string {
  const body = {
    reconstruction_digest: snapshot.reconstruction.instrumentId,
    evaluated_at: snapshot.evaluatedAt,
    instrument_id: snapshot.instrumentId,
    hypothesis_count: snapshot.hypotheses.hypotheses.length,
  };
  return createHash("sha256").update(canonicalizeSemanticJsonString(body), "utf8").digest("hex");
}

function computeOutputSemanticDigest(
  snapshot: MarketStateSnapshot,
  decisionChain: DecisionChain,
): string {
  const body = {
    terminal_reason_code: decisionChain.terminalReasonCode,
    trading_permission: snapshot.tradingPermission,
    active_hypothesis_type: decisionChain.activeHypothesisType,
    opportunity_authorized: decisionChain.opportunityAuthorized,
    conviction: canonicalDecimalFromNumber(snapshot.conviction),
  };
  return createHash("sha256").update(canonicalizeSemanticJsonString(body), "utf8").digest("hex");
}

function resolveHypothesisStatus(hypothesis: MarketHypothesis, activeType: string | null): string {
  if (activeType === hypothesis.hypothesisType) {
    return "ACTIVE";
  }
  return "EMITTED";
}

export function buildIntelligenceCycleBundle(
  input: BuildIntelligenceCycleBundleInput,
): IntelligenceCycleBundle {
  if (input.accountId !== null && input.accountId.trim().length === 0) {
    throw new Error("buildIntelligenceCycleBundle: accountId must be null or non-empty");
  }
  if (input.analyticalTimeframe.trim().length === 0) {
    throw new Error("buildIntelligenceCycleBundle: analyticalTimeframe is required");
  }
  const profile = input.profile ?? HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1;
  const matrixDigest = input.matrixDigest ?? TIMEFRAME_EVIDENCE_LANE_AUTHORITY_MATRIX_V1_DIGEST;
  const snapshot = input.marketStateSnapshot;
  const decisionChain = input.decisionChain;

  const universalTerminalReason = resolveUniversalTerminalReason({
    sourceTerminalReasonCode: snapshot.terminalReasonCode,
    sourceReasonCodes: decisionChain.reasonCodes,
    opportunityAuthorized: decisionChain.opportunityAuthorized,
    tradingPermission: snapshot.tradingPermission,
    activeHypothesisType: decisionChain.activeHypothesisType,
    insufficientBars:
      snapshot.terminalReasonCode.includes("INSUFFICIENT_BARS") ||
      decisionChain.reasonCodes.some((code) => code.includes("INSUFFICIENT_BARS")),
  });

  const envelopeBase: TraderIntelligenceCycleEnvelopeRecord = {
    id: deriveCycleEnvelopeId({
      organizationId: input.organizationId,
      runId: input.runId,
      cycleId: input.cycleId,
      symbol: input.symbol,
    }),
    organizationId: input.organizationId,
    runId: input.runId,
    cycleId: input.cycleId,
    symbol: input.symbol,
    evaluatedAt: snapshot.evaluatedAt,
    historicalProfileId: profile.profileId,
    historicalProfileDigest: HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1_DIGEST,
    matrixDigest,
    terminalReasonCode: universalTerminalReason,
    inputSemanticDigest: computeInputSemanticDigest(snapshot),
    outputSemanticDigest: computeOutputSemanticDigest(snapshot, decisionChain),
    contentDigest: "",
    schemaVersion: CYCLE_ENVELOPE_SCHEMA_VERSION,
  };
  const envelope: TraderIntelligenceCycleEnvelopeRecord = {
    ...envelopeBase,
    contentDigest: computeCycleEnvelopeContentDigest(envelopeBase),
  };

  const activeType = snapshot.hypotheses.activeHypothesis?.hypothesisType ?? null;
  const hypotheses: TraderIntelligenceHypothesisRecord[] = snapshot.hypotheses.hypotheses.map(
    (hypothesis) => {
      const thesisDigest = buildThesisDigest(hypothesis.hypothesisType, hypothesis.expectedPath);
      const evidenceDigest = buildEvidenceDigest(
        hypothesis.supportingEvidence,
        hypothesis.contradictingEvidence,
      );
      const causalLineageJson = hypothesis.canonicalCausalLineageJson ?? null;
      const causalLineageDigest = hypothesis.canonicalCausalLineageDigest ?? null;
      const authoritativeLinkDigest = buildHypothesisLinkDigestInput({
        organizationId: input.organizationId,
        runId: input.runId,
        cycleId: input.cycleId,
        symbol: input.symbol,
        evaluatedAt: snapshot.evaluatedAt,
        hypothesisType: hypothesis.hypothesisType,
        thesisDigest,
        evidenceDigest,
        ...(causalLineageDigest ? { canonicalCausalLineageDigest: causalLineageDigest } : {}),
      });
      if ((causalLineageJson === null) !== (causalLineageDigest === null)) {
        throw new Error("CANONICAL_CAUSAL_LINEAGE_INCOMPLETE");
      }
      if (causalLineageJson !== null && causalLineageDigest !== null) {
        const lineage = parseCanonicalCausalLineageV1(causalLineageJson);
        if (
          lineage.contentDigest !== causalLineageDigest ||
          lineage.organizationId !== input.organizationId ||
          lineage.symbol !== input.symbol ||
          lineage.pitAnchor !== snapshot.evaluatedAt ||
          lineage.hypothesisId !== hypothesis.canonicalHypothesisId ||
          lineage.runtimeIntelligenceStateDigest !== hypothesis.canonicalIntelligenceStateDigest
        ) {
          throw new Error("CANONICAL_CAUSAL_LINEAGE_SCOPE_OR_DIGEST_MISMATCH");
        }
      }
      const base: TraderIntelligenceHypothesisRecord = {
        id: deriveHypothesisRecordId({
          organizationId: input.organizationId,
          runId: input.runId,
          cycleId: input.cycleId,
          symbol: input.symbol,
          evaluatedAt: snapshot.evaluatedAt,
          hypothesisType: hypothesis.hypothesisType,
          thesisDigest,
          evidenceDigest,
          ...(causalLineageDigest ? { canonicalCausalLineageDigest: causalLineageDigest } : {}),
        }),
        organizationId: input.organizationId,
        cycleEnvelopeId: envelope.id,
        runId: input.runId,
        cycleId: input.cycleId,
        symbol: input.symbol,
        evaluatedAt: snapshot.evaluatedAt,
        hypothesisType: hypothesis.hypothesisType,
        hypothesisStatus: resolveHypothesisStatus(hypothesis, activeType),
        confidenceValue: canonicalDecimalFromNumber(hypothesis.confidence),
        thesisDigest,
        evidenceDigest,
        miHypothesisId: null,
        authoritativeLinkDigest,
        canonicalCausalLineageJson: causalLineageJson,
        canonicalCausalLineageDigest: causalLineageDigest,
        contentDigest: "",
        schemaVersion: HYPOTHESIS_RECORD_SCHEMA_VERSION,
      };
      return {
        ...base,
        contentDigest: computeHypothesisRecordContentDigest(base),
      };
    },
  );

  const sortedHypotheses = sortHypothesesByTypeCodePoint(hypotheses);
  const activeHypothesisRecord =
    activeType === null
      ? null
      : (sortedHypotheses.find((row) => row.hypothesisType === activeType) ?? null);

  const opportunity = snapshot.hypotheses.opportunity;
  const convictionScope = activeHypothesisRecord
    ? ("ACTIVE_HYPOTHESIS" as const)
    : ("NONE" as const);
  const convictionBase: TraderIntelligenceConvictionRecord = {
    id: deriveConvictionRecordId({
      organizationId: input.organizationId,
      runId: input.runId,
      cycleId: input.cycleId,
      symbol: input.symbol,
    }),
    organizationId: input.organizationId,
    cycleEnvelopeId: envelope.id,
    activeHypothesisRecordId: activeHypothesisRecord?.id ?? null,
    convictionScope,
    runId: input.runId,
    cycleId: input.cycleId,
    symbol: input.symbol,
    evaluatedAt: snapshot.evaluatedAt,
    convictionValue: canonicalDecimalFromNumber(
      opportunity?.conviction ?? snapshot.conviction ?? 0,
    ),
    convictionClass: opportunity?.authorized ? "AUTHORIZED" : "NOT_AUTHORIZED",
    reasonCodes: [...decisionChain.reasonCodes],
    sustainedCycles: opportunity?.sustainedCycles ?? 0,
    contentDigest: "",
    schemaVersion: CONVICTION_RECORD_SCHEMA_VERSION,
  };
  const conviction: TraderIntelligenceConvictionRecord = {
    ...convictionBase,
    contentDigest: computeConvictionRecordContentDigest(convictionBase),
  };

  const frozenEnvelope = Object.freeze(envelope);
  const frozenHypotheses = Object.freeze(
    sortedHypotheses.map((hypothesis) => Object.freeze(hypothesis)),
  );
  const frozenConviction = Object.freeze(conviction);
  const informationSufficiencyProvenance = Object.freeze({
    accountId: input.accountId,
    analyticalTimeframe: input.analyticalTimeframe,
  });

  return Object.freeze({
    envelope: frozenEnvelope,
    hypotheses: frozenHypotheses,
    conviction: frozenConviction,
    informationSufficiencyProvenance,
  });
}

export type PersistEvaluationCycleRecordsInput = BuildIntelligenceCycleBundleInput;

export type PersistEvaluationCycleRecordsDeps = Readonly<{
  db?: WaiaPostgresDb;
  bundleRepository?: IntelligenceCycleBundleRepository;
}>;

export async function persistEvaluationCycleRecords(
  context: OrgContext,
  input: PersistEvaluationCycleRecordsInput,
  deps: PersistEvaluationCycleRecordsDeps = {},
): Promise<IntelligenceCycleBundle> {
  const bundle = buildIntelligenceCycleBundle(input);
  if (deps.bundleRepository) {
    return deps.bundleRepository.persist(context, bundle);
  }
  if (!deps.db) {
    return bundle;
  }
  return persistIntelligenceCycleBundle(context, bundle, deps.db);
}
