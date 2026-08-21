import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import * as pgSchema from "@/db/schema.postgres";
import {
  runWaiaPostgresTransaction,
  type WaiaPostgresDb,
} from "@/db/waia-postgres-transaction";
import {
  createExecutionAttemptV2,
  createExecutionPlanV2,
  createExecutionPolicyBindingV2,
  type ExecutionPlanV2,
} from "@/lib/trader/execution/v2/contracts";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import {
  bindExecutionAuthorityV2Postgres,
  dispatchCommittedExecutionAttemptV2,
  type BindExecutionAuthorityV2Input,
} from "@/lib/trader/execution/v2/authority-postgres";
import {
  appendExecutionReportV2Postgres,
  insertExecutionAttemptV2Postgres,
  insertExecutionPlanV2Postgres,
  insertExecutionPolicyV2Postgres,
  listExecutionReportsV2Postgres,
  readExecutionAttemptProjectionV2Postgres,
  readExecutionAttemptV2Postgres,
} from "@/lib/trader/execution/v2/repository-postgres";
import {
  dispatchAndRecordExecutionAttemptV2,
  recordProtectiveCancelAcknowledgementV2Postgres,
  requestProtectiveCancelV2Postgres,
} from "@/lib/trader/execution/v2/recovery-postgres";
import { divideDecimal } from "@/lib/trader/risk/numeric";
import {
  admitRiskAllowanceV2Postgres,
  consumeRiskAllowanceForOrderV2Postgres,
  initializeRiskAccountStateV2Postgres,
  type AdmitRiskAllowanceV2Input,
} from "@/lib/trader/risk/v2/risk-allowance-repository-postgres";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { cleanupWp13Org, seedWp13User } from "./wp13-intelligence-test-helpers";

const enabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();
const USER_A = "00000000-0000-4000-8000-000000066701";
const USER_B = "00000000-0000-4000-8000-000000066702";
const hex64 = (seed: string) => createHash("sha256").update(seed).digest("hex");
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const executionTables = [
  "trader_execution_policies_v2",
  "trader_execution_plans_v2",
  "trader_execution_attempts_v2",
  "trader_execution_reports_v2",
] as const;

function account(accountId: string) {
  return {
    accountId,
    posture: "NORMAL" as const,
    killState: "CLEAR" as const,
    reconciliationStatus: "RECONCILED" as const,
    realitySnapshotId: `reality-${accountId}`,
    realityContentDigestHex: hex64(`reality-${accountId}`),
    reconciliationAuthorityDigestHex: hex64(`reconciliation-${accountId}`),
    reconciledInstrumentExposures: [{
      instrumentIdentityDigestHex: hex64("BTCUSDT-SPOT"),
      symbol: "BTCUSDT",
      baseQuantity: "0",
    }],
    accounting: {
      reconciledExposureNotional: "0",
      worstCasePendingExposureNotional: "0",
      outstandingReservationNotional: "0",
      exposureLimitNotional: "100",
    },
  };
}

function admission(accountId: string): AdmitRiskAllowanceV2Input {
  return {
    accountId,
    riskVerdictId: uuid(667_101),
    riskAllowanceId: uuid(667_102),
    issuanceEventId: uuid(667_103),
    nonce: uuid(667_104),
    validForMs: 30_000,
    verdict: {
      venue: "HTX",
      market: "SPOT",
      symbol: "BTCUSDT",
      baseAsset: "BTC",
      quoteAsset: "USDT",
      instrumentIdentityDigestHex: hex64("BTCUSDT-SPOT"),
      decision: {
        decisionId: "decision-execution-v2",
        semanticDigestHex: hex64("decision-semantic"),
        contentDigestHex: hex64("decision-content"),
        action: "ENTER_LONG",
        economicSizeSetId: "decision-execution-v2-sizes",
        economicSizeSetDigestHex: hex64("decision-execution-v2-sizes"),
      },
      riskPolicyVersion: "risk-v2-integration",
      riskPolicyDigestHex: hex64("risk-v2-integration"),
      limitVersions: [{ layer: "L2", version: "position-v1", digestHex: hex64("position-v1") }],
      reality: {
        snapshotId: `reality-${accountId}`,
        contentDigestHex: hex64(`reality-${accountId}`),
        asOfUtc: "2026-08-21T00:00:00.000Z",
        reconciliationAuthorityDigestHex: hex64(`reconciliation-${accountId}`),
        reconciliationStatus: "RECONCILED",
      },
      referencePrice: {
        authorityId: "test-median",
        authorityVersion: "v1",
        contentDigestHex: hex64("test-median-v1"),
        price: divideDecimal("25", "0.001"),
      },
      verdict: "APPROVE_CLAMPED",
      approvedQualifiedQuantity: "0.001",
      bindingLayers: ["L2"],
      reasonCodes: ["POSITION_LIMIT_BINDING"],
    },
  };
}

