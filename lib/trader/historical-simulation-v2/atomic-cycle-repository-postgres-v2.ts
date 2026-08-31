import type postgres from "postgres";
import { canonicalizeSemanticJsonString, computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import type { HistoricalDatasetMembershipV2 } from "./dataset-membership-v2";
import type { HistoricalModeledExecutionReceiptV2 } from "./modeled-capital-binding-v2";
import { computeEconomicsContentDigest } from "@/lib/trader/execution/fill-economics";
import type { CostedFillEconomics } from "@/lib/trader/execution/historical-execution-model.types";
import { historicalFillId } from "@/lib/trader/execution/deterministic-execution-id";
import { computeAccountingSemanticDigest } from "@/lib/trader/accounting/canonical-cross-backend-accounting-engine";

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

const STATE_KINDS = ["KNOWLEDGE", "MODELED_EXECUTION_REGISTRY", "MODELED_EXCHANGE",
  "ACCOUNTING_FRONTIER", "GUARDIAN", "LEARNING"] as const;

export const HISTORICAL_SIMULATION_COMMIT_REQUEST_V2 =
  "waia.trader.historical_simulation_commit_request.v2" as const;
export const HISTORICAL_SIMULATION_MODELED_ATOMIC_ARTIFACT_V2 =
  "waia.trader.historical_simulation_modeled_atomic_artifact.v2" as const;

export type HistoricalSimulationCommitRequestV2 = Readonly<{
  schemaVersion: typeof HISTORICAL_SIMULATION_COMMIT_REQUEST_V2;
  organizationId: string; accountId: string; runId: string; split: HistoricalSimulationAtomicScopeV2["split"];
  cycleSequence: number; cycleId: string; replayBarClosedAtUtc: string;
  datasetMembership: HistoricalDatasetMembershipV2; datasetMembershipContentDigestHex: string;
  forecastInputAuthorityContentDigestHex: string;
  policyConfigContentDigestHex: string; codeSha: string; ledgerEntryContentDigestHex: string;
  stageBundleDigestHexByStage: Readonly<Record<(typeof HISTORICAL_SIMULATION_ATOMIC_STAGES_V2)[number], string>>;
  snapshotContentDigestHexByKind: Readonly<Record<(typeof STATE_KINDS)[number], string>>;
  contentDigestHex: string;
}>;

export type HistoricalSimulationModeledAtomicArtifactV2 = Readonly<{
  schemaVersion: typeof HISTORICAL_SIMULATION_MODELED_ATOMIC_ARTIFACT_V2;
  artifactKind: "MODELED_RISK_VERDICT" | "MODELED_EXECUTION_SUBMISSION" | "MODELED_EXECUTION_EFFECT" |
    "GUARDIAN_ASSESSMENT" | "KNOWLEDGE_CHECKPOINT" | "LEARNING_UPDATE";
  artifactId: string; organizationId: string; accountId: string; runId: string; cycleId: string;
  pitAnchor: string; sourceContentDigestHex: string; sourcePayload: Readonly<Record<string, unknown>>;
  lineagePayload?: Readonly<Record<string, unknown>>;
  sourcePayloadSemanticDigestHex: string;
  contentDigestHex: string;
}>;

type CommitRequestSeed = Omit<HistoricalSimulationCommitRequestV2, "schemaVersion" | "contentDigestHex">;

export function createHistoricalSimulationCommitRequestV2(seed: CommitRequestSeed): HistoricalSimulationCommitRequestV2 {
  const body = { schemaVersion: HISTORICAL_SIMULATION_COMMIT_REQUEST_V2, ...seed };
  const request = { ...body, contentDigestHex: computeSemanticSha256Hex(body) };
  validateHistoricalSimulationCommitRequestV2(request);
  return Object.freeze(request);
}

export function validateHistoricalSimulationCommitRequestV2(request: HistoricalSimulationCommitRequestV2): void {
  const { contentDigestHex, ...body } = request;
  const { contentDigestHex: membershipDigest, ...membershipBody } = request.datasetMembership;
  const digests = [request.datasetMembershipContentDigestHex, request.forecastInputAuthorityContentDigestHex,
    request.policyConfigContentDigestHex, request.ledgerEntryContentDigestHex,
    ...Object.values(request.stageBundleDigestHexByStage), ...Object.values(request.snapshotContentDigestHexByKind)];
  if (request.schemaVersion !== HISTORICAL_SIMULATION_COMMIT_REQUEST_V2 ||
      request.organizationId.trim() === "" || request.accountId.trim() === "" || request.runId.trim() === "" ||
      request.cycleId.trim() === "" || !Number.isSafeInteger(request.cycleSequence) || request.cycleSequence < 0 ||
      !["DEVELOPMENT", "WALK_FORWARD"].includes(request.split) ||
      new Date(request.replayBarClosedAtUtc).toISOString() !== request.replayBarClosedAtUtc ||
      !/^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(request.codeSha) ||
      request.datasetMembership.organizationId !== request.organizationId ||
      request.datasetMembership.cycleId !== request.cycleId || request.datasetMembership.partition !== request.split ||
      membershipDigest !== request.datasetMembershipContentDigestHex ||
      membershipDigest !== computeSemanticSha256Hex(membershipBody) ||
      digests.some((digest) => !/^[0-9a-f]{64}$/.test(digest)) ||
      Object.keys(request.stageBundleDigestHexByStage).length !== HISTORICAL_SIMULATION_ATOMIC_STAGES_V2.length ||
      Object.keys(request.snapshotContentDigestHexByKind).length !== STATE_KINDS.length ||
      contentDigestHex !== computeSemanticSha256Hex(body)) {
    throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:COMMIT_REQUEST");
  }
}

export function createHistoricalSimulationModeledAtomicArtifactV2(input:
  Omit<HistoricalSimulationModeledAtomicArtifactV2, "schemaVersion" | "contentDigestHex" | "sourcePayloadSemanticDigestHex">,
): HistoricalSimulationModeledAtomicArtifactV2 {
  const body = { schemaVersion: HISTORICAL_SIMULATION_MODELED_ATOMIC_ARTIFACT_V2, ...input,
    sourcePayloadSemanticDigestHex: computeSemanticSha256Hex(input.sourcePayload) };
  return Object.freeze({ ...body, contentDigestHex: computeSemanticSha256Hex(body) });
}

export function assertHistoricalSimulationLearningSnapshotTransitionV2(input: Readonly<{
  previousSnapshot: HistoricalSimulationDurableStateSnapshotV2 | null;
  nextSnapshot: HistoricalSimulationDurableStateSnapshotV2;
  artifacts: readonly HistoricalSimulationModeledAtomicArtifactV2[];
}>): void {
  if (input.artifacts.length === 0 || input.artifacts.some((artifact) => !artifact.lineagePayload ||
      artifact.lineagePayload.previousSnapshotContentDigestHex !== (input.previousSnapshot?.contentDigestHex ?? null) ||
      artifact.lineagePayload.nextSnapshotContentDigestHex !== input.nextSnapshot.contentDigestHex ||
      canonicalizeSemanticJsonString(artifact.lineagePayload.nextState) !==
        canonicalizeSemanticJsonString(input.nextSnapshot.state) ||
      canonicalizeSemanticJsonString(artifact.lineagePayload.previousState ?? null) !==
        canonicalizeSemanticJsonString(input.previousSnapshot?.state ?? null) ||
      canonicalizeSemanticJsonString(artifact.sourcePayload.previousState ?? null) !==
        canonicalizeSemanticJsonString(input.previousSnapshot?.state ?? null) ||
      canonicalizeSemanticJsonString(artifact.sourcePayload.nextState) !==
        canonicalizeSemanticJsonString(input.nextSnapshot.state))) {
    throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:LEARNING_SNAPSHOT_TRANSITION");
  }
}

export function assertHistoricalSimulationFillDetailParityV2(input: Readonly<{
  organizationId: string; cycleId: string; orderId: string; symbol: string; side: string;
  evidence: Readonly<Record<string, unknown>>; detail: Readonly<Record<string, unknown>>;
  consumedFillIds: readonly string[];
}>): void {
  const detailBody = { ...input.detail }; const detailDigest = detailBody.contentDigestHex;
  delete detailBody.contentDigestHex;
  const event = input.detail.event as Record<string, unknown> | undefined;
  const economics = input.detail.economics as Record<string, unknown> | undefined;
  const accounting = input.detail.accountingFrontier as
    (Readonly<{ semanticContentDigest: string; consumedFillIds: readonly string[] }> & Record<string, unknown>) | undefined;
  const fillId = input.evidence.fillId;
  if (!event || !economics || !accounting || typeof detailDigest !== "string" ||
      computeSemanticSha256Hex(detailBody) !== detailDigest ||
      canonicalizeSemanticJsonString(input.detail.evidence) !== canonicalizeSemanticJsonString(input.evidence) ||
      input.evidence.cycleId !== input.cycleId ||
      event.orderId !== input.orderId || event.organizationId !== input.organizationId ||
      event.symbol !== input.symbol || event.side !== input.side || !Number.isSafeInteger(event.fillSequence) ||
      !Number.isSafeInteger(event.sourceBarIndex) || typeof event.sliceQuantity !== "string" ||
      typeof event.grossFillPrice !== "string" || typeof event.remainingQuantityAfter !== "string" ||
      typeof event.acceptedAt !== "string" || typeof event.fillTimestamp !== "string" ||
      fillId !== historicalFillId({ organizationId: input.organizationId, orderId: input.orderId,
        fillSequence: event.fillSequence as number, sourceBarIndex: event.sourceBarIndex as number }) ||
      economics.quantity !== event.sliceQuantity || economics.grossFillPrice !== event.grossFillPrice ||
      economics.remainingQuantityAfter !== event.remainingQuantityAfter || economics.fillSequence !== event.fillSequence ||
      economics.sourceBarIndex !== event.sourceBarIndex || economics.symbol !== event.symbol || economics.side !== event.side ||
      economics.acceptedAt !== event.acceptedAt || economics.fillTimestamp !== event.fillTimestamp ||
      economics.sourceBarTimestamp !== (event.sourceBar as Record<string, unknown> | undefined)?.barCloseTime ||
      economics.economicsContentDigest !== input.evidence.economicsContentDigestHex ||
      computeEconomicsContentDigest(economics as unknown as Omit<CostedFillEconomics, "economicsContentDigest">) !==
        economics.economicsContentDigest || computeAccountingSemanticDigest(accounting as never) !== accounting.semanticContentDigest ||
      input.evidence.accountingFrontierContentDigestHex !== accounting.semanticContentDigest ||
      typeof fillId !== "string" || !accounting.consumedFillIds.includes(fillId) || !input.consumedFillIds.includes(fillId)) {
    throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:MODELED_FILL_DETAIL_SOURCE");
  }
}

export function validateHistoricalSimulationModeledAtomicArtifactV2(scope: HistoricalSimulationAtomicScopeV2,
  cycleId: string, reference: HistoricalSimulationAtomicArtifactReferenceV2,
): HistoricalSimulationModeledAtomicArtifactV2 {
  const payload = reference.payload as HistoricalSimulationModeledAtomicArtifactV2 | undefined;
  if (!payload) throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:MODELED_ARTIFACT_PAYLOAD");
  const { contentDigestHex, ...body } = payload;
  if (payload.schemaVersion !== HISTORICAL_SIMULATION_MODELED_ATOMIC_ARTIFACT_V2 ||
      payload.artifactKind !== reference.artifactKind || payload.artifactId !== reference.artifactId ||
      payload.organizationId !== scope.organizationId || payload.accountId !== scope.accountId ||
      payload.runId !== scope.runId || payload.cycleId !== cycleId ||
      !/^[0-9a-f]{64}$/.test(payload.sourceContentDigestHex) ||
      !Number.isSafeInteger(Date.parse(payload.pitAnchor)) ||
      !payload.sourcePayload || Array.isArray(payload.sourcePayload) ||
      payload.sourcePayloadSemanticDigestHex !== computeSemanticSha256Hex(payload.sourcePayload) ||
      contentDigestHex !== reference.contentDigestHex || contentDigestHex !== computeSemanticSha256Hex(body)) {
    throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:MODELED_ARTIFACT_PAYLOAD");
  }
  const embedded = payload.sourcePayload.contentDigestHex;
  const domainBody = { ...payload.sourcePayload };
  delete domainBody.contentDigestHex;
  const recomputedDomainDigest = typeof embedded === "string"
    ? computeSemanticSha256Hex(domainBody) : computeSemanticSha256Hex(payload.sourcePayload);
  if ((typeof embedded === "string" && embedded !== payload.sourceContentDigestHex) ||
      recomputedDomainDigest !== payload.sourceContentDigestHex) {
    throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:MODELED_ARTIFACT_DOMAIN_DIGEST");
  }
  return payload;
}

type ProducedCycle = Omit<Parameters<typeof commitHistoricalSimulationCycleAtomicallyV2>[0], "repository" | "scope">;

async function verifyCanonicalStageArtifacts(sql: postgres.Sql, scope: HistoricalSimulationAtomicScopeV2,
  produced: ProducedCycle, previousCursor: HistoricalSimulationResumeCursorV2 | null): Promise<void> {
  for (const artifact of produced.stageBundles.FORECAST_LIFECYCLE.artifacts) {
    const rows = await sql<{ forecast_content_digest: string }[]>`
      SELECT forecast_content_digest FROM trader_forecast_v2
      WHERE id=${artifact.artifactId}::uuid AND organization_id=${scope.organizationId}::uuid
        AND forecast_content_digest=${artifact.contentDigestHex}`;
    if (rows.length !== 1) throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:FORECAST_ARTIFACT_SOURCE");
  }
  for (const artifact of produced.stageBundles.CANONICAL_VERIFICATION.artifacts) {
    const rows = await sql<{ verification_receipt_digest_hex: string }[]>`
      SELECT verification_receipt_digest_hex FROM trader_canonical_decision_verification_receipt_v2
      WHERE id=${artifact.artifactId}::uuid AND organization_id=${scope.organizationId}::uuid
        AND (account_id IS NULL OR account_id=${scope.accountId})
        AND verification_receipt_digest_hex=${artifact.contentDigestHex} AND verified=true`;
    if (rows.length !== 1) throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:VERIFICATION_ARTIFACT_SOURCE");
  }
  for (const artifact of produced.stageBundles.ACCOUNTING.artifacts) {
    const rows = await sql<{ semantic_content_digest: string }[]>`
      SELECT semantic_content_digest FROM trader_accounting_frontier
      WHERE id=${artifact.artifactId}::uuid AND organization_id=${scope.organizationId}::uuid
        AND account_key=${scope.accountId} AND run_id=${scope.runId}
        AND semantic_content_digest=${artifact.contentDigestHex}`;
    if (rows.length !== 1 || artifact.contentDigestHex !== produced.ledgerEntry.accounting.frontierContentDigestHex) {
      throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:ACCOUNTING_ARTIFACT_SOURCE");
    }
  }
  const exactDigestSets = {
    MODELED_RISK: new Set(([produced.ledgerEntry.risk.verdictContentDigestHex,
      produced.ledgerEntry.risk.allowanceContentDigestHex].filter((value): value is string => value !== null)
      .concat(produced.ledgerEntry.risk.verdictContentDigestHex ? [] : [computeSemanticSha256Hex(produced.ledgerEntry.risk)]))),
    MODELED_EXECUTION: new Set([produced.ledgerEntry.execution.planContentDigestHex,
      produced.ledgerEntry.execution.attemptContentDigestHex, produced.ledgerEntry.execution.reportContentDigestHex]
      .filter((value): value is string => value !== null).concat(
        produced.ledgerEntry.execution.planContentDigestHex ? [] : [computeSemanticSha256Hex(produced.ledgerEntry.execution)])),
    OBSERVED_EXECUTION_EFFECTS: new Set(produced.ledgerEntry.observedExecutionEffects.flatMap((effect) =>
      [...effect.reportContentDigestHexes, ...effect.fillContentDigestHexes]).concat(
        produced.ledgerEntry.observedExecutionEffects.length ? [] :
          [computeSemanticSha256Hex({ effects: produced.ledgerEntry.observedExecutionEffects })])),
    GUARDIAN: new Set([produced.ledgerEntry.guardian.assessmentContentDigestHex]),
    KNOWLEDGE: new Set([produced.knowledgeCheckpointContentDigestHex]),
    LEARNING: new Set(([produced.ledgerEntry.learning.calibrationObservationContentDigestHex,
      produced.ledgerEntry.learning.knowledgeUpdateContentDigestHex].filter((value): value is string => value !== null)
      .concat(produced.ledgerEntry.learning.knowledgeUpdateContentDigestHex ? [] :
        [computeSemanticSha256Hex(produced.ledgerEntry.learning)]))),
  } as const;
  for (const [stage, expected] of Object.entries(exactDigestSets)) {
    const artifacts = produced.stageBundles[stage as keyof typeof exactDigestSets].artifacts;
    const modeled = artifacts.map((artifact) => validateHistoricalSimulationModeledAtomicArtifactV2(scope, produced.ledgerEntry.cycleId, artifact));
    const sourceDigests = modeled.map((artifact) => artifact.sourceContentDigestHex);
    if (sourceDigests.some((digest) => !expected.has(digest)) ||
        [...expected].some((digest) => !sourceDigests.includes(digest))) {
      throw new Error(`HISTORICAL_SIMULATION_RESUME_REFUSED:${stage}_ARTIFACT_SOURCE`);
    }
    if (modeled.some((artifact) => Date.parse(artifact.pitAnchor) > Date.parse(produced.ledgerEntry.replayBarClosedAtUtc))) {
      throw new Error(`HISTORICAL_SIMULATION_RESUME_REFUSED:${stage}_ARTIFACT_FUTURE`);
    }
  }
  const executionPayloads = [...produced.stageBundles.MODELED_EXECUTION.artifacts,
    ...produced.stageBundles.OBSERVED_EXECUTION_EFFECTS.artifacts]
    .map((artifact) => validateHistoricalSimulationModeledAtomicArtifactV2(scope, produced.ledgerEntry.cycleId, artifact));
  const receipts = (produced.modeledExecutionRegistrySnapshot.state as Readonly<{
    receipts: readonly HistoricalModeledExecutionReceiptV2[];
  }>).receipts;
  for (const artifact of executionPayloads.filter((value) => value.artifactKind === "MODELED_EXECUTION_SUBMISSION")) {
    const receipt = receipts.find((candidate) => candidate.executionPlanContentDigestHex === artifact.sourceContentDigestHex ||
      candidate.executionAttemptContentDigestHex === artifact.sourceContentDigestHex);
    if (!receipt) {
      throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:MODELED_EXECUTION_REGISTRY_SOURCE");
    }
    const planBody = { schemaVersion: "waia.trader.historical_modeled_execution_plan.v2",
      source: "MODELED_HISTORICAL", capitalEligible: false, executionPlanId: receipt.executionPlanId,
      decisionId: receipt.decisionId, decisionContentDigestHex: receipt.decisionContentDigestHex,
      riskReceiptContentDigestHex: receipt.riskReceiptContentDigestHex, symbol: receipt.symbol,
      side: receipt.side, quantity: receipt.quantity };
    const attemptBody = { schemaVersion: "waia.trader.historical_modeled_execution_attempt.v2",
      source: "MODELED_HISTORICAL", capitalEligible: false, executionAttemptId: receipt.executionAttemptId,
      executionPlanId: receipt.executionPlanId, executionPlanContentDigestHex: receipt.executionPlanContentDigestHex,
      acceptedAtUtc: receipt.acceptedAtUtc };
    const expected = artifact.sourceContentDigestHex === receipt.executionPlanContentDigestHex ? planBody : attemptBody;
    if (canonicalizeSemanticJsonString(artifact.sourcePayload) !== canonicalizeSemanticJsonString(expected)) {
      throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:MODELED_EXECUTION_REGISTRY_SOURCE");
    }
  }
  const riskArtifacts = produced.stageBundles.MODELED_RISK.artifacts.map((artifact) =>
    validateHistoricalSimulationModeledAtomicArtifactV2(scope, produced.ledgerEntry.cycleId, artifact));
  const verdictArtifact = riskArtifacts.find((artifact) =>
    artifact.sourceContentDigestHex === produced.ledgerEntry.risk.verdictContentDigestHex);
  if (produced.ledgerEntry.risk.verdictContentDigestHex && (!verdictArtifact ||
      verdictArtifact.sourcePayload.verdict !== produced.ledgerEntry.risk.status ||
      verdictArtifact.sourcePayload.decisionContentDigestHex !== produced.ledgerEntry.decision.decisionContentDigestHex ||
      verdictArtifact.sourcePayload.riskAllowanceContentDigestHex !== produced.ledgerEntry.risk.allowanceContentDigestHex)) {
    throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:MODELED_RISK_PAYLOAD_SOURCE");
  }
  const learningArtifacts = produced.stageBundles.LEARNING.artifacts.map((artifact) =>
    validateHistoricalSimulationModeledAtomicArtifactV2(scope, produced.ledgerEntry.cycleId, artifact));
  assertHistoricalSimulationLearningSnapshotTransitionV2({
    previousSnapshot: previousCursor?.learningSnapshot ?? null,
    nextSnapshot: produced.learningSnapshot, artifacts: learningArtifacts,
  });
  const guardian = validateHistoricalSimulationModeledAtomicArtifactV2(scope, produced.ledgerEntry.cycleId,
    produced.stageBundles.GUARDIAN.artifacts[0]);
  const guardianState = produced.guardianSnapshot.state as Readonly<{
    assessmentContentDigestHex: string; posture: string;
  }>;
  if (guardian.sourceContentDigestHex !== guardianState.assessmentContentDigestHex ||
      guardian.sourcePayload.status !== guardianState.posture) {
    throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:GUARDIAN_SNAPSHOT_SOURCE");
  }
  const knowledge = validateHistoricalSimulationModeledAtomicArtifactV2(scope, produced.ledgerEntry.cycleId,
    produced.stageBundles.KNOWLEDGE.artifacts[0]);
  const knowledgeState = produced.knowledgeSnapshot.state as Readonly<{
    checkpointContentDigestHex: string; checkpointSequence: number;
  }>;
  if (knowledge.sourceContentDigestHex !== knowledgeState.checkpointContentDigestHex ||
      knowledge.sourcePayload.checkpointSequence !== knowledgeState.checkpointSequence) {
    throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:KNOWLEDGE_SNAPSHOT_SOURCE");
  }
  for (const effect of produced.ledgerEntry.observedExecutionEffects) {
    const receipt = receipts.find((candidate) => candidate.orderId === effect.originatingOrderId);
    if (!receipt || receipt.decisionId !== effect.originatingDecisionId ||
        receipt.decisionContentDigestHex !== effect.originatingDecisionContentDigestHex ||
        receipt.executionPlanId !== effect.originatingPlanId ||
        receipt.executionPlanContentDigestHex !== effect.originatingPlanContentDigestHex ||
        receipt.executionAttemptId !== effect.originatingAttemptId ||
        receipt.executionAttemptContentDigestHex !== effect.originatingAttemptContentDigestHex ||
        receipt.orderContentDigestHex !== effect.originatingOrderContentDigestHex) {
      throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:MODELED_EFFECT_RECEIPT_LINEAGE");
    }
    const reportBody = { schemaVersion: "waia.trader.historical_modeled_execution_report.v2",
      source: "MODELED_HISTORICAL", capitalEligible: false, cycleId: produced.ledgerEntry.cycleId,
      decisionId: effect.originatingDecisionId,
      decisionContentDigestHex: effect.originatingDecisionContentDigestHex,
      executionPlanId: effect.originatingPlanId,
      executionPlanContentDigestHex: effect.originatingPlanContentDigestHex,
      orderId: effect.originatingOrderId, orderContentDigestHex: effect.originatingOrderContentDigestHex,
      executionAttemptId: effect.originatingAttemptId,
      executionAttemptContentDigestHex: effect.originatingAttemptContentDigestHex, status: effect.status,
      fillEvidenceContentDigestHexes: effect.fillContentDigestHexes };
    const reportDigest = computeSemanticSha256Hex(reportBody);
    if (!effect.reportContentDigestHexes.includes(reportDigest)) {
      throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:MODELED_EFFECT_REPORT_SOURCE");
    }
    const effectArtifacts = produced.stageBundles.OBSERVED_EXECUTION_EFFECTS.artifacts.map((artifact) =>
      validateHistoricalSimulationModeledAtomicArtifactV2(scope, produced.ledgerEntry.cycleId, artifact));
    if (!effectArtifacts.some((artifact) => artifact.sourceContentDigestHex === reportDigest &&
      canonicalizeSemanticJsonString(artifact.sourcePayload) === canonicalizeSemanticJsonString(reportBody)) ||
      effect.fillContentDigestHexes.some((digest) => !effectArtifacts.some((artifact) =>
        artifact.sourceContentDigestHex === digest && artifact.sourcePayload.orderId === effect.originatingOrderId &&
        artifact.sourcePayload.cycleId === produced.ledgerEntry.cycleId && artifact.lineagePayload &&
        artifact.lineagePayload.originatingDecisionId === effect.originatingDecisionId &&
        artifact.lineagePayload.originatingDecisionContentDigestHex === effect.originatingDecisionContentDigestHex &&
        artifact.lineagePayload.originatingPlanId === effect.originatingPlanId &&
        artifact.lineagePayload.originatingAttemptId === effect.originatingAttemptId &&
        artifact.lineagePayload.status === effect.status && artifact.lineagePayload.fillDetail &&
        typeof artifact.lineagePayload.fillDetail === "object"))) {
      throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:MODELED_EFFECT_PAYLOAD_SOURCE");
    }
    const fillIds = effectArtifacts.filter((artifact) => effect.fillContentDigestHexes.includes(artifact.sourceContentDigestHex))
      .map((artifact) => artifact.sourcePayload.fillId);
    const accounting = produced.accountingFrontierSnapshot.state as Readonly<{ consumedFillIds: readonly string[] }>;
    if (new Set(fillIds).size !== fillIds.length || fillIds.some((id) => typeof id !== "string" ||
      !accounting.consumedFillIds.includes(id))) {
      throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:MODELED_EFFECT_ACCOUNTING_SOURCE");
    }
    for (const artifact of effectArtifacts.filter((value) => effect.fillContentDigestHexes.includes(value.sourceContentDigestHex))) {
      const detail = artifact.lineagePayload!.fillDetail as Record<string, unknown>;
      assertHistoricalSimulationFillDetailParityV2({ organizationId: scope.organizationId,
        cycleId: produced.ledgerEntry.cycleId, orderId: effect.originatingOrderId,
        symbol: receipt.symbol, side: receipt.side, evidence: artifact.sourcePayload, detail,
        consumedFillIds: accounting.consumedFillIds });
    }
  }
}

function json(sql: postgres.Sql, value: unknown) {
  return sql.json(JSON.parse(JSON.stringify(value)) as postgres.JSONValue);
}

async function verifyCommitRequestSources(sql: postgres.Sql, request: HistoricalSimulationCommitRequestV2): Promise<void> {
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
    verifierVersion: "historical-simulation-v2-canonical-verifier/1", releaseSha,
  });
  const rows = await sql<{ authority_bundle_digest_hex: string; policy_config_digest_hex: string;
    membership_content_digest_hex: string; membership_json: HistoricalDatasetMembershipV2;
    verifier_code_digest_hex: string }[]>`
    SELECT p.authority_bundle_digest_hex,p.policy_config_digest_hex,d.membership_content_digest_hex,d.membership_json,
      c.verifier_code_digest_hex
    FROM trader_dee659_authority_preregistration_v2 p
    JOIN trader_historical_dataset_authority_v2 d
      ON d.id=p.dataset_authority_id AND d.organization_id=p.organization_id AND d.run_id=p.run_id
     AND d.cycle_id=p.cycle_id AND d.dataset_seal_digest_hex=p.dataset_seal_digest_hex
    JOIN trader_historical_simulation_policy_config_v2 c
      ON c.organization_id=p.organization_id AND c.run_id=p.run_id
     AND c.policy_config_digest_hex=p.policy_config_digest_hex
    WHERE p.organization_id=${request.organizationId}::uuid AND p.account_id=${request.accountId}
      AND p.run_id=${request.runId} AND p.cycle_id=${request.cycleId}
      AND p.authority_bundle_digest_hex=${request.forecastInputAuthorityContentDigestHex}
      AND p.policy_config_digest_hex=${request.policyConfigContentDigestHex}
      AND d.membership_content_digest_hex=${request.datasetMembershipContentDigestHex}
      AND (d.sealed_cycle_json #>> '{closedBar,barCloseTime}')=${request.replayBarClosedAtUtc}`;
  if (rows.length !== 1 || rows[0]?.verifier_code_digest_hex !== verifierDigest ||
      canonicalizeSemanticJsonString(rows[0].membership_json) !== canonicalizeSemanticJsonString(request.datasetMembership)) {
    throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:COMMIT_REQUEST_SOURCE");
  }
}

