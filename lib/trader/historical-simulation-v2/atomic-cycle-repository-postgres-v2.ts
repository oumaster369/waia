import type postgres from "postgres";
import {
  canonicalizeSemanticJsonString,
  computeSemanticSha256Hex,
} from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import type { HistoricalDatasetMembershipV2 } from "./dataset-membership-v2";
import type { HistoricalModeledExecutionReceiptV2 } from "./modeled-capital-binding-v2";
import { computeEconomicsContentDigest } from "@/lib/trader/execution/fill-economics";
import type { CostedFillEconomics } from "@/lib/trader/execution/historical-execution-model.types";
import { historicalFillId } from "@/lib/trader/execution/deterministic-execution-id";
import { computeAccountingSemanticDigest } from "@/lib/trader/accounting/canonical-cross-backend-accounting-engine";
import {
  validateDecisionEvaluationReceiptV1,
  validateWhyNotCashReceiptV2,
  type DecisionEvaluationReceiptV1,
  type WhyNotCashReceiptV2,
} from "@/lib/trader/intelligence/decision-economics/dee660-why-not-cash-receipt-v2";

import {
  HISTORICAL_SIMULATION_ATOMIC_STAGES_V2,
  commitHistoricalSimulationCycleAtomicallyV2,
  createHistoricalSimulationAtomicStageBundleV2,
  validateHistoricalSimulationResumeCursorV2,
  type HistoricalSimulationAtomicCycleRepositoryV2,
  type HistoricalSimulationAtomicArtifactReferenceV2,
  type HistoricalSimulationAtomicCycleTransactionV2,
  type HistoricalSimulationAtomicScopeV2,
  type HistoricalSimulationDurableStateSnapshotV2,
  type HistoricalSimulationResumeCursorV2,
} from "./atomic-cycle-commit-v2";
import type { HistoricalSimulationReasonLedgerV2 } from "./reason-ledger-v2";
import { deriveHistoricalSimulationModeledEvidenceV2 } from "./reason-ledger-repository-postgres";
import {
  assertHistoricalSimulationV2ClosedGraphRequest,
  type HistoricalSimulationV2ClosedGraphRequest,
} from "./production-graph-boundary-v2";
import { createHistoricalSimulationProductionCyclePortV2 } from "./production-cycle-port-v2";
import { HISTORICAL_SIMULATION_RUNNER_DATABASE_ROLE_V2 } from "./historical-runner-role-v2";
import { assertFhvV2PostgresSchemaPreflight } from "@/lib/trader/observability/fhv-v2-postgres-schema-preflight";
import { createHistoricalExecutionModelV1 } from "@/lib/trader/execution/historical-execution-model";
import { createHistoricalSimulatedExchange } from "@/lib/trader/execution/historical-simulated-exchange";
import { deterministicExecutionUuidV2 } from "@/lib/trader/execution/v2/contracts";
import {
  createHistoricalDecisionEconomicsCapitalCoordinatorV2,
  runHistoricalSimulationV2,
  type HistoricalSimulationV2Cycle,
} from "@/lib/trader/backtest/historical-simulation-v2";
import {
  createHistoricalDecisionEconomicsProductionInputBuilderV2,
  type PersistedDecisionEconomicsAuthoritiesV2,
} from "./decision-economics-production-adapter-v2";
import { createHistoricalSimulationPostgresKnowledgeReadPortV2 } from "./knowledge-port-postgres";
import { loadHistoricalSimulationInitialRecordIndexV2 } from "./production-initial-cycle-index-v2";
import { prepareHistoricalProductionNextCycleForCommitV2 } from "./production-next-cycle-preparation-v2";
import {
  assertHistoricalForecastNonActionableSourceV2,
  assertHistoricalForecastNonActionableVerificationV2,
  type HistoricalForecastNonActionableSourceV2,
  type HistoricalForecastNonActionableVerificationV2,
} from "./non-actionable-forecast-source-v2";
import { prepareHistoricalProductionNextCycleAuthorityV2 } from "./production-next-cycle-authority-v2";
import {
  loadHistoricalProductionLearningProjectionV2,
  loadHistoricalProductionPendingForecastsV2,
} from "./production-learning-projection-v2";
import { withPostgresSessionTransactionV2 } from "./postgres-session-transaction-v2";
import {
  createHistoricalModeledCapitalBindingV2,
  createHistoricalModeledExecutionRegistryV2,
  type HistoricalModeledGuardianReceiptV2,
  type HistoricalModeledRiskReceiptV2,
} from "./modeled-capital-binding-v2";
import {
  createAdvanceHistoricalModeledExecutionV2,
  projectHistoricalModeledEffectsToReasonLedgerV2,
  type AdvanceHistoricalModeledExecutionV2Result,
  type HistoricalSealedMarketCycleV2,
} from "./modeled-execution-advance-v2";
import {
  createHistoricalSimulationExecutionPersistenceV2,
  createHistoricalSimulationProductionTransactionRepositoriesV2,
  persistHistoricalModeledExecutionSubmissionV2,
} from "./production-transaction-adapters-v2";
import {
  loadHistoricalSimulationInceptionAccountingV2,
  restoreHistoricalSimulationProductionRuntimeStateV2,
  snapshotHistoricalSimulationProductionRuntimeStateV2,
  type HistoricalSimulationProductionRuntimeStateV2,
} from "./production-runtime-state-v2";
import {
  buildHistoricalSimulationModeledCapitalArtifactsV2,
  buildHistoricalSimulationModeledNoopArtifactsV2,
  buildHistoricalSimulationModeledRealityArtifactsV2,
  buildHistoricalSimulationModeledStateArtifactsV2,
  buildHistoricalSimulationModeledVetoArtifactsV2,
  buildHistoricalSimulationProductionStageBundlesV2,
} from "./production-stage-builder-v2";
import { closeHistoricalSimulationProducedCycleV2 } from "./production-produced-cycle-v2";
import { addDecimal, multiplyDecimal, subtractDecimal } from "@/lib/trader/risk/numeric";
import {
  assertHistoricalModeledRealityAgainstAccountingV2,
  assertHistoricalModeledRealityV2,
  deriveHistoricalModeledRiskAccountingV2,
  resolveHistoricalModeledPortfolioProposalV2,
  type HistoricalModeledPortfolioLifecycleReceiptV2,
  type HistoricalModeledRealityV2,
} from "./historical-modeled-portfolio-reality-v2";

const STATE_KINDS = [
  "KNOWLEDGE",
  "MODELED_EXECUTION_REGISTRY",
  "MODELED_EXCHANGE",
  "ACCOUNTING_FRONTIER",
  "GUARDIAN",
  "LEARNING",
] as const;

export const HISTORICAL_SIMULATION_COMMIT_REQUEST_V2 =
  "waia.trader.historical_simulation_commit_request.v2" as const;
export const HISTORICAL_SIMULATION_MODELED_ATOMIC_ARTIFACT_V2 =
  "waia.trader.historical_simulation_modeled_atomic_artifact.v2" as const;

export type HistoricalSimulationCommitRequestV2 = Readonly<{
  schemaVersion: typeof HISTORICAL_SIMULATION_COMMIT_REQUEST_V2;
  organizationId: string;
  accountId: string;
  runId: string;
  split: HistoricalSimulationAtomicScopeV2["split"];
  cycleSequence: number;
  cycleId: string;
  replayBarClosedAtUtc: string;
  datasetMembership: HistoricalDatasetMembershipV2;
  datasetMembershipContentDigestHex: string;
  forecastInputAuthorityContentDigestHex: string;
  policyConfigContentDigestHex: string;
  codeSha: string;
  ledgerEntryContentDigestHex: string;
  stageBundleDigestHexByStage: Readonly<
    Record<(typeof HISTORICAL_SIMULATION_ATOMIC_STAGES_V2)[number], string>
  >;
  snapshotContentDigestHexByKind: Readonly<Record<(typeof STATE_KINDS)[number], string>>;
  contentDigestHex: string;
}>;

export type HistoricalSimulationModeledAtomicArtifactV2 = Readonly<{
  schemaVersion: typeof HISTORICAL_SIMULATION_MODELED_ATOMIC_ARTIFACT_V2;
  artifactKind:
    | "MODELED_RISK_VERDICT"
    | "MODELED_EXECUTION_SUBMISSION"
    | "MODELED_EXECUTION_EFFECT"
    | "HISTORICAL_MODELED_REALITY"
    | "GUARDIAN_ASSESSMENT"
    | "KNOWLEDGE_CHECKPOINT"
    | "LEARNING_UPDATE";
  artifactId: string;
  organizationId: string;
  accountId: string;
  runId: string;
  cycleId: string;
  pitAnchor: string;
  sourceContentDigestHex: string;
  sourcePayload: Readonly<Record<string, unknown>>;
  lineagePayload?: Readonly<Record<string, unknown>>;
  sourcePayloadSemanticDigestHex: string;
  contentDigestHex: string;
}>;

type CommitRequestSeed = Omit<
  HistoricalSimulationCommitRequestV2,
  "schemaVersion" | "contentDigestHex"
>;

export function createHistoricalSimulationCommitRequestV2(
  seed: CommitRequestSeed,
): HistoricalSimulationCommitRequestV2 {
  const body = { schemaVersion: HISTORICAL_SIMULATION_COMMIT_REQUEST_V2, ...seed };
  const request = { ...body, contentDigestHex: computeSemanticSha256Hex(body) };
  validateHistoricalSimulationCommitRequestV2(request);
  return Object.freeze(request);
}

export function validateHistoricalSimulationCommitRequestV2(
  request: HistoricalSimulationCommitRequestV2,
): void {
  const { contentDigestHex, ...body } = request;
  const { contentDigestHex: membershipDigest, ...membershipBody } = request.datasetMembership;
  const digests = [
    request.datasetMembershipContentDigestHex,
    request.forecastInputAuthorityContentDigestHex,
    request.policyConfigContentDigestHex,
    request.ledgerEntryContentDigestHex,
    ...Object.values(request.stageBundleDigestHexByStage),
    ...Object.values(request.snapshotContentDigestHexByKind),
  ];
  if (
    request.schemaVersion !== HISTORICAL_SIMULATION_COMMIT_REQUEST_V2 ||
    request.organizationId.trim() === "" ||
    request.accountId.trim() === "" ||
    request.runId.trim() === "" ||
    request.cycleId.trim() === "" ||
    !Number.isSafeInteger(request.cycleSequence) ||
    request.cycleSequence < 0 ||
    !["DEVELOPMENT", "WALK_FORWARD"].includes(request.split) ||
    new Date(request.replayBarClosedAtUtc).toISOString() !== request.replayBarClosedAtUtc ||
    !/^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(request.codeSha) ||
    request.datasetMembership.organizationId !== request.organizationId ||
    request.datasetMembership.cycleId !== request.cycleId ||
    request.datasetMembership.partition !== request.split ||
    membershipDigest !== request.datasetMembershipContentDigestHex ||
    membershipDigest !== computeSemanticSha256Hex(membershipBody) ||
    digests.some((digest) => !/^[0-9a-f]{64}$/.test(digest)) ||
    Object.keys(request.stageBundleDigestHexByStage).length !==
      HISTORICAL_SIMULATION_ATOMIC_STAGES_V2.length ||
    Object.keys(request.snapshotContentDigestHexByKind).length !== STATE_KINDS.length ||
    contentDigestHex !== computeSemanticSha256Hex(body)
  ) {
    throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:COMMIT_REQUEST");
  }
}

export function createHistoricalSimulationModeledAtomicArtifactV2(
  input: Omit<
    HistoricalSimulationModeledAtomicArtifactV2,
    "schemaVersion" | "contentDigestHex" | "sourcePayloadSemanticDigestHex"
  >,
): HistoricalSimulationModeledAtomicArtifactV2 {
  const body = {
    schemaVersion: HISTORICAL_SIMULATION_MODELED_ATOMIC_ARTIFACT_V2,
    ...input,
    sourcePayloadSemanticDigestHex: computeSemanticSha256Hex(input.sourcePayload),
  };
  return Object.freeze({ ...body, contentDigestHex: computeSemanticSha256Hex(body) });
}

export function assertHistoricalSimulationLearningSnapshotTransitionV2(
  input: Readonly<{
    previousSnapshot: HistoricalSimulationDurableStateSnapshotV2 | null;
    nextSnapshot: HistoricalSimulationDurableStateSnapshotV2;
    artifacts: readonly HistoricalSimulationModeledAtomicArtifactV2[];
  }>,
): void {
  if (
    input.artifacts.length === 0 ||
    input.artifacts.some(
      (artifact) =>
        !artifact.lineagePayload ||
        artifact.lineagePayload.previousSnapshotContentDigestHex !==
          (input.previousSnapshot?.contentDigestHex ?? null) ||
        artifact.lineagePayload.nextSnapshotContentDigestHex !==
          input.nextSnapshot.contentDigestHex ||
        canonicalizeSemanticJsonString(artifact.lineagePayload.nextState) !==
          canonicalizeSemanticJsonString(input.nextSnapshot.state) ||
        canonicalizeSemanticJsonString(artifact.lineagePayload.previousState ?? null) !==
          canonicalizeSemanticJsonString(input.previousSnapshot?.state ?? null) ||
        canonicalizeSemanticJsonString(artifact.sourcePayload.previousState ?? null) !==
          canonicalizeSemanticJsonString(input.previousSnapshot?.state ?? null) ||
        canonicalizeSemanticJsonString(artifact.sourcePayload.nextState) !==
          canonicalizeSemanticJsonString(input.nextSnapshot.state),
    )
  ) {
    throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:LEARNING_SNAPSHOT_TRANSITION");
  }
}

