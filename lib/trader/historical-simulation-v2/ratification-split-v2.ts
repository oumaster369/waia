import { randomUUID } from "node:crypto";

import type postgres from "postgres";

import { bindPostgresReservedSession, withPostgresSessionTransaction } from
  "@/db/postgres-session-transaction";
import { canonicalizeSemanticJsonString, computeSemanticSha256Hex } from
  "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  HISTORICAL_FOUR_SURFACE_HUMAN_DECISION_V2,
  INTERNAL_materializeApprovedHistoricalFourSurfaceCandidateV2,
  INTERNAL_prepareHistoricalFourSurfaceTechnicalAuthorityCandidateV2,
  requireHistoricalFourSurfaceRatifiedAdmissionV2,
  type HistoricalFourSurfaceTechnicalCandidateV2,
} from
  "@/lib/trader/research/execopp-qualification/historical-four-surface-ratified-admission-v2";
import type { KmFourSurfaceProductionPreflightInputV2 } from
  "@/lib/trader/research/execopp-qualification/km-four-surface-production-preflight-v2";
import {
  HISTORICAL_EXECUTION_SERVER_BOOTSTRAP_MANIFEST_V2,
  type HistoricalExecutionServerBootstrapManifestV2,
} from "./execution-server-launch-cli-v2";
import {
  assumeHistoricalSimulationRunnerRoleV2,
  requireHistoricalSimulationRunnerLoginV2,
  resetHistoricalSimulationRunnerRoleV2,
} from "./historical-runner-role-v2";
import type { HistoricalProductionFirstCycleBootstrapInputV2 } from
  "./production-first-cycle-bootstrap-v2";
import { historicalDatasetAuthorityRunLockKeyV2 } from
  "./canonical-verification-receipt-postgres-v2";

export const HISTORICAL_RATIFICATION_REQUEST_V2 =
  "waia.trader.historical_ratification_request.v2" as const;
export const HISTORICAL_TECHNICAL_PROPOSAL_V2 =
  "waia.trader.historical_technical_proposal.v2" as const;
export const HISTORICAL_PROPOSAL_RATIFICATION_V2 =
  "waia.trader.historical_proposal_ratification.v2" as const;
export const HISTORICAL_PROPOSAL_REQUEST_DECISION_V2 =
  "REQUEST_EXACT_PRE_HOLDOUT_TECHNICAL_PROPOSAL" as const;
/** Current qualified FHV corpus: first record strictly after the predictive prefix. */
export const CURRENT_FHV_FIRST_ECONOMIC_RECORD_INDEX_V2 = 525_600;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;

export type HistoricalRatificationRequestV2 = Readonly<{
  schemaVersion: typeof HISTORICAL_RATIFICATION_REQUEST_V2;
  organizationId: string;
  runId: string;
  releaseSha: string;
  operatorUserId: string;
  humanDecision: typeof HISTORICAL_PROPOSAL_REQUEST_DECISION_V2;
  executionExtent: Readonly<{ initialRecordIndex: number; cycleCount: number }>;
  authorityBoundary: Readonly<{
    capitalAuthority: "NONE";
    liveTradingAuthority: "NONE";
    blindHoldoutAuthority: "FORBIDDEN_NOT_PRESENT_NOT_ACCESSED";
  }>;
  contentDigestHex: string;
}>;

export type HistoricalTechnicalLaunchPlanV2 = Readonly<{
  accountId: string;
  symbol: "BTCUSDT" | "ETHUSDT";
  primaryHorizonMinutes: 30 | 60;
  startingCashUsdt: string;
  defaultQuantity: string;
  initialRecordIndex: number;
  cycleCount: number;
}>;

export type HistoricalTechnicalProposalV2 = Readonly<{
  schemaVersion: typeof HISTORICAL_TECHNICAL_PROPOSAL_V2;
  organizationId: string;
  runId: string;
  releaseSha: string;
  requestId: string;
  requestContentDigestHex: string;
  technicalCandidateContentDigestHex: string;
  technicalCandidate: HistoricalFourSurfaceTechnicalCandidateV2;
  preflight: KmFourSurfaceProductionPreflightInputV2;
  launchPlan: HistoricalTechnicalLaunchPlanV2;
  authorityBoundary: HistoricalRatificationRequestV2["authorityBoundary"];
  contentDigestHex: string;
}>;

