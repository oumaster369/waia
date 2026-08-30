import { createHash, randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { bindExecutionAuthorityV2Postgres } from "@/lib/trader/execution/v2/authority-postgres";
import {
  createExecutionPolicyBindingV2,
  deterministicExecutionUuidV2,
} from "@/lib/trader/execution/v2/contracts";
import { dispatchAndRecordExecutionAttemptV2 } from "@/lib/trader/execution/v2/recovery-postgres";
import { listExecutionReportsV2Postgres } from "@/lib/trader/execution/v2/repository-postgres";
import type {
  TestOnlyExecutionV2AuthorityPort,
  TestOnlyExecutionV2AuthorityProof,
} from "@/lib/trader/execution/v2/test-only-authority-port";
import { assertControlReplayTestOnlyAuthorityV1 } from "@/lib/trader/observability/control-replay-test-authority";
import { multiplyDecimal } from "@/lib/trader/risk/numeric";
import {
  admitRiskAllowanceV2Postgres,
  initializeRiskAccountStateV2Postgres,
  readRiskAccountStateV2Postgres,
} from "@/lib/trader/risk/v2/risk-allowance-repository-postgres";

const hex64 = (seed: string): string => createHash("sha256").update(seed).digest("hex");

function localPostgresUrl(): string {
  if (process.env.NODE_ENV !== "test" || process.env.WAIA_PG_INTEGRATION !== "1") {
    throw new Error("TEST_ONLY_EXECUTION_V2_POSTGRES_NOT_ENABLED");
  }
  const value = process.env.DATABASE_URL_POSTGRES?.trim();
  if (!value) throw new Error("DATABASE_URL_POSTGRES is required for TEST_ONLY Execution V2");
  const hostname = new URL(value).hostname;
  if (!new Set(["localhost", "127.0.0.1", "::1"]).has(hostname)) {
    throw new Error("TEST_ONLY Execution V2 requires loopback PostgreSQL");
  }
  return value;
}

async function seedTestTenant(
  sql: postgres.Sql,
  db: WaiaPostgresDb,
  organizationId: string,
): Promise<void> {
  const ownerUserId = deterministicExecutionUuidV2("order", {
    purpose: "test-only-execution-owner",
    organizationId,
  });
  await sql`insert into auth.users (id) values (${ownerUserId}::uuid) on conflict (id) do nothing`;
  await db
    .insert(pgSchema.users)
    .values({
      id: ownerUserId,
      identityLabel: "DEE-651 TEST_ONLY Execution V2",
      email: `${ownerUserId}@execution-v2.invalid`,
      passwordHash: null,
    })
    .onConflictDoNothing();
  await db
    .insert(pgSchema.organizations)
    .values({
      id: organizationId,
      ownerUserId,
      kind: "personal",
      name: "DEE-651 TEST_ONLY Execution V2",
    })
    .onConflictDoNothing();
  await db
    .insert(pgSchema.organizationMembers)
    .values({
      id: deterministicExecutionUuidV2("order", {
        purpose: "test-only-execution-membership",
        organizationId,
      }),
      organizationId,
      userId: ownerUserId,
      memberRole: "owner",
    })
    .onConflictDoNothing();
}

function requireProof(condition: boolean, message: string): void {
  if (!condition) throw new Error(`TEST_ONLY_EXECUTION_V2_PROOF_FAILED:${message}`);
}

export const postgresTestOnlyExecutionV2Authority: TestOnlyExecutionV2AuthorityPort = async (
  request,
): Promise<TestOnlyExecutionV2AuthorityProof> => {
  assertControlReplayTestOnlyAuthorityV1({
    surface: "CONTROL_REPLAY",
    authority: request.authority,
  });
  const url = localPostgresUrl();
  const sql = postgres(url, { max: 2 });
  const db = drizzle(sql, { schema: pgSchema }) as WaiaPostgresDb;
  const context = { organizationId: request.organizationId };
  const invocationId = randomUUID();
  const accountId = `${request.accountId}-${invocationId}`;
  const reservationNotional = multiplyDecimal(request.qualifiedQuantity, request.referencePrice);

  try {
    await seedTestTenant(sql, db, request.organizationId);
    await initializeRiskAccountStateV2Postgres(db, context, {
      accountId,
      posture: "NORMAL",
      killState: "CLEAR",
      reconciliationStatus: "RECONCILED",
      realitySnapshotId: `test-only-reality-${invocationId}`,
      realityContentDigestHex: hex64(`test-only-reality:${invocationId}`),
      reconciliationAuthorityDigestHex: hex64(`test-only-reconciliation:${invocationId}`),
      reconciledInstrumentExposures: [
        {
          instrumentIdentityDigestHex: hex64(`${request.symbol}:SPOT`),
          symbol: request.symbol,
          baseQuantity: "0",
        },
      ],
      accounting: {
        reconciledExposureNotional: "0",
        worstCasePendingExposureNotional: "0",
        outstandingReservationNotional: "0",
        exposureLimitNotional: "1000000000",
      },
    });

    const admitted = await admitRiskAllowanceV2Postgres(db, context, {
      accountId,
      riskVerdictId: randomUUID(),
      riskAllowanceId: randomUUID(),
      issuanceEventId: randomUUID(),
      nonce: randomUUID(),
      validForMs: 300_000,
      verdict: {
        venue: "HTX",
        market: "SPOT",
        symbol: request.symbol,
        baseAsset: request.baseAsset,
        quoteAsset: "USDT",
        instrumentIdentityDigestHex: hex64(`${request.symbol}:SPOT`),
        decision: {
          decisionId: request.decision.decisionId,
          semanticDigestHex: request.decision.semanticDigestHex,
          contentDigestHex: request.decision.contentDigestHex,
          forecastId: request.decision.forecastId,
          forecastContentDigestHex: request.decision.forecastContentDigestHex,
          canonicalCausalLineageDigestHex:
            request.decision.canonicalCausalLineageDigestHex,
          action: "ENTER_LONG",
          economicSizeSetId: request.decision.economicSizeSetId,
          economicSizeSetDigestHex: request.decision.economicSizeSetDigestHex,
        },
        riskPolicyVersion: "dee-651-test-only-risk-v2",
        riskPolicyDigestHex: hex64("dee-651-test-only-risk-v2"),
        limitVersions: [
          {
            layer: "L2",
            version: "test-only-position-v1",
            digestHex: hex64("test-only-position-v1"),
          },
        ],
        reality: {
          snapshotId: `test-only-reality-${invocationId}`,
          contentDigestHex: hex64(`test-only-reality:${invocationId}`),
          asOfUtc: new Date().toISOString(),
          reconciliationAuthorityDigestHex: hex64(`test-only-reconciliation:${invocationId}`),
          reconciliationStatus: "RECONCILED",
        },
        referencePrice: {
          authorityId: "test-only-control-replay-anchor",
          authorityVersion: "v1",
          contentDigestHex: hex64(`test-only-price:${request.referencePrice}`),
          price: request.referencePrice,
        },
        verdict: "APPROVE_CLAMPED",
        approvedQualifiedQuantity: request.qualifiedQuantity,
        bindingLayers: ["L2"],
        reasonCodes: ["POSITION_LIMIT_BINDING"],
      },
    });
    const reserved = await readRiskAccountStateV2Postgres(db, context, accountId);
    requireProof(
      reserved?.accounting.outstandingReservationNotional === reservationNotional,
      "allowance reservation was not durable",
    );

    const now = Date.now();
    const policy = createExecutionPolicyBindingV2({
      executionPolicyId: randomUUID(),
      organizationId: request.organizationId,
      policyVersion: "dee-651-test-only-htx-spot-v1",
      decisionId: request.decision.decisionId,
      decisionContentDigestHex: request.decision.contentDigestHex,
      decisionExecutionPolicyDigestHex: request.decision.executionPolicyDigestHex,
      economicSizeSetDigestHex: request.decision.economicSizeSetDigestHex,
      venue: "HTX",
      market: "SPOT",
      instrumentIdentityDigestHex: admitted.allowance.instrumentIdentityDigestHex,
      allowedOrderTypes: ["limit"],
      allowedTimeInForce: ["GTC"],
      allowedLiquidityRoles: ["MAKER"],
      priceCollar: {
        minimumPrice: request.referencePrice,
        maximumPrice: request.referencePrice,
        authorityDigestHex: hex64(`test-only-collar:${request.referencePrice}`),
      },
      quantityRules: {
        minimumQuantity: request.qualifiedQuantity,
        quantityStep: request.qualifiedQuantity,
        roundingMode: "EXACT",
        economicQualifiedQuantities: [request.qualifiedQuantity],
      },
      slicingPolicy: { maximumSlices: 1, completePlanRequired: true },
      retryPolicy: {
        maximumNetworkSubmissions: 1,
        sameIdentityRetryAllowed: false,
        venueIdempotencyProven: false,
      },
      cancelPolicy: {
        protectiveCancelAllowed: true,
        replacementRequiresPresealedOrFreshAuthority: true,
      },
      timeoutMs: 5_000,
      uncertaintyHandling: "RECONCILIATION_REQUIRED",
      effectiveFromUtc: new Date(now - 60_000).toISOString(),
      effectiveUntilUtc: new Date(now + 600_000).toISOString(),
    });
    const bindInput = {
      allowance: admitted.allowance,
      policy,
      plan: {
        approvedNotionalCeiling: reservationNotional,
        plannedQuantity: request.qualifiedQuantity,
        orderType: "limit" as const,
        liquidityRole: "MAKER" as const,
        limitPrice: request.referencePrice,
        timeInForce: "GTC" as const,
        timingWindow: {
          opensAtUtc: new Date(now - 1_000).toISOString(),
          closesAtUtc: new Date(now + 300_000).toISOString(),
        },
        childSlices: [
          {
            sequence: 1,
            quantity: request.qualifiedQuantity,
            limitPrice: request.referencePrice,
          },
        ],
        sealedAtUtc: new Date(now - 2_000).toISOString(),
      },
      executionMode: "mock" as const,
      credentialId: null,
      strategySignalId: null,
      allocationDecisionId: request.decision.decisionId,
    };
    const first = await bindExecutionAuthorityV2Postgres(db, context, bindInput);
    const restart = await bindExecutionAuthorityV2Postgres(db, context, bindInput);
    requireProof(first.consumedNow, "first bind did not consume allowance");
    requireProof(!restart.consumedNow, "restart consumed allowance twice");
    requireProof(
      first.attempt.contentDigestHex === restart.attempt.contentDigestHex &&
        first.order.id === restart.order.id,
      "restart changed the exact effect identity",
    );
    const bound = await readRiskAccountStateV2Postgres(db, context, accountId);
    const reservationTransferredToPending =
      bound?.accounting.outstandingReservationNotional === "0" &&
      bound.accounting.worstCasePendingExposureNotional === reservationNotional;
    requireProof(reservationTransferredToPending, "reservation did not transfer to pending");

    let networkSubmissionCalls = 0;
    const uncertain = await dispatchAndRecordExecutionAttemptV2(
      db,
      context,
      first.attempt.executionAttemptId,
      async () => {
        networkSubmissionCalls += 1;
        throw new Error("TEST_ONLY_ZERO_EFFECT_TIMEOUT");
      },
    );
    requireProof(uncertain.status === "RECONCILIATION_REQUIRED", "timeout did not fail unknown");
    const callsBeforeRestart = networkSubmissionCalls;
    await dispatchAndRecordExecutionAttemptV2(
      db,
      context,
      first.attempt.executionAttemptId,
      async () => {
        networkSubmissionCalls += 1;
        throw new Error("BLIND_RESEND_FORBIDDEN");
      },
    );
    requireProof(
      networkSubmissionCalls === callsBeforeRestart,
      "recovery attempted a blind resend",
    );
    const reports = await listExecutionReportsV2Postgres(
      db,
      context,
      first.attempt.executionAttemptId,
    );
    const reportTypes = reports.map((report) => report.reportType);
    requireProof(reportTypes.includes("CONNECTOR_UNCERTAIN"), "raw unknown report missing");
    requireProof(
      reportTypes.includes("RECONCILIATION_REQUIRED"),
      "reconciliation-required report missing",
    );

    return Object.freeze({
      riskAllowanceId: admitted.allowance.riskAllowanceId,
      riskAllowanceContentDigestHex: admitted.allowance.contentDigestHex,
      executionPlanId: first.plan.executionPlanId,
      executionPlanContentDigestHex: first.plan.contentDigestHex,
      executionAttemptId: first.attempt.executionAttemptId,
      executionAttemptContentDigestHex: first.attempt.contentDigestHex,
      orderId: first.order.id,
      clientOrderId: first.attempt.clientOrderId,
      qualifiedQuantity: request.qualifiedQuantity,
      firstBindConsumedNow: true,
      restartConsumedNow: false,
      restartPreservedEffectIdentity: true,
      reservationTransferredToPending: true,
      networkSubmissionCalls: 1,
      restartSubmissionCalls: 0,
      terminalStatus: "RECONCILIATION_REQUIRED",
      reportTypes: Object.freeze(reportTypes),
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
};
