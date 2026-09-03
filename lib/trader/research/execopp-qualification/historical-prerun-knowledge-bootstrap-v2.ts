import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";

import * as pgSchema from "@/db/schema.postgres";
import { deterministicExecutionUuidV2 } from "@/lib/trader/execution/v2/contracts";
import { buildMsvEnvelope } from "@/lib/trader/intelligence/cde-v0";
import { computeFeatureSnapshot } from "@/lib/trader/intelligence/feature-engine-v0";
import {
  evaluateCanonicalHistoricalApplicabilityFactsV1,
} from "@/lib/trader/intelligence/hypothesis/canonical-historical-applicability-v1";
import {
  sealHistoricalKnowledgeEdgeV1,
  sealHistoricalMarketPredictionV1,
} from "@/lib/trader/intelligence/hypothesis/canonical-runtime-intelligence-fold-v1";
import { computeSemanticSha256Hex } from
  "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  hypothesisTypeEnum,
  type HypothesisType,
} from "@/lib/trader/intelligence/hypothesis/hypothesis.types";
import { buildReconstructionSnapshotForClosedPrefix } from
  "@/lib/trader/intelligence/reconstruction/build-reconstruction-snapshot";
import type { Bar } from "@/lib/trader/intelligence/types";
import {
  insertKnowledgeEdgePostgres,
} from "@/lib/trader/knowledge/knowledge-edge-repository-postgres";
import {
  recordMarketPrediction,
  updateEdgeConfidenceFromVerification,
  verifyMarketPredictionOutcome,
} from "@/lib/trader/knowledge/market-memory";
import { createPostgresMiEvidenceService } from "@/lib/trader/mi/evidence-service";
import { createPostgresMiHypothesisService } from "@/lib/trader/mi/hypothesis-service";
import type { HypothesisDefinition, MiHypothesis } from
  "@/lib/trader/mi/hypothesis.types";
import { createPostgresMiMeasurementService } from "@/lib/trader/mi/measurement-service";
import {
  computeObservationKey,
  createPostgresMiObservationService,
} from "@/lib/trader/mi/observation-service";
import { createPostgresMiPatternService } from "@/lib/trader/mi/pattern-service";
import { createPostgresMiSourceProvenanceRepository } from
  "@/lib/trader/mi/repository-adapters";
import { serializeMsvPayloadJson } from "@/lib/trader/mi/serialize-observation";
import { createPostgresMiTrialService } from "@/lib/trader/mi/trial-service";

export const HISTORICAL_PRERUN_KNOWLEDGE_BOOTSTRAP_V2 =
  "waia.trader.historical_prerun_knowledge_bootstrap.v2" as const;

export type HistoricalPrerunKnowledgeSurfaceKeyV2 =
  `${"BTCUSDT" | "ETHUSDT"}:${30 | 60}`;

export type HistoricalPrerunKnowledgeScopeV2 = Readonly<{
  organizationId: string;
  runId: string;
  releaseSha: string;
  surfaceKey: HistoricalPrerunKnowledgeSurfaceKeyV2;
  exchangeSymbol: "BTCUSDT" | "ETHUSDT";
  instrumentId: "BTC/USDT" | "ETH/USDT";
  primaryHorizonMinutes: 30 | 60;
  operatorUserId: string;
  aggregateAdmissionContentDigestHex: string;
  qualificationReceiptDigestHex: string;
  predictivePackageContentDigestHex: string;
  wfPredictiveStartUtc: string;
  wfPredictiveEndUtc: string;
}>;

export type HistoricalPrerunKnowledgeSnapshotV2 = Readonly<{
  schemaVersion: typeof HISTORICAL_PRERUN_KNOWLEDGE_BOOTSTRAP_V2;
  organizationId: string;
  runId: string;
  releaseSha: string;
  surfaceKey: HistoricalPrerunKnowledgeSurfaceKeyV2;
  selectedHypothesisId: string;
  selectedHypothesisKey: string;
  selectedHypothesisType: HypothesisType;
  marketPitBoundary: string;
  hypothesis: Readonly<{
    id: string;
    hypothesisKey: string;
    definitionDigest: string;
    createdAt: string;
  }>;
  lifecycle: Readonly<{
    id: string;
    contentDigest: string;
    state: "VALIDATED";
    createdAt: string;
  }>;
  trial: Readonly<{
    id: string;
    contentDigest: string;
    eventTime: string;
    ingestTime: string;
    createdAt: string;
  }>;
  observation: Readonly<{
    id: string;
    contentDigest: string;
    eventTime: string;
    ingestTime: string;
    createdAt: string;
  }>;
  evidence: Readonly<{
    id: string;
    contentDigest: string;
    eventTime: string;
    ingestTime: string;
    createdAt: string;
  }>;
  prediction: Readonly<{
    id: string;
    sealDigestHex: string;
  }>;
  knowledgeEdge: Readonly<{
    id: string;
    sealDigestHex: string;
  }>;
  snapshotContentDigestHex: string;
}>;