async function appendLedger(sql: postgres.Sql, entry: HistoricalSimulationReasonLedgerV2): Promise<void> {
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
      ${entry.datasetMembership.contentDigestHex}, ${json(sql, entry.datasetMembership)},
      ${entry.previousContentDigestHex}, ${json(sql, entry.forecast)}, ${json(sql, entry.decision)},
      ${json(sql, entry.portfolio)}, ${json(sql, entry.risk)}, ${json(sql, entry.execution)},
      ${json(sql, entry.observedExecutionEffects)}, ${json(sql, entry.accounting)}, ${json(sql, entry.guardian)},
      ${json(sql, entry.learning)}, ${entry.contentDigestHex}
    )
  `;
  for (const evidence of deriveHistoricalSimulationModeledEvidenceV2(entry)) {
    await sql`
      INSERT INTO trader_historical_simulation_modeled_evidence_v2 (
        evidence_id, organization_id, reason_ledger_entry_id, evidence_kind, evidence_ordinal,
        source_content_digest_hex, evidence_content_digest_hex, payload_json, capital_eligible
      ) VALUES (${evidence.evidenceId}, ${evidence.organizationId}::uuid, ${evidence.reasonLedgerEntryId},
        ${evidence.evidenceKind}, ${evidence.evidenceOrdinal}, ${evidence.sourceContentDigestHex},
        ${evidence.evidenceContentDigestHex}, ${json(sql, evidence.payload)}, false)
    `;
  }
}

function transactionPort(sql: postgres.Sql, commitRequest: HistoricalSimulationCommitRequestV2): HistoricalSimulationAtomicCycleTransactionV2 {
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
        ORDER BY cycle_sequence FOR UPDATE
      `;
      return rows.map((row) => row.entry_json);
    },
    async loadResumeCursor(scope) {
      const rows = await sql<{ checkpoint_json: HistoricalSimulationResumeCursorV2;
        committed_cycle_sequence: number }[]>`
        SELECT checkpoint_json, committed_cycle_sequence
        FROM trader_historical_simulation_resume_checkpoint_v2
        WHERE organization_id=${scope.organizationId}::uuid AND account_id=${scope.accountId} AND run_id=${scope.runId}
        ORDER BY committed_cycle_sequence DESC LIMIT 1 FOR UPDATE
      `;
      const row = rows[0];
      if (!row) return null;
      const stageRows = await sql<{ stage: string; bundle_content_digest_hex: string; cycle_id: string;
        ledger_entry_content_digest_hex: string; artifacts_json: Parameters<typeof createHistoricalSimulationAtomicStageBundleV2>[0]["artifacts"] }[]>`
        SELECT l.stage,l.bundle_content_digest_hex,s.cycle_id,s.ledger_entry_content_digest_hex,s.artifacts_json
        FROM trader_historical_simulation_resume_stage_link_v2 l
        JOIN trader_historical_simulation_atomic_stage_v2 s USING
          (organization_id,account_id,run_id,stage,bundle_content_digest_hex)
        WHERE l.organization_id=${scope.organizationId}::uuid AND l.account_id=${scope.accountId} AND l.run_id=${scope.runId}
          AND l.committed_cycle_sequence=${row.committed_cycle_sequence}
          AND s.cycle_sequence=l.committed_cycle_sequence
      `;
      const snapshotRows = await sql<{ state_kind: string; snapshot_content_digest_hex: string; state_json: unknown }[]>`
        SELECT l.state_kind,l.snapshot_content_digest_hex,s.state_json
        FROM trader_historical_simulation_resume_snapshot_link_v2 l
        JOIN trader_historical_simulation_durable_snapshot_v2 s USING
          (organization_id,account_id,run_id,state_kind,snapshot_content_digest_hex)
        WHERE l.organization_id=${scope.organizationId}::uuid AND l.account_id=${scope.accountId} AND l.run_id=${scope.runId}
          AND l.committed_cycle_sequence=${row.committed_cycle_sequence}
          AND s.cycle_sequence=l.committed_cycle_sequence
      `;
      const cursor = row.checkpoint_json;
      if (stageRows.length !== HISTORICAL_SIMULATION_ATOMIC_STAGES_V2.length || snapshotRows.length !== STATE_KINDS.length ||
          stageRows.some((stage) => {
            const kind = stage.stage as keyof typeof cursor.cycleStageBundleDigestHexByStage;
            const rebuilt = createHistoricalSimulationAtomicStageBundleV2({ ...scope, stage: kind,
              cycleId: stage.cycle_id, ledgerEntryContentDigestHex: stage.ledger_entry_content_digest_hex,
              artifacts: stage.artifacts_json });
            return cursor.cycleStageBundleDigestHexByStage[kind] !== stage.bundle_content_digest_hex ||
              rebuilt.contentDigestHex !== stage.bundle_content_digest_hex;
          }) ||
          snapshotRows.some((snapshot) => {
            const key = ({ KNOWLEDGE: "knowledgeSnapshot", MODELED_EXECUTION_REGISTRY: "modeledExecutionRegistrySnapshot",
              MODELED_EXCHANGE: "modeledExchangeSnapshot", ACCOUNTING_FRONTIER: "accountingFrontierSnapshot",
              GUARDIAN: "guardianSnapshot", LEARNING: "learningSnapshot" } as const)[snapshot.state_kind as typeof STATE_KINDS[number]];
            return !key || cursor[key].contentDigestHex !== snapshot.snapshot_content_digest_hex ||
              canonicalizeSemanticJsonString(snapshot.state_json) !== canonicalizeSemanticJsonString(cursor[key].state);
          })) throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:PERSISTED_LINK_DIVERGENCE");
      validateHistoricalSimulationResumeCursorV2(cursor, scope);
      return cursor;
    },
    async persistStageBundle(bundle) {
      const inserted = await sql<{ stage: string }[]>`INSERT INTO trader_historical_simulation_atomic_stage_v2
        (organization_id,account_id,run_id,cycle_sequence,cycle_id,stage,ledger_entry_id,
         ledger_entry_content_digest_hex,artifacts_json,bundle_content_digest_hex,schema_version)
        SELECT ${bundle.organizationId}::uuid,${bundle.accountId},${bundle.runId},l.cycle_sequence,
          ${bundle.cycleId},${bundle.stage},l.entry_id,${bundle.ledgerEntryContentDigestHex},
          ${json(sql, bundle.artifacts)},${bundle.contentDigestHex},${bundle.schemaVersion}
        FROM trader_historical_simulation_reason_ledger_v2 l
        WHERE l.organization_id=${bundle.organizationId}::uuid AND l.account_id=${bundle.accountId}
          AND l.run_id=${bundle.runId} AND l.cycle_id=${bundle.cycleId}
          AND l.content_digest_hex=${bundle.ledgerEntryContentDigestHex}
        RETURNING stage`;
      if (inserted.length !== 1) throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:STAGE_LEDGER_BINDING");
    },
    appendLedger: (entry) => appendLedger(sql, entry),
    async saveResumeCursor(cursor) {
      const snapshots = STATE_KINDS.map((kind) => ({ kind, snapshot: ({ KNOWLEDGE: cursor.knowledgeSnapshot,
        MODELED_EXECUTION_REGISTRY: cursor.modeledExecutionRegistrySnapshot, MODELED_EXCHANGE: cursor.modeledExchangeSnapshot,
        ACCOUNTING_FRONTIER: cursor.accountingFrontierSnapshot, GUARDIAN: cursor.guardianSnapshot,
        LEARNING: cursor.learningSnapshot } as const)[kind] as HistoricalSimulationDurableStateSnapshotV2 }));
      for (const { kind, snapshot } of snapshots) await sql`
        INSERT INTO trader_historical_simulation_durable_snapshot_v2
          (organization_id,account_id,run_id,cycle_sequence,cycle_id,state_kind,ledger_entry_id,
           ledger_entry_content_digest_hex,state_json,
           snapshot_content_digest_hex,schema_version)
        VALUES (${cursor.organizationId}::uuid,${cursor.accountId},${cursor.runId},${cursor.nextCycleSequence - 1},
          ${cursor.committedCycleId},${kind},
          (SELECT entry_id FROM trader_historical_simulation_reason_ledger_v2 WHERE organization_id=${cursor.organizationId}::uuid
            AND account_id=${cursor.accountId} AND run_id=${cursor.runId} AND cycle_sequence=${cursor.nextCycleSequence - 1}
            AND content_digest_hex=${cursor.ledgerHeadContentDigestHex}),${cursor.ledgerHeadContentDigestHex},${json(sql, snapshot.state)},
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
          ${json(sql, cursor.datasetAuthority)},${json(sql, cursor.cycleStageBundleDigestHexByStage)},
          ${json(sql, Object.fromEntries(snapshots.map(({ kind, snapshot }) => [kind,snapshot.contentDigestHex])))},
          ${json(sql, cursor)},${cursor.contentDigestHex},${commitRequest.contentDigestHex},${json(sql, commitRequest)},
          ${cursor.schemaVersion})`;
      for (const stage of HISTORICAL_SIMULATION_ATOMIC_STAGES_V2) await sql`
        INSERT INTO trader_historical_simulation_resume_stage_link_v2 VALUES
          (${cursor.organizationId}::uuid,${cursor.accountId},${cursor.runId},${cursor.nextCycleSequence - 1},
           ${stage},${cursor.cycleStageBundleDigestHexByStage[stage]})`;
      for (const { kind, snapshot } of snapshots) await sql`
        INSERT INTO trader_historical_simulation_resume_snapshot_link_v2 VALUES
          (${cursor.organizationId}::uuid,${cursor.accountId},${cursor.runId},${cursor.nextCycleSequence - 1},
           ${kind},${snapshot.contentDigestHex})`;
    },
  };
}