export type HistoricalProposalRatificationV2 = Readonly<{
  schemaVersion: typeof HISTORICAL_PROPOSAL_RATIFICATION_V2;
  organizationId: string;
  runId: string;
  releaseSha: string;
  proposalId: string;
  proposalContentDigestHex: string;
  operatorUserId: string;
  humanDecision: typeof HISTORICAL_FOUR_SURFACE_HUMAN_DECISION_V2;
  authorityBoundary: HistoricalRatificationRequestV2["authorityBoundary"];
  contentDigestHex: string;
}>;

type RequestRow = Readonly<{ id: string; request_json: HistoricalRatificationRequestV2;
  content_digest_hex: string }>;
type ProposalRow = Readonly<{ id: string; proposal_json: HistoricalTechnicalProposalV2;
  content_digest_hex: string }>;
type RatificationRow = Readonly<{ id: string;
  ratification_json: HistoricalProposalRatificationV2; content_digest_hex: string }>;

function refuse(code: string): never {
  throw new Error(`HISTORICAL_RATIFICATION_SPLIT_REFUSED:${code}`);
}

function boundary() {
  return Object.freeze({
    capitalAuthority: "NONE" as const,
    liveTradingAuthority: "NONE" as const,
    blindHoldoutAuthority: "FORBIDDEN_NOT_PRESENT_NOT_ACCESSED" as const,
  });
}

function seal<T extends object>(body: T): Readonly<T & { contentDigestHex: string }> {
  return Object.freeze({ ...body, contentDigestHex: computeSemanticSha256Hex(body) });
}

function assertScope(input: Readonly<{ organizationId: string; runId: string;
  releaseSha: string }>): void {
  if (!UUID.test(input.organizationId) || !input.runId || input.runId.trim() !== input.runId ||
      !SHA.test(input.releaseSha)) refuse("SCOPE");
}

function assertSealed<T extends Readonly<{ contentDigestHex: string }>>(
  value: T,
  schemaVersion: string,
): void {
  const { contentDigestHex, ...body } = value;
  if (!DIGEST.test(contentDigestHex) ||
      (body as Readonly<{ schemaVersion?: string }>).schemaVersion !== schemaVersion ||
      computeSemanticSha256Hex(body) !== contentDigestHex) refuse("DIGEST");
}

function validateLaunchPlan(plan: HistoricalTechnicalLaunchPlanV2): void {
  if (!plan.accountId || plan.accountId.trim() !== plan.accountId ||
      !["BTCUSDT", "ETHUSDT"].includes(plan.symbol) ||
      ![30, 60].includes(plan.primaryHorizonMinutes) ||
      !/^\d+(?:\.\d+)?$/.test(plan.startingCashUsdt) ||
      !/^\d+(?:\.\d+)?$/.test(plan.defaultQuantity) ||
      Number(plan.startingCashUsdt) <= 0 || Number(plan.defaultQuantity) <= 0 ||
      !Number.isSafeInteger(plan.initialRecordIndex) || plan.initialRecordIndex < 0 ||
      !Number.isSafeInteger(plan.cycleCount) || plan.cycleCount < 1 || plan.cycleCount > 10_000) {
    refuse("LAUNCH_PLAN");
  }
}

function assertLaunchPlanWithinQualifiedEconomicPartition(
  plan: HistoricalTechnicalLaunchPlanV2,
  candidate: HistoricalFourSurfaceTechnicalCandidateV2,
): void {
  const first = candidate.firstEconomicRecordIndex;
  const count = candidate.economicRecordCount;
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(count) || first < 240 || count < 1 ||
      plan.initialRecordIndex < first || plan.initialRecordIndex >= first + count ||
      plan.cycleCount > first + count - plan.initialRecordIndex) {
    refuse("LAUNCH_PLAN_OUTSIDE_QUALIFIED_ECONOMIC_PARTITION");
  }
}