async function clearOrganization(sql: postgres.Sql, organizationId: string): Promise<void> {
  const guarded = [
    ["trader_execution_reports_v2", "trader_execution_reports_v2_block_delete"],
    ["trader_execution_attempts_v2", "trader_execution_attempts_v2_block_delete"],
    ["trader_execution_plans_v2", "trader_execution_plans_v2_block_delete"],
    ["trader_execution_policies_v2", "trader_execution_policies_v2_block_delete"],
    ["trader_risk_enforcement_events_v2", "trader_risk_enforcement_events_v2_block_delete"],
    ["trader_risk_allowances_v2", "trader_risk_allowances_v2_block_delete"],
    ["trader_risk_verdicts_v2", "trader_risk_verdicts_v2_block_delete"],
  ] as const;
  for (const [table, trigger] of guarded) {
    await sql.unsafe(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
  }
  try {
    await sql.begin(async (tx) => {
      await tx`DELETE FROM trader_execution_reports_v2 WHERE organization_id = ${organizationId}::uuid`;
      await tx`DELETE FROM trader_execution_attempts_v2 WHERE organization_id = ${organizationId}::uuid`;
      await tx`DELETE FROM trader_execution_plans_v2 WHERE organization_id = ${organizationId}::uuid`;
      await tx`DELETE FROM trader_execution_policies_v2 WHERE organization_id = ${organizationId}::uuid`;
      await tx`DELETE FROM trader_risk_enforcement_events_v2 WHERE organization_id = ${organizationId}::uuid`;
      await tx`DELETE FROM trader_risk_allowances_v2 WHERE organization_id = ${organizationId}::uuid`;
      await tx`DELETE FROM trader_orders WHERE organization_id = ${organizationId}::uuid`;
      await tx`DELETE FROM trader_risk_verdicts_v2 WHERE organization_id = ${organizationId}::uuid`;
      await tx`DELETE FROM trader_risk_account_state_v2 WHERE organization_id = ${organizationId}::uuid`;
    });
  } finally {
    for (const [table, trigger] of [...guarded].reverse()) {
      await sql.unsafe(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
    }
  }
}

describe.skipIf(!enabled || !url)("Postgres Execution V2 substrate (DEE-667 / E651-A)", () => {
  let sql: postgres.Sql;
  let db: WaiaPostgresDb;
  let orgA: string;
  let orgB: string;

  beforeAll(async () => {
    sql = postgres(url!, { max: 8 });
    for (const userId of [USER_A, USER_B]) {
      await clearOrganization(sql, personalOrganizationIdFromUserId(userId));
      await cleanupWp13Org(url!, userId);
    }
    orgA = await seedWp13User(url!, USER_A, "DEE-667 Execution Org A");
    orgB = await seedWp13User(url!, USER_B, "DEE-667 Execution Org B");
    db = drizzle(sql, { schema: pgSchema }) as WaiaPostgresDb;
  }, 120_000);

  beforeEach(async () => {
    await clearOrganization(sql, orgA);
    await clearOrganization(sql, orgB);
  });

  afterAll(async () => {
    if (sql) {
      await clearOrganization(sql, orgA);
      await clearOrganization(sql, orgB);
      await sql.end({ timeout: 10 });
    }
    await cleanupWp13Org(url!, USER_A);
    await cleanupWp13Org(url!, USER_B);
  });

  async function persistAuthority() {
    const accountId = "execution-v2";
    await initializeRiskAccountStateV2Postgres(db, { organizationId: orgA }, account(accountId));
    const admitted = await admitRiskAllowanceV2Postgres(
      db,
      { organizationId: orgA },
      admission(accountId),
    );
    const allowance = admitted.allowance;
    const policy = createExecutionPolicyBindingV2({
      executionPolicyId: uuid(667_201),
      organizationId: orgA,
      policyVersion: "htx-spot-v1",
      decisionId: allowance.decision.decisionId,
      decisionContentDigestHex: allowance.decision.contentDigestHex,
      decisionExecutionPolicyDigestHex: hex64("decision-execution-policy"),
      economicSizeSetDigestHex: allowance.decision.economicSizeSetDigestHex,
      venue: "HTX",
      market: "SPOT",
      instrumentIdentityDigestHex: allowance.instrumentIdentityDigestHex,
      allowedOrderTypes: ["limit"],
      allowedTimeInForce: ["GTC"],
      allowedLiquidityRoles: ["MAKER"],
      priceCollar: {
        minimumPrice: "24000",
        maximumPrice: "26000",
        authorityDigestHex: hex64("collar"),
      },
      quantityRules: {
        minimumQuantity: "0.001",
        quantityStep: "0.001",
        roundingMode: "EXACT",
        economicQualifiedQuantities: ["0.001"],
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
      effectiveFromUtc: "2026-08-21T00:00:00.000Z",
      effectiveUntilUtc: "2026-08-22T00:00:00.000Z",
    });
    const plan = createExecutionPlanV2({
      executionPlanId: uuid(667_202),
      allowance,
      policy,
      approvedNotionalCeiling: "25",
      plannedQuantity: "0.001",
      orderType: "limit",
      liquidityRole: "MAKER",
      limitPrice: "25000",
      timeInForce: "GTC",
      timingWindow: {
        opensAtUtc: "2026-08-21T00:00:00.000Z",
        closesAtUtc: "2026-08-21T00:00:05.000Z",
      },
      childSlices: [{ sequence: 1, quantity: "0.001", limitPrice: "25000" }],
      sealedAtUtc: "2026-08-21T00:00:00.000Z",
    });
    const orderId = uuid(667_203);
    const consumed = await consumeRiskAllowanceForOrderV2Postgres(db, { organizationId: orgA }, {
      accountId,
      riskAllowanceId: allowance.riskAllowanceId,
      nonce: allowance.nonce,
      consumptionEventId: uuid(667_204),
      order: {
        id: orderId,
        executionMode: "paper",
        symbol: "BTCUSDT",
        side: "buy",
        type: "limit",
        price: "25000",
        quantity: "0.001",
        clientOrderId: "legacy-placeholder",
        idempotencyKey: `execution-v2-${plan.contentDigestHex}`,
        strategySignalId: null,
        allocationDecisionId: null,
        credentialId: null,
      },
    });
    expect(consumed.status).toBe("CONSUMED");
    const attempt = createExecutionAttemptV2({
      executionAttemptId: uuid(667_205),
      orderId,
      plan,
      riskAllowanceContentDigestHex: allowance.contentDigestHex,
      boundAtUtc: "2026-08-21T00:00:00.001Z",
    });
    await insertExecutionPolicyV2Postgres(db, { organizationId: orgA }, policy);
    await runWaiaPostgresTransaction(db, async (tx) => {
      await insertExecutionPlanV2Postgres(tx, { organizationId: orgA }, plan);
      await tx.update(pgSchema.traderOrders).set({
        clientOrderId: attempt.clientOrderId,
        executionPlanId: plan.executionPlanId,
        executionPlanDigest: plan.contentDigestHex,
        executionAttemptId: attempt.executionAttemptId,
        executionAttemptDigest: attempt.contentDigestHex,
      }).where(and(
        eq(pgSchema.traderOrders.id, orderId),
        eq(pgSchema.traderOrders.organizationId, orgA),
      ));
      await insertExecutionAttemptV2Postgres(tx, { organizationId: orgA }, attempt);
    });
    return { accountId, allowance, attempt, plan, policy };
  }

  async function admittedBindInput(): Promise<BindExecutionAuthorityV2Input> {
    const accountId = "atomic-bind";
    await initializeRiskAccountStateV2Postgres(db, { organizationId: orgA }, account(accountId));
    const admitted = await admitRiskAllowanceV2Postgres(
      db,
      { organizationId: orgA },
      admission(accountId),
    );
    const allowance = admitted.allowance;
    const now = Date.now();
    const opensAtUtc = new Date(now - 60_000).toISOString();
    const closesAtUtc = new Date(now + 60_000).toISOString();
    const policy = createExecutionPolicyBindingV2({
      executionPolicyId: uuid(667_501),
      organizationId: orgA,
      policyVersion: "htx-atomic-bind-v1",
      decisionId: allowance.decision.decisionId,
      decisionContentDigestHex: allowance.decision.contentDigestHex,
      decisionExecutionPolicyDigestHex: hex64("atomic-decision-execution-policy"),
      economicSizeSetDigestHex: allowance.decision.economicSizeSetDigestHex,
      venue: "HTX",
      market: "SPOT",
      instrumentIdentityDigestHex: allowance.instrumentIdentityDigestHex,
      allowedOrderTypes: ["limit"],
      allowedTimeInForce: ["GTC"],
      allowedLiquidityRoles: ["MAKER"],
      priceCollar: {
        minimumPrice: "24000",
        maximumPrice: "26000",
        authorityDigestHex: hex64("atomic-collar"),
      },
      quantityRules: {
        minimumQuantity: "0.001",
        quantityStep: "0.001",
        roundingMode: "EXACT",
        economicQualifiedQuantities: ["0.001"],
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
      effectiveFromUtc: new Date(now - 120_000).toISOString(),
      effectiveUntilUtc: new Date(now + 120_000).toISOString(),
    });
    return {
      allowance,
      policy,
      plan: {
        approvedNotionalCeiling: "25",
        plannedQuantity: "0.001",
        orderType: "limit",
        liquidityRole: "MAKER",
        limitPrice: "25000",
        timeInForce: "GTC",
        timingWindow: { opensAtUtc, closesAtUtc },
        childSlices: [{ sequence: 1, quantity: "0.001", limitPrice: "25000" }],
        sealedAtUtc: opensAtUtc,
      },
      executionMode: "paper",
      credentialId: null,
      strategySignalId: "signal-atomic-bind",
      allocationDecisionId: "allocation-atomic-bind",
    };
  }

  it("persists tenant-scoped immutable authority and a raw append-only report chain", async () => {
    const { accountId, attempt } = await persistAuthority();
    expect(await readExecutionAttemptV2Postgres(db, { organizationId: orgA }, attempt.executionAttemptId))
      .toEqual(attempt);
    expect(await readExecutionAttemptV2Postgres(db, { organizationId: orgB }, attempt.executionAttemptId))
      .toBeNull();

    const first = await appendExecutionReportV2Postgres(db, { organizationId: orgA }, {
      executionReportId: uuid(667_301),
      accountId,
      executionAttemptId: attempt.executionAttemptId,
      reportType: "ATTEMPT_BOUND",
      source: "EXECUTION",
      rawObservation: { committed: true },
      observedAtUtc: "2026-08-21T00:00:00.002Z",
    });
    const second = await appendExecutionReportV2Postgres(db, { organizationId: orgA }, {
      executionReportId: uuid(667_302),
      accountId,
      executionAttemptId: attempt.executionAttemptId,
      reportType: "CONNECTOR_UNCERTAIN",
      source: "CONNECTOR",
      rawObservation: { timeout: true, body: null },
      observedAtUtc: "2026-08-21T00:00:05.000Z",
    });
    expect(second.previousReportDigestHex).toBe(first.contentDigestHex);
    expect(await listExecutionReportsV2Postgres(db, { organizationId: orgA }, attempt.executionAttemptId))
      .toEqual([first, second]);
    await expect(sql`
      UPDATE trader_execution_reports_v2 SET raw_observation = '{}'::jsonb
      WHERE id = ${first.executionReportId}::uuid
    `).rejects.toThrow(/append-only/);
  });

  it("derives lifecycle projection from report type instead of caller input", async () => {
    const { accountId, attempt } = await persistAuthority();
    const forgedProjection = {
      executionReportId: uuid(667_303),
      accountId,
      executionAttemptId: attempt.executionAttemptId,
      reportType: "ATTEMPT_BOUND",
      source: "EXECUTION",
      rawObservation: { committed: true },
      observedAtUtc: "2026-08-21T00:00:00.002Z",
      lifecycleState: "FILLED",
    } as const;
    await appendExecutionReportV2Postgres(
      db,
      { organizationId: orgA },
      forgedProjection,
    );
    const projection = await readExecutionAttemptProjectionV2Postgres(
      db,
      { organizationId: orgA },
      attempt.executionAttemptId,
    );
    expect(projection?.lifecycleState).toBe("BOUND");
  });

  it("refuses caller-labeled terminal reports without exact matching raw evidence", async () => {
    const { accountId, attempt } = await persistAuthority();
    await appendExecutionReportV2Postgres(db, { organizationId: orgA }, {
      executionReportId: uuid(667_304),
      accountId,
      executionAttemptId: attempt.executionAttemptId,
      reportType: "SUBMIT_STARTED",
      source: "EXECUTION",
      rawObservation: { effectIdentityDigestHex: attempt.effectIdentityDigestHex },
      observedAtUtc: "2026-08-21T00:00:00.002Z",
    });
    const openOrder = {
      orderId: "venue-order-forged-terminal",
      clientOrderId: attempt.clientOrderId,
      symbol: attempt.exactRequestPayload.symbol,
      side: attempt.exactRequestPayload.side,
      type: attempt.exactRequestPayload.type,
      status: "open",
      price: attempt.exactRequestPayload.price,
      quantity: attempt.exactRequestPayload.quantity,
      filledQuantity: "0",
    };
    await expect(appendExecutionReportV2Postgres(db, { organizationId: orgA }, {
      executionReportId: uuid(667_305),
      accountId,
      executionAttemptId: attempt.executionAttemptId,
      reportType: "VENUE_REJECTED",
      source: "CONNECTOR",
      rawObservation: { order: openOrder },
      venueOrderId: openOrder.orderId,
      observedAtUtc: "2026-08-21T00:00:00.003Z",
    })).rejects.toThrow(/exact bound order evidence/);
    await expect(appendExecutionReportV2Postgres(db, { organizationId: orgA }, {
      executionReportId: uuid(667_306),
      accountId,
      executionAttemptId: attempt.executionAttemptId,
      reportType: "FILL_REPORT_OBSERVED",
      source: "CONNECTOR",
      rawObservation: {
        order: {
          ...openOrder,
          status: "filled",
          filledQuantity: attempt.exactRequestPayload.quantity,
        },
      },
      venueOrderId: openOrder.orderId,
      observedAtUtc: "2026-08-21T00:00:00.004Z",
    })).rejects.toThrow(/exact raw trade evidence/);
    const projection = await readExecutionAttemptProjectionV2Postgres(
      db,
      { organizationId: orgA },
      attempt.executionAttemptId,
    );
    expect(projection?.lifecycleState).toBe("SUBMIT_STARTED");
  });

  it("enables service-only deny-by-default RLS for all four relations", async () => {
    await persistAuthority();
    const metadata = await sql<{ relname: string; relrowsecurity: boolean }[]>`
      SELECT c.relname, c.relrowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY(${executionTables as unknown as string[]})
      ORDER BY c.relname
    `;
    expect(metadata).toHaveLength(4);
    expect(metadata.every((row) => row.relrowsecurity)).toBe(true);

    await sql.unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${executionTables.join(", ")} TO authenticated, anon`);
    try {
      for (const role of ["authenticated", "anon"] as const) {
        const roleSql = postgres(url!, { max: 1 });
        try {
          await roleSql.unsafe(`SET ROLE ${role}`);
          for (const table of executionTables) {
            await expect(roleSql.unsafe(`SELECT * FROM ${table}`)).resolves.toEqual([]);
            await expect(roleSql.unsafe(
              `UPDATE ${table} SET organization_id = organization_id RETURNING organization_id`,
            )).resolves.toEqual([]);
            await expect(roleSql.unsafe(`DELETE FROM ${table} RETURNING organization_id`))
              .resolves.toEqual([]);
          }
          await expect(roleSql.unsafe(`
            INSERT INTO trader_execution_policies_v2 (
              id, organization_id, policy_version, decision_id, decision_content_digest,
              decision_execution_policy_digest, economic_size_set_digest, venue, market,
              instrument_identity_digest, allowed_order_types, allowed_time_in_force,
              allowed_liquidity_roles, price_collar, quantity_rules, slicing_policy,
              retry_policy, cancel_policy, timeout_ms, uncertainty_handling,
              effective_from, effective_until, semantic_digest, content_digest, schema_version
            ) VALUES (
              '${uuid(667_401)}', '${orgA}', 'denied', 'decision', '${hex64("d1")}',
              '${hex64("d2")}', '${hex64("d3")}', 'HTX', 'SPOT', '${hex64("d4")}',
              '["limit"]', '["GTC"]', '["MAKER"]', '{}', '{}', '{}', '{}', '{}', 1,
              'RECONCILIATION_REQUIRED', now(), now() + interval '1 minute',
              '${hex64("d5")}', '${hex64("d6")}', 'execution-policy-binding/v2'
            )
          `)).rejects.toThrow(/row-level security/);
        } finally {
          try { await roleSql.unsafe("RESET ROLE"); } catch {}
          await roleSql.end({ timeout: 5 });
        }
      }
    } finally {
      await sql.unsafe(
        `REVOKE SELECT, INSERT, UPDATE, DELETE ON ${executionTables.join(", ")} FROM authenticated, anon`,
      );
    }
  });

  it("atomically binds one allowance/plan/attempt under concurrency and dispatches once", async () => {
    const input = await admittedBindInput();
    const outcomes = await Promise.all([
      bindExecutionAuthorityV2Postgres(db, { organizationId: orgA }, input),
      bindExecutionAuthorityV2Postgres(db, { organizationId: orgA }, input),
    ]);
    expect(outcomes.filter((value) => value.consumedNow)).toHaveLength(1);
    expect(outcomes[0]?.plan.contentDigestHex).toBe(outcomes[1]?.plan.contentDigestHex);
    expect(outcomes[0]?.attempt).toEqual(outcomes[1]?.attempt);
    const counts = await sql<{ order_count: string; attempt_count: string; report_count: string }[]>`
      SELECT
        (SELECT count(*)::text FROM trader_orders
          WHERE organization_id = ${orgA}::uuid
            AND risk_allowance_id = ${input.allowance.riskAllowanceId}::uuid) AS order_count,
        (SELECT count(*)::text FROM trader_execution_attempts_v2
          WHERE organization_id = ${orgA}::uuid
            AND risk_allowance_id = ${input.allowance.riskAllowanceId}::uuid) AS attempt_count,
        (SELECT count(*)::text FROM trader_execution_reports_v2
          WHERE organization_id = ${orgA}::uuid) AS report_count
    `;
    expect(counts[0]).toEqual({ order_count: "1", attempt_count: "1", report_count: "3" });
    const riskState = await sql<{
      outstanding: string;
      pending: string;
    }[]>`
      SELECT outstanding_reservation_notional::text AS outstanding,
        worst_case_pending_exposure_notional::text AS pending
      FROM trader_risk_account_state_v2
      WHERE organization_id = ${orgA}::uuid AND account_id = ${input.allowance.accountId}
    `;
    expect(riskState[0]).toEqual({ outstanding: "0.00000000", pending: "25.00000000" });

    let networkCalls = 0;
    const firstDispatch = await dispatchCommittedExecutionAttemptV2(
      db,
      { organizationId: orgA },
      outcomes[0]!.attempt.executionAttemptId,
      async (payload) => {
        networkCalls += 1;
        expect(payload).toEqual(outcomes[0]!.attempt.exactRequestPayload);
        return { accepted: true };
      },
    );
    expect(firstDispatch.status).toBe("SUBMITTED");
    const restartDispatch = await dispatchCommittedExecutionAttemptV2(
      db,
      { organizationId: orgA },
      outcomes[0]!.attempt.executionAttemptId,
      async () => {
        networkCalls += 1;
        return { accepted: true };
      },
    );
    expect(restartDispatch.status).toBe("REFUSED_ALREADY_STARTED");
    expect(networkCalls).toBe(1);
  });

  it("refuses a self-consistent plan whose claimed ceiling exceeds the locked allowance", async () => {
    const input = await admittedBindInput();
    await insertExecutionPolicyV2Postgres(db, { organizationId: orgA }, input.policy);
    const forgedPlan = createExecutionPlanV2({
      ...input.plan,
      executionPlanId: uuid(667_506),
      allowance: { ...input.allowance, reservedExposureNotional: "250" },
      policy: input.policy,
      approvedNotionalCeiling: "250",
    });
    await expect(insertExecutionPlanV2Postgres(
      db,
      { organizationId: orgA },
      forgedPlan,
    )).rejects.toThrow(/locked Risk allowance/);
  });

  it("refuses a self-consistent plan whose exact effect exceeds its claimed ceiling", async () => {
    const input = await admittedBindInput();
    await insertExecutionPolicyV2Postgres(db, { organizationId: orgA }, input.policy);
    const validPlan = createExecutionPlanV2({
      ...input.plan,
      executionPlanId: uuid(667_507),
      allowance: input.allowance,
      policy: input.policy,
    });
    const {
      semanticDigestHex: _semanticDigestHex,
      contentDigestHex: _contentDigestHex,
      ...validPayload
    } = validPlan;
    void _semanticDigestHex;
    void _contentDigestHex;
    const forgedPayload = {
      ...validPayload,
      limitPrice: "26000",
      childSlices: [{ sequence: 1, quantity: "0.001", limitPrice: "26000" }],
    };
    const semanticDigestHex = computeStableJsonDigest(forgedPayload);
    const forgedPlan = {
      ...forgedPayload,
      semanticDigestHex,
      contentDigestHex: computeStableJsonDigest({ ...forgedPayload, semanticDigestHex }),
    } as ExecutionPlanV2;

    await expect(insertExecutionPlanV2Postgres(
      db,
      { organizationId: orgA },
      forgedPlan,
    )).rejects.toThrow(/stored Execution policy or notional authority/);
  });

  it("reconstructs the complete durable effect binding before any network call", async () => {
    const input = await admittedBindInput();
    const bound = await bindExecutionAuthorityV2Postgres(db, { organizationId: orgA }, input);
    await sql`
      UPDATE trader_orders SET idempotency_key = 'tampered-after-bind'
      WHERE organization_id = ${orgA}::uuid AND id = ${bound.order.id}::uuid
    `;
    let networkCalls = 0;
    await expect(dispatchCommittedExecutionAttemptV2(
      db,
      { organizationId: orgA },
      bound.attempt.executionAttemptId,
      async () => {
        networkCalls += 1;
        return { forbidden: true };
      },
    )).rejects.toThrow(/INCOMPLETE_DURABLE_EFFECT_BINDING/);
    expect(networkCalls).toBe(0);
  });

  it("rechecks the sealed timing window immediately before submission", async () => {
    const original = await admittedBindInput();
    const input: BindExecutionAuthorityV2Input = {
      ...original,
      plan: {
        ...original.plan,
        timingWindow: {
          ...original.plan.timingWindow,
          closesAtUtc: new Date(Date.now() + 1_000).toISOString(),
        },
      },
    };
    const bound = await bindExecutionAuthorityV2Postgres(db, { organizationId: orgA }, input);
    await sql`select pg_sleep(1.2)`;
    let networkCalls = 0;
    await expect(dispatchCommittedExecutionAttemptV2(
      db,
      { organizationId: orgA },
      bound.attempt.executionAttemptId,
      async () => {
        networkCalls += 1;
        return { forbidden: true };
      },
    )).rejects.toThrow(/EXECUTION_WINDOW_CLOSED/);
    expect(networkCalls).toBe(0);
  });

  it("uses wall-clock time after an attempt-lock wait before submission", async () => {
    const original = await admittedBindInput();
    const input: BindExecutionAuthorityV2Input = {
      ...original,
      plan: {
        ...original.plan,
        timingWindow: {
          ...original.plan.timingWindow,
          closesAtUtc: new Date(Date.now() + 3_000).toISOString(),
        },
      },
    };
    const bound = await bindExecutionAuthorityV2Postgres(db, { organizationId: orgA }, input);
    let releaseAttemptLock!: () => void;
    const releaseAttemptLockPromise = new Promise<void>((resolve) => {
      releaseAttemptLock = resolve;
    });
    let markAttemptLocked!: () => void;
    const attemptLocked = new Promise<void>((resolve) => {
      markAttemptLocked = resolve;
    });
    const blocker = sql.begin(async (tx) => {
      await tx`
        SELECT id FROM trader_execution_attempts_v2
        WHERE organization_id = ${orgA}::uuid
          AND id = ${bound.attempt.executionAttemptId}::uuid
        FOR UPDATE
      `;
      markAttemptLocked();
      await releaseAttemptLockPromise;
    });
    await attemptLocked;

    let networkCalls = 0;
    const dispatch = dispatchCommittedExecutionAttemptV2(
      db,
      { organizationId: orgA },
      bound.attempt.executionAttemptId,
      async () => {
        networkCalls += 1;
        return { forbidden: true };
      },
    );
    await sql`select pg_sleep(3.2)`;
    releaseAttemptLock();
    await blocker;

    await expect(dispatch).rejects.toThrow(/EXECUTION_WINDOW_CLOSED/);
    expect(networkCalls).toBe(0);
  }, 15_000);

  it("fails unknown after a network timeout and never blindly resends", async () => {
    const input = await admittedBindInput();
    const bound = await bindExecutionAuthorityV2Postgres(db, { organizationId: orgA }, input);
    let networkCalls = 0;
    const timedOut = await dispatchCommittedExecutionAttemptV2(
      db,
      { organizationId: orgA },
      bound.attempt.executionAttemptId,
      async () => {
        networkCalls += 1;
        throw new Error("HTX_TIMEOUT_UNKNOWN");
      },
    );
    expect(timedOut.status).toBe("FAIL_UNKNOWN");
    const restarted = await dispatchCommittedExecutionAttemptV2(
      db,
      { organizationId: orgA },
      bound.attempt.executionAttemptId,
      async () => {
        networkCalls += 1;
        return { forbiddenResend: true };
      },
    );
    expect(restarted.status).toBe("REFUSED_ALREADY_STARTED");
    expect(networkCalls).toBe(1);
  });

  it("rechecks current Risk authority under lock and rolls back a TOCTOU bind", async () => {
    const input = await admittedBindInput();
    await sql`
      UPDATE trader_risk_account_state_v2 SET kill_state = 'TRIPPED'
      WHERE organization_id = ${orgA}::uuid AND account_id = ${input.allowance.accountId}
    `;
    await expect(bindExecutionAuthorityV2Postgres(db, { organizationId: orgA }, input))
      .rejects.toThrow(/CURRENT_AUTHORITY_BINDING_MISMATCH/);
    const rows = await sql<{
      lifecycle_state: string;
      plan_count: string;
      order_count: string;
      attempt_count: string;
    }[]>`
      SELECT a.lifecycle_state,
        (SELECT count(*)::text FROM trader_execution_plans_v2
          WHERE organization_id = ${orgA}::uuid) AS plan_count,
        (SELECT count(*)::text FROM trader_orders
          WHERE organization_id = ${orgA}::uuid) AS order_count,
        (SELECT count(*)::text FROM trader_execution_attempts_v2
          WHERE organization_id = ${orgA}::uuid) AS attempt_count
      FROM trader_risk_allowances_v2 a
      WHERE a.organization_id = ${orgA}::uuid AND a.id = ${input.allowance.riskAllowanceId}::uuid
    `;
    expect(rows[0]).toEqual({
      lifecycle_state: "ISSUED",
      plan_count: "0",
      order_count: "0",
      attempt_count: "0",
    });
  });

  it("rechecks the planned effect ceiling against the locked Risk reservation", async () => {
    const input = await admittedBindInput();
    const forgedInput = {
      ...input,
      allowance: { ...input.allowance, reservedExposureNotional: "26" },
      plan: {
        ...input.plan,
        approvedNotionalCeiling: "26",
        limitPrice: "26000",
        childSlices: [{ sequence: 1, quantity: "0.001", limitPrice: "26000" }],
      },
    } as BindExecutionAuthorityV2Input;
    await expect(bindExecutionAuthorityV2Postgres(
      db,
      { organizationId: orgA },
      forgedInput,
    )).rejects.toThrow(/locked Risk allowance|EFFECT_NOTIONAL_EXCEEDS_ALLOWANCE_RESERVATION/);
    const counts = await sql<{ plans: string; orders: string; attempts: string }[]>`
      SELECT
        (SELECT count(*)::text FROM trader_execution_plans_v2
          WHERE organization_id = ${orgA}::uuid) AS plans,
        (SELECT count(*)::text FROM trader_orders
          WHERE organization_id = ${orgA}::uuid) AS orders,
        (SELECT count(*)::text FROM trader_execution_attempts_v2
          WHERE organization_id = ${orgA}::uuid) AS attempts
    `;
    expect(counts[0]).toEqual({ plans: "0", orders: "0", attempts: "0" });
  });

  it("records timeout as raw fail-unknown reports and reconciliation-only state", async () => {
    const input = await admittedBindInput();
    const bound = await bindExecutionAuthorityV2Postgres(db, { organizationId: orgA }, input);
    let networkCalls = 0;
    const result = await dispatchAndRecordExecutionAttemptV2(
      db,
      { organizationId: orgA },
      bound.attempt.executionAttemptId,
      async () => {
        networkCalls += 1;
        throw new Error("HTX_TIMEOUT_UNKNOWN");
      },
    );
    expect(result.status).toBe("RECONCILIATION_REQUIRED");
    const reports = await listExecutionReportsV2Postgres(
      db,
      { organizationId: orgA },
      bound.attempt.executionAttemptId,
    );
    expect(reports.slice(-2).map((report) => report.reportType)).toEqual([
      "CONNECTOR_UNCERTAIN",
      "RECONCILIATION_REQUIRED",
    ]);
    expect(reports.at(-2)?.rawObservation).toEqual({
      error: { name: "Error", message: "HTX_TIMEOUT_UNKNOWN" },
    });
    const restart = await dispatchAndRecordExecutionAttemptV2(
      db,
      { organizationId: orgA },
      bound.attempt.executionAttemptId,
      async () => {
        networkCalls += 1;
        throw new Error("BLIND_RESEND_FORBIDDEN");
      },
    );
    expect(restart.status).toBe("REFUSED_ALREADY_TERMINAL");
    expect(networkCalls).toBe(1);
  });

  it("records an unknown HTX state as raw fail-unknown without terminal rejection", async () => {
    const input = await admittedBindInput();
    const bound = await bindExecutionAuthorityV2Postgres(db, { organizationId: orgA }, input);
    const unknownState = Object.assign(new Error("HTX order state is fail-unknown"), {
      name: "HtxUnknownOrderStateError",
      rawVenueObservation: Object.freeze({
        id: 12345,
        state: "venue-state-not-in-contract",
        symbol: "btcusdt",
      }),
    });
    const result = await dispatchAndRecordExecutionAttemptV2(
      db,
      { organizationId: orgA },
      bound.attempt.executionAttemptId,
      async () => { throw unknownState; },
    );
    expect(result.status).toBe("RECONCILIATION_REQUIRED");
    const reports = await listExecutionReportsV2Postgres(
      db,
      { organizationId: orgA },
      bound.attempt.executionAttemptId,
    );
    expect(reports.at(-2)).toMatchObject({
      reportType: "CONNECTOR_UNCERTAIN",
      rawObservation: {
        error: { name: "HtxUnknownOrderStateError" },
        connector: { state: "venue-state-not-in-contract", id: 12345 },
      },
    });
    expect(reports.some((report) => report.reportType === "VENUE_REJECTED")).toBe(false);
  });

  it("refuses to promote filled status without exact trades or fabricate fills", async () => {
    const input = await admittedBindInput();
    const bound = await bindExecutionAuthorityV2Postgres(db, { organizationId: orgA }, input);
    const rawOrder = {
      orderId: "htx-order-status-only",
      ...bound.attempt.exactRequestPayload,
      status: "filled" as const,
      price: bound.attempt.exactRequestPayload.price ?? undefined,
      quantity: bound.attempt.exactRequestPayload.quantity,
      filledQuantity: bound.attempt.exactRequestPayload.quantity,
      createdAt: "2026-08-21T00:00:00.000Z",
      updatedAt: "2026-08-21T00:00:01.000Z",
    };
    const result = await dispatchAndRecordExecutionAttemptV2(
      db,
      { organizationId: orgA },
      bound.attempt.executionAttemptId,
      async () => ({ order: rawOrder, trades: [], raw: { htx: rawOrder } }),
    );
    expect(result.status).toBe("RECONCILIATION_REQUIRED");
    const fillCount = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM trader_fills
      WHERE organization_id = ${orgA}::uuid AND order_id = ${bound.order.id}::uuid
    `;
    expect(fillCount[0]?.count).toBe("0");
    const projection = await readExecutionAttemptProjectionV2Postgres(
      db,
      { organizationId: orgA },
      bound.attempt.executionAttemptId,
    );
    expect(projection?.lifecycleState).toBe("RECONCILIATION_REQUIRED");
  });

  it("reconciles a venue response whose exact price or quantity differs from the bound effect", async () => {
    const input = await admittedBindInput();
    const bound = await bindExecutionAuthorityV2Postgres(db, { organizationId: orgA }, input);
    const result = await dispatchAndRecordExecutionAttemptV2(
      db,
      { organizationId: orgA },
      bound.attempt.executionAttemptId,
      async () => ({
        order: {
          orderId: "htx-order-mechanics-mismatch",
          ...bound.attempt.exactRequestPayload,
          status: "open" as const,
          price: "24999",
          quantity: "0.002",
          filledQuantity: "0",
          createdAt: "2026-08-21T00:00:00.000Z",
          updatedAt: "2026-08-21T00:00:01.000Z",
        },
        trades: [],
        raw: { state: "submitted", price: "24999", amount: "0.002" },
      }),
    );
    expect(result.status).toBe("RECONCILIATION_REQUIRED");
  });

  it("reconciles fills whose trade totals or capital notional exceed the bound authority", async () => {
    const input = await admittedBindInput();
    const bound = await bindExecutionAuthorityV2Postgres(db, { organizationId: orgA }, input);
    const order = {
      orderId: "htx-order-over-notional",
      ...bound.attempt.exactRequestPayload,
      status: "filled" as const,
      price: bound.attempt.exactRequestPayload.price ?? undefined,
      quantity: bound.attempt.exactRequestPayload.quantity,
      filledQuantity: bound.attempt.exactRequestPayload.quantity,
      createdAt: "2026-08-21T00:00:00.000Z",
      updatedAt: "2026-08-21T00:00:01.000Z",
    };
    const result = await dispatchAndRecordExecutionAttemptV2(
      db,
      { organizationId: orgA },
      bound.attempt.executionAttemptId,
      async () => ({
        order,
        trades: [{
          tradeId: "htx-trade-over-notional",
          orderId: order.orderId,
          clientOrderId: bound.attempt.clientOrderId,
          symbol: bound.attempt.exactRequestPayload.symbol,
          side: bound.attempt.exactRequestPayload.side,
          price: "26000",
          quantity: bound.attempt.exactRequestPayload.quantity,
          fee: "0.01",
          feeAsset: "USDT",
          executedAt: "2026-08-21T00:00:01.000Z",
        }],
        raw: { state: "filled", price: "25000", filledAmount: "0.001" },
      }),
    );
    expect(result.status).toBe("RECONCILIATION_REQUIRED");
  });

  it("preserves partial/reject/cancel semantics without residual or replacement authority", async () => {
    const input = await admittedBindInput();
    const bound = await bindExecutionAuthorityV2Postgres(db, { organizationId: orgA }, input);
    const partialOrder = {
      orderId: "htx-order-partial",
      ...bound.attempt.exactRequestPayload,
      status: "partially_filled" as const,
      price: bound.attempt.exactRequestPayload.price ?? undefined,
      quantity: bound.attempt.exactRequestPayload.quantity,
      filledQuantity: "0.0005",
      createdAt: "2026-08-21T00:00:00.000Z",
      updatedAt: "2026-08-21T00:00:01.000Z",
    };
    const partial = await dispatchAndRecordExecutionAttemptV2(
      db,
      { organizationId: orgA },
      bound.attempt.executionAttemptId,
      async () => ({
        order: partialOrder,
        trades: [{
          tradeId: "htx-trade-partial",
          orderId: partialOrder.orderId,
          clientOrderId: bound.attempt.clientOrderId,
          symbol: bound.attempt.exactRequestPayload.symbol,
          side: bound.attempt.exactRequestPayload.side,
          price: "25000",
          quantity: "0.0005",
          fee: "0.01",
          feeAsset: "USDT",
          executedAt: "2026-08-21T00:00:01.000Z",
        }],
        raw: { status: "partial" },
      }),
    );
    expect(partial.status).toBe("PARTIALLY_FILLED");
    await requestProtectiveCancelV2Postgres(
      db,
      { organizationId: orgA },
      bound.attempt.executionAttemptId,
      "protect residual exposure",
    );
    await recordProtectiveCancelAcknowledgementV2Postgres(
      db,
      { organizationId: orgA },
      bound.attempt.executionAttemptId,
      { ...partialOrder, status: "canceled", updatedAt: "2026-08-21T00:00:02.000Z" },
    );
    const counts = await sql<{ attempts: string; orders: string }[]>`
      SELECT
        (SELECT count(*)::text FROM trader_execution_attempts_v2
          WHERE organization_id = ${orgA}::uuid) AS attempts,
        (SELECT count(*)::text FROM trader_orders
          WHERE organization_id = ${orgA}::uuid) AS orders
    `;
    expect(counts[0]).toEqual({ attempts: "1", orders: "1" });
    const reports = await listExecutionReportsV2Postgres(
      db,
      { organizationId: orgA },
      bound.attempt.executionAttemptId,
    );
    expect(reports.slice(-3).map((report) => report.reportType)).toEqual([
      "FILL_REPORT_OBSERVED",
      "CANCEL_REQUESTED",
      "CANCEL_ACKNOWLEDGED",
    ]);
    expect(reports.at(-2)?.rawObservation).toMatchObject({ replacementAuthorized: false });
  });

  it("preserves mismatched cancel observations and requires reconciliation", async () => {
    const input = await admittedBindInput();
    const bound = await bindExecutionAuthorityV2Postgres(db, { organizationId: orgA }, input);
    const openOrder = {
      orderId: "htx-order-cancel-identity",
      ...bound.attempt.exactRequestPayload,
      status: "open" as const,
      price: bound.attempt.exactRequestPayload.price ?? undefined,
      quantity: bound.attempt.exactRequestPayload.quantity,
      filledQuantity: "0",
      createdAt: "2026-08-21T00:00:00.000Z",
      updatedAt: "2026-08-21T00:00:01.000Z",
    };
    const accepted = await dispatchAndRecordExecutionAttemptV2(
      db,
      { organizationId: orgA },
      bound.attempt.executionAttemptId,
      async () => ({ order: openOrder, trades: [], raw: { state: "submitted" } }),
    );
    expect(accepted.status).toBe("VENUE_ACCEPTED");
    await requestProtectiveCancelV2Postgres(
      db,
      { organizationId: orgA },
      bound.attempt.executionAttemptId,
      "protect pending exposure",
    );
    await recordProtectiveCancelAcknowledgementV2Postgres(
      db,
      { organizationId: orgA },
      bound.attempt.executionAttemptId,
      {
        ...openOrder,
        orderId: "different-venue-order",
        status: "canceled",
        updatedAt: "2026-08-21T00:00:02.000Z",
      },
    );
    const reports = await listExecutionReportsV2Postgres(
      db,
      { organizationId: orgA },
      bound.attempt.executionAttemptId,
    );
    expect(reports.slice(-2)).toMatchObject([
      {
        reportType: "VENUE_STATUS_OBSERVED",
        rawObservation: { order: { orderId: "different-venue-order" } },
      },
      {
        reportType: "RECONCILIATION_REQUIRED",
        rawObservation: { cause: "CANCEL_VENUE_ORDER_IDENTITY_MISMATCH" },
      },
    ]);
    const projection = await readExecutionAttemptProjectionV2Postgres(
      db,
      { organizationId: orgA },
      bound.attempt.executionAttemptId,
    );
    expect(projection?.lifecycleState).toBe("RECONCILIATION_REQUIRED");
  });

  it("terminally consumes a raw venue rejection", async () => {
    const input = await admittedBindInput();
    const bound = await bindExecutionAuthorityV2Postgres(db, { organizationId: orgA }, input);
    const rejected = await dispatchAndRecordExecutionAttemptV2(
      db,
      { organizationId: orgA },
      bound.attempt.executionAttemptId,
      async () => ({
        order: {
          orderId: "htx-order-rejected",
          ...bound.attempt.exactRequestPayload,
          status: "rejected",
          price: bound.attempt.exactRequestPayload.price ?? undefined,
          quantity: bound.attempt.exactRequestPayload.quantity,
          filledQuantity: "0",
          createdAt: "2026-08-21T00:00:00.000Z",
          updatedAt: "2026-08-21T00:00:01.000Z",
        },
        trades: [],
        raw: { code: "venue-reject" },
      }),
    );
    expect(rejected.status).toBe("VENUE_REJECTED");
    const projection = await readExecutionAttemptProjectionV2Postgres(
      db,
      { organizationId: orgA },
      bound.attempt.executionAttemptId,
    );
    expect(projection?.lifecycleState).toBe("VENUE_REJECTED");
  });
});