export function assertHistoricalSimulationFillDetailParityV2(
  input: Readonly<{
    organizationId: string;
    cycleId: string;
    orderId: string;
    symbol: string;
    side: string;
    evidence: Readonly<Record<string, unknown>>;
    detail: Readonly<Record<string, unknown>>;
    consumedFillIds: readonly string[];
  }>,
): void {
  const detailBody = { ...input.detail };
  const detailDigest = detailBody.contentDigestHex;
  delete detailBody.contentDigestHex;
  const event = input.detail.event as Record<string, unknown> | undefined;
  const economics = input.detail.economics as Record<string, unknown> | undefined;
  const accounting = input.detail.accountingFrontier as
    | (Readonly<{ semanticContentDigest: string; consumedFillIds: readonly string[] }> &
        Record<string, unknown>)
    | undefined;
  const fillId = input.evidence.fillId;
  if (
    !event ||
    !economics ||
    !accounting ||
    typeof detailDigest !== "string" ||
    computeSemanticSha256Hex(detailBody) !== detailDigest ||
    canonicalizeSemanticJsonString(input.detail.evidence) !==
      canonicalizeSemanticJsonString(input.evidence) ||
    input.evidence.cycleId !== input.cycleId ||
    event.orderId !== input.orderId ||
    event.organizationId !== input.organizationId ||
    event.symbol !== input.symbol ||
    event.side !== input.side ||
    !Number.isSafeInteger(event.fillSequence) ||
    !Number.isSafeInteger(event.sourceBarIndex) ||
    typeof event.sliceQuantity !== "string" ||
    typeof event.grossFillPrice !== "string" ||
    typeof event.remainingQuantityAfter !== "string" ||
    typeof event.acceptedAt !== "string" ||
    typeof event.fillTimestamp !== "string" ||
    fillId !==
      historicalFillId({
        organizationId: input.organizationId,
        orderId: input.orderId,
        fillSequence: event.fillSequence as number,
        sourceBarIndex: event.sourceBarIndex as number,
      }) ||
    economics.quantity !== event.sliceQuantity ||
    economics.grossFillPrice !== event.grossFillPrice ||
    economics.remainingQuantityAfter !== event.remainingQuantityAfter ||
    economics.fillSequence !== event.fillSequence ||
    economics.sourceBarIndex !== event.sourceBarIndex ||
    economics.symbol !== event.symbol ||
    economics.side !== event.side ||
    economics.acceptedAt !== event.acceptedAt ||
    economics.fillTimestamp !== event.fillTimestamp ||
    economics.sourceBarTimestamp !==
      (event.sourceBar as Record<string, unknown> | undefined)?.barCloseTime ||
    economics.economicsContentDigest !== input.evidence.economicsContentDigestHex ||
    computeEconomicsContentDigest(
      economics as unknown as Omit<CostedFillEconomics, "economicsContentDigest">,
    ) !== economics.economicsContentDigest ||
    computeAccountingSemanticDigest(accounting as never) !== accounting.semanticContentDigest ||
    input.evidence.accountingFrontierContentDigestHex !== accounting.semanticContentDigest ||
    typeof fillId !== "string" ||
    !accounting.consumedFillIds.includes(fillId) ||
    !input.consumedFillIds.includes(fillId)
  ) {
    throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:MODELED_FILL_DETAIL_SOURCE");
  }
}

export function validateHistoricalSimulationModeledAtomicArtifactV2(
  scope: HistoricalSimulationAtomicScopeV2,
  cycleId: string,
  reference: HistoricalSimulationAtomicArtifactReferenceV2,
): HistoricalSimulationModeledAtomicArtifactV2 {
  const payload = reference.payload as HistoricalSimulationModeledAtomicArtifactV2 | undefined;
  if (!payload) throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:MODELED_ARTIFACT_PAYLOAD");
  const { contentDigestHex, ...body } = payload;
  if (
    payload.schemaVersion !== HISTORICAL_SIMULATION_MODELED_ATOMIC_ARTIFACT_V2 ||
    payload.artifactKind !== reference.artifactKind ||
    payload.artifactId !== reference.artifactId ||
    payload.organizationId !== scope.organizationId ||
    payload.accountId !== scope.accountId ||
    payload.runId !== scope.runId ||
    payload.cycleId !== cycleId ||
    !/^[0-9a-f]{64}$/.test(payload.sourceContentDigestHex) ||
    !Number.isSafeInteger(Date.parse(payload.pitAnchor)) ||
    !payload.sourcePayload ||
    Array.isArray(payload.sourcePayload) ||
    payload.sourcePayloadSemanticDigestHex !== computeSemanticSha256Hex(payload.sourcePayload) ||
    contentDigestHex !== reference.contentDigestHex ||
    contentDigestHex !== computeSemanticSha256Hex(body)
  ) {
    throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:MODELED_ARTIFACT_PAYLOAD");
  }
  const embedded = payload.sourcePayload.contentDigestHex;
  const domainBody = { ...payload.sourcePayload };
  delete domainBody.contentDigestHex;
  const recomputedDomainDigest =
    typeof embedded === "string"
      ? computeSemanticSha256Hex(domainBody)
      : computeSemanticSha256Hex(payload.sourcePayload);
  if (
    (typeof embedded === "string" && embedded !== payload.sourceContentDigestHex) ||
    recomputedDomainDigest !== payload.sourceContentDigestHex
  ) {
    throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:MODELED_ARTIFACT_DOMAIN_DIGEST");
  }
  return payload;
}

type ProducedCycle = Omit<
  Parameters<typeof commitHistoricalSimulationCycleAtomicallyV2>[0],
  "repository" | "scope"
>;