export function canonicalHistoricalWalkForwardPolicyV2(releaseSha: string):
HistoricalProductionFirstCycleBootstrapInputV2["policyConfig"] {
  if (!SHA.test(releaseSha)) refuse("RELEASE");
  const costs = Object.freeze({
    feeBps: "20", spreadBps: "5", impactBps: "10", slippageBps: "0",
    conservativeStressBps: "0",
  });
  return Object.freeze({
    policyInstanceId: `historical-walk-forward-d5:${releaseSha}`,
    interimPositionPolicyId:
      "fixed-horizon-qualification/unrepresentable-normal-exits-disabled/v1",
    sliceAllocationPolicy: "explicit-weights-last-slice-remainder-no-top-up/v1",
    roundingPolicy: "scale8-floor-step-truncate-half-up/v1",
    entrySliceOffsets: [1, 2, 3] as const,
    entrySliceWeights: ["0.4", "0.3", "0.3"] as const,
    exitSliceOffsetsAfterHorizon: [1, 2, 3] as const,
    exitSliceWeights: ["0.4", "0.3", "0.3"] as const,
    participationCapFraction: "0.10", quantityStep: "0.00000001",
    minimumQuantity: "0.00000001", minimumNotionalUsdt: "1",
    entryCosts: costs, exitCosts: costs,
    partialFillPolicy: "EXPLICIT_CAPACITY_BOUNDED_NO_TOP_UP",
    unfilledEntryPolicy: "RETAIN_AS_CASH",
    postExitResidualPolicy: "SIZE_ECONOMICALLY_INADMISSIBLE",
  });
}

export async function createHistoricalRatificationRequestV2(sql: postgres.Sql, input: Readonly<{
  organizationId: string; runId: string; releaseSha: string;
  authenticatedOperatorUserId: string;
  initialRecordIndex: number; cycleCount: number;
}>): Promise<Readonly<{ id: string; request: HistoricalRatificationRequestV2 }>> {
  assertScope(input);
  if (!UUID.test(input.authenticatedOperatorUserId)) refuse("ACTOR");
  // The request is an operator intent record, not dataset authority. The
  // execution host later proves the exact economic boundary from the sealed
  // qualification receipt before it may produce or finalize a proposal.
  if (!Number.isSafeInteger(input.initialRecordIndex) ||
      input.initialRecordIndex < 239 ||
      !Number.isSafeInteger(input.cycleCount) || input.cycleCount < 1 ||
      input.cycleCount > 10_000) refuse("EXECUTION_EXTENT");
  const members = await sql<Array<Readonly<{ member_role: string }>>>`
    SELECT member_role FROM organization_members
    WHERE organization_id=${input.organizationId}::uuid
      AND user_id=${input.authenticatedOperatorUserId}::uuid FOR SHARE
  `;
  if (members.length !== 1 || !["owner", "manager"].includes(members[0]!.member_role)) {
    refuse("MEMBERSHIP");
  }
  const request = seal({
    schemaVersion: HISTORICAL_RATIFICATION_REQUEST_V2,
    organizationId: input.organizationId, runId: input.runId,
    releaseSha: input.releaseSha, operatorUserId: input.authenticatedOperatorUserId,
    humanDecision: HISTORICAL_PROPOSAL_REQUEST_DECISION_V2,
    executionExtent: Object.freeze({ initialRecordIndex: input.initialRecordIndex,
      cycleCount: input.cycleCount }),
    authorityBoundary: boundary(),
  });
  const id = randomUUID();
  await sql`
    INSERT INTO trader_historical_ratification_request_v2
      (id,organization_id,run_id,release_sha,operator_user_id,request_json,
       content_digest_hex,schema_version)
    VALUES (${id}::uuid,${input.organizationId}::uuid,${input.runId},${input.releaseSha},
      ${input.authenticatedOperatorUserId}::uuid,
      ${JSON.stringify(request)}::text::jsonb,
      ${request.contentDigestHex},${HISTORICAL_RATIFICATION_REQUEST_V2})
    ON CONFLICT DO NOTHING
  `;
  const rows = await sql<RequestRow[]>`
    SELECT id::text AS id,request_json,content_digest_hex
    FROM trader_historical_ratification_request_v2
    WHERE organization_id=${input.organizationId}::uuid AND run_id=${input.runId}
  `;
  const row = rows[0];
  if (rows.length !== 1 || !row || row.content_digest_hex !== request.contentDigestHex) {
    refuse("REQUEST_CONFLICT");
  }
  assertSealed(row.request_json, HISTORICAL_RATIFICATION_REQUEST_V2);
  return Object.freeze({ id: row.id, request: row.request_json });
}