/**
 * Durable repository boundary used by the cycle committer.  Keeping the
 * SERIALIZABLE transaction and scope lock here lets crash/restart tests (and
 * future composers) exercise the exact persistence graph without weakening
 * the higher-level canonical-source verification performed by
 * commitHistoricalSimulationCyclePostgresV2.
 */
export function createHistoricalSimulationAtomicCyclePostgresRepositoryV2(input: Readonly<{
  sql: postgres.Sql;
  request: HistoricalSimulationCommitRequestV2;
}>): HistoricalSimulationAtomicCycleRepositoryV2 {
  validateHistoricalSimulationCommitRequestV2(input.request);
  return {
    transaction: <T>(callback: (tx: HistoricalSimulationAtomicCycleTransactionV2) => Promise<T>) =>
      withHistoricalSimulationSerializableScopeLockV2(input.sql, input.request, (tx) =>
        callback(transactionPort(tx, input.request))),
  };
}

async function withHistoricalSimulationSerializableScopeLockV2<T>(sql: postgres.Sql,
  request: Pick<HistoricalSimulationCommitRequestV2, "organizationId" | "accountId" | "runId">,
  callback: (tx: postgres.Sql) => Promise<T>,
): Promise<T> {
  // Acquire the session lock before BEGIN: an xact lock acquired inside a
  // SERIALIZABLE transaction can wait while retaining a pre-winner snapshot.
  const reserved = await sql.reserve();
  const connection = reserved as unknown as postgres.Sql;
  const key = `${request.organizationId}:${request.accountId}:${request.runId}`;
  try {
    await connection`SELECT pg_advisory_lock(hashtextextended(${key},0))`;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await connection`BEGIN ISOLATION LEVEL SERIALIZABLE`;
        const result = await callback(connection);
        await connection`COMMIT`;
        return result;
      } catch (error) {
        try { await connection`ROLLBACK`; } catch { /* connection reports the original error below */ }
        const code = (error as { code?: string }).code;
        if (attempt === 2 || !["40001", "40P01"].includes(code ?? "")) throw error;
      }
    }
    throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:SERIALIZABLE_RETRY_EXHAUSTED");
  } finally {
    try { await connection`SELECT pg_advisory_unlock(hashtextextended(${key},0))`; } finally { reserved.release(); }
  }
}