export type HistoricalPrerunKnowledgeBootstrapResultV2 =
  HistoricalPrerunKnowledgeSnapshotV2;

export function computeHistoricalPrerunKnowledgeSnapshotDigestV2(
  snapshot: Omit<HistoricalPrerunKnowledgeSnapshotV2, "snapshotContentDigestHex">,
): string {
  return computeSemanticSha256Hex(snapshot);
}

function deterministicUuid(seed: Readonly<Record<string, unknown>>): string {
  return deterministicExecutionUuidV2("report", seed);
}

function hypothesisName(scope: HistoricalPrerunKnowledgeScopeV2, type: HypothesisType): string {
  return `${HISTORICAL_PRERUN_KNOWLEDGE_BOOTSTRAP_V2}:${scope.runId}:${scope.surfaceKey}:${type}`;
}

function expectedPath(type: HypothesisType): string {
  return `canonical ${type.replaceAll("_", " ")} structure persists through the next evaluation`;
}

function claimShape(type: HypothesisType): HypothesisDefinition["claimShape"] {
  return {
    relationshipType: "predictive",
    isDirectional: ["trend_continuation", "reversal", "breakout", "false_breakout"]
      .includes(type),
    isTrendEdge: type === "trend_continuation" || type === "mean_reversion",
    isTimingEdge: type === "breakout" || type === "false_breakout" ||
      type === "liquidity_sweep",
  };
}

function scopeNotes(scope: HistoricalPrerunKnowledgeScopeV2, type: HypothesisType): string {
  return JSON.stringify({
    schemaVersion: HISTORICAL_PRERUN_KNOWLEDGE_BOOTSTRAP_V2,
    organizationId: scope.organizationId,
    runId: scope.runId,
    releaseSha: scope.releaseSha,
    surfaceKey: scope.surfaceKey,
    exchangeSymbol: scope.exchangeSymbol,
    instrumentId: scope.instrumentId,
    primaryHorizonMinutes: scope.primaryHorizonMinutes,
    aggregateAdmissionContentDigestHex: scope.aggregateAdmissionContentDigestHex,
    qualificationReceiptDigestHex: scope.qualificationReceiptDigestHex,
    predictivePackageContentDigestHex: scope.predictivePackageContentDigestHex,
    hypothesisType: type,
    wfPredictiveStartUtc: scope.wfPredictiveStartUtc,
    wfPredictiveEndUtc: scope.wfPredictiveEndUtc,
  });
}

/** Exact projection used by the closed DEE-919 runtime fold. */
export function projectHistoricalPrerunHypothesisV2(
  scope: Omit<HistoricalPrerunKnowledgeScopeV2, "operatorUserId">,
  hypothesis: MiHypothesis,
  definition: HypothesisDefinition,
): Readonly<{ hypothesisType: HypothesisType; expectedPath: string }> | null {
  const type = hypothesisTypeEnum.find((candidate) =>
    hypothesis.name === hypothesisName({ ...scope, operatorUserId: "" }, candidate));
  if (!type || definition.regimeScope.notes !== scopeNotes(
    { ...scope, operatorUserId: "" }, type,
  )) return null;
  return Object.freeze({ hypothesisType: type, expectedPath: expectedPath(type) });
}

/**
 * Server-only pre-run knowledge composition. Every candidate is preregistered before the
 * terminal WF_PREDICTIVE reconstruction is evaluated. Only the resulting applicable candidate
 * receives human lifecycle ratification and durable outcome lineage. No economic bars are read.
 */