async function loadRequest(sql: postgres.Sql, scope: Readonly<{ organizationId: string;
  runId: string; releaseSha: string }>): Promise<Readonly<{ id: string;
  request: HistoricalRatificationRequestV2 }>> {
  const rows = await sql<RequestRow[]>`
    SELECT id::text AS id,request_json,content_digest_hex
    FROM trader_historical_ratification_request_v2
    WHERE organization_id=${scope.organizationId}::uuid AND run_id=${scope.runId}
      AND release_sha=${scope.releaseSha}
  `;
  const row = rows[0];
  if (rows.length !== 1 || !row || row.content_digest_hex !== row.request_json.contentDigestHex) {
    refuse("REQUEST_MISSING");
  }
  assertSealed(row.request_json, HISTORICAL_RATIFICATION_REQUEST_V2);
  return Object.freeze({ id: row.id, request: row.request_json });
}

/** Admin review projection. The reviewer must be the actor bound by the durable request. */
export async function readHistoricalTechnicalProposalForAdminV2(
  sql: postgres.Sql,
  input: Readonly<{ organizationId: string; runId: string; releaseSha: string;
    authenticatedOperatorUserId: string }>,
): Promise<Readonly<{ requestId: string; proposalId: string;
  proposal: HistoricalTechnicalProposalV2; ratified: boolean }>> {
  assertScope(input);
  if (!UUID.test(input.authenticatedOperatorUserId)) refuse("ACTOR");
  const request = await loadRequest(sql, input);
  if (request.request.operatorUserId !== input.authenticatedOperatorUserId) {
    refuse("ACTOR_BINDING");
  }
  const proposals = await sql<ProposalRow[]>`
    SELECT id::text AS id,proposal_json,content_digest_hex
    FROM trader_historical_technical_proposal_v2
    WHERE organization_id=${input.organizationId}::uuid AND run_id=${input.runId}
      AND release_sha=${input.releaseSha}
    FOR SHARE
  `;
  const proposal = proposals[0];
  if (proposals.length !== 1 || !proposal ||
      proposal.proposal_json.requestId !== request.id ||
      proposal.content_digest_hex !== proposal.proposal_json.contentDigestHex) {
    refuse("PROPOSAL_MISSING");
  }
  assertSealed(proposal.proposal_json, HISTORICAL_TECHNICAL_PROPOSAL_V2);
  const approvals = await sql<Array<Readonly<{ present: boolean }>>>`
    SELECT EXISTS (
      SELECT 1 FROM trader_historical_proposal_ratification_v2
      WHERE organization_id=${input.organizationId}::uuid AND run_id=${input.runId}
        AND release_sha=${input.releaseSha} AND proposal_id=${proposal.id}::uuid
        AND proposal_content_digest_hex=${proposal.content_digest_hex}
    ) AS present
  `;
  return Object.freeze({ requestId: request.id, proposalId: proposal.id,
    proposal: proposal.proposal_json, ratified: approvals[0]?.present === true });
}