async function verifyCanonicalStageArtifacts(
  sql: postgres.Sql,
  scope: HistoricalSimulationAtomicScopeV2,
  produced: ProducedCycle,
  previousCursor: HistoricalSimulationResumeCursorV2 | null,
): Promise<void> {
  if (produced.ledgerEntry.forecast.status === "NON_ACTIONABLE") {
    const sourceArtifact = produced.stageBundles.FORECAST_LIFECYCLE.artifacts[0];
    const verificationArtifact =
      produced.stageBundles.CANONICAL_VERIFICATION.artifacts[0];
    const source = sourceArtifact?.payload as
      | HistoricalForecastNonActionableSourceV2
      | undefined;
    const verification = verificationArtifact?.payload as
      | HistoricalForecastNonActionableVerificationV2
      | undefined;
    const releaseSha = process.env.WAIA_RELEASE_SHA?.toLowerCase() ??
      process.env.VERCEL_GIT_COMMIT_SHA?.toLowerCase() ?? "";
    if (
      !sourceArtifact ||
      !verificationArtifact ||
      sourceArtifact.artifactKind !== "FORECAST_NON_ACTIONABLE" ||
      verificationArtifact.artifactKind !==
        "FORECAST_NON_ACTIONABLE_VERIFICATION" ||
      !source ||
      !verification ||
      sourceArtifact.contentDigestHex !== source.contentDigestHex ||
      verificationArtifact.contentDigestHex !== verification.contentDigestHex
    ) {
      throw new Error(
        "HISTORICAL_SIMULATION_RESUME_REFUSED:NON_ACTIONABLE_STAGE_SOURCE",
      );
    }
    assertHistoricalForecastNonActionableSourceV2(source, {
      organizationId: scope.organizationId,
      accountId: scope.accountId,
      runId: scope.runId,
      cycleId: produced.ledgerEntry.cycleId,
      symbol: produced.ledgerEntry.symbol as "BTCUSDT" | "ETHUSDT",
      pitAnchor: produced.ledgerEntry.replayBarClosedAtUtc,
      datasetMembershipContentDigestHex:
        produced.ledgerEntry.datasetMembership.contentDigestHex,
    });
    assertHistoricalForecastNonActionableVerificationV2(verification, {
      source,
      releaseSha,
    });
    const cycleAuthority = source.runtimeInput.historicalIntelligenceCycleAuthority;
    const rows = cycleAuthority
      ? await sql<Array<Readonly<{ content_digest: string;
          input_semantic_digest: string }>>>`
          SELECT content_digest,input_semantic_digest
          FROM trader_intelligence_cycle_envelope
          WHERE id=${cycleAuthority.envelopeId}::uuid
            AND organization_id=${scope.organizationId}::uuid
            AND run_id=${scope.runId} AND cycle_id=${produced.ledgerEntry.cycleId}
            AND content_digest=${cycleAuthority.envelopeContentDigestHex}
            AND input_semantic_digest=${cycleAuthority.inputSemanticDigestHex}`
      : [];
    if (rows.length !== 1) {
      throw new Error(
        "HISTORICAL_SIMULATION_RESUME_REFUSED:NON_ACTIONABLE_INTELLIGENCE_SOURCE",
      );
    }
  } else {
    for (const artifact of produced.stageBundles.FORECAST_LIFECYCLE.artifacts) {
      const rows = await sql<{ forecast_content_digest_hex: string }[]>`
        SELECT encode(forecast_content_digest,'hex') AS forecast_content_digest_hex FROM trader_forecast_v2
        WHERE id=${artifact.artifactId}::uuid AND organization_id=${scope.organizationId}::uuid
          AND encode(forecast_content_digest,'hex')=${artifact.contentDigestHex}`;
      if (rows.length !== 1)
        throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:FORECAST_ARTIFACT_SOURCE");
    }
    for (const artifact of produced.stageBundles.CANONICAL_VERIFICATION.artifacts) {
      const rows = await sql<{ verification_receipt_digest_hex: string }[]>`
        SELECT verification_receipt_digest_hex FROM trader_canonical_decision_verification_receipt_v2
        WHERE id=${artifact.artifactId}::uuid AND organization_id=${scope.organizationId}::uuid
          AND (account_id IS NULL OR account_id=${scope.accountId})
          AND verification_receipt_digest_hex=${artifact.contentDigestHex} AND verified=true`;
      if (rows.length !== 1)
        throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:VERIFICATION_ARTIFACT_SOURCE");
    }
  }
  for (const artifact of produced.stageBundles.ACCOUNTING.artifacts) {
    const rows = await sql<{ semantic_content_digest: string }[]>`
      SELECT semantic_content_digest FROM trader_accounting_frontier
      WHERE id=${artifact.artifactId}::uuid AND organization_id=${scope.organizationId}::uuid
        AND account_key=${scope.accountId} AND run_id=${scope.runId}
        AND semantic_content_digest=${artifact.contentDigestHex}`;
    if (
      rows.length !== 1 ||
      artifact.contentDigestHex !== produced.ledgerEntry.accounting.frontierContentDigestHex
    ) {
      throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:ACCOUNTING_ARTIFACT_SOURCE");
    }
  }
  if (produced.ledgerEntry.learning.status === "APPLIED") {
    const learning = produced.ledgerEntry.learning;
    const rows = await sql<
      Array<
        Readonly<{
          knowledge_digest: string;
          calibration_digest: string;
          eligible_resolution_at: Date | string;
          visible_from_pit_anchor: Date | string;
        }>
      >
    >`
      SELECT k.content_digest AS knowledge_digest,
        encode(c.content_digest, 'hex') AS calibration_digest,
        k.eligible_resolution_at,
        (k.source_record_ids_json::jsonb ->>
          'visible_from_cycle_pit_anchor')::timestamptz AS visible_from_pit_anchor
      FROM trader_knowledge_confidence_update_record k
      JOIN trader_forecast_calibration_observation_v2 c
        ON c.organization_id=k.organization_id
       AND encode(c.content_digest, 'hex')=(k.source_record_ids_json::jsonb ->>
          'calibration_observation_content_digest')
       AND c.scoring_eligible=true
      WHERE k.organization_id=${scope.organizationId}::uuid
        AND k.run_id=${scope.runId}
        AND k.content_digest=${learning.knowledgeUpdateContentDigestHex}
        AND encode(c.content_digest, 'hex')=${learning.calibrationObservationContentDigestHex}
    `;
    const row = rows[0];
    if (
      !row ||
      rows.length !== 1 ||
      new Date(row.eligible_resolution_at).toISOString() !== learning.eligibleResolutionAtUtc ||
      new Date(row.visible_from_pit_anchor).toISOString() !== learning.visibleFromPitAnchorUtc
    ) {
      throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:LEARNING_EVIDENCE_SOURCE");
    }
  }
  const exactDigestSets = {
    MODELED_RISK: new Set(
      [
        produced.ledgerEntry.risk.verdictContentDigestHex,
        produced.ledgerEntry.risk.allowanceContentDigestHex,
      ]
        .filter((value): value is string => value !== null)
        .concat(
          produced.ledgerEntry.risk.verdictContentDigestHex
            ? []
            : [computeSemanticSha256Hex(produced.ledgerEntry.risk)],
        ),
    ),
    MODELED_EXECUTION: new Set(
      [
        produced.ledgerEntry.execution.planContentDigestHex,
        produced.ledgerEntry.execution.attemptContentDigestHex,
        produced.ledgerEntry.execution.reportContentDigestHex,
      ]
        .filter((value): value is string => value !== null)
        .concat(
          produced.ledgerEntry.execution.planContentDigestHex
            ? []
            : [computeSemanticSha256Hex(produced.ledgerEntry.execution)],
        ),
    ),
    OBSERVED_EXECUTION_EFFECTS: new Set(
      produced.ledgerEntry.observedExecutionEffects
        .flatMap((effect) => [...effect.reportContentDigestHexes, ...effect.fillContentDigestHexes])
        .concat(
          produced.ledgerEntry.observedExecutionEffects.length
            ? []
            : [
                computeSemanticSha256Hex({
                  effects: produced.ledgerEntry.observedExecutionEffects,
                }),
              ],
        ),
    ),
    GUARDIAN: new Set([produced.ledgerEntry.guardian.assessmentContentDigestHex]),
    KNOWLEDGE: new Set([produced.knowledgeCheckpointContentDigestHex]),
    LEARNING: new Set([
      computeSemanticSha256Hex({
        schemaVersion: "waia.trader.historical_learning_transition.v2",
        previousState: previousCursor?.learningSnapshot.state ?? null,
        nextState: produced.learningSnapshot.state,
      }),
    ]),
  } as const;
  for (const [stage, expected] of Object.entries(exactDigestSets)) {
    const artifacts = produced.stageBundles[stage as keyof typeof exactDigestSets].artifacts;
    const modeled = artifacts.map((artifact) =>
      validateHistoricalSimulationModeledAtomicArtifactV2(
        scope,
        produced.ledgerEntry.cycleId,
        artifact,
      ),
    );
    const sourceDigests = modeled.map((artifact) => artifact.sourceContentDigestHex);
    if (
      sourceDigests.some((digest) => !expected.has(digest)) ||
      [...expected].some((digest) => !sourceDigests.includes(digest))
    ) {
      throw new Error(`HISTORICAL_SIMULATION_RESUME_REFUSED:${stage}_ARTIFACT_SOURCE`);
    }
    if (
      modeled.some(
        (artifact) =>
          Date.parse(artifact.pitAnchor) > Date.parse(produced.ledgerEntry.replayBarClosedAtUtc),
      )
    ) {
      throw new Error(`HISTORICAL_SIMULATION_RESUME_REFUSED:${stage}_ARTIFACT_FUTURE`);
    }
  }
  const realityArtifacts = produced.stageBundles.HISTORICAL_MODELED_REALITY.artifacts.map(
    (artifact) =>
      validateHistoricalSimulationModeledAtomicArtifactV2(
        scope,
        produced.ledgerEntry.cycleId,
        artifact,
      ),
  );
  if (realityArtifacts.length !== 1) {
    throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:MODELED_REALITY_CARDINALITY");
  }
  const realityArtifact = realityArtifacts[0]!;
  const reality = realityArtifact.sourcePayload as unknown as HistoricalModeledRealityV2;
  const lifecycle = realityArtifact.lineagePayload?.portfolioLifecycle as
    | HistoricalModeledPortfolioLifecycleReceiptV2
    | undefined;
  assertHistoricalModeledRealityV2(reality);
  if (
    realityArtifact.artifactKind !== "HISTORICAL_MODELED_REALITY" ||
    !lifecycle ||
    realityArtifact.sourceContentDigestHex !== reality.contentDigestHex ||
    reality.accountingFrontierContentDigestHex !==
      produced.ledgerEntry.accounting.frontierContentDigestHex ||
    reality.organizationId !== scope.organizationId ||
    reality.accountId !== scope.accountId ||
    reality.runId !== scope.runId ||
    reality.cycleId !== produced.ledgerEntry.cycleId ||
    lifecycle.action !== produced.ledgerEntry.portfolio.action ||
    lifecycle.accountingFrontierContentDigestHex !== reality.accountingFrontierContentDigestHex ||
    lifecycle.contentDigestHex !== reality.portfolioLifecycleContentDigestHex
  ) {
    throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:MODELED_REALITY_SOURCE");
  }
  const { contentDigestHex: lifecycleDigest, ...lifecycleBody } = lifecycle;
  if (computeSemanticSha256Hex(lifecycleBody) !== lifecycleDigest) {
    throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:MODELED_REALITY_LIFECYCLE");
  }
  if (
    produced.ledgerEntry.portfolio.action !== "CASH" &&
    !produced.stageBundles.MODELED_RISK.artifacts
      .map((artifact) =>
        validateHistoricalSimulationModeledAtomicArtifactV2(
          scope,
          produced.ledgerEntry.cycleId,
          artifact,
        ),
      )
      .some(
        (artifact) =>
          artifact.sourcePayload.portfolioLifecycleContentDigestHex === lifecycleDigest &&
          artifact.sourcePayload.action === produced.ledgerEntry.portfolio.action,
      )
  ) {
    throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:MODELED_REALITY_RISK_LINEAGE");
  }
  const accountingFrontier = produced.accountingFrontierSnapshot
    .state as import("@/lib/trader/accounting/accounting-frontier.types").AccountingFrontierV1;
  assertHistoricalModeledRealityAgainstAccountingV2({
    reality,
    portfolioLifecycle: lifecycle,
    accounting: deriveHistoricalModeledRiskAccountingV2({
      frontier: accountingFrontier,
      organizationId: scope.organizationId,
      accountId: scope.accountId,
      runId: scope.runId,
      exposureLimitNotional: accountingFrontier.equity,
      worstCasePendingExposureNotional: "0",
      outstandingReservationNotional: "0",
    }),
  });
  const executionPayloads = [
    ...produced.stageBundles.MODELED_EXECUTION.artifacts,
    ...produced.stageBundles.OBSERVED_EXECUTION_EFFECTS.artifacts,
  ].map((artifact) =>
    validateHistoricalSimulationModeledAtomicArtifactV2(
      scope,
      produced.ledgerEntry.cycleId,
      artifact,
    ),
  );
  const receipts = (
    produced.modeledExecutionRegistrySnapshot.state as Readonly<{
      receipts: readonly HistoricalModeledExecutionReceiptV2[];
    }>
  ).receipts;
  for (const artifact of executionPayloads.filter(
    (value) => value.artifactKind === "MODELED_EXECUTION_SUBMISSION",
  )) {
    if (
      produced.ledgerEntry.execution.planContentDigestHex === null &&
      artifact.sourceContentDigestHex ===
        computeSemanticSha256Hex(produced.ledgerEntry.execution) &&
      canonicalizeSemanticJsonString(artifact.sourcePayload) ===
        canonicalizeSemanticJsonString(produced.ledgerEntry.execution)
    ) {
      continue;
    }
    const receipt = receipts.find(
      (candidate) =>
        candidate.executionPlanContentDigestHex === artifact.sourceContentDigestHex ||
        candidate.executionAttemptContentDigestHex === artifact.sourceContentDigestHex,
    );
    if (!receipt) {
      throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:MODELED_EXECUTION_REGISTRY_SOURCE");
    }
    const planBody = {
      schemaVersion: "waia.trader.historical_modeled_execution_plan.v2",
      source: "MODELED_HISTORICAL",
      capitalEligible: false,
      executionPlanId: receipt.executionPlanId,
      decisionId: receipt.decisionId,
      decisionContentDigestHex: receipt.decisionContentDigestHex,
      riskReceiptContentDigestHex: receipt.riskReceiptContentDigestHex,
      symbol: receipt.symbol,
      side: receipt.side,
      quantity: receipt.quantity,
    };
    const attemptBody = {
      schemaVersion: "waia.trader.historical_modeled_execution_attempt.v2",
      source: "MODELED_HISTORICAL",
      capitalEligible: false,
      executionAttemptId: receipt.executionAttemptId,
      executionPlanId: receipt.executionPlanId,
      executionPlanContentDigestHex: receipt.executionPlanContentDigestHex,
      acceptedAtUtc: receipt.acceptedAtUtc,
    };
    const expected =
      artifact.sourceContentDigestHex === receipt.executionPlanContentDigestHex
        ? planBody
        : attemptBody;
    if (
      canonicalizeSemanticJsonString(artifact.sourcePayload) !==
      canonicalizeSemanticJsonString(expected)
    ) {
      throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:MODELED_EXECUTION_REGISTRY_SOURCE");
    }
  }
  const riskArtifacts = produced.stageBundles.MODELED_RISK.artifacts.map((artifact) =>
    validateHistoricalSimulationModeledAtomicArtifactV2(
      scope,
      produced.ledgerEntry.cycleId,
      artifact,
    ),
  );
  const verdictArtifact = riskArtifacts.find(
    (artifact) =>
      artifact.sourceContentDigestHex === produced.ledgerEntry.risk.verdictContentDigestHex,
  );
  if (
    produced.ledgerEntry.risk.verdictContentDigestHex &&
    (!verdictArtifact ||
      verdictArtifact.sourcePayload.verdict !== produced.ledgerEntry.risk.status ||
      verdictArtifact.sourcePayload.decisionContentDigestHex !==
        produced.ledgerEntry.decision.decisionContentDigestHex ||
      verdictArtifact.sourcePayload.riskAllowanceContentDigestHex !==
        produced.ledgerEntry.risk.allowanceContentDigestHex)
  ) {
    throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:MODELED_RISK_PAYLOAD_SOURCE");
  }
  const decisionCarrier =
    verdictArtifact ??
    riskArtifacts.find(
      (artifact) =>
        artifact.sourceContentDigestHex === computeSemanticSha256Hex(produced.ledgerEntry.risk),
    );
  if (decisionCarrier) {
    if (produced.ledgerEntry.forecast.status === "NON_ACTIONABLE") {
      const terminal = decisionCarrier.lineagePayload?.forecastTerminal;
      const exitTerminal = Boolean(terminal && typeof terminal === "object" &&
        Object.prototype.hasOwnProperty.call(terminal, "portfolio"));
      const terminalExpected = exitTerminal ? {
        forecast: produced.ledgerEntry.forecast,
        decision: produced.ledgerEntry.decision,
        portfolio: produced.ledgerEntry.portfolio,
      } : {
        forecast: produced.ledgerEntry.forecast,
        decision: produced.ledgerEntry.decision,
      };
      const terminalStageStatusValid = exitTerminal
        ? ((produced.ledgerEntry.portfolio.action === "CLOSE" ||
            produced.ledgerEntry.portfolio.action === "REDUCE") &&
          verdictArtifact?.sourcePayload.action === produced.ledgerEntry.portfolio.action &&
          ((produced.ledgerEntry.risk.status === "APPROVE" &&
              produced.ledgerEntry.execution.status === "COMMITTED") ||
            (produced.ledgerEntry.risk.status === "VETO" &&
              produced.ledgerEntry.execution.status === "NOT_DISPATCHED")))
        : produced.ledgerEntry.risk.status === "NOT_EVALUATED" &&
          produced.ledgerEntry.execution.status === "NOT_DISPATCHED";
      if (
        !terminal ||
        canonicalizeSemanticJsonString(terminal) !==
          canonicalizeSemanticJsonString(terminalExpected) ||
        produced.ledgerEntry.decision.status !== "CASH" ||
        !terminalStageStatusValid ||
        decisionCarrier.lineagePayload?.decisionReceipt ||
        decisionCarrier.lineagePayload?.whyNotCashReceipt
      ) {
        throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:FORECAST_TERMINAL_LINEAGE");
      }
    } else {
      const decisionReceipt = decisionCarrier.lineagePayload?.decisionReceipt as
        | DecisionEvaluationReceiptV1
        | undefined;
      const whyNotCashReceipt = decisionCarrier.lineagePayload?.whyNotCashReceipt as
        | WhyNotCashReceiptV2
        | undefined;
      if (
        !decisionReceipt ||
        !whyNotCashReceipt ||
        validateDecisionEvaluationReceiptV1(decisionReceipt).length !== 0 ||
        validateWhyNotCashReceiptV2(whyNotCashReceipt).length !== 0 ||
        decisionReceipt.contentDigestHex !==
          produced.ledgerEntry.decision.decisionContentDigestHex ||
        decisionReceipt.selectedAction !== produced.ledgerEntry.decision.status ||
        whyNotCashReceipt.selectedAction !== produced.ledgerEntry.decision.status ||
        canonicalizeSemanticJsonString(whyNotCashReceipt.reasonCodes) !==
          canonicalizeSemanticJsonString(produced.ledgerEntry.decision.reasonCodes) ||
        whyNotCashReceipt.contentDigestHex !==
          produced.ledgerEntry.decision.whyNotCashReceiptDigestHex ||
        decisionReceipt.whyNotCashReceiptDigestHex !== whyNotCashReceipt.contentDigestHex
      ) {
        throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:DECISION_RECEIPT_LINEAGE");
      }
    }
  }
  const learningArtifacts = produced.stageBundles.LEARNING.artifacts.map((artifact) =>
    validateHistoricalSimulationModeledAtomicArtifactV2(
      scope,
      produced.ledgerEntry.cycleId,
      artifact,
    ),
  );
  assertHistoricalSimulationLearningSnapshotTransitionV2({
    previousSnapshot: previousCursor?.learningSnapshot ?? null,
    nextSnapshot: produced.learningSnapshot,
    artifacts: learningArtifacts,
  });
  const guardian = validateHistoricalSimulationModeledAtomicArtifactV2(
    scope,
    produced.ledgerEntry.cycleId,
    produced.stageBundles.GUARDIAN.artifacts[0],
  );
  const guardianState = produced.guardianSnapshot.state as Readonly<{
    assessmentContentDigestHex: string;
    posture: string;
  }>;
  if (
    guardian.sourceContentDigestHex !== guardianState.assessmentContentDigestHex ||
    guardian.sourcePayload.status !== guardianState.posture
  ) {
    throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:GUARDIAN_SNAPSHOT_SOURCE");
  }
  const knowledge = validateHistoricalSimulationModeledAtomicArtifactV2(
    scope,
    produced.ledgerEntry.cycleId,
    produced.stageBundles.KNOWLEDGE.artifacts[0],
  );
  const knowledgeState = produced.knowledgeSnapshot.state as Readonly<{
    checkpointContentDigestHex: string;
    checkpointSequence: number;
  }>;
  if (
    knowledge.sourceContentDigestHex !== knowledgeState.checkpointContentDigestHex ||
    knowledge.sourcePayload.checkpointSequence !== knowledgeState.checkpointSequence
  ) {
    throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:KNOWLEDGE_SNAPSHOT_SOURCE");
  }
  for (const effect of produced.ledgerEntry.observedExecutionEffects) {
    const receipt = receipts.find((candidate) => candidate.orderId === effect.originatingOrderId);
    if (
      !receipt ||
      receipt.decisionId !== effect.originatingDecisionId ||
      receipt.decisionContentDigestHex !== effect.originatingDecisionContentDigestHex ||
      receipt.executionPlanId !== effect.originatingPlanId ||
      receipt.executionPlanContentDigestHex !== effect.originatingPlanContentDigestHex ||
      receipt.executionAttemptId !== effect.originatingAttemptId ||
      receipt.executionAttemptContentDigestHex !== effect.originatingAttemptContentDigestHex ||
      receipt.orderContentDigestHex !== effect.originatingOrderContentDigestHex
    ) {
      throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:MODELED_EFFECT_RECEIPT_LINEAGE");
    }
    const reportBody = {
      schemaVersion: "waia.trader.historical_modeled_execution_report.v2",
      source: "MODELED_HISTORICAL",
      capitalEligible: false,
      cycleId: produced.ledgerEntry.cycleId,
      decisionId: effect.originatingDecisionId,
      decisionContentDigestHex: effect.originatingDecisionContentDigestHex,
      executionPlanId: effect.originatingPlanId,
      executionPlanContentDigestHex: effect.originatingPlanContentDigestHex,
      orderId: effect.originatingOrderId,
      orderContentDigestHex: effect.originatingOrderContentDigestHex,
      executionAttemptId: effect.originatingAttemptId,
      executionAttemptContentDigestHex: effect.originatingAttemptContentDigestHex,
      status: effect.status,
      fillEvidenceContentDigestHexes: effect.fillContentDigestHexes,
    };
    const reportDigest = computeSemanticSha256Hex(reportBody);
    if (!effect.reportContentDigestHexes.includes(reportDigest)) {
      throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:MODELED_EFFECT_REPORT_SOURCE");
    }
    const effectArtifacts = produced.stageBundles.OBSERVED_EXECUTION_EFFECTS.artifacts.map(
      (artifact) =>
        validateHistoricalSimulationModeledAtomicArtifactV2(
          scope,
          produced.ledgerEntry.cycleId,
          artifact,
        ),
    );
    if (
      !effectArtifacts.some(
        (artifact) =>
          artifact.sourceContentDigestHex === reportDigest &&
          canonicalizeSemanticJsonString(artifact.sourcePayload) ===
            canonicalizeSemanticJsonString(reportBody),
      ) ||
      effect.fillContentDigestHexes.some(
        (digest) =>
          !effectArtifacts.some(
            (artifact) =>
              artifact.sourceContentDigestHex === digest &&
              artifact.sourcePayload.orderId === effect.originatingOrderId &&
              artifact.sourcePayload.cycleId === produced.ledgerEntry.cycleId &&
              artifact.lineagePayload &&
              artifact.lineagePayload.originatingDecisionId === effect.originatingDecisionId &&
              artifact.lineagePayload.originatingDecisionContentDigestHex ===
                effect.originatingDecisionContentDigestHex &&
              artifact.lineagePayload.originatingPlanId === effect.originatingPlanId &&
              artifact.lineagePayload.originatingAttemptId === effect.originatingAttemptId &&
              artifact.lineagePayload.status === effect.status &&
              artifact.lineagePayload.fillDetail &&
              typeof artifact.lineagePayload.fillDetail === "object",
          ),
      )
    ) {
      throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:MODELED_EFFECT_PAYLOAD_SOURCE");
    }
    const fillIds = effectArtifacts
      .filter((artifact) => effect.fillContentDigestHexes.includes(artifact.sourceContentDigestHex))
      .map((artifact) => artifact.sourcePayload.fillId);
    const accounting = produced.accountingFrontierSnapshot.state as Readonly<{
      consumedFillIds: readonly string[];
    }>;
    if (
      new Set(fillIds).size !== fillIds.length ||
      fillIds.some((id) => typeof id !== "string" || !accounting.consumedFillIds.includes(id))
    ) {
      throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:MODELED_EFFECT_ACCOUNTING_SOURCE");
    }
    for (const artifact of effectArtifacts.filter((value) =>
      effect.fillContentDigestHexes.includes(value.sourceContentDigestHex),
    )) {
      const detail = artifact.lineagePayload!.fillDetail as Record<string, unknown>;
      assertHistoricalSimulationFillDetailParityV2({
        organizationId: scope.organizationId,
        cycleId: produced.ledgerEntry.cycleId,
        orderId: effect.originatingOrderId,
        symbol: receipt.symbol,
        side: receipt.side,
        evidence: artifact.sourcePayload,
        detail,
        consumedFillIds: accounting.consumedFillIds,
      });
    }
  }
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

async function verifyCommitRequestSources(
  sql: postgres.Sql,
  request: HistoricalSimulationCommitRequestV2,
  produced?: ProducedCycle,
): Promise<void> {
  const waiaSha = process.env.WAIA_RELEASE_SHA?.toLowerCase();
  const vercelSha = process.env.VERCEL_GIT_COMMIT_SHA?.toLowerCase();
  if (waiaSha && vercelSha && waiaSha !== vercelSha) {
    throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:RELEASE_SHA_CONFLICT");
  }
  const releaseSha = waiaSha ?? vercelSha ?? "";
  if (!/^[0-9a-f]{40}$/.test(releaseSha) || request.codeSha !== releaseSha) {
    throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:RELEASE_SHA");
  }
  const verifierDigest = computeStableJsonDigest({
    verifierVersion: "historical-simulation-v2-canonical-verifier/1",
    releaseSha,
  });
  const commonRows = await sql<
    {
      membership_content_digest_hex: string;
      membership_json: HistoricalDatasetMembershipV2;
      verifier_code_digest_hex: string;
    }[]
  >`
    SELECT d.membership_content_digest_hex,d.membership_json,c.verifier_code_digest_hex
    FROM trader_historical_dataset_authority_v2 d
    JOIN trader_historical_simulation_policy_config_v2 c
      ON c.organization_id=d.organization_id AND c.run_id=d.run_id
     AND c.policy_config_digest_hex=${request.policyConfigContentDigestHex}
    WHERE d.organization_id=${request.organizationId}::uuid
      AND d.run_id=${request.runId} AND d.cycle_id=${request.cycleId}
      AND d.membership_content_digest_hex=${request.datasetMembershipContentDigestHex}
      AND (d.sealed_cycle_json #>> '{closedBar,barCloseTime}')=${request.replayBarClosedAtUtc}`;
  if (
    commonRows.length !== 1 ||
    commonRows[0]?.verifier_code_digest_hex !== verifierDigest ||
    canonicalizeSemanticJsonString(commonRows[0].membership_json) !==
      canonicalizeSemanticJsonString(request.datasetMembership)
  ) {
    throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:COMMIT_REQUEST_SOURCE");
  }
  let forecastStatus = produced?.ledgerEntry.forecast.status;
  let persistedSource: HistoricalForecastNonActionableSourceV2 | undefined;
  let persistedVerification:
    | HistoricalForecastNonActionableVerificationV2
    | undefined;
  if (!forecastStatus) {
    const rows = await sql<Array<Readonly<{ forecast_json: Readonly<{ status?: string }> }>>>`
      SELECT forecast_json FROM trader_historical_simulation_reason_ledger_v2
      WHERE organization_id=${request.organizationId}::uuid
        AND account_id=${request.accountId} AND run_id=${request.runId}
        AND cycle_id=${request.cycleId}
        AND content_digest_hex=${request.ledgerEntryContentDigestHex}`;
    forecastStatus = rows[0]?.forecast_json.status as typeof forecastStatus;
  }
  if (forecastStatus === "NON_ACTIONABLE") {
    if (produced) {
      persistedSource = produced.stageBundles.FORECAST_LIFECYCLE.artifacts[0]
        ?.payload as HistoricalForecastNonActionableSourceV2 | undefined;
      persistedVerification = produced.stageBundles.CANONICAL_VERIFICATION.artifacts[0]
        ?.payload as HistoricalForecastNonActionableVerificationV2 | undefined;
    } else {
      const rows = await sql<Array<Readonly<{ stage: string; artifacts_json: Array<Readonly<{
          artifactKind: string; contentDigestHex: string; payload?: unknown }>> }>>>`
        SELECT stage,artifacts_json
        FROM trader_historical_simulation_atomic_stage_v2
        WHERE organization_id=${request.organizationId}::uuid
          AND account_id=${request.accountId} AND run_id=${request.runId}
          AND cycle_id=${request.cycleId}
          AND stage IN ('FORECAST_LIFECYCLE','CANONICAL_VERIFICATION')`;
      persistedSource = rows.find((row) => row.stage === "FORECAST_LIFECYCLE")
        ?.artifacts_json.find((artifact) =>
          artifact.artifactKind === "FORECAST_NON_ACTIONABLE")
        ?.payload as HistoricalForecastNonActionableSourceV2 | undefined;
      persistedVerification = rows.find((row) => row.stage === "CANONICAL_VERIFICATION")
        ?.artifacts_json.find((artifact) =>
          artifact.artifactKind === "FORECAST_NON_ACTIONABLE_VERIFICATION")
        ?.payload as HistoricalForecastNonActionableVerificationV2 | undefined;
    }
    if (!persistedSource || !persistedVerification ||
        persistedSource.contentDigestHex !== request.forecastInputAuthorityContentDigestHex) {
      throw new Error(
        "HISTORICAL_SIMULATION_RESUME_REFUSED:NON_ACTIONABLE_COMMIT_SOURCE",
      );
    }
    assertHistoricalForecastNonActionableSourceV2(persistedSource, {
      organizationId: request.organizationId,
      accountId: request.accountId,
      runId: request.runId,
      cycleId: request.cycleId,
      symbol: request.datasetMembership.symbol,
      pitAnchor: request.replayBarClosedAtUtc,
      datasetMembershipContentDigestHex:
        request.datasetMembershipContentDigestHex,
    });
    assertHistoricalForecastNonActionableVerificationV2(persistedVerification, {
      source: persistedSource,
      releaseSha,
    });
    const cycleAuthority =
      persistedSource.runtimeInput.historicalIntelligenceCycleAuthority;
    const intelligenceRows = cycleAuthority
      ? await sql<Array<Readonly<{ id: string }>>>`
          SELECT id::text FROM trader_intelligence_cycle_envelope
          WHERE id=${cycleAuthority.envelopeId}::uuid
            AND organization_id=${request.organizationId}::uuid
            AND run_id=${request.runId} AND cycle_id=${request.cycleId}
            AND content_digest=${cycleAuthority.envelopeContentDigestHex}
            AND input_semantic_digest=${cycleAuthority.inputSemanticDigestHex}`
      : [];
    if (intelligenceRows.length !== 1) {
      throw new Error(
        "HISTORICAL_SIMULATION_RESUME_REFUSED:NON_ACTIONABLE_INTELLIGENCE_SOURCE",
      );
    }
    return;
  }
  const authorityRows = await sql<Array<Readonly<{
    authority_bundle_digest_hex: string;
    policy_config_digest_hex: string;
  }>>>`
    SELECT authority_bundle_digest_hex,policy_config_digest_hex
    FROM trader_dee659_authority_preregistration_v2
    WHERE organization_id=${request.organizationId}::uuid
      AND account_id=${request.accountId} AND run_id=${request.runId}
      AND cycle_id=${request.cycleId}
      AND authority_bundle_digest_hex=${request.forecastInputAuthorityContentDigestHex}
      AND policy_config_digest_hex=${request.policyConfigContentDigestHex}`;
  if (forecastStatus !== "AUTHORIZED" || authorityRows.length !== 1) {
    throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:COMMIT_REQUEST_SOURCE");
  }
}

async function appendLedger(
  sql: postgres.Sql,
  entry: HistoricalSimulationReasonLedgerV2,
): Promise<void> {
  await sql`
    INSERT INTO trader_historical_simulation_reason_ledger_v2 (
      entry_id, organization_id, account_id, run_id, cycle_id, cycle_sequence, symbol, partition,
      capital_eligible, replay_bar_closed_at_utc, dataset_membership_content_digest_hex,
      dataset_membership_json, previous_content_digest_hex, forecast_json, decision_json, portfolio_json,
      risk_json, execution_json, observed_execution_effects_json, accounting_json, guardian_json,
      learning_json, content_digest_hex
    ) VALUES (
      ${entry.entryId}, ${entry.organizationId}::uuid, ${entry.accountId}, ${entry.runId}, ${entry.cycleId},
      ${entry.cycleSequence}, ${entry.symbol}, ${entry.partition}, false, ${entry.replayBarClosedAtUtc}::timestamptz,
      ${entry.datasetMembership.contentDigestHex}, ${json(entry.datasetMembership)}::text::jsonb,
      ${entry.previousContentDigestHex}, ${json(entry.forecast)}::text::jsonb,
      ${json(entry.decision)}::text::jsonb, ${json(entry.portfolio)}::text::jsonb,
      ${json(entry.risk)}::text::jsonb, ${json(entry.execution)}::text::jsonb,
      ${json(entry.observedExecutionEffects)}::text::jsonb, ${json(entry.accounting)}::text::jsonb,
      ${json(entry.guardian)}::text::jsonb, ${json(entry.learning)}::text::jsonb,
      ${entry.contentDigestHex}
    )
  `;
  for (const evidence of deriveHistoricalSimulationModeledEvidenceV2(entry)) {
    await sql`
      INSERT INTO trader_historical_simulation_modeled_evidence_v2 (
        evidence_id, organization_id, reason_ledger_entry_id, evidence_kind, evidence_ordinal,
        source_content_digest_hex, evidence_content_digest_hex, payload_json, capital_eligible
      ) VALUES (${evidence.evidenceId}, ${evidence.organizationId}::uuid, ${evidence.reasonLedgerEntryId},
        ${evidence.evidenceKind}, ${evidence.evidenceOrdinal}, ${evidence.sourceContentDigestHex},
        ${evidence.evidenceContentDigestHex}, ${json(evidence.payload)}::text::jsonb, false)
    `;
  }
}

function transactionPort(
  sql: postgres.Sql,
  commitRequest: HistoricalSimulationCommitRequestV2,
): HistoricalSimulationAtomicCycleTransactionV2 {
  return {
    async loadLedgerChain(scope) {
      const rows = await sql<{ entry_json: HistoricalSimulationReasonLedgerV2 }[]>`
        SELECT jsonb_build_object(
          'schemaVersion','waia.trader.historical_simulation_reason_ledger.v2','entryId',entry_id,
          'organizationId',organization_id::text,'accountId',account_id,'runId',run_id,'cycleId',cycle_id,
          'cycleSequence',cycle_sequence,'symbol',symbol,'partition',partition,'capitalEligible',false,
          'replayBarClosedAtUtc',to_char(replay_bar_closed_at_utc AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'datasetMembership',dataset_membership_json,'previousContentDigestHex',previous_content_digest_hex,
          'forecast',forecast_json,'decision',decision_json,'portfolio',portfolio_json,'risk',risk_json,
          'execution',execution_json,'observedExecutionEffects',observed_execution_effects_json,
          'accounting',accounting_json,'guardian',guardian_json,'learning',learning_json,'contentDigestHex',content_digest_hex
        ) AS entry_json
        FROM trader_historical_simulation_reason_ledger_v2
        WHERE organization_id=${scope.organizationId}::uuid AND account_id=${scope.accountId} AND run_id=${scope.runId}
        ORDER BY cycle_sequence
      `;
      return rows.map((row) => row.entry_json);
    },
    async loadResumeCursor(scope) {
      const rows = await sql<
        { checkpoint_json: HistoricalSimulationResumeCursorV2; committed_cycle_sequence: number }[]
      >`
        SELECT checkpoint_json, committed_cycle_sequence
        FROM trader_historical_simulation_resume_checkpoint_v2
        WHERE organization_id=${scope.organizationId}::uuid AND account_id=${scope.accountId} AND run_id=${scope.runId}
        ORDER BY committed_cycle_sequence DESC LIMIT 1
      `;
      const row = rows[0];
      if (!row) return null;
      const stageRows = await sql<
        {
          stage: string;
          bundle_content_digest_hex: string;
          cycle_id: string;
          ledger_entry_content_digest_hex: string;
          artifacts_json: Parameters<
            typeof createHistoricalSimulationAtomicStageBundleV2
          >[0]["artifacts"];
        }[]
      >`
        SELECT l.stage,l.bundle_content_digest_hex,s.cycle_id,s.ledger_entry_content_digest_hex,s.artifacts_json
        FROM trader_historical_simulation_resume_stage_link_v2 l
        JOIN trader_historical_simulation_atomic_stage_v2 s USING
          (organization_id,account_id,run_id,stage,bundle_content_digest_hex)
        WHERE l.organization_id=${scope.organizationId}::uuid AND l.account_id=${scope.accountId} AND l.run_id=${scope.runId}
          AND l.committed_cycle_sequence=${row.committed_cycle_sequence}
          AND s.cycle_sequence=l.committed_cycle_sequence
      `;
      const snapshotRows = await sql<
        { state_kind: string; snapshot_content_digest_hex: string; state_json: unknown }[]
      >`
        SELECT l.state_kind,l.snapshot_content_digest_hex,s.state_json
        FROM trader_historical_simulation_resume_snapshot_link_v2 l
        JOIN trader_historical_simulation_durable_snapshot_v2 s USING
          (organization_id,account_id,run_id,state_kind,snapshot_content_digest_hex)
        WHERE l.organization_id=${scope.organizationId}::uuid AND l.account_id=${scope.accountId} AND l.run_id=${scope.runId}
          AND l.committed_cycle_sequence=${row.committed_cycle_sequence}
          AND s.cycle_sequence=l.committed_cycle_sequence
      `;
      const cursor = row.checkpoint_json;
      if (
        stageRows.length !== HISTORICAL_SIMULATION_ATOMIC_STAGES_V2.length ||
        snapshotRows.length !== STATE_KINDS.length ||
        stageRows.some((stage) => {
          const kind = stage.stage as keyof typeof cursor.cycleStageBundleDigestHexByStage;
          const rebuilt = createHistoricalSimulationAtomicStageBundleV2({
            ...scope,
            stage: kind,
            cycleId: stage.cycle_id,
            ledgerEntryContentDigestHex: stage.ledger_entry_content_digest_hex,
            artifacts: stage.artifacts_json,
          });
          return (
            cursor.cycleStageBundleDigestHexByStage[kind] !== stage.bundle_content_digest_hex ||
            rebuilt.contentDigestHex !== stage.bundle_content_digest_hex
          );
        }) ||
        snapshotRows.some((snapshot) => {
          const key = (
            {
              KNOWLEDGE: "knowledgeSnapshot",
              MODELED_EXECUTION_REGISTRY: "modeledExecutionRegistrySnapshot",
              MODELED_EXCHANGE: "modeledExchangeSnapshot",
              ACCOUNTING_FRONTIER: "accountingFrontierSnapshot",
              GUARDIAN: "guardianSnapshot",
              LEARNING: "learningSnapshot",
            } as const
          )[snapshot.state_kind as (typeof STATE_KINDS)[number]];
          return (
            !key ||
            cursor[key].contentDigestHex !== snapshot.snapshot_content_digest_hex ||
            canonicalizeSemanticJsonString(snapshot.state_json) !==
              canonicalizeSemanticJsonString(cursor[key].state)
          );
        })
      )
        throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:PERSISTED_LINK_DIVERGENCE");
      validateHistoricalSimulationResumeCursorV2(cursor, scope);
      return cursor;
    },
    async persistStageBundle(bundle) {
      const inserted = await sql<
        { stage: string }[]
      >`INSERT INTO trader_historical_simulation_atomic_stage_v2
        (organization_id,account_id,run_id,cycle_sequence,cycle_id,stage,ledger_entry_id,
         ledger_entry_content_digest_hex,artifacts_json,bundle_content_digest_hex,schema_version)
        SELECT ${bundle.organizationId}::uuid,${bundle.accountId},${bundle.runId},l.cycle_sequence,
          ${bundle.cycleId},${bundle.stage},l.entry_id,${bundle.ledgerEntryContentDigestHex},
          ${json(bundle.artifacts)}::text::jsonb,${bundle.contentDigestHex},${bundle.schemaVersion}
        FROM trader_historical_simulation_reason_ledger_v2 l
        WHERE l.organization_id=${bundle.organizationId}::uuid AND l.account_id=${bundle.accountId}
          AND l.run_id=${bundle.runId} AND l.cycle_id=${bundle.cycleId}
          AND l.content_digest_hex=${bundle.ledgerEntryContentDigestHex}
        RETURNING stage`;
      if (inserted.length !== 1)
        throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:STAGE_LEDGER_BINDING");
    },
    appendLedger: (entry) => appendLedger(sql, entry),
    async saveResumeCursor(cursor) {
      const snapshots = STATE_KINDS.map((kind) => ({
        kind,
        snapshot: (
          {
            KNOWLEDGE: cursor.knowledgeSnapshot,
            MODELED_EXECUTION_REGISTRY: cursor.modeledExecutionRegistrySnapshot,
            MODELED_EXCHANGE: cursor.modeledExchangeSnapshot,
            ACCOUNTING_FRONTIER: cursor.accountingFrontierSnapshot,
            GUARDIAN: cursor.guardianSnapshot,
            LEARNING: cursor.learningSnapshot,
          } as const
        )[kind] as HistoricalSimulationDurableStateSnapshotV2,
      }));
      for (const { kind, snapshot } of snapshots)
        await sql`
        INSERT INTO trader_historical_simulation_durable_snapshot_v2
          (organization_id,account_id,run_id,cycle_sequence,cycle_id,state_kind,ledger_entry_id,
           ledger_entry_content_digest_hex,state_json,
           snapshot_content_digest_hex,schema_version)
        VALUES (${cursor.organizationId}::uuid,${cursor.accountId},${cursor.runId},${cursor.nextCycleSequence - 1},
          ${cursor.committedCycleId},${kind},
          (SELECT entry_id FROM trader_historical_simulation_reason_ledger_v2 WHERE organization_id=${cursor.organizationId}::uuid
            AND account_id=${cursor.accountId} AND run_id=${cursor.runId} AND cycle_sequence=${cursor.nextCycleSequence - 1}
            AND content_digest_hex=${cursor.ledgerHeadContentDigestHex}),${cursor.ledgerHeadContentDigestHex},${json(snapshot.state)}::text::jsonb,
          ${snapshot.contentDigestHex},${snapshot.schemaVersion})`;
      await sql`INSERT INTO trader_historical_simulation_resume_checkpoint_v2
        (organization_id,account_id,run_id,split,committed_cycle_sequence,committed_cycle_id,ledger_entry_id,
         ledger_head_content_digest_hex,next_record_index,next_cycle_sequence,dataset_authority_json,
         stage_digest_json,snapshot_digest_json,checkpoint_json,checkpoint_content_digest_hex,commit_request_digest_hex,
         commit_request_json,schema_version)
        VALUES (${cursor.organizationId}::uuid,${cursor.accountId},${cursor.runId},${cursor.split},
          ${cursor.nextCycleSequence - 1},${cursor.committedCycleId},
          (SELECT entry_id FROM trader_historical_simulation_reason_ledger_v2 WHERE organization_id=${cursor.organizationId}::uuid
            AND account_id=${cursor.accountId} AND run_id=${cursor.runId} AND cycle_sequence=${cursor.nextCycleSequence - 1}),
          ${cursor.ledgerHeadContentDigestHex},${cursor.nextRecordIndex},${cursor.nextCycleSequence},
          ${json(cursor.datasetAuthority)}::text::jsonb,
          ${json(cursor.cycleStageBundleDigestHexByStage)}::text::jsonb,
          ${json(Object.fromEntries(snapshots.map(({ kind, snapshot }) => [kind, snapshot.contentDigestHex])))}::text::jsonb,
          ${json(cursor)}::text::jsonb,${cursor.contentDigestHex},${commitRequest.contentDigestHex},
          ${json(commitRequest)}::text::jsonb,
          ${cursor.schemaVersion})`;
      for (const stage of HISTORICAL_SIMULATION_ATOMIC_STAGES_V2)
        await sql`
        INSERT INTO trader_historical_simulation_resume_stage_link_v2 VALUES
          (${cursor.organizationId}::uuid,${cursor.accountId},${cursor.runId},${cursor.nextCycleSequence - 1},
           ${stage},${cursor.cycleStageBundleDigestHexByStage[stage]})`;
      for (const { kind, snapshot } of snapshots)
        await sql`
        INSERT INTO trader_historical_simulation_resume_snapshot_link_v2 VALUES
          (${cursor.organizationId}::uuid,${cursor.accountId},${cursor.runId},${cursor.nextCycleSequence - 1},
           ${kind},${snapshot.contentDigestHex})`;
    },
  };
}

export async function prepareHistoricalSimulationProductionPortsV2<Ports>(
  input: Readonly<{
    tx: postgres.Sql;
    request: HistoricalSimulationCommitRequestV2;
    scope: HistoricalSimulationAtomicScopeV2;
    createPorts(tx: postgres.Sql, previousCursor: HistoricalSimulationResumeCursorV2 | null): Ports;
  }>,
): Promise<
  Readonly<{
    transaction: HistoricalSimulationAtomicCycleTransactionV2;
    previousCursor: HistoricalSimulationResumeCursorV2 | null;
    ports: Ports;
  }>
> {
  const transaction = transactionPort(input.tx, input.request);
  const previousCursor = await transaction.loadResumeCursor(input.scope);
  const ports = input.createPorts(input.tx, previousCursor);
  return Object.freeze({ transaction, previousCursor, ports });
}

/**
 * Durable repository boundary used by the cycle committer.  Keeping the
 * SERIALIZABLE transaction and scope lock here lets crash/restart tests (and
 * future composers) exercise the exact persistence graph without weakening
 * the higher-level canonical-source verification performed by
 * commitHistoricalSimulationCyclePostgresV2.
 */
export function createHistoricalSimulationAtomicCyclePostgresRepositoryV2(
  input: Readonly<{
    sql: postgres.Sql;
    request: HistoricalSimulationCommitRequestV2;
  }>,
): HistoricalSimulationAtomicCycleRepositoryV2 {
  validateHistoricalSimulationCommitRequestV2(input.request);
  return {
    transaction: <T>(callback: (tx: HistoricalSimulationAtomicCycleTransactionV2) => Promise<T>) =>
      withHistoricalSimulationSerializableScopeLockV2(input.sql, input.request, (tx) =>
        callback(transactionPort(tx, input.request)),
      ),
  };
}

async function withHistoricalSimulationSerializableScopeLockV2<T>(
  sql: postgres.Sql,
  request: Pick<HistoricalSimulationCommitRequestV2, "organizationId" | "accountId" | "runId">,
  callback: (tx: postgres.Sql) => Promise<T>,
): Promise<T> {
  // Acquire the session lock before BEGIN: an xact lock acquired inside a
  // SERIALIZABLE transaction can wait while retaining a pre-winner snapshot.
  const reserve = (sql as unknown as { reserve?: postgres.Sql["reserve"] }).reserve;
  const callerHeldSession = typeof reserve !== "function";
  const reserved = callerHeldSession ? null : await reserve.call(sql);
  const connection = (reserved ?? sql) as postgres.Sql;
  // postgres.js reserved handles intentionally omit the top-level parser options object,
  // while drizzle's transaction-scoped executor requires it only to configure codecs.
  // Bind the same immutable client options to the reserved query function; all queries
  // still execute on this one locked connection and therefore remain in the cycle tx.
  if (!(connection as unknown as { options?: unknown }).options) {
    const baseOptions =
      (
        sql as unknown as {
          options?: {
            parsers?: Record<string, unknown>;
            serializers?: Record<string, unknown>;
            [key: string]: unknown;
          };
        }
      ).options ?? {};
    Object.defineProperty(connection, "options", {
      value: {
        ...baseOptions,
        parsers: { ...(baseOptions.parsers ?? {}) },
        serializers: { ...(baseOptions.serializers ?? {}) },
      },
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
  const key = `${request.organizationId}:${request.accountId}:${request.runId}`;
  try {
    await connection`SELECT pg_advisory_lock(hashtextextended(${key},0))`;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        // Register the manually reserved handle as the active transaction as well as
        // issuing BEGIN/COMMIT. Nested Forecast, PIT, and DEE-659 persistence services
        // then reuse this exact transaction instead of attempting a nested BEGIN.
        return await withPostgresSessionTransactionV2(connection, "SERIALIZABLE", () =>
          callback(connection),
        );
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (attempt === 2 || !["40001", "40P01"].includes(code ?? "")) throw error;
      }
    }
    throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:SERIALIZABLE_RETRY_EXHAUSTED");
  } finally {
    try {
      await connection`SELECT pg_advisory_unlock(hashtextextended(${key},0))`;
    } finally {
      // A caller-held runner session spans lifecycle updates and every cycle;
      // only a connection reserved by this helper belongs to this helper.
      reserved?.release();
    }
  }
}

export async function commitHistoricalSimulationCyclePostgresV2<Ports>(
  input: Readonly<{
    sql: postgres.Sql;
    scope: HistoricalSimulationAtomicScopeV2;
    request: HistoricalSimulationCommitRequestV2;
    createPorts(tx: postgres.Sql, previousCursor: HistoricalSimulationResumeCursorV2 | null): Ports;
    produce(
      ports: Ports,
    ): Promise<
      Omit<
        Parameters<typeof commitHistoricalSimulationCycleAtomicallyV2>[0],
        "repository" | "scope"
      >
    >;
  }>,
): Promise<HistoricalSimulationResumeCursorV2> {
  validateHistoricalSimulationCommitRequestV2(input.request);
  if (
    input.request.organizationId !== input.scope.organizationId ||
    input.request.accountId !== input.scope.accountId ||
    input.request.runId !== input.scope.runId ||
    input.request.split !== input.scope.split
  ) {
    throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:COMMIT_REQUEST_SCOPE");
  }
  return withHistoricalSimulationSerializableScopeLockV2(input.sql, input.request, async (tx) => {
    await verifyCommitRequestSources(tx, input.request);
    const committed = await tx<
      {
        checkpoint_json: HistoricalSimulationResumeCursorV2;
        commit_request_digest_hex: string;
        commit_request_json: HistoricalSimulationCommitRequestV2;
        committed_cycle_id: string;
        committed_cycle_sequence: number;
        ledger_head_content_digest_hex: string;
      }[]
    >`
      SELECT checkpoint_json,commit_request_digest_hex,commit_request_json,committed_cycle_id,committed_cycle_sequence,
        ledger_head_content_digest_hex FROM trader_historical_simulation_resume_checkpoint_v2
      WHERE organization_id=${input.scope.organizationId}::uuid AND account_id=${input.scope.accountId}
        AND run_id=${input.scope.runId} AND committed_cycle_sequence=${input.request.cycleSequence}
      `;
    if (committed[0]) {
      const row = committed[0];
      if (
        row.commit_request_digest_hex !== input.request.contentDigestHex ||
        canonicalizeSemanticJsonString(row.commit_request_json) !==
          canonicalizeSemanticJsonString(input.request) ||
        row.committed_cycle_id !== input.request.cycleId ||
        row.ledger_head_content_digest_hex !== input.request.ledgerEntryContentDigestHex
      ) {
        throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:AMBIGUOUS_RETRY");
      }
      const port = transactionPort(tx, input.request);
      const exact = await port.loadResumeCursor(input.scope);
      if (!exact || exact.contentDigestHex !== row.checkpoint_json.contentDigestHex) {
        throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:PERSISTED_RETRY_DIVERGENCE");
      }
      return exact;
    }
    const prepared = await prepareHistoricalSimulationProductionPortsV2({
      tx,
      request: input.request,
      scope: input.scope,
      createPorts: input.createPorts,
    });
    const { transaction, previousCursor } = prepared;
    const produced = await input.produce(prepared.ports);
    if (
      produced.ledgerEntry.cycleSequence !== input.request.cycleSequence ||
      produced.ledgerEntry.cycleId !== input.request.cycleId ||
      produced.ledgerEntry.contentDigestHex !== input.request.ledgerEntryContentDigestHex ||
      produced.ledgerEntry.replayBarClosedAtUtc !== input.request.replayBarClosedAtUtc ||
      produced.ledgerEntry.datasetMembership.contentDigestHex !==
        input.request.datasetMembershipContentDigestHex ||
      canonicalizeSemanticJsonString(produced.ledgerEntry.datasetMembership) !==
        canonicalizeSemanticJsonString(input.request.datasetMembership) ||
      HISTORICAL_SIMULATION_ATOMIC_STAGES_V2.some(
        (stage) =>
          produced.stageBundles[stage].contentDigestHex !==
          input.request.stageBundleDigestHexByStage[stage],
      ) ||
      STATE_KINDS.some((kind) => {
        const snapshot = (
          {
            KNOWLEDGE: produced.knowledgeSnapshot,
            MODELED_EXECUTION_REGISTRY: produced.modeledExecutionRegistrySnapshot,
            MODELED_EXCHANGE: produced.modeledExchangeSnapshot,
            ACCOUNTING_FRONTIER: produced.accountingFrontierSnapshot,
            GUARDIAN: produced.guardianSnapshot,
            LEARNING: produced.learningSnapshot,
          } as const
        )[kind];
        return snapshot.contentDigestHex !== input.request.snapshotContentDigestHexByKind[kind];
      })
    ) {
      throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:COMMIT_REQUEST_BINDING");
    }
    await verifyCanonicalStageArtifacts(tx, input.scope, produced, previousCursor);
    const repository: HistoricalSimulationAtomicCycleRepositoryV2 = {
      transaction: (callback) => callback(transaction),
    };
    return commitHistoricalSimulationCycleAtomicallyV2({
      repository,
      scope: input.scope,
      ...produced,
    });
  });
}

type ClosedCycleIdentityV2 = Readonly<{
  cycleSequence: number;
  cycleId: string;
  datasetMembershipContentDigestHex: string;
  forecastInputAuthorityContentDigestHex: string;
  policyConfigContentDigestHex: string;
  codeSha: string;
}>;

/**
 * Internal production boundary: source load, resume restoration, deterministic production and the
 * 0188 commit all run under one reserved SERIALIZABLE scope lock. Exact committed retries return
 * before producer execution using the immutable source identity stored in the prior request.
 */
async function commitHistoricalSimulationProducedCycleInsideLockV2(
  input: Readonly<{
    sql: postgres.Sql;
    scope: HistoricalSimulationAtomicScopeV2;
    identity: ClosedCycleIdentityV2;
    produce(
      tx: postgres.Sql,
      previousCursor: HistoricalSimulationResumeCursorV2 | null,
    ): Promise<
      Readonly<{
        request: HistoricalSimulationCommitRequestV2;
        produced: ProducedCycle;
      }>
    >;
  }>,
): Promise<HistoricalSimulationResumeCursorV2> {
  return withHistoricalSimulationSerializableScopeLockV2(input.sql, input.scope, async (tx) => {
    const committed = await tx<
      {
        checkpoint_json: HistoricalSimulationResumeCursorV2;
        commit_request_json: HistoricalSimulationCommitRequestV2;
      }[]
    >`
      SELECT checkpoint_json,commit_request_json FROM trader_historical_simulation_resume_checkpoint_v2
      WHERE organization_id=${input.scope.organizationId}::uuid AND account_id=${input.scope.accountId}
        AND run_id=${input.scope.runId} AND committed_cycle_sequence=${input.identity.cycleSequence}`;
    if (committed[0]) {
      const request = committed[0].commit_request_json;
      if (
        request.cycleId !== input.identity.cycleId ||
        request.datasetMembershipContentDigestHex !==
          input.identity.datasetMembershipContentDigestHex ||
        request.forecastInputAuthorityContentDigestHex !==
          input.identity.forecastInputAuthorityContentDigestHex ||
        request.policyConfigContentDigestHex !== input.identity.policyConfigContentDigestHex ||
        request.codeSha !== input.identity.codeSha
      ) {
        throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:IMMUTABLE_SOURCE_RETRY_DIVERGENCE");
      }
      await verifyCommitRequestSources(tx, request);
      const exact = await transactionPort(tx, request).loadResumeCursor(input.scope);
      if (!exact || exact.contentDigestHex !== committed[0].checkpoint_json.contentDigestHex) {
        throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:PERSISTED_RETRY_DIVERGENCE");
      }
      return exact;
    }
    const prior = await tx<{ commit_request_json: HistoricalSimulationCommitRequestV2 }[]>`
      SELECT commit_request_json FROM trader_historical_simulation_resume_checkpoint_v2
      WHERE organization_id=${input.scope.organizationId}::uuid AND account_id=${input.scope.accountId}
        AND run_id=${input.scope.runId} ORDER BY committed_cycle_sequence DESC LIMIT 1`;
    if (prior[0]) {
      validateHistoricalSimulationCommitRequestV2(prior[0].commit_request_json);
      await verifyCommitRequestSources(tx, prior[0].commit_request_json);
    }
    const previousCursor = prior[0]
      ? await transactionPort(tx, prior[0].commit_request_json).loadResumeCursor(input.scope)
      : null;
    if (
      (previousCursor === null && input.identity.cycleSequence !== 0) ||
      (previousCursor !== null && previousCursor.nextCycleSequence !== input.identity.cycleSequence)
    ) {
      throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:SKIPPED_CYCLE_SEQUENCE");
    }
    const closed = await input.produce(tx, previousCursor);
    validateHistoricalSimulationCommitRequestV2(closed.request);
    const request = closed.request;
    const produced = closed.produced;
    if (
      request.organizationId !== input.scope.organizationId ||
      request.accountId !== input.scope.accountId ||
      request.runId !== input.scope.runId ||
      request.split !== input.scope.split ||
      request.cycleSequence !== input.identity.cycleSequence ||
      request.cycleId !== input.identity.cycleId ||
      request.datasetMembershipContentDigestHex !==
        input.identity.datasetMembershipContentDigestHex ||
      request.forecastInputAuthorityContentDigestHex !==
        input.identity.forecastInputAuthorityContentDigestHex ||
      request.policyConfigContentDigestHex !== input.identity.policyConfigContentDigestHex ||
      request.codeSha !== input.identity.codeSha
    ) {
      throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:PRODUCED_SOURCE_IDENTITY");
    }
    await verifyCommitRequestSources(tx, request, produced);
    if (
      produced.ledgerEntry.cycleSequence !== request.cycleSequence ||
      produced.ledgerEntry.cycleId !== request.cycleId ||
      produced.ledgerEntry.replayBarClosedAtUtc !== request.replayBarClosedAtUtc ||
      produced.ledgerEntry.datasetMembership.contentDigestHex !==
        request.datasetMembershipContentDigestHex ||
      produced.ledgerEntry.contentDigestHex !== request.ledgerEntryContentDigestHex ||
      HISTORICAL_SIMULATION_ATOMIC_STAGES_V2.some(
        (stage) =>
          produced.stageBundles[stage].contentDigestHex !==
          request.stageBundleDigestHexByStage[stage],
      ) ||
      STATE_KINDS.some((kind) => {
        const snapshot = (
          {
            KNOWLEDGE: produced.knowledgeSnapshot,
            MODELED_EXECUTION_REGISTRY: produced.modeledExecutionRegistrySnapshot,
            MODELED_EXCHANGE: produced.modeledExchangeSnapshot,
            ACCOUNTING_FRONTIER: produced.accountingFrontierSnapshot,
            GUARDIAN: produced.guardianSnapshot,
            LEARNING: produced.learningSnapshot,
          } as const
        )[kind];
        return snapshot.contentDigestHex !== request.snapshotContentDigestHexByKind[kind];
      })
    ) {
      throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:PRODUCED_REQUEST_BINDING");
    }
    await verifyCanonicalStageArtifacts(tx, input.scope, produced, previousCursor);
    const transaction = transactionPort(tx, request);
    return commitHistoricalSimulationCycleAtomicallyV2({
      repository: { transaction: (callback) => callback(transaction) },
      scope: input.scope,
      ...produced,
    });
  });
}

/**
 * Sole public next-cycle production entry. The caller supplies identity only; source selection,
 * release/policy binding, fresh retry-local runtime construction and persistence remain behind
 * the reserved SERIALIZABLE scope lock.
 */
type HistoricalSimulationLoadedAuthorizedProductionCycleV2 = Readonly<{
  status: "FORECAST_AUTHORIZED";
  membership: HistoricalSimulationV2Cycle["datasetMembership"];
  sealedCycle: HistoricalSealedMarketCycleV2;
  forecastInput: Parameters<
    typeof import("@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2").issueForecastRuntimeV2
  >[0];
  forecastId: string;
  forecastContentDigestHex: string;
  forecastAuthorityContentDigestHex: string;
  knowledgeContentDigestHex: string;
  datasetAuthorityId: string;
  datasetAuthorityDigestHex: string;
  pitAnchor: string;
  dee659PreregistrationId: string;
  dee659BundleContentDigestHex: string;
  canonicalVerificationReceiptId: string;
  decisionAuthorities: PersistedDecisionEconomicsAuthoritiesV2;
}>;

type HistoricalSimulationLoadedNonActionableProductionCycleV2 = Readonly<{
  status: "NON_ACTIONABLE";
  membership: HistoricalSimulationV2Cycle["datasetMembership"];
  sealedCycle: HistoricalSealedMarketCycleV2;
  forecastInput: Parameters<
    typeof import("@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2").issueForecastRuntimeV2
  >[0];
  nonActionableSource: HistoricalForecastNonActionableSourceV2;
  nonActionableVerification: HistoricalForecastNonActionableVerificationV2;
}>;

type HistoricalSimulationLoadedProductionCycleV2 =
  | HistoricalSimulationLoadedAuthorizedProductionCycleV2
  | HistoricalSimulationLoadedNonActionableProductionCycleV2;

type Source = HistoricalSimulationLoadedProductionCycleV2;
type CycleIdentitySource = Pick<Source, "membership" | "sealedCycle">;
type SourceAuthority = Readonly<{
  source: Source;
  defaultQuantity: string;
  policyConfigContentDigestHex: string;
  forecastInputAuthorityContentDigestHex: string;
}>;

function initialRuntime(
  accounting: Awaited<ReturnType<typeof loadHistoricalSimulationInceptionAccountingV2>>,
): HistoricalSimulationProductionRuntimeStateV2 {
  const model = createHistoricalExecutionModelV1();
  return Object.freeze({
    model,
    exchange: createHistoricalSimulatedExchange(model),
    executionRegistry: createHistoricalModeledExecutionRegistryV2(),
    executionReceipts: Object.freeze([]),
    accounting,
    knowledge: Object.freeze({
      checkpointSequence: 0,
      checkpointContentDigestHex: computeSemanticSha256Hex({ inception: true }),
      durableCheckpointContentDigestHex: computeSemanticSha256Hex({ durableInception: true }),
      knowledgeContentDigestHex: computeSemanticSha256Hex({ inception: true }),
      visibleThroughPitAnchor: accounting.frontierAsOf,
    }),
    guardian: Object.freeze({
      assessmentContentDigestHex: computeSemanticSha256Hex({ posture: "NONE", inception: true }),
      posture: "NONE" as const,
      assessedAt: accounting.frontierAsOf,
    }),
    learning: Object.freeze({
      appliedClosureWatermarkUtc: null,
      pendingForecastAuthorityContentDigestHexes: Object.freeze([]),
    }),
  });
}

/**
 * @internal Package-private deterministic producer used only by the locked
 * identity entrypoint. It is intentionally absent from every public barrel.
 * It accepts canonical data loaded by that entrypoint, never caller ports.
 */
async function produceHistoricalSimulationNextCycleV2(
  input: Readonly<{
    tx: postgres.Sql;
    scope: HistoricalSimulationAtomicScopeV2;
    source: CycleIdentitySource;
    sourceAuthority?: SourceAuthority;
    finalizeSourceAuthority?: (
      accounting: HistoricalSimulationProductionRuntimeStateV2["accounting"],
    ) => Promise<SourceAuthority>;
    previousCursor: HistoricalSimulationResumeCursorV2 | null;
    codeSha: string;
  }>,
) {
  const { scope } = input;
  const cycleIdentity = input.source;
  const cycleId = cycleIdentity.sealedCycle.cycleId;
  const cycle: HistoricalSimulationV2Cycle = Object.freeze({
    cycleId,
    observedAt: cycleIdentity.sealedCycle.closedBar.barCloseTime,
    symbol: cycleIdentity.sealedCycle.closedBar.symbol.replace("/", ""),
    referencePrice: String(cycleIdentity.sealedCycle.closedBar.close),
    datasetMembership: cycleIdentity.membership,
  });
  const repos = createHistoricalSimulationProductionTransactionRepositoriesV2(input.tx);
  const inceptionSource = input.sourceAuthority?.source.status === "FORECAST_AUTHORIZED"
    ? input.sourceAuthority.source
    : undefined;
  if (!input.previousCursor && !inceptionSource) {
    throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:INCEPTION_AUTHORITY");
  }
  let runtime = input.previousCursor
    ? restoreHistoricalSimulationProductionRuntimeStateV2({ scope, cursor: input.previousCursor })
    : initialRuntime(
        await loadHistoricalSimulationInceptionAccountingV2({
          tx: input.tx,
          scope,
          preregistrationId: inceptionSource!.dee659PreregistrationId,
          expectedAuthorityBundleContentDigestHex: inceptionSource!.dee659BundleContentDigestHex,
        }),
      );
  const previousLedger = input.previousCursor
    ? ((
        await input.tx<{ entry_json: HistoricalSimulationReasonLedgerV2 }[]>`
    SELECT jsonb_build_object('schemaVersion','waia.trader.historical_simulation_reason_ledger.v2','entryId',entry_id,
      'organizationId',organization_id::text,'accountId',account_id,'runId',run_id,'cycleId',cycle_id,
      'cycleSequence',cycle_sequence,'symbol',symbol,'partition',partition,'capitalEligible',false,
      'replayBarClosedAtUtc',to_char(replay_bar_closed_at_utc AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'datasetMembership',dataset_membership_json,'previousContentDigestHex',previous_content_digest_hex,'forecast',forecast_json,
      'decision',decision_json,'portfolio',portfolio_json,'risk',risk_json,'execution',execution_json,
      'observedExecutionEffects',observed_execution_effects_json,'accounting',accounting_json,'guardian',guardian_json,
      'learning',learning_json,'contentDigestHex',content_digest_hex) entry_json
    FROM trader_historical_simulation_reason_ledger_v2 WHERE organization_id=${scope.organizationId}::uuid
      AND account_id=${scope.accountId} AND run_id=${scope.runId} AND cycle_sequence=${input.previousCursor.nextCycleSequence - 1}`
      )[0]?.entry_json ?? null)
    : null;
  const knowledge = createHistoricalSimulationPostgresKnowledgeReadPortV2({
    sql: input.tx,
    organizationId: scope.organizationId,
    runId: scope.runId,
    symbol:
      scope.split === "DEVELOPMENT" || scope.split === "WALK_FORWARD"
        ? cycleIdentity.sealedCycle.closedBar.symbol.replace("/", "")
        : "",
    appliedClosureWatermarkUtc: runtime.learning.appliedClosureWatermarkUtc,
  });
  const modeledEvidence: Array<
    | HistoricalModeledRiskReceiptV2
    | HistoricalModeledExecutionReceiptV2
    | HistoricalModeledGuardianReceiptV2
  > = [];
  let currentAccounting = runtime.accounting;
  let advanceResult: AdvanceHistoricalModeledExecutionV2Result | null = null;
  const advance = createAdvanceHistoricalModeledExecutionV2({
    context: { organizationId: scope.organizationId },
    accountKey: scope.accountId,
    runId: scope.runId,
    exchange: runtime.exchange,
    executionRegistry: runtime.executionRegistry,
    model: runtime.model,
    persistence: createHistoricalSimulationExecutionPersistenceV2({
      orders: repos.orders,
      model: runtime.model,
    }),
    accountingRepository: Object.freeze({
      loadLatest: async () => runtime.accounting,
      append: async (context, frontier) => {
        await repos.accounting.append(context, frontier);
        return frontier;
      },
    }),
    resolveMarketCycle: async (id) => {
      if (id !== cycleId) throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:CYCLE_ID");
      return cycleIdentity.sealedCycle;
    },
    initialAccountingFrontier: async () => runtime.accounting,
    refreshAccountState: async () => ({
      positions: Object.entries(currentAccounting.positions).map(([symbol, position]) => ({
        symbol,
        quantity: position.quantity,
      })),
      openOrderCount: runtime.exchange.listOpenOrders().length,
      dailyPnl: currentAccounting.netRealizedPnl,
      drawdown: String(currentAccounting.accountDrawdownBps),
      quoteExposureByCurrency: Object.freeze({}),
      availableBalanceUsdt: currentAccounting.cash,
      equityUsdt: currentAccounting.equity,
      openPositionCount: Object.values(currentAccounting.positions).filter(
        (position) => position.quantity !== "0",
      ).length,
    }),
    reconcileOrder: async () => undefined,
    resolveLatestOrder: (id) =>
      repos.orders.getOrderById({ organizationId: scope.organizationId }, id),
    persistAdvanceEvidence: async (bundle) => {
      advanceResult = Object.freeze({
        fillCount: bundle.fillEvidence.length,
        fillEvidence: bundle.fillEvidence,
        fillDetails: bundle.fillDetails,
        accountingFrontierContentDigestHex:
          bundle.fillDetails.at(-1)?.accountingFrontier.semanticContentDigest ??
          runtime.accounting.semanticContentDigest,
        accountingFrontier: bundle.fillDetails.at(-1)?.accountingFrontier ?? runtime.accounting,
        accountingAdvanced: bundle.fillEvidence.length > 0,
        effects: bundle.effects,
      });
    },
  });
  // Chronology is strict: orders accepted on earlier bars are advanced on the
  // current closed bar before Forecast/Decision/Risk observe capital.  The
  // ledger projection below consumes this exact result and must never advance
  // the exchange a second time for the same bar.
  const currentBarAdvance = await advance(cycleId);
  advanceResult = currentBarAdvance;
  currentAccounting = currentBarAdvance.accountingFrontier;
  const sourceAuthority = input.sourceAuthority ??
    await input.finalizeSourceAuthority?.(currentAccounting);
  if (!sourceAuthority) {
    throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:SOURCE_AUTHORITY");
  }
  const source = sourceAuthority.source;
  if (
    source.sealedCycle.cycleId !== cycleId ||
    source.sealedCycle.contentDigestHex !== cycleIdentity.sealedCycle.contentDigestHex ||
    source.membership.contentDigestHex !== cycleIdentity.membership.contentDigestHex
  ) {
    throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:POST_ADVANCE_SOURCE_IDENTITY");
  }
  const authorityPort = Object.freeze({
    async load() {
      if (source.status !== "FORECAST_AUTHORIZED") {
        throw new Error(
          "HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:NON_ACTIONABLE_DECISION_AUTHORITY",
        );
      }
      return source.decisionAuthorities;
    },
  });
  const decisionBuilder = createHistoricalDecisionEconomicsProductionInputBuilderV2({
    organizationId: scope.organizationId,
    accountId: scope.accountId,
    authorities: authorityPort,
  });
  const coordinator = createHistoricalDecisionEconomicsCapitalCoordinatorV2({
    organizationId: scope.organizationId,
    accountId: scope.accountId,
    buildEvaluationInput: source.status === "FORECAST_AUTHORIZED"
      ? decisionBuilder
      : async () => {
          throw new Error(
            "HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:NON_ACTIONABLE_DECISION_EVALUATION",
          );
        },
  });
  let currentBarAdvanceConsumed = false;
  const binding = createHistoricalModeledCapitalBindingV2({
    organizationId: scope.organizationId,
    accountId: scope.accountId,
    runId: scope.runId,
    resolveCycle: (id) => {
      if (id !== cycleId) throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:CYCLE_ID");
      return cycle;
    },
    decide: coordinator.decide,
    loadAccounting: async () => ({
      frontier: currentAccounting,
      // Existing accepted BUY orders have not reached Accounting yet. Their remaining quantity is
      // valued at this cycle's sealed reference price and included in the worst-case envelope.
      worstCasePendingExposureNotional: runtime.exchange
        .listOpenOrders()
        .reduce(
          (sum, entry) =>
            entry.order.side === "buy"
              ? addDecimal(
                  sum,
                  multiplyDecimal(
                    subtractDecimal(entry.order.quantity, entry.order.filledQuantity),
                    cycle.referencePrice,
                  ),
                )
              : sum,
          "0",
        ),
      outstandingReservationNotional: "0",
      exposureLimitNotional: currentAccounting.equity,
      posture:
        runtime.guardian.posture === "NONE"
          ? "NORMAL"
          : runtime.guardian.posture === "STOP_ACCOUNT"
            ? "HALT"
            : "CLOSE_ONLY",
    }),
    exchange: runtime.exchange,
    executionRegistry: runtime.executionRegistry,
    decisionBarIndex: () => source.sealedCycle.barIndex,
    evaluateGuardian: async () => ({
      status: runtime.guardian.posture,
      reasonCodes: runtime.guardian.posture === "NONE" ? [] : ["RESTORED_GUARDIAN_POSTURE"],
    }),
    persistEvidence: async (e) => {
      modeledEvidence.push(e);
    },
    persistExecutionSubmission: async ({ receipt, riskAllowanceId }) =>
      persistHistoricalModeledExecutionSubmissionV2({
        context: { organizationId: scope.organizationId },
        orders: repos.orders,
        organizationId: scope.organizationId,
        accountId: scope.accountId,
        runId: scope.runId,
        decisionId: receipt.decisionId,
        riskAllowanceId,
        receipt,
      }),
    advanceModeledExecution: async () => {
      if (currentBarAdvanceConsumed) {
        throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:ADVANCE_ALREADY_CONSUMED");
      }
      currentBarAdvanceConsumed = true;
      return {
        observedExecutionEffects:
          projectHistoricalModeledEffectsToReasonLedgerV2(currentBarAdvance),
        accountingAdvanced: currentBarAdvance.accountingAdvanced,
      };
    },
    learningProjection: async (context) =>
      loadHistoricalProductionLearningProjectionV2({
        sql: input.tx,
        organizationId: scope.organizationId,
        runId: scope.runId,
        symbol: cycle.symbol,
        pitAnchor: context.cycle.observedAt,
        closures: context.closures,
      }),
  });
  const result = await runHistoricalSimulationV2({
    organizationId: scope.organizationId,
    accountId: scope.accountId,
    runId: scope.runId,
    split: scope.split === "DEVELOPMENT" ? "development" : "walk_forward",
    authority: "HISTORICAL_SIMULATION_V2",
    cycles: [cycle],
    defaultQuantity: sourceAuthority.defaultQuantity,
    knowledge,
    resolveForecastInput: async () => source.forecastInput,
    resolvePortfolioProposal: async (context) => {
      const decisionProposal = await coordinator.resolvePortfolioProposal(context);
      const accounting = deriveHistoricalModeledRiskAccountingV2({
        frontier: currentAccounting,
        organizationId: scope.organizationId,
        accountId: scope.accountId,
        runId: scope.runId,
        exposureLimitNotional: currentAccounting.equity,
        worstCasePendingExposureNotional: "0",
        outstandingReservationNotional: "0",
      });
      const hasPendingModeledOrder = runtime.exchange
        .listOpenOrders()
        .some(
          (entry) =>
            entry.order.symbol === cycle.symbol &&
            entry.order.state !== "FILLED" &&
            entry.order.state !== "CANCELLED",
        );
      return resolveHistoricalModeledPortfolioProposalV2({
        organizationId: scope.organizationId,
        accountId: scope.accountId,
        runId: scope.runId,
        cycleId,
        symbol: cycle.symbol,
        decisionProposal,
        accounting,
        hasPendingModeledOrder,
      });
    },
    decisionCapitalAuthorityV2: binding.decisionCapitalAuthorityV2,
    modeledExit: binding.modeledExit,
    resolveLedgerProjection: binding.resolveLedgerProjection,
    postgresSchemaPreflight: async () => undefined,
    previousReasonLedger: previousLedger,
  });
  const ledger = result.reasonLedger[0];
  if (!ledger || !advanceResult)
    throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:INCOMPLETE_CYCLE");
  const completedAdvance = advanceResult as AdvanceHistoricalModeledExecutionV2Result;
  const risk = modeledEvidence.find(
    (e): e is HistoricalModeledRiskReceiptV2 => "riskVerdictId" in e,
  );
  const execution = modeledEvidence.find(
    (e): e is HistoricalModeledExecutionReceiptV2 => "executionPlanId" in e,
  );
  const guardian = modeledEvidence.find(
    (e): e is HistoricalModeledGuardianReceiptV2 =>
      "accountingFrontierContentDigestHex" in e && "cycleId" in e,
  );
  if (!guardian)
    throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:GUARDIAN_EVIDENCE_MISSING");
  const decisionEvidence =
    ledger.forecast.status === "AUTHORIZED"
      ? coordinator.takeDecisionEvidence(cycleId, ledger.portfolio.action)
      : null;
  const atomicScope = {
    organizationId: scope.organizationId,
    accountId: scope.accountId,
    runId: scope.runId,
    cycleId,
    pitAnchor: cycle.observedAt,
  };
  const capital =
    risk?.verdict === "VETO"
      ? buildHistoricalSimulationModeledVetoArtifactsV2({
          scope: atomicScope,
          ledgerEntry: ledger,
          risk,
          decisionEvidence,
          advance: completedAdvance,
        })
      : risk && execution
        ? buildHistoricalSimulationModeledCapitalArtifactsV2({
            scope: atomicScope,
            ledgerEntry: ledger,
            risk,
            execution,
            advance: completedAdvance,
            decisionEvidence,
          })
        : buildHistoricalSimulationModeledNoopArtifactsV2({
            scope: atomicScope,
            ledgerEntry: ledger,
            decisionEvidence,
            advance: completedAdvance,
          });
  const checkpoint = await knowledge.checkpoint({
    runId: scope.runId,
    checkpointSeq: ledger.cycleSequence + 1,
    pitAnchor: cycle.observedAt,
    modelVersion: "historical-simulation-v2",
  });
  const knowledgePayloadBody = {
    schemaVersion: "waia.trader.historical_knowledge_checkpoint.v2",
    cycleId,
    checkpointSequence: ledger.cycleSequence + 1,
    durableCheckpointContentDigestHex: checkpoint.checkpointContentDigest,
    snapshotContentDigestHex: checkpoint.snapshot.contentDigestHex,
  };
  const knowledgeDigest = computeSemanticSha256Hex(knowledgePayloadBody);
  const pendingForecastAuthorityContentDigestHexes =
    await loadHistoricalProductionPendingForecastsV2({
      sql: input.tx,
      organizationId: scope.organizationId,
      runId: scope.runId,
    });
  runtime = Object.freeze({
    ...runtime,
    accounting: currentAccounting,
    executionReceipts: Object.freeze([
      ...runtime.executionReceipts,
      ...modeledEvidence.filter(
        (e): e is HistoricalModeledExecutionReceiptV2 => "executionPlanId" in e,
      ),
    ]),
    knowledge: Object.freeze({
      checkpointSequence: ledger.cycleSequence + 1,
      checkpointContentDigestHex: knowledgeDigest,
      knowledgeContentDigestHex: checkpoint.snapshot.contentDigestHex,
      durableCheckpointContentDigestHex: checkpoint.checkpointContentDigest,
      visibleThroughPitAnchor: cycle.observedAt,
    }),
    guardian: Object.freeze({
      assessmentContentDigestHex:
        guardian?.contentDigestHex ?? ledger.guardian.assessmentContentDigestHex,
      posture: ledger.guardian.status,
      assessedAt: cycle.observedAt,
    }),
    learning: Object.freeze({
      appliedClosureWatermarkUtc: cycle.observedAt,
      pendingForecastAuthorityContentDigestHexes,
    }),
  });
  const snapshots = snapshotHistoricalSimulationProductionRuntimeStateV2({
    scope,
    cycleId,
    runtime,
  });
  const transitionPayload = Object.freeze({
    schemaVersion: "waia.trader.historical_learning_transition.v2",
    previousState: input.previousCursor?.learningSnapshot.state ?? null,
    nextState: snapshots.learningSnapshot.state,
  });
  const learningDigest = computeSemanticSha256Hex(transitionPayload);
  const guardianPayload = guardian;
  const state = buildHistoricalSimulationModeledStateArtifactsV2({
    scope: atomicScope,
    guardian: {
      id: deterministicExecutionUuidV2("report", { kind: "guardian", cycleId }),
      contentDigestHex: guardianPayload.contentDigestHex,
      payload: guardianPayload,
    },
    knowledge: {
      id: deterministicExecutionUuidV2("report", { kind: "knowledge", cycleId }),
      contentDigestHex: knowledgeDigest,
      payload: Object.freeze({ ...knowledgePayloadBody, contentDigestHex: knowledgeDigest }),
    },
    learning: [
      {
        id: deterministicExecutionUuidV2("report", { kind: "learning", cycleId }),
        contentDigestHex: learningDigest,
        payload: Object.freeze({ ...transitionPayload, contentDigestHex: learningDigest }),
      },
    ],
    previousLearningSnapshot: (input.previousCursor?.learningSnapshot ?? null) as
      | import("./atomic-cycle-commit-v2").HistoricalSimulationDurableStateSnapshotV2<"LEARNING">
      | null,
    nextLearningSnapshot: snapshots.learningSnapshot,
  });
  const portfolioLifecycle = binding.portfolioLifecycleForCycle(cycleId);
  const modeledReality = binding.modeledRealityForCycle(cycleId);
  if (!portfolioLifecycle || !modeledReality) {
    throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:MODELED_REALITY_MISSING");
  }
  const reality = buildHistoricalSimulationModeledRealityArtifactsV2({
    scope: atomicScope,
    reality: modeledReality,
    portfolioLifecycle,
  });
  const canonicalForecastStages = source.status === "FORECAST_AUTHORIZED"
    ? {
        forecast: {
          id: source.forecastId,
          contentDigestHex: source.forecastContentDigestHex,
        },
        canonicalVerification: {
          id: source.canonicalVerificationReceiptId,
          contentDigestHex:
            source.decisionAuthorities.forecastVerificationReceiptDigestHex,
        },
      }
    : {
        forecast: {
          id: deterministicExecutionUuidV2("report", {
            kind: "forecast-non-actionable",
            cycleId,
          }),
          contentDigestHex: source.nonActionableSource.contentDigestHex,
          artifactKind: "FORECAST_NON_ACTIONABLE" as const,
          payload: source.nonActionableSource,
        },
        canonicalVerification: {
          id: deterministicExecutionUuidV2("report", {
            kind: "forecast-non-actionable-verification",
            cycleId,
          }),
          contentDigestHex: source.nonActionableVerification.contentDigestHex,
          artifactKind: "FORECAST_NON_ACTIONABLE_VERIFICATION" as const,
          payload: source.nonActionableVerification,
        },
      };
  const stageBundles = buildHistoricalSimulationProductionStageBundlesV2({
    ledgerEntry: ledger,
    ...canonicalForecastStages,
    accounting: {
      id: completedAdvance.accountingFrontier.id,
      contentDigestHex: completedAdvance.accountingFrontier.semanticContentDigest,
    },
    modeled: Object.freeze({ ...capital, ...reality, ...state }),
  });
  const closed = closeHistoricalSimulationProducedCycleV2({
    scope,
    codeSha: input.codeSha,
    forecastInputAuthorityContentDigestHex:
      sourceAuthority.forecastInputAuthorityContentDigestHex,
    policyConfigContentDigestHex: sourceAuthority.policyConfigContentDigestHex,
    knowledgeCheckpointSequence: ledger.cycleSequence + 1,
    knowledgeCheckpointContentDigestHex: knowledgeDigest,
    ledgerEntry: ledger,
    stageBundles,
    snapshots,
  });
  return Object.freeze({ closed, sourceAuthority });
}

export async function runHistoricalSimulationNextCyclePostgresV2(
  input: HistoricalSimulationV2ClosedGraphRequest,
): Promise<HistoricalSimulationResumeCursorV2> {
  assertHistoricalSimulationV2ClosedGraphRequest(input);
  await assertFhvV2PostgresSchemaPreflight({ sql: input.sql, repoRoot: process.cwd() });
  const scope: HistoricalSimulationAtomicScopeV2 = {
    organizationId: input.organizationId,
    accountId: input.accountId,
    runId: input.runId,
    split: input.partition,
  };
  return withHistoricalSimulationSerializableScopeLockV2(input.sql, scope, async (tx) => {
    const runnerRole = await tx<Array<Readonly<{ current_user: string }>>>`
      SELECT current_user::text AS current_user
    `;
    if (
      runnerRole.length !== 1 ||
      runnerRole[0]?.current_user !== HISTORICAL_SIMULATION_RUNNER_DATABASE_ROLE_V2
    ) {
      throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:DATABASE_RUNNER_ROLE");
    }
    const exactRows = await tx<
      {
        checkpoint_json: HistoricalSimulationResumeCursorV2;
        commit_request_json: HistoricalSimulationCommitRequestV2;
      }[]
    >`
      SELECT checkpoint_json,commit_request_json FROM trader_historical_simulation_resume_checkpoint_v2
      WHERE organization_id=${scope.organizationId}::uuid AND account_id=${scope.accountId} AND run_id=${scope.runId}
        AND committed_cycle_sequence=${input.expectedCycleSequence}`;
    if (exactRows[0]) {
      const request = exactRows[0].commit_request_json;
      validateHistoricalSimulationCommitRequestV2(request);
      if (
        request.organizationId !== scope.organizationId ||
        request.accountId !== scope.accountId ||
        request.runId !== scope.runId ||
        request.split !== scope.split ||
        request.cycleSequence !== input.expectedCycleSequence ||
        request.datasetMembership.symbol !== input.symbol
      ) {
        throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:IMMUTABLE_SOURCE_RETRY_DIVERGENCE");
      }
      await verifyCommitRequestSources(tx, request);
      const exact = exactRows[0].checkpoint_json;
      validateHistoricalSimulationResumeCursorV2(exact, scope);
      if (
        exact.nextCycleSequence !== request.cycleSequence + 1 ||
        exact.committedCycleId !== request.cycleId ||
        exact.ledgerHeadContentDigestHex !== request.ledgerEntryContentDigestHex
      ) {
        throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:PERSISTED_RETRY_DIVERGENCE");
      }
      return exact;
    }
    const latest = await tx<
      {
        checkpoint_json: HistoricalSimulationResumeCursorV2;
        commit_request_json: HistoricalSimulationCommitRequestV2;
      }[]
    >`
      SELECT checkpoint_json,commit_request_json FROM trader_historical_simulation_resume_checkpoint_v2
      WHERE organization_id=${scope.organizationId}::uuid AND account_id=${scope.accountId} AND run_id=${scope.runId}
      ORDER BY committed_cycle_sequence DESC LIMIT 1`;
    const previousCursor = latest[0]?.checkpoint_json ?? null;
    if (previousCursor) {
      validateHistoricalSimulationResumeCursorV2(previousCursor, scope);
      validateHistoricalSimulationCommitRequestV2(latest[0]!.commit_request_json);
      await verifyCommitRequestSources(tx, latest[0]!.commit_request_json);
    }
    const cycleSequence = input.expectedCycleSequence;
    if (
      (previousCursor === null && cycleSequence !== 0) ||
      (previousCursor !== null && previousCursor.nextCycleSequence !== cycleSequence)
    ) {
      throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:SKIPPED_CYCLE_SEQUENCE");
    }
    const expectedRecordIndex =
      previousCursor?.nextRecordIndex ??
      (await loadHistoricalSimulationInitialRecordIndexV2({
        tx,
        organizationId: scope.organizationId,
        accountId: scope.accountId,
        runId: scope.runId,
        partition: scope.split,
        symbol: input.symbol,
      }));
    const cyclePort = createHistoricalSimulationProductionCyclePortV2(tx);
    const loadSourceAuthority = async (
      loaded: Awaited<ReturnType<typeof cyclePort.loadNextExact>>,
    ): Promise<SourceAuthority> => {
      const source: HistoricalSimulationLoadedAuthorizedProductionCycleV2 =
        Object.freeze({ status: "FORECAST_AUTHORIZED" as const, ...loaded });
      const defaultQuantity = source.decisionAuthorities.economicSizeSet.exactQuantities[0];
      if (!defaultQuantity) {
        throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:QUANTITY_AUTHORITY");
      }
      const prereg = await tx<
        { authority_bundle_digest_hex: string; policy_config_digest_hex: string }[]
      >`
        SELECT authority_bundle_digest_hex,policy_config_digest_hex
        FROM trader_dee659_authority_preregistration_v2
        WHERE id=${source.dee659PreregistrationId}::uuid
          AND organization_id=${scope.organizationId}::uuid
          AND account_id=${scope.accountId} AND run_id=${scope.runId}
          AND cycle_id=${source.sealedCycle.cycleId}
          AND dataset_authority_digest_hex=${source.datasetAuthorityDigestHex}`;
      if (
        prereg.length !== 1 ||
        prereg[0]!.authority_bundle_digest_hex !== source.dee659BundleContentDigestHex
      ) {
        throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:PREREGISTRATION_IDENTITY");
      }
      return Object.freeze({
        source,
        defaultQuantity,
        policyConfigContentDigestHex: prereg[0]!.policy_config_digest_hex,
        forecastInputAuthorityContentDigestHex: prereg[0]!.authority_bundle_digest_hex,
      });
    };

    let cycleIdentity: CycleIdentitySource;
    let sourceAuthority: SourceAuthority | undefined;
    let finalizeSourceAuthority:
      | ((accounting: HistoricalSimulationProductionRuntimeStateV2["accounting"]) =>
          Promise<SourceAuthority>)
      | undefined;
    if (previousCursor && scope.split === "WALK_FORWARD") {
      // The current sealed bar is authenticated first, but its Forecast/DEE-659
      // authority is deliberately not created yet. Existing orders must be
      // advanced and marked on this bar before cash/equity authority is sealed.
      const next = await prepareHistoricalProductionNextCycleAuthorityV2({
        tx,
        organizationId: scope.organizationId,
        accountId: scope.accountId,
        runId: scope.runId,
        partition: "WALK_FORWARD",
        symbol: input.symbol,
        expectedRecordIndex,
      });
      cycleIdentity = Object.freeze({
        membership: next.currentMembership,
        sealedCycle: next.currentSealedCycle,
      });
      finalizeSourceAuthority = async (accounting) => {
        const prepared = await prepareHistoricalProductionNextCycleForCommitV2({
          tx,
          organizationId: scope.organizationId,
          accountId: scope.accountId,
          runId: scope.runId,
          partition: "WALK_FORWARD",
          symbol: input.symbol,
          expectedRecordIndex,
          previousCycleId: previousCursor.committedCycleId,
          accountingFrontierId: accounting.id,
          accountingFrontierContentDigestHex: accounting.semanticContentDigest,
          codeSha,
        });
        if (prepared.status === "NON_ACTIONABLE") {
          return Object.freeze({
            source: Object.freeze({
              status: "NON_ACTIONABLE" as const,
              membership: cycleIdentity.membership,
              sealedCycle: cycleIdentity.sealedCycle,
              forecastInput: prepared.source.runtimeInput,
              nonActionableSource: prepared.source,
              nonActionableVerification: prepared.verification,
            }),
            defaultQuantity: prepared.defaultQuantity,
            policyConfigContentDigestHex: prepared.policyConfigContentDigestHex,
            forecastInputAuthorityContentDigestHex: prepared.source.contentDigestHex,
          });
        }
        const source = await cyclePort.loadNextExact({
          organizationId: scope.organizationId,
          accountId: scope.accountId,
          runId: scope.runId,
          partition: "WALK_FORWARD",
          symbol: input.symbol,
          expectedRecordIndex,
        });
        return loadSourceAuthority(source);
      };
    } else {
      // Initial cycles already have their ratified bootstrap authority.
      const source = await cyclePort.loadNextExact({
        organizationId: scope.organizationId,
        accountId: scope.accountId,
        runId: scope.runId,
        partition: scope.split,
        symbol: input.symbol,
        expectedRecordIndex,
      });
      cycleIdentity = source;
      sourceAuthority = await loadSourceAuthority(source);
    }
    const waiaSha = process.env.WAIA_RELEASE_SHA?.toLowerCase();
    const vercelSha = process.env.VERCEL_GIT_COMMIT_SHA?.toLowerCase();
    if (waiaSha && vercelSha && waiaSha !== vercelSha) {
      throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:RELEASE_SHA_CONFLICT");
    }
    const codeSha = waiaSha ?? vercelSha ?? "";
    if (!/^[0-9a-f]{40}$/.test(codeSha))
      throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:RELEASE_SHA");

    const result = await produceHistoricalSimulationNextCycleV2({
      tx,
      scope,
      source: cycleIdentity,
      sourceAuthority,
      finalizeSourceAuthority,
      previousCursor,
      codeSha,
    });
    const { closed, sourceAuthority: committedAuthority } = result;
    const source = committedAuthority.source;
    const { request, produced } = closed;
    validateHistoricalSimulationCommitRequestV2(request);
    if (
      request.organizationId !== scope.organizationId ||
      request.accountId !== scope.accountId ||
      request.runId !== scope.runId ||
      request.split !== scope.split ||
      request.cycleSequence !== cycleSequence ||
      request.cycleId !== source.sealedCycle.cycleId ||
      request.datasetMembershipContentDigestHex !== source.membership.contentDigestHex ||
      request.forecastInputAuthorityContentDigestHex !==
        committedAuthority.forecastInputAuthorityContentDigestHex ||
      request.policyConfigContentDigestHex !==
        committedAuthority.policyConfigContentDigestHex ||
      request.codeSha !== codeSha
    ) {
      throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:PRODUCED_SOURCE_IDENTITY");
    }
    await verifyCommitRequestSources(tx, request, produced);
    await verifyCanonicalStageArtifacts(tx, scope, produced, previousCursor);
    const transaction = transactionPort(tx, request);
    return commitHistoricalSimulationCycleAtomicallyV2({
      repository: {
        transaction: (callback) => callback(transaction),
      },
      scope,
      ...produced,
    });
  });
}