export async function commitHistoricalSimulationCyclePostgresV2<Ports>(input: Readonly<{
  sql: postgres.Sql; scope: HistoricalSimulationAtomicScopeV2;
  request: HistoricalSimulationCommitRequestV2;
  createPorts(tx: postgres.Sql): Ports;
  produce(ports: Ports): Promise<Omit<Parameters<typeof commitHistoricalSimulationCycleAtomicallyV2>[0], "repository" | "scope">>;
}>): Promise<HistoricalSimulationResumeCursorV2> {
  validateHistoricalSimulationCommitRequestV2(input.request);
  if (input.request.organizationId !== input.scope.organizationId || input.request.accountId !== input.scope.accountId ||
      input.request.runId !== input.scope.runId || input.request.split !== input.scope.split) {
    throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:COMMIT_REQUEST_SCOPE");
  }
  return withHistoricalSimulationSerializableScopeLockV2(input.sql, input.request, async (tx) => {
    await verifyCommitRequestSources(tx, input.request);
    const committed = await tx<{ checkpoint_json: HistoricalSimulationResumeCursorV2;
      commit_request_digest_hex: string; commit_request_json: HistoricalSimulationCommitRequestV2;
      committed_cycle_id: string; committed_cycle_sequence: number;
      ledger_head_content_digest_hex: string }[]>`
      SELECT checkpoint_json,commit_request_digest_hex,commit_request_json,committed_cycle_id,committed_cycle_sequence,
        ledger_head_content_digest_hex FROM trader_historical_simulation_resume_checkpoint_v2
      WHERE organization_id=${input.scope.organizationId}::uuid AND account_id=${input.scope.accountId}
        AND run_id=${input.scope.runId} AND committed_cycle_sequence=${input.request.cycleSequence}
      FOR UPDATE`;
    if (committed[0]) {
      const row = committed[0];
      if (row.commit_request_digest_hex !== input.request.contentDigestHex ||
          canonicalizeSemanticJsonString(row.commit_request_json) !== canonicalizeSemanticJsonString(input.request) ||
          row.committed_cycle_id !== input.request.cycleId ||
          row.ledger_head_content_digest_hex !== input.request.ledgerEntryContentDigestHex) {
        throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:AMBIGUOUS_RETRY");
      }
      const port = transactionPort(tx, input.request);
      const exact = await port.loadResumeCursor(input.scope);
      if (!exact || exact.contentDigestHex !== row.checkpoint_json.contentDigestHex) {
        throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:PERSISTED_RETRY_DIVERGENCE");
      }
      return exact;
    }
    const produced = await input.produce(input.createPorts(tx));
    if (produced.ledgerEntry.cycleSequence !== input.request.cycleSequence ||
        produced.ledgerEntry.cycleId !== input.request.cycleId ||
        produced.ledgerEntry.contentDigestHex !== input.request.ledgerEntryContentDigestHex ||
        produced.ledgerEntry.replayBarClosedAtUtc !== input.request.replayBarClosedAtUtc ||
        produced.ledgerEntry.datasetMembership.contentDigestHex !== input.request.datasetMembershipContentDigestHex ||
        canonicalizeSemanticJsonString(produced.ledgerEntry.datasetMembership) !==
          canonicalizeSemanticJsonString(input.request.datasetMembership) ||
        HISTORICAL_SIMULATION_ATOMIC_STAGES_V2.some((stage) =>
          produced.stageBundles[stage].contentDigestHex !== input.request.stageBundleDigestHexByStage[stage]) ||
        STATE_KINDS.some((kind) => {
          const snapshot = ({ KNOWLEDGE: produced.knowledgeSnapshot,
            MODELED_EXECUTION_REGISTRY: produced.modeledExecutionRegistrySnapshot,
            MODELED_EXCHANGE: produced.modeledExchangeSnapshot, ACCOUNTING_FRONTIER: produced.accountingFrontierSnapshot,
            GUARDIAN: produced.guardianSnapshot, LEARNING: produced.learningSnapshot } as const)[kind];
          return snapshot.contentDigestHex !== input.request.snapshotContentDigestHexByKind[kind];
        })) {
      throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:COMMIT_REQUEST_BINDING");
    }
    const transaction = transactionPort(tx, input.request);
    const previousCursor = await transaction.loadResumeCursor(input.scope);
    await verifyCanonicalStageArtifacts(tx, input.scope, produced, previousCursor);
    const repository: HistoricalSimulationAtomicCycleRepositoryV2 = {
      transaction: (callback) => callback(transaction),
    };
    return commitHistoricalSimulationCycleAtomicallyV2({ repository, scope: input.scope, ...produced });
  });
}