export async function prepareHistoricalTechnicalProposalOnExecutionServerV2(
  pool: postgres.Sql,
  input: Readonly<{ preflight: KmFourSurfaceProductionPreflightInputV2;
    launchPlan: HistoricalTechnicalLaunchPlanV2 }>,
): Promise<Readonly<{ id: string; proposal: HistoricalTechnicalProposalV2 }>> {
  assertScope(input.preflight);
  validateLaunchPlan(input.launchPlan);
  const reserved = await pool.reserve();
  const sql = bindPostgresReservedSession(pool, reserved);
  let assumed = false;
  let locked = false;
  const lockKey = historicalDatasetAuthorityRunLockKeyV2(input.preflight);
  try {
    await requireHistoricalSimulationRunnerLoginV2(sql);
    await assumeHistoricalSimulationRunnerRoleV2(sql);
    assumed = true;
    await sql`SELECT pg_advisory_lock(hashtextextended(${lockKey},0))`;
    locked = true;
    const request = await loadRequest(sql, input.preflight);
    if (request.request.executionExtent.initialRecordIndex !== input.launchPlan.initialRecordIndex ||
        request.request.executionExtent.cycleCount !== input.launchPlan.cycleCount) {
      refuse("REQUEST_EXECUTION_EXTENT");
    }
    const technicalCandidate =
      await INTERNAL_prepareHistoricalFourSurfaceTechnicalAuthorityCandidateV2(
      sql,
      { preflight: input.preflight,
        humanDecision: HISTORICAL_FOUR_SURFACE_HUMAN_DECISION_V2 },
    );
    assertLaunchPlanWithinQualifiedEconomicPartition(input.launchPlan, technicalCandidate);
    const proposal = seal({
      schemaVersion: HISTORICAL_TECHNICAL_PROPOSAL_V2,
      organizationId: input.preflight.organizationId, runId: input.preflight.runId,
      releaseSha: input.preflight.releaseSha, requestId: request.id,
      requestContentDigestHex: request.request.contentDigestHex,
      technicalCandidateContentDigestHex: technicalCandidate.contentDigestHex,
      technicalCandidate, preflight: input.preflight,
      launchPlan: Object.freeze({ ...input.launchPlan }),
      authorityBoundary: boundary(),
    });
    const id = randomUUID();
    await sql`
      INSERT INTO trader_historical_technical_proposal_v2
        (id,organization_id,run_id,release_sha,request_id,request_content_digest_hex,
         technical_candidate_json,technical_candidate_content_digest_hex,
         launch_plan_json,proposal_json,
         content_digest_hex,schema_version)
      VALUES (${id}::uuid,${proposal.organizationId}::uuid,${proposal.runId},
        ${proposal.releaseSha},${proposal.requestId}::uuid,${proposal.requestContentDigestHex},
        ${JSON.stringify(proposal.technicalCandidate)}::text::jsonb,
        ${proposal.technicalCandidateContentDigestHex},
        ${JSON.stringify(proposal.launchPlan)}::text::jsonb,
        ${JSON.stringify(proposal)}::text::jsonb,${proposal.contentDigestHex},
        ${HISTORICAL_TECHNICAL_PROPOSAL_V2}) ON CONFLICT DO NOTHING
    `;
    const rows = await sql<ProposalRow[]>`
      SELECT id::text AS id,proposal_json,content_digest_hex
      FROM trader_historical_technical_proposal_v2
      WHERE organization_id=${proposal.organizationId}::uuid AND run_id=${proposal.runId}
    `;
    const row = rows[0];
    if (rows.length !== 1 || !row || row.content_digest_hex !== proposal.contentDigestHex) {
      refuse("PROPOSAL_CONFLICT");
    }
    assertSealed(row.proposal_json, HISTORICAL_TECHNICAL_PROPOSAL_V2);
    return Object.freeze({ id: row.id, proposal: row.proposal_json });
  } finally {
    try {
      if (locked) await sql`SELECT pg_advisory_unlock(hashtextextended(${lockKey},0))`;
      if (assumed) await resetHistoricalSimulationRunnerRoleV2(sql);
    }
    finally { reserved.release(); }
  }
}

/** TEST_ONLY production-composition seam; the database role downgrade remains real. */
export async function TEST_ONLY_prepareHistoricalTechnicalProposalOnExecutionServerV2(
  pool: postgres.Sql,
  input: Readonly<{ preflight: KmFourSurfaceProductionPreflightInputV2;
    launchPlan: HistoricalTechnicalLaunchPlanV2 }>,
  prepareCandidate: (sql: postgres.Sql) => Promise<HistoricalFourSurfaceTechnicalCandidateV2>,
): Promise<Readonly<{ id: string; proposal: HistoricalTechnicalProposalV2 }>> {
  if (process.env.NODE_ENV !== "test" || process.env.VITEST !== "true") {
    refuse("TEST_ONLY_RUNTIME");
  }
  assertScope(input.preflight);
  validateLaunchPlan(input.launchPlan);
  const reserved = await pool.reserve();
  const sql = bindPostgresReservedSession(pool, reserved);
  let assumed = false;
  let locked = false;
  const lockKey = historicalDatasetAuthorityRunLockKeyV2(input.preflight);
  try {
    await assumeHistoricalSimulationRunnerRoleV2(sql);
    assumed = true;
    await sql`SELECT pg_advisory_lock(hashtextextended(${lockKey},0))`;
    locked = true;
    const request = await loadRequest(sql, input.preflight);
    if (request.request.executionExtent.initialRecordIndex !== input.launchPlan.initialRecordIndex ||
        request.request.executionExtent.cycleCount !== input.launchPlan.cycleCount) {
      refuse("REQUEST_EXECUTION_EXTENT");
    }
    const technicalCandidate = await prepareCandidate(sql);
    assertLaunchPlanWithinQualifiedEconomicPartition(input.launchPlan, technicalCandidate);
    const proposal = seal({
      schemaVersion: HISTORICAL_TECHNICAL_PROPOSAL_V2,
      organizationId: input.preflight.organizationId, runId: input.preflight.runId,
      releaseSha: input.preflight.releaseSha, requestId: request.id,
      requestContentDigestHex: request.request.contentDigestHex,
      technicalCandidateContentDigestHex: technicalCandidate.contentDigestHex,
      technicalCandidate, preflight: input.preflight,
      launchPlan: Object.freeze({ ...input.launchPlan }),
      authorityBoundary: boundary(),
    });
    const id = randomUUID();
    await sql`
      INSERT INTO trader_historical_technical_proposal_v2
        (id,organization_id,run_id,release_sha,request_id,request_content_digest_hex,
         technical_candidate_json,technical_candidate_content_digest_hex,
         launch_plan_json,proposal_json,
         content_digest_hex,schema_version)
      VALUES (${id}::uuid,${proposal.organizationId}::uuid,${proposal.runId},
        ${proposal.releaseSha},${proposal.requestId}::uuid,${proposal.requestContentDigestHex},
        ${JSON.stringify(proposal.technicalCandidate)}::text::jsonb,
        ${proposal.technicalCandidateContentDigestHex},
        ${JSON.stringify(proposal.launchPlan)}::text::jsonb,
        ${JSON.stringify(proposal)}::text::jsonb,${proposal.contentDigestHex},
        ${HISTORICAL_TECHNICAL_PROPOSAL_V2})
    `;
    return Object.freeze({ id, proposal });
  } finally {
    try {
      if (locked) await sql`SELECT pg_advisory_unlock(hashtextextended(${lockKey},0))`;
      if (assumed) await resetHistoricalSimulationRunnerRoleV2(sql);
    }
    finally { reserved.release(); }
  }
}