export async function INTERNAL_buildHistoricalPrerunKnowledgeBootstrapV2(input: Readonly<{
  sql: postgres.Sql;
  scope: HistoricalPrerunKnowledgeScopeV2;
  wfPredictiveBars: readonly Bar[];
}>): Promise<HistoricalPrerunKnowledgeBootstrapResultV2> {
  const { scope } = input;
  const start = Date.parse(scope.wfPredictiveStartUtc);
  const end = Date.parse(scope.wfPredictiveEndUtc);
  if (
    input.wfPredictiveBars.length < 240 || !Number.isFinite(start) || !Number.isFinite(end) ||
    start >= end || input.wfPredictiveBars[0]?.barOpenTime !== scope.wfPredictiveStartUtc ||
    input.wfPredictiveBars.at(-1)?.barCloseTime !== scope.wfPredictiveEndUtc ||
    input.wfPredictiveBars.some((bar) => bar.symbol !== scope.instrumentId ||
      Date.parse(bar.barOpenTime) < start || Date.parse(bar.barCloseTime) > end)
  ) throw new Error("HISTORICAL_PRERUN_KNOWLEDGE_REFUSED:WF_PREDICTIVE_SCOPE");

  const executor = drizzle(input.sql, { schema: pgSchema });
  const context = { organizationId: scope.organizationId };
  const actor = { actorType: "admin" as const, actorId: scope.operatorUserId };
  const measurementService = createPostgresMiMeasurementService(executor, actor).measurement;
  const patternService = createPostgresMiPatternService(executor, actor).pattern;
  const hypothesisService = createPostgresMiHypothesisService(executor, actor).hypothesis;
  const trialService = createPostgresMiTrialService(executor, actor).trial;
  const evidenceService = createPostgresMiEvidenceService(executor, actor).evidence;
  const observationService = createPostgresMiObservationService(
    executor,
    createPostgresMiSourceProvenanceRepository(executor),
    actor,
  ).observation;

  const measurement = await measurementService.registerMeasurement(context, {
    measurementKind: "feature_transform",
    name: `${HISTORICAL_PRERUN_KNOWLEDGE_BOOTSTRAP_V2}:${scope.runId}:${scope.surfaceKey}:msv`,
    definition: {
      inputs: { observationKinds: ["msv_envelope"] },
      outputType: "canonical-market-structure-facts",
      params: {
        surfaceKey: scope.surfaceKey,
        qualificationReceiptDigestHex: scope.qualificationReceiptDigestHex,
      },
      description: "PIT reconstruction facts sealed from WF_PREDICTIVE only",
    },
    authoredBy: scope.operatorUserId,
  });
  const measurementRef = {
    measurementKey: measurement.measurementKey,
    measurementDefinitionDigest: measurement.definitionDigest,
  };
  const candidates: Array<Readonly<{
    type: HypothesisType;
    hypothesis: MiHypothesis;
    trial: Awaited<ReturnType<typeof trialService.registerTrial>>;
    predictionId: string;
  }>> = [];
  const predictedAt = new Date(scope.wfPredictiveStartUtc);
  const actualIngestAt = new Date();
  for (const type of hypothesisTypeEnum) {
    const pattern = await patternService.registerPattern(context, {
      patternKind: "recurring_structure",
      name: `${hypothesisName(scope, type)}:pattern`,
      definition: {
        measurements: [measurementRef],
        recurrence: {
          description: "A named canonical reconstruction fact set recurs in sealed history",
          params: { structureCode: type, surfaceCode: scope.surfaceKey },
        },
        scope: { asset: scope.instrumentId, timeframe: "1m", observationWindow: "240-bars" },
      },
      trialBudgetMax: 1,
      authoredBy: scope.operatorUserId,
    });
    const hypothesis = await hypothesisService.registerHypothesis(context, {
      hypothesisKind: "market_claim",
      name: hypothesisName(scope, type),
      definition: {
        claimShape: claimShape(type),
        prior: { ordinal: "preregistered-no-scalar", band: "unquantified" },
        falsificationConditions: [
          `canonical ${type} applicability facts are absent at the sealed PIT boundary`,
          "any qualified data, package, release, organization or surface identity changes",
        ],
        requiredNulls: [
          "always-flat-cash",
          "buy-and-hold",
          "simple-trend-baseline",
          "random-entry-matched-exposure",
        ],
        patternRefs: [{
          patternKey: pattern.patternKey,
          patternDefinitionDigest: pattern.definitionDigest,
        }],
        measurementRefs: [measurementRef],
        regimeScope: {
          description: `Preregistered ${type} structural claim for ${scope.surfaceKey}`,
          notes: scopeNotes(scope, type),
        },
      },
      authoredBy: scope.operatorUserId,
    });
    const trial = await trialService.registerTrial(context, {
      hypothesisId: hypothesis.id,
      hypothesisDefinitionDigest: hypothesis.definitionDigest,
      researchProgram: `${HISTORICAL_PRERUN_KNOWLEDGE_BOOTSTRAP_V2}:${scope.runId}`,
      eventTime: predictedAt,
      ingestTime: actualIngestAt,
      registeredBy: scope.operatorUserId,
    });
    const predictionId = deterministicUuid({
      schemaVersion: HISTORICAL_PRERUN_KNOWLEDGE_BOOTSTRAP_V2,
      runId: scope.runId,
      surfaceKey: scope.surfaceKey,
      type,
      kind: "market-prediction",
    });
    await recordMarketPrediction(executor, context, {
      id: predictionId,
      subjectRef: `hypothesis:${hypothesis.id}`,
      predictedAt,
      prediction: {
        schemaVersion: HISTORICAL_PRERUN_KNOWLEDGE_BOOTSTRAP_V2,
        hypothesisType: type,
        hypothesisDefinitionDigest: hypothesis.definitionDigest,
        qualificationReceiptDigestHex: scope.qualificationReceiptDigestHex,
        predictivePackageContentDigestHex: scope.predictivePackageContentDigestHex,
        marketPitBoundary: scope.wfPredictiveEndUtc,
      },
    });
    candidates.push({ type, hypothesis, trial, predictionId });
  }

  const reconstruction = buildReconstructionSnapshotForClosedPrefix({
    bars1m: input.wfPredictiveBars,
    evaluatedAt: scope.wfPredictiveEndUtc,
  });
  const selected = candidates.find(({ type }) =>
    evaluateCanonicalHistoricalApplicabilityFactsV1(type, reconstruction).applicable);
  if (!selected) throw new Error("HISTORICAL_PRERUN_KNOWLEDGE_REFUSED:NO_APPLICABLE_HYPOTHESIS");

  const features = computeFeatureSnapshot({
    bars: input.wfPredictiveBars,
    evaluatedAt: scope.wfPredictiveEndUtc,
    newId: () => deterministicUuid({ runId: scope.runId, symbol: scope.exchangeSymbol,
      kind: "feature" }),
  });
  const msv = buildMsvEnvelope({
    features,
    newId: () => deterministicUuid({ runId: scope.runId, symbol: scope.exchangeSymbol,
      kind: "msv" }),
  });
  const source = await observationService.resolveInternalMsvSource(context);
  const marketBoundary = new Date(scope.wfPredictiveEndUtc);
  const payloadJson = serializeMsvPayloadJson(msv);
  const observationKey = computeObservationKey({
    organizationId: scope.organizationId,
    sourceId: source.id,
    observationKind: "msv_envelope",
    subjectRef: scope.instrumentId,
    eventTime: marketBoundary,
  });
  const priorObservation = await observationService.getLatestObservation(context, observationKey);
  const observation = priorObservation ?? await observationService.recordObservation(context, {
      sourceId: source.id,
      observationKind: "msv_envelope",
      subjectRef: scope.instrumentId,
      payloadJson,
      eventTime: marketBoundary,
      ingestTime: actualIngestAt,
      observedBy: scope.operatorUserId,
    });
  if (observation.payloadJson !== payloadJson || observation.eventTime.getTime() !== end) {
    throw new Error("HISTORICAL_PRERUN_KNOWLEDGE_REFUSED:OBSERVATION_CONFLICT");
  }
  const evidence = await evidenceService.recordEvidence(context, {
    direction: "FOR",
    hypothesisId: selected.hypothesis.id,
    hypothesisDefinitionDigest: selected.hypothesis.definitionDigest,
    measurementRefs: [measurementRef],
    observationRefs: [{ observationId: observation.id }],
    eventTime: marketBoundary,
    ingestTime: actualIngestAt,
    recordedBy: scope.operatorUserId,
    trialRegistrationRef: selected.trial.id,
  });
  await hypothesisService.transitionHypothesisLifecycle(context, {
    hypothesisKey: selected.hypothesis.hypothesisKey,
    toState: "VALIDATING",
    rationale: "Authenticated human review of preregistered WF_PREDICTIVE evidence",
    recordedBy: scope.operatorUserId,
    actorType: "admin",
    actorId: scope.operatorUserId,
  });
  const lifecycle = await hypothesisService.transitionHypothesisLifecycle(context, {
    hypothesisKey: selected.hypothesis.hypothesisKey,
    toState: "VALIDATED",
    rationale: "Authenticated pre-run ratification; historical non-capital scope only",
    recordedBy: scope.operatorUserId,
    actorType: "admin",
    actorId: scope.operatorUserId,
  });
  const prediction = await verifyMarketPredictionOutcome(executor, context, {
    predictionId: selected.predictionId,
    verifiedAt: marketBoundary,
    verificationResult: "confirmed",
    outcome: {
      schemaVersion: HISTORICAL_PRERUN_KNOWLEDGE_BOOTSTRAP_V2,
      observedApplicabilityFacts:
        evaluateCanonicalHistoricalApplicabilityFactsV1(selected.type, reconstruction).facts,
      pitEvidenceBoundary: scope.wfPredictiveEndUtc,
    },
  });
  const now = new Date();
  const edgeId = deterministicUuid({
    schemaVersion: HISTORICAL_PRERUN_KNOWLEDGE_BOOTSTRAP_V2,
    runId: scope.runId,
    surfaceKey: scope.surfaceKey,
    type: selected.type,
    kind: "knowledge-edge",
  });
  await insertKnowledgeEdgePostgres(executor, context, {
    id: edgeId,
    fromRef: `market_prediction:${selected.predictionId}`,
    toRef: `hypothesis:${selected.hypothesis.id}`,
    relationKind: "wf_predictive_supports_hypothesis",
    confidence: "0.7000",
    strength: "ORDINAL_SUPPORTED",
    regimeScope: `${scope.surfaceKey}:${selected.type}`,
    failureCasesJson: JSON.stringify({
      schemaVersion: HISTORICAL_PRERUN_KNOWLEDGE_BOOTSTRAP_V2,
      aggregateAdmissionContentDigestHex: scope.aggregateAdmissionContentDigestHex,
      qualificationReceiptDigestHex: scope.qualificationReceiptDigestHex,
      predictivePackageContentDigestHex: scope.predictivePackageContentDigestHex,
      pitEvidenceBoundary: scope.wfPredictiveEndUtc,
    }),
    hypothesisId: selected.hypothesis.id,
    verified: false,
    createdAt: now,
    updatedAt: now,
  });
  const resolved = await updateEdgeConfidenceFromVerification(executor, context, {
    edgeId,
    verificationResult: "confirmed",
    updatedAt: new Date(),
  });
  if (!resolved.verified) {
    throw new Error("HISTORICAL_PRERUN_KNOWLEDGE_REFUSED:UNRESOLVED_KNOWLEDGE");
  }
  const body = Object.freeze({
    schemaVersion: HISTORICAL_PRERUN_KNOWLEDGE_BOOTSTRAP_V2,
    organizationId: scope.organizationId,
    runId: scope.runId,
    releaseSha: scope.releaseSha,
    surfaceKey: scope.surfaceKey,
    selectedHypothesisId: selected.hypothesis.id,
    selectedHypothesisKey: selected.hypothesis.hypothesisKey,
    selectedHypothesisType: selected.type,
    marketPitBoundary: scope.wfPredictiveEndUtc,
    hypothesis: Object.freeze({
      id: selected.hypothesis.id,
      hypothesisKey: selected.hypothesis.hypothesisKey,
      definitionDigest: selected.hypothesis.definitionDigest,
      createdAt: selected.hypothesis.createdAt.toISOString(),
    }),
    lifecycle: Object.freeze({
      id: lifecycle.id,
      contentDigest: lifecycle.contentDigest,
      state: "VALIDATED" as const,
      createdAt: lifecycle.createdAt.toISOString(),
    }),
    trial: Object.freeze({
      id: selected.trial.id,
      contentDigest: selected.trial.contentDigest,
      eventTime: selected.trial.eventTime.toISOString(),
      ingestTime: selected.trial.ingestTime.toISOString(),
      createdAt: selected.trial.createdAt.toISOString(),
    }),
    observation: Object.freeze({
      id: observation.id,
      contentDigest: observation.contentDigest,
      eventTime: observation.eventTime.toISOString(),
      ingestTime: observation.ingestTime.toISOString(),
      createdAt: observation.createdAt.toISOString(),
    }),
    evidence: Object.freeze({
      id: evidence.id,
      contentDigest: evidence.contentDigest,
      eventTime: evidence.eventTime.toISOString(),
      ingestTime: evidence.ingestTime.toISOString(),
      createdAt: evidence.createdAt.toISOString(),
    }),
    prediction: Object.freeze({
      id: prediction.id,
      sealDigestHex: sealHistoricalMarketPredictionV1(prediction),
    }),
    knowledgeEdge: Object.freeze({
      id: resolved.id,
      sealDigestHex: sealHistoricalKnowledgeEdgeV1(resolved),
    }),
  });
  return Object.freeze({
    ...body,
    snapshotContentDigestHex: computeHistoricalPrerunKnowledgeSnapshotDigestV2(body),
  });
}