export async function ratifyHistoricalTechnicalProposalV2(sql: postgres.Sql, input: Readonly<{
  organizationId: string; runId: string; releaseSha: string; proposalId: string;
  proposalContentDigestHex: string; authenticatedOperatorUserId: string;
  humanDecision: typeof HISTORICAL_FOUR_SURFACE_HUMAN_DECISION_V2;
}>): Promise<Readonly<{ id: string; ratification: HistoricalProposalRatificationV2 }>> {
  assertScope(input);
  if (!UUID.test(input.proposalId) || !DIGEST.test(input.proposalContentDigestHex) ||
      !UUID.test(input.authenticatedOperatorUserId) ||
      input.humanDecision !== HISTORICAL_FOUR_SURFACE_HUMAN_DECISION_V2) refuse("RATIFICATION");
  return withPostgresSessionTransaction(sql, "SERIALIZABLE", async (tx) => {
    const lockKey = historicalDatasetAuthorityRunLockKeyV2(input);
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey},0))`;
    const proposals = await tx<ProposalRow[]>`
      SELECT id::text AS id,proposal_json,content_digest_hex
      FROM trader_historical_technical_proposal_v2
      WHERE id=${input.proposalId}::uuid AND organization_id=${input.organizationId}::uuid
        AND run_id=${input.runId} AND release_sha=${input.releaseSha} FOR SHARE
    `;
    const proposal = proposals[0];
    if (proposals.length !== 1 || !proposal ||
        proposal.content_digest_hex !== input.proposalContentDigestHex) refuse("PROPOSAL_MISSING");
    assertSealed(proposal.proposal_json, HISTORICAL_TECHNICAL_PROPOSAL_V2);
    const request = await loadRequest(tx, input);
    if (request.request.operatorUserId !== input.authenticatedOperatorUserId ||
        proposal.proposal_json.requestId !== request.id ||
        proposal.proposal_json.requestContentDigestHex !== request.request.contentDigestHex) {
      refuse("ACTOR_BINDING");
    }
    const members = await tx<Array<Readonly<{ member_role: string }>>>`
      SELECT member_role FROM organization_members
      WHERE organization_id=${input.organizationId}::uuid
        AND user_id=${input.authenticatedOperatorUserId}::uuid FOR SHARE
    `;
    if (members.length !== 1 || !["owner", "manager"].includes(members[0]!.member_role)) {
      refuse("MEMBERSHIP");
    }
    const ratification = seal({
      schemaVersion: HISTORICAL_PROPOSAL_RATIFICATION_V2,
      organizationId: input.organizationId, runId: input.runId,
      releaseSha: input.releaseSha, proposalId: proposal.id,
      proposalContentDigestHex: proposal.content_digest_hex,
      operatorUserId: input.authenticatedOperatorUserId,
      humanDecision: HISTORICAL_FOUR_SURFACE_HUMAN_DECISION_V2,
      authorityBoundary: boundary(),
    });
    const id = randomUUID();
    await tx`
      INSERT INTO trader_historical_proposal_ratification_v2
        (id,organization_id,run_id,release_sha,proposal_id,proposal_content_digest_hex,
         operator_user_id,ratification_json,content_digest_hex,schema_version)
      VALUES (${id}::uuid,${input.organizationId}::uuid,${input.runId},${input.releaseSha},
        ${proposal.id}::uuid,${proposal.content_digest_hex},
        ${input.authenticatedOperatorUserId}::uuid,
        ${JSON.stringify(ratification)}::text::jsonb,
        ${ratification.contentDigestHex},${HISTORICAL_PROPOSAL_RATIFICATION_V2})
      ON CONFLICT DO NOTHING
    `;
    const rows = await tx<RatificationRow[]>`
      SELECT id::text AS id,ratification_json,content_digest_hex
      FROM trader_historical_proposal_ratification_v2
      WHERE organization_id=${input.organizationId}::uuid AND run_id=${input.runId}
    `;
    const row = rows[0];
    if (rows.length !== 1 || !row || row.content_digest_hex !== ratification.contentDigestHex) {
      refuse("RATIFICATION_CONFLICT");
    }
    assertSealed(row.ratification_json, HISTORICAL_PROPOSAL_RATIFICATION_V2);
    return Object.freeze({ id: row.id, ratification: row.ratification_json });
  });
}

async function finalizeApprovedHistoricalProposalWithMaterializerV2(
  pool: postgres.Sql,
  scope: Readonly<{ organizationId: string; runId: string; releaseSha: string }>,
  materialize: typeof INTERNAL_materializeApprovedHistoricalFourSurfaceCandidateV2,
): Promise<Readonly<{ authorityId: string; manifest: HistoricalExecutionServerBootstrapManifestV2 }>> {
  assertScope(scope);
  const reserved = await pool.reserve();
  const sql = bindPostgresReservedSession(pool, reserved);
  let assumed = false;
  let locked = false;
  let operationFailed = false;
  try {
    await assumeHistoricalSimulationRunnerRoleV2(sql);
    assumed = true;
    const lockKey = historicalDatasetAuthorityRunLockKeyV2(scope);
    await sql`SELECT pg_advisory_lock(hashtextextended(${lockKey},0))`;
    locked = true;
    const proposals = await sql<ProposalRow[]>`
        SELECT id::text AS id,proposal_json,content_digest_hex
        FROM trader_historical_technical_proposal_v2
        WHERE organization_id=${scope.organizationId}::uuid AND run_id=${scope.runId}
          AND release_sha=${scope.releaseSha}
      `;
    const approvals = await sql<RatificationRow[]>`
        SELECT id::text AS id,ratification_json,content_digest_hex
        FROM trader_historical_proposal_ratification_v2
        WHERE organization_id=${scope.organizationId}::uuid AND run_id=${scope.runId}
          AND release_sha=${scope.releaseSha}
      `;
    const proposal = proposals[0];
    const approval = approvals[0];
    if (proposals.length !== 1 || approvals.length !== 1 || !proposal || !approval) {
      refuse("APPROVAL_MISSING");
    }
    assertSealed(proposal.proposal_json, HISTORICAL_TECHNICAL_PROPOSAL_V2);
    assertSealed(approval.ratification_json, HISTORICAL_PROPOSAL_RATIFICATION_V2);
    if (approval.ratification_json.proposalId !== proposal.id ||
        approval.ratification_json.proposalContentDigestHex !== proposal.content_digest_hex) {
      refuse("APPROVAL_BINDING");
    }
    const existingAuthorityRows = await sql<Array<Readonly<{
      id: string; authority_content_digest_hex: string;
    }>>>`
      SELECT id::text AS id,authority_content_digest_hex
      FROM trader_historical_four_surface_ratified_admission_v2
      WHERE organization_id=${scope.organizationId}::uuid AND run_id=${scope.runId}
        AND release_sha=${scope.releaseSha}
    `;
    if (existingAuthorityRows.length > 1) refuse("AUTHORITY_AMBIGUOUS");
    const existingAuthority = existingAuthorityRows[0];
    const authorityContentDigestHex = existingAuthority?.authority_content_digest_hex ??
      (await materialize(
        sql,
        { preflight: proposal.proposal_json.preflight,
          humanDecision: HISTORICAL_FOUR_SURFACE_HUMAN_DECISION_V2,
          executionExtent: Object.freeze({
            initialRecordIndex: proposal.proposal_json.launchPlan.initialRecordIndex,
            cycleCount: proposal.proposal_json.launchPlan.cycleCount,
          }) },
        approval.ratification_json.operatorUserId,
        proposal.proposal_json.technicalCandidate,
        { proposalId: proposal.id, proposalContentDigestHex: proposal.content_digest_hex,
          technicalCandidateContentDigestHex:
            proposal.proposal_json.technicalCandidateContentDigestHex },
      )).authority.contentDigestHex;
    const authority = await requireHistoricalFourSurfaceRatifiedAdmissionV2(sql, {
        organizationId: scope.organizationId,
        runId: scope.runId,
        releaseSha: scope.releaseSha,
        aggregateAdmissionReceiptId:
          proposal.proposal_json.technicalCandidate.aggregateAdmissionReceiptId,
        authorityContentDigestHex,
      });
    if (authority.operatorUserId !== approval.ratification_json.operatorUserId ||
        canonicalizeSemanticJsonString(authority.executionExtent) !==
          canonicalizeSemanticJsonString({
            initialRecordIndex: proposal.proposal_json.launchPlan.initialRecordIndex,
            cycleCount: proposal.proposal_json.launchPlan.cycleCount,
          })) {
      refuse("AUTHORITY_APPROVAL_BINDING");
    }
    const authorityRows = await sql<Array<Readonly<{ id: string }>>>`
        SELECT id::text AS id
        FROM trader_historical_four_surface_ratified_admission_v2
        WHERE organization_id=${scope.organizationId}::uuid AND run_id=${scope.runId}
          AND release_sha=${scope.releaseSha}
          AND authority_content_digest_hex=${authority.contentDigestHex}
      `;
      const authorityRow = authorityRows[0];
      if (authorityRows.length !== 1 || !authorityRow ||
          authority.surfaceAdmissions.length !== 4) {
        refuse("AUTHORITY_SURFACES");
      }
      const bootstrap: HistoricalProductionFirstCycleBootstrapInputV2 = Object.freeze({
        preflight: proposal.proposal_json.preflight,
        ratifiedAuthorityId: authorityRow.id,
        ...proposal.proposal_json.launchPlan,
        policyConfig: canonicalHistoricalWalkForwardPolicyV2(scope.releaseSha),
      });
      const body = Object.freeze({
        schemaVersion: HISTORICAL_EXECUTION_SERVER_BOOTSTRAP_MANIFEST_V2,
        bootstrap,
      });
      return Object.freeze({
        authorityId: bootstrap.ratifiedAuthorityId,
        manifest: Object.freeze({ ...body, contentDigestHex: computeSemanticSha256Hex(body) }),
      });
  } catch (error) {
    operationFailed = true;
    throw error;
  } finally {
    let cleanupError: unknown;
    try {
      if (locked) {
        try {
          const lockKey = historicalDatasetAuthorityRunLockKeyV2(scope);
          await sql`SELECT pg_advisory_unlock(hashtextextended(${lockKey},0))`;
        } catch (error) { cleanupError ??= error; }
      }
      if (assumed) {
        try { await resetHistoricalSimulationRunnerRoleV2(sql); }
        catch (error) { cleanupError ??= error; }
      }
    }
    finally { reserved.release(); }
    if (!operationFailed && cleanupError) throw cleanupError;
  }
}

export function finalizeApprovedHistoricalProposalOnExecutionServerV2(
  pool: postgres.Sql,
  scope: Readonly<{ organizationId: string; runId: string; releaseSha: string }>,
) {
  return finalizeApprovedHistoricalProposalWithMaterializerV2(
    pool, scope, INTERNAL_materializeApprovedHistoricalFourSurfaceCandidateV2,
  );
}

export function TEST_ONLY_finalizeApprovedHistoricalProposalOnExecutionServerV2(
  pool: postgres.Sql,
  scope: Readonly<{ organizationId: string; runId: string; releaseSha: string }>,
  materialize: typeof INTERNAL_materializeApprovedHistoricalFourSurfaceCandidateV2,
) {
  if (process.env.NODE_ENV !== "test" || process.env.VITEST !== "true") {
    refuse("TEST_ONLY_RUNTIME");
  }
  return finalizeApprovedHistoricalProposalWithMaterializerV2(pool, scope, materialize);
}
