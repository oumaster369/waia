import { createHash } from "node:crypto";

import { and, eq, sql as sqlQuery } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const prePostGate = vi.hoisted(() => ({ fail: false }));

vi.mock("@/lib/trader/execution/v2/pre-post-recheck-v2", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/trader/execution/v2/pre-post-recheck-v2")>();
  return {
    ...actual,
    prePostNetworkRefusalV2: (...args: Parameters<typeof actual.prePostNetworkRefusalV2>) => {
      if (prePostGate.fail) throw new Error("transient pre-post database failure");
      return actual.prePostNetworkRefusalV2(...args);
    },
  };
});

import * as pgSchema from "@/db/schema.postgres";
import { runWaiaPostgresTransaction, type WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import {
  createExecutionAttemptV2,
  createExecutionPlanV2,
  createExecutionPolicyBindingV2,
  validateExecutionPolicyBindingV2,
  type ExecutionPlanV2,
} from "@/lib/trader/execution/v2/contracts";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import { parseOpeningCausalLineageV1 } from "@/lib/trader/lifecycle/opening-causal-lineage-v1";
import {
  bindExecutionAuthorityV2Postgres,
  dispatchCommittedExecutionAttemptV2,
  ExecutionV2AuthorityRefusedError,
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
  readExecutionAttemptProjectionV2Postgres,
} from "@/lib/trader/execution/v2/repository-postgres";
import { HtxPlacementRejectedError } from "@/lib/trader/connectors/htx/classify-htx-placement";
import {
  dispatchAndRecordExecutionAttemptV2,
  markExecutionAttemptReconciliationRequiredV2Postgres,
  recordProtectiveCancelAcknowledgementV2Postgres,
  requestProtectiveCancelV2Postgres,
  resolveReconciliationRequiredV2Postgres,
} from "@/lib/trader/execution/v2/recovery-postgres";
import { divideDecimal } from "@/lib/trader/risk/numeric";
import {
  admitRiskAllowanceV2Postgres,
  consumeRiskAllowanceForOrderV2Postgres,
  initializeRiskAccountStateV2Postgres as initializeRiskAccountStateRaw,
  revokeRiskAllowanceV2Postgres,
  RiskV2AdmissionRefusedError,
  type AdmitRiskAllowanceV2Input,
} from "@/lib/trader/risk/v2/risk-allowance-repository-postgres";
import { HTX_DEFAULT_REST_HOST } from "@/lib/trader/connectors/htx/config";
import { HtxExchangeConnector } from "@/lib/trader/connectors/htx/htx-exchange-connector";
import { MockExchangeConnector } from "@/lib/trader/connectors/mock-exchange-connector";
import { createPostgresKillSwitchService } from "@/lib/trader/risk/kill-switch";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { createPostgresExecutionV2Service } from "@/lib/trader/execution/v2/connector-dispatch";
import { createAssertExecutionV2LiveAuthorized, createOrgScopedExecutionV2OrderPath } from "@/lib/trader/execution/v2/org-order-path";
import { EXECUTION_V2_LIVE_GATE_REASONS } from "@/lib/trader/execution/v2/live-gates";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { buildHtxPermissionMetadata } from "@/lib/trader/security/htx-credential-types";
import {
  deleteLiveCapitalEnvelopeRows,
  publishMirroredLiveCapitalEnvelopeV2,
  TEST_HUMAN_SOURCE_METHOD_QUALIFIED,
} from "../helpers/live-capital-test-envelope";
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
    reconciledInstrumentExposures: [
      {
        instrumentIdentityDigestHex: hex64("BTCUSDT-SPOT"),
        symbol: "BTCUSDT",
        baseQuantity: "0",
      },
    ],
    accounting: {
      reconciledExposureNotional: "0",
      worstCasePendingExposureNotional: "0",
      outstandingReservationNotional: "0",
      exposureLimitNotional: "100",
    },
  };
}

function admission(accountId: string, identityBase = 667_101): AdmitRiskAllowanceV2Input {
  return {
    accountId,
    riskVerdictId: uuid(identityBase),
    riskAllowanceId: uuid(identityBase + 1),
    issuanceEventId: uuid(identityBase + 2),
    nonce: uuid(identityBase + 3),
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
        forecastId: "forecast-execution-v2",
        forecastContentDigestHex: hex64("forecast-execution-v2"),
        canonicalCausalLineageDigestHex: hex64("causal-lineage-execution-v2"),
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

async function initializeRiskAccountStateV2Postgres(
  database: Parameters<typeof initializeRiskAccountStateRaw>[0],
  context: Parameters<typeof initializeRiskAccountStateRaw>[1],
  state: Parameters<typeof initializeRiskAccountStateRaw>[2],
) {
  await initializeRiskAccountStateRaw(database, context, state);
  await publishMirroredLiveCapitalEnvelopeV2({
    sourceMethodQualified: TEST_HUMAN_SOURCE_METHOD_QUALIFIED,
    organizationId: context.organizationId,
    accountId: state.accountId,
    exposureLimitNotional: state.accounting.exposureLimitNotional,
  });
}

async function deleteOrgAuditLogs(sql: postgres.Sql, organizationId: string): Promise<void> {
  await sql.unsafe("ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_block_delete");
  try {
    await sql`DELETE FROM audit_logs WHERE organization_id = ${organizationId}::uuid`;
  } finally {
    await sql.unsafe("ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_block_delete");
  }
}

async function clearOrganization(sql: postgres.Sql, organizationId: string): Promise<void> {
  await deleteLiveCapitalEnvelopeRows(sql, organizationId);
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

type LockTx = Parameters<Parameters<WaiaPostgresDb["transaction"]>[0]>[0];
type LockResource = "account" | "allowance" | "attempt";
type LockTrace = Record<string, unknown>[];
type CompletedSelect = {
  toSQL(): { sql: string; params: unknown[] };
  execute(...args: unknown[]): Promise<unknown>;
};

function nativeErrorCauses(error: unknown): Record<string, unknown>[] {
  const causes: Record<string, unknown>[] = [];
  const seen = new Set<unknown>();
  while (error && typeof error === "object" && !seen.has(error)) {
    seen.add(error);
    const cause = error as Error & { code?: string; detail?: string; reason?: string; cause?: unknown };
    causes.push({ name: cause.name, message: cause.message, code: cause.code,
      detail: cause.detail, reason: cause.reason });
    error = cause.cause;
  }
  if (error && typeof error !== "object") causes.push({ value: String(error) });
  return causes;
}

function nativeSettled<T>(operation: Promise<T>) {
  return operation.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error, causes: nativeErrorCauses(error) }),
  );
}

function printLockProof(test: string, receipt: Record<string, unknown>): void {
  console.info(`[DEE1134_NATIVE] ${JSON.stringify({ test, ...receipt },
    (_key, value) => typeof value === "bigint" ? value.toString()
      : value instanceof Error ? { causes: nativeErrorCauses(value) } : value)}`);
}

// A test-local observer: all SQL and transaction ownership remain with the real
// Drizzle/postgres-js root client. Only a successfully completed SELECT is gated.
function lockClient(
  label: string,
  organizationId: string,
  trace: LockTrace,
  pause?: { resource: "account" | "allowance" | "attempt"; identity: string },
) {
  const client = postgres(url!, { max: 1, connect_timeout: 5,
    connection: { application_name: `dee1134-${label}` } });
  const plainDb = drizzle(client, { schema: pgSchema }) as WaiaPostgresDb;
  let release!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  const actor = { client, plainDb, db: plainDb, label, pid: 0,
    tx: null as LockTx | null, paused: false, release };
  actor.db = new Proxy(plainDb, {
    get(target, property) {
      if (property !== "transaction") {
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return async (run: (tx: LockTx) => Promise<unknown>,
        config?: Parameters<WaiaPostgresDb["transaction"]>[1]) => {
        try {
          const result = await target.transaction(async (tx) => {
            actor.tx = tx;
            await tx.execute(sqlQuery`SET LOCAL lock_timeout = '10s'`);
            await tx.execute(sqlQuery`SET LOCAL statement_timeout = '15s'`);
            await tx.execute(sqlQuery`SET LOCAL idle_in_transaction_session_timeout = '20s'`);
            const [identity] = await tx.execute<{ pid: number; deadlock_before_timeout: boolean }>(
              sqlQuery`SELECT pg_backend_pid() AS pid,
                current_setting('lock_timeout') AS lock_timeout,
                current_setting('statement_timeout') AS statement_timeout,
                current_setting('idle_in_transaction_session_timeout') AS idle_timeout,
                current_setting('deadlock_timeout') AS deadlock_timeout,
                current_setting('deadlock_timeout')::interval < interval '10 seconds'
                  AS deadlock_before_timeout`);
            actor.pid = identity!.pid;
            trace.push({ actor: label, kind: "transaction-start", ...identity });
            expect(identity!.deadlock_before_timeout).toBe(true);
            const observed = new Proxy(tx, {
              get(realTx, key) {
                if (key === "select") return (...args: unknown[]) => {
                  const builder = Reflect.apply(realTx.select, realTx, args) as ReturnType<LockTx["select"]>;
                  const from = builder.from.bind(builder);
                  builder.from = ((...fromArgs: unknown[]) => {
                    const query = Reflect.apply(from, builder, fromArgs) as CompletedSelect;
                    const execute = query.execute.bind(query);
                    query.execute = async (...executeArgs: unknown[]) => {
                      const statement = query.toSQL();
                      const rows = await execute(...executeArgs);
                      const resource = ([
                        ["account", "trader_risk_account_state_v2"],
                        ["allowance", "trader_risk_allowances_v2"],
                        ["attempt", "trader_execution_attempts_v2"],
                      ] as const).find(([, table]) => statement.sql.includes(`"${table}"`))?.[0];
                      if (resource && /\bfor update\b/i.test(statement.sql)) {
                        trace.push({ actor: label, kind: "lock-acquired", resource,
                          sql: statement.sql, params: statement.params,
                          rowCount: Array.isArray(rows) ? rows.length : null });
                        if (!actor.paused && resource === pause?.resource) {
                          expect(statement.params).toContain(organizationId);
                          expect(statement.params).toContain(pause.identity);
                          expect(rows).toHaveLength(1);
                          actor.paused = true;
                          await released;
                        }
                      }
                      return rows;
                    };
                    return query;
                  }) as typeof builder.from;
                  return builder;
                };
                if (key === "execute") return async (...args: Parameters<LockTx["execute"]>) => {
                  const rows = await realTx.execute(...args);
                  const first = (rows as unknown as { durable_at?: Date | string }[])[0];
                  if (first?.durable_at) trace.push({ actor: label, kind: "clock",
                    at: new Date(first.durable_at).toISOString() });
                  return rows;
                };
                const value = Reflect.get(realTx, key);
                return typeof value === "function" ? value.bind(realTx) : value;
              },
            });
            return run(observed);
          }, config);
          trace.push({ actor: label, kind: "committed" });
          return result;
        } catch (error) {
          trace.push({ actor: label, kind: "rolled-back", causes: nativeErrorCauses(error) });
          throw error;
        } finally {
          actor.tx = null;
        }
      };
    },
  });
  return actor;
}

async function observeLockWait(
  holder: ReturnType<typeof lockClient>,
  binder: ReturnType<typeof lockClient>,
  resource: LockResource,
  trace: LockTrace,
) {
  const table = { account: "trader_risk_account_state_v2", allowance: "trader_risk_allowances_v2",
    attempt: "trader_execution_attempts_v2" }[resource];
  await expect.poll(() => binder.pid, { timeout: 5_000 }).not.toBe(0);
  expect(binder.pid).not.toBe(holder.pid);
  await expect.poll(async () => {
    await holder.tx!.execute(sqlQuery`SELECT pg_stat_clear_snapshot()`);
    const rows = await holder.tx!.execute<{ pid: number; query: string; blockers: number[] }>(
      sqlQuery`SELECT pid, query, pg_blocking_pids(pid) AS blockers FROM pg_stat_activity
        WHERE pid = ${binder.pid} AND wait_event_type = 'Lock'
          AND ${holder.pid} = ANY(pg_blocking_pids(pid))`);
    const waiting = rows[0];
    if (!waiting?.query.includes(table) || !/\bfor update\b/i.test(waiting.query)) return false;
    const locks = await holder.tx!.execute(sqlQuery`SELECT pid, locktype, mode, granted,
      relation::regclass::text AS relation, transactionid::text AS transaction_id
      FROM pg_locks WHERE pid IN (${holder.pid}, ${binder.pid})
        AND locktype IN ('transactionid', 'tuple', 'relation')
      ORDER BY pid, locktype, mode, granted LIMIT 64`);
    trace.push({ kind: "observed-server-wait", resource, holderPid: holder.pid,
      binderPid: binder.pid, waiting, locks });
    return true;
  }, { timeout: 5_000 }).toBe(true);
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
    prePostGate.fail = false;
    await clearOrganization(sql, orgA);
    await clearOrganization(sql, orgB);
  });

  afterAll(async () => {
    if (sql) {
      await clearOrganization(sql, orgA);
      await clearOrganization(sql, orgB);
      await deleteOrgAuditLogs(sql, orgA);
      await deleteOrgAuditLogs(sql, orgB);
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
    const consumed = await consumeRiskAllowanceForOrderV2Postgres(
      db,
      { organizationId: orgA },
      {
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
      },
    );
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
      await tx
        .update(pgSchema.traderOrders)
        .set({
          clientOrderId: attempt.clientOrderId,
          executionPlanId: plan.executionPlanId,
          executionPlanDigest: plan.contentDigestHex,
          executionAttemptId: attempt.executionAttemptId,
          executionAttemptDigest: attempt.contentDigestHex,
        })
        .where(
          and(
            eq(pgSchema.traderOrders.id, orderId),
            eq(pgSchema.traderOrders.organizationId, orgA),
          ),
        );
      await insertExecutionAttemptV2Postgres(tx, { organizationId: orgA }, attempt);
    });
    return { accountId, allowance, attempt, plan, policy };
  }

  async function admittedBindInput(
    options: {
      reduction?: boolean;
      validForMs?: number;
      symbol?: string;
      baseAsset?: string;
      organizationId?: string;
      accountId?: string;
      identityBase?: number;
    } = {},
  ): Promise<BindExecutionAuthorityV2Input> {
    const organizationId = options.organizationId ?? orgA;
    const accountId = options.accountId ?? "atomic-bind";
    const state = account(accountId);
    if (options.reduction) state.reconciledInstrumentExposures[0]!.baseQuantity = "0.002";
    await initializeRiskAccountStateV2Postgres(db, { organizationId }, state);
    const request = admission(accountId, options.identityBase);
    const admitted = await admitRiskAllowanceV2Postgres(
      db,
      { organizationId },
      {
        ...request,
        validForMs: options.validForMs ?? request.validForMs,
        verdict: {
          ...request.verdict,
          ...(options.symbol ? { symbol: options.symbol } : {}),
          ...(options.baseAsset ? { baseAsset: options.baseAsset } : {}),
          decision: {
            ...request.verdict.decision,
            action: options.reduction ? "REDUCE" : "ENTER_LONG",
          },
        },
      },
    );
    const allowance = admitted.allowance;
    const now = Date.now();
    const opensAtUtc = new Date(now - 60_000).toISOString();
    const closesAtUtc = new Date(now + 60_000).toISOString();
    const policy = createExecutionPolicyBindingV2({
      executionPolicyId: uuid((options.identityBase ?? 667_101) + 400),
      organizationId,
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
        approvedNotionalCeiling: options.reduction ? "0" : "25",
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

  async function lockProofState(input: BindExecutionAuthorityV2Input, organizationId = orgA) {
    const [state] = await sql<{
      r: string; p: string; next: string; head: string | null;
    }[]>`SELECT outstanding_reservation_notional::text AS r,
      worst_case_pending_exposure_notional::text AS p,
      next_enforcement_event_sequence::text AS next, last_enforcement_event_digest AS head
      FROM trader_risk_account_state_v2
      WHERE organization_id = ${organizationId}::uuid AND account_id = ${input.allowance.accountId}`;
    const allowance = await sql`SELECT lifecycle_state, bound_order_id, bound_order_digest,
      last_enforcement_event_sequence::text, last_enforcement_event_digest, content_digest
      FROM trader_risk_allowances_v2
      WHERE organization_id = ${organizationId}::uuid AND id = ${input.allowance.riskAllowanceId}::uuid`;
    const events = await sql<{
      type: string; sequence: string; previous: string | null; digest: string;
    }[]>`SELECT event_type AS type, event_sequence::text AS sequence,
      previous_event_digest AS previous, content_digest AS digest
      FROM trader_risk_enforcement_events_v2
      WHERE organization_id = ${organizationId}::uuid AND account_id = ${input.allowance.accountId}
      ORDER BY event_sequence LIMIT 4`;
    const reports = await sql<{
      type: string; sequence: string; previous: string | null; digest: string;
    }[]>`SELECT report_type AS type, report_sequence::text AS sequence,
      previous_report_digest AS previous, content_digest AS digest
      FROM trader_execution_reports_v2
      WHERE organization_id = ${organizationId}::uuid AND account_id = ${input.allowance.accountId}
      ORDER BY report_sequence LIMIT 5`;
    const [counts] = await sql`SELECT
      (SELECT count(*)::int FROM trader_execution_policies_v2 WHERE organization_id = ${organizationId}::uuid) AS policies,
      (SELECT count(*)::int FROM trader_execution_plans_v2 WHERE organization_id = ${organizationId}::uuid) AS plans,
      (SELECT count(*)::int FROM trader_orders WHERE organization_id = ${organizationId}::uuid) AS orders,
      (SELECT count(*)::int FROM trader_execution_attempts_v2 WHERE organization_id = ${organizationId}::uuid) AS attempts,
      (SELECT count(*)::int FROM trader_execution_reports_v2 WHERE organization_id = ${organizationId}::uuid) AS reports,
      (SELECT count(*)::int FROM trader_risk_enforcement_events_v2 WHERE organization_id = ${organizationId}::uuid) AS events`;
    return { account: state ?? null, allowance, events, reports, counts };
  }

  function expectRiskChain(state: Awaited<ReturnType<typeof lockProofState>>, types: string[], r: string, p: string) {
    expect(state.events.map((event) => event.type)).toEqual(types);
    state.events.forEach((event, index) => {
      expect(event.sequence).toBe(String(index + 1));
      expect(event.previous).toBe(index === 0 ? null : state.events[index - 1]!.digest);
      expect(event.digest).toMatch(/^[0-9a-f]{64}$/);
    });
    expect(state.counts!.events).toBe(types.length);
    expect(state.account).toEqual({ r, p, next: String(types.length + 1), head: state.events.at(-1)!.digest });
  }

  function expectIssuedBeforeBind(state: Awaited<ReturnType<typeof lockProofState>>) {
    expect(state.allowance[0]).toMatchObject({ lifecycle_state: "ISSUED", bound_order_id: null });
    expectRiskChain(state, ["ALLOWANCE_ISSUED"], "25.00000000", "0.00000000");
    expect(state.counts).toEqual({
      policies: 0, plans: 0, orders: 0, attempts: 0, reports: 0, events: 1,
    });
    expect(state.reports).toEqual([]);
  }

  async function finishLockProof(test: string, input: BindExecutionAuthorityV2Input, trace: LockTrace,
    clients: ReturnType<typeof lockClient>[], operations: Promise<unknown>[]) {
    clients.forEach((client) => client.release());
    const outcomes = await Promise.all(operations);
    // Always emit both terminal results and nested driver causes before any
    // post-fix expectation can fail on the unchanged-production baseline.
    printLockProof(test, { phase: "settled", trace, outcomes });
    try {
      const state = await lockProofState(input);
      printLockProof(test, { phase: "durable-state", state });
      return { outcomes, state };
    } finally {
      const closed = await Promise.allSettled(clients.map((client) => client.client.end({ timeout: 5 })));
      printLockProof(test, { phase: "closed", clients: clients.map((client) => ({ label: client.label, pid: client.pid })), closed });
      expect(closed.every((result) => result.status === "fulfilled")).toBe(true);
    }
  }

  async function waitPastDeadline(holder: ReturnType<typeof lockClient>, deadline: string, trace: LockTrace) {
    const [before] = await holder.tx!.execute<{ at: Date }>(sqlQuery`SELECT clock_timestamp() AS at`);
    trace.push({ kind: "before-deadline", at: before!.at, deadline });
    expect(new Date(before!.at).getTime()).toBeLessThan(new Date(deadline).getTime());
    await expect.poll(async () => {
      const [row] = await holder.tx!.execute<{ at: Date }>(sqlQuery`SELECT clock_timestamp() AS at`);
      if (new Date(row!.at).getTime() < new Date(deadline).getTime()) return false;
      trace.push({ kind: "deadline-reached", at: row!.at, deadline });
      return true;
    }, { timeout: 5_000 }).toBe(true);
  }

  it("DEE-1134 serializes issued bind behind actual issued revoke", async () => {
    const input = await admittedBindInput({ validForMs: 60_000 });
    const before = await lockProofState(input);
    expectRiskChain(before, ["ALLOWANCE_ISSUED"], "25.00000000", "0.00000000");
    const trace: LockTrace = [{ kind: "before", state: before }];
    const binder = lockClient("issued-bind", orgA, trace);
    const revoker = lockClient("issued-revoke", orgA, trace,
      { resource: "account", identity: input.allowance.accountId });
    const operations: Promise<unknown>[] = [];
    let proof!: Awaited<ReturnType<typeof finishLockProof>>;
    try {
      operations.push(nativeSettled(revokeRiskAllowanceV2Postgres(revoker.db, { organizationId: orgA }, {
        accountId: input.allowance.accountId, riskAllowanceId: input.allowance.riskAllowanceId,
        eventId: uuid(667_901), reasonCode: "DEE1134_NATIVE_REVOKE",
      })));
      await expect.poll(() => revoker.paused, { timeout: 5_000 }).toBe(true);
      operations.push(nativeSettled(bindExecutionAuthorityV2Postgres(binder.db, { organizationId: orgA }, input)));
      await observeLockWait(revoker, binder, "account", trace);
    } catch (error) {
      trace.push({ kind: "harness-failure", causes: nativeErrorCauses(error) });
      throw error;
    } finally {
      proof = await finishLockProof("issued-bind/revoke", input, trace, [binder, revoker], operations);
    }
    expect(proof.outcomes).toMatchObject([
      { ok: true, value: true },
      { ok: false, error: expect.any(ExecutionV2AuthorityRefusedError) },
    ]);
    expect(trace.find((event) => event.actor === binder.label && event.kind === "lock-acquired")?.resource).toBe("account");
    expect(proof.state.allowance[0]!.lifecycle_state).toBe("REVOKED");
    expectRiskChain(proof.state, ["ALLOWANCE_ISSUED", "ALLOWANCE_REVOKED"], "0.00000000", "0.00000000");
    expect(proof.state.counts).toEqual({ policies: 0, plans: 0, orders: 0, attempts: 0, reports: 0, events: 2 });
    expect(proof.state.reports).toEqual([]);
  }, 30_000);

  it("DEE-1151 terminalizes public Execution V2 binds under an organization kill switch once", async () => {
    const input = await admittedBindInput({ accountId: "org-kill-bind" });
    const otherOrganization = await admittedBindInput({
      organizationId: orgB,
      accountId: "other-org-kill-bind",
      identityBase: 668_101,
    });
    const service = createPostgresKillSwitchService(db);
    await service.trip(
      { actorType: "service", actorId: null },
      requireOrgContext(orgA),
      { scopeType: "organization", organizationId: orgA },
      { scopeType: "organization", scopeRef: null, switchType: "EMERGENCY_STOP" },
      { enforcementMode: "REJECT", origin: "manual", reason: "dee-1151 native org bind" },
    );
    try {
      expectIssuedBeforeBind(await lockProofState(input));
      const first = await nativeSettled(
        bindExecutionAuthorityV2Postgres(db, { organizationId: orgA }, input),
      );
      expect(first).toMatchObject({
        ok: false,
        error: expect.objectContaining({ reason: "KILL_SWITCH_TRIPPED" }),
      });

      const refused = await lockProofState(input);
      expect(refused.allowance[0]).toMatchObject({
        lifecycle_state: "REVOKED",
        bound_order_id: null,
      });
      expectRiskChain(refused, ["ALLOWANCE_ISSUED", "ALLOWANCE_REVOKED"], "0.00000000", "0.00000000");
      expect(refused.counts).toEqual({
        policies: 0, plans: 0, orders: 0, attempts: 0, reports: 0, events: 2,
      });
      expect(refused.reports).toEqual([]);
      const [revocation] = await sql<{
        from_state: string | null;
        to_state: string | null;
        reason_code: string | null;
        event_payload: Record<string, unknown>;
        previous_event_digest: string | null;
        content_digest: string;
      }[]>`
        SELECT from_state, to_state, reason_code, event_payload,
          previous_event_digest, content_digest
        FROM trader_risk_enforcement_events_v2
        WHERE organization_id = ${orgA}::uuid
          AND account_id = ${input.allowance.accountId}
          AND event_type = 'ALLOWANCE_REVOKED'
      `;
      expect(revocation).toMatchObject({
        from_state: "ISSUED",
        to_state: "REVOKED",
        reason_code: "KILL_SWITCH_TRIPPED",
        event_payload: {
          refusalReason: "KILL_SWITCH_TRIPPED",
          reservationReleased: "25.00000000",
        },
        previous_event_digest: refused.events[0]!.digest,
        content_digest: refused.events[1]!.digest,
      });

      const retry = await nativeSettled(
        bindExecutionAuthorityV2Postgres(db, { organizationId: orgA }, input),
      );
      expect(retry).toMatchObject({
        ok: false,
        error: expect.objectContaining({ reason: "KILL_SWITCH_TRIPPED" }),
      });
      expect(await lockProofState(input)).toEqual(refused);

      const unaffected = await bindExecutionAuthorityV2Postgres(
        db,
        { organizationId: orgB },
        otherOrganization,
      );
      expect(unaffected.order.organizationId).toBe(orgB);
      expect(unaffected.consumedNow).toBe(true);
    } finally {
      await sql`DELETE FROM trader_kill_switches WHERE organization_id = ${orgA}::uuid`;
    }
  }, 30_000);

  it("DEE-1151 terminalizes ISSUED binds under a platform kill switch across organizations", async () => {
    const inputA = await admittedBindInput({ accountId: "platform-kill-bind-a" });
    const inputB = await admittedBindInput({
      organizationId: orgB,
      accountId: "platform-kill-bind-b",
      identityBase: 668_101,
    });
    const [activePlatformSwitches] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM trader_kill_switches
      WHERE organization_id IS NULL AND state IN ('ACTIVE', 'CLEARING')
    `;
    expect(activePlatformSwitches!.count).toBe(0);
    const platformProjectionTargets = await sql<{
      organization_id: string;
      account_id: string;
    }[]>`
      SELECT organization_id::text, account_id FROM trader_risk_account_state_v2
      ORDER BY organization_id, account_id
    `;
    expect(platformProjectionTargets).toEqual([
      { organization_id: orgA, account_id: inputA.allowance.accountId },
      { organization_id: orgB, account_id: inputB.allowance.accountId },
    ]);
    const service = createPostgresKillSwitchService(db);
    const trip = await service.trip(
      { actorType: "service", actorId: null },
      null,
      { scopeType: "platform" },
      { scopeType: "platform", scopeRef: null, switchType: "EMERGENCY_STOP" },
      { enforcementMode: "REJECT", origin: "manual", reason: "dee-1151 native platform bind" },
    );
    try {
      expectIssuedBeforeBind(await lockProofState(inputA, orgA));
      expectIssuedBeforeBind(await lockProofState(inputB, orgB));
      for (const [organizationId, input] of [[orgA, inputA], [orgB, inputB]] as const) {
        const refusal = await nativeSettled(
          bindExecutionAuthorityV2Postgres(db, { organizationId }, input),
        );
        expect(refusal).toMatchObject({
          ok: false,
          error: expect.objectContaining({ reason: "KILL_SWITCH_TRIPPED" }),
        });
        const state = await lockProofState(input, organizationId);
        expect(state.allowance[0]).toMatchObject({ lifecycle_state: "REVOKED", bound_order_id: null });
        expectRiskChain(state, ["ALLOWANCE_ISSUED", "ALLOWANCE_REVOKED"], "0.00000000", "0.00000000");
        expect(state.counts).toEqual({
          policies: 0, plans: 0, orders: 0, attempts: 0, reports: 0, events: 2,
        });
        expect(state.reports).toEqual([]);
      }
    } finally {
      await sql.unsafe("ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_block_delete");
      try {
        await sql`DELETE FROM audit_logs WHERE id = ${trip.auditId}::uuid`;
      } finally {
        await sql.unsafe("ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_block_delete");
      }
      await sql`DELETE FROM trader_kill_switches WHERE id = ${trip.row.id}::uuid`;
    }
  }, 30_000);

  it("DEE-1151 leaves consumed allowance history unchanged when bind sees a kill switch", async () => {
    const input = await admittedBindInput({ accountId: "consumed-kill-bind" });
    const bound = await bindExecutionAuthorityV2Postgres(db, { organizationId: orgA }, input);
    const before = await lockProofState(input);
    const [orderBefore] = await sql<{ row: Record<string, unknown> }[]>`
      SELECT to_jsonb(order_row) AS row FROM trader_orders AS order_row
      WHERE organization_id = ${orgA}::uuid AND id = ${bound.order.id}::uuid
    `;
    expect(orderBefore).toBeDefined();
    expectRiskChain(before, ["ALLOWANCE_ISSUED", "ALLOWANCE_CONSUMED"], "0.00000000", "25.00000000");
    const service = createPostgresKillSwitchService(db);
    await service.trip(
      { actorType: "service", actorId: null },
      requireOrgContext(orgA),
      { scopeType: "organization", organizationId: orgA },
      { scopeType: "organization", scopeRef: null, switchType: "EMERGENCY_STOP" },
      { enforcementMode: "REJECT", origin: "manual", reason: "dee-1151 native consumed bind" },
    );
    try {
      const retry = await nativeSettled(
        bindExecutionAuthorityV2Postgres(db, { organizationId: orgA }, input),
      );
      expect(retry).toMatchObject({
        ok: false,
        error: expect.objectContaining({ reason: "KILL_SWITCH_TRIPPED" }),
      });
      const after = await lockProofState(input);
      expect(after.allowance).toEqual(before.allowance);
      expect(after.events).toEqual(before.events);
      expect(after.reports).toEqual(before.reports);
      expect(after.counts).toEqual(before.counts);
      expect(after.account).toEqual(before.account);
      const [orderAfter] = await sql<{ row: Record<string, unknown> }[]>`
        SELECT to_jsonb(order_row) AS row FROM trader_orders AS order_row
        WHERE organization_id = ${orgA}::uuid AND id = ${bound.order.id}::uuid
      `;
      expect(orderAfter).toEqual(orderBefore);
      expect(await readExecutionAttemptV2Postgres(db, { organizationId: orgA }, bound.attempt.executionAttemptId))
        .toEqual(bound.attempt);
    } finally {
      await sql`DELETE FROM trader_kill_switches WHERE organization_id = ${orgA}::uuid`;
    }
  }, 30_000);

  it("DEE-1151 terminalizes a live bind under a kill switch after valid live gates pass", async () => {
    const input = await admittedBindInput({ accountId: "live-kill-bind" });
    const credentialId = uuid(669_901);
    const promotionId = uuid(669_902);
    const strategyId = "dee1151-live-gate-fixture";
    const strategyVersion = "native-v1";
    const permissionMetadata = buildHtxPermissionMetadata({
      exchangeAccountId: input.allowance.accountId,
      scopes: ["read", "trade"],
    });
    const originalOrg0 = process.env.WAIA_TRADER_ORG0_ORGANIZATION_ID;
    let killSwitchId: string | null = null;
    try {
      // These are test-only gate facts. The credential row contains permission
      // metadata only: no API key, encrypted payload, or exchange call exists.
      process.env.WAIA_TRADER_ORG0_ORGANIZATION_ID = orgA;
      await sql`
        INSERT INTO trader_org_live_enable (organization_id, state, max_notional_cap)
        VALUES (${orgA}::uuid, 'ENABLED', '25')
      `;
      await sql`
        INSERT INTO trader_strategy_promotion_records (
          id, organization_id, strategy_id, strategy_version, git_commit_sha,
          target_deployment_state, hypothesis, intended_regime, cost_model_json,
          failure_modes_json, reason_code_distribution_json, paper_trading_evidence_json,
          evidence_content_digest, confidence_attestation_json, record_content_digest,
          schema_version, state, effective_at, state_version
        ) VALUES (
          ${promotionId}::uuid, ${orgA}::uuid, ${strategyId}, ${strategyVersion}, ${"a".repeat(40)},
          'LIVE_LIMITED', 'Synthetic native gate fixture', 'RANGE', '{}'::jsonb,
          '[]'::jsonb, '{}'::jsonb, '{}'::jsonb, ${hex64("live-gate-evidence")},
          '{}'::jsonb, ${hex64("live-gate-record")}, 'dee1151-native-fixture/v1',
          'EFFECTIVE', clock_timestamp(), 1
        )
      `;
      await sql`
        INSERT INTO exchange_credentials (
          id, organization_id, venue, exchange_account_id, permission_metadata, status
        ) VALUES (
          ${credentialId}::uuid, ${orgA}::uuid, 'htx', ${input.allowance.accountId},
          ${JSON.stringify(permissionMetadata)}, 'active'
        )
      `;
      const service = createPostgresKillSwitchService(db);
      const trip = await service.trip(
        { actorType: "service", actorId: null },
        requireOrgContext(orgA),
        { scopeType: "organization", organizationId: orgA },
        { scopeType: "organization", scopeRef: null, switchType: "EMERGENCY_STOP" },
        { enforcementMode: "REJECT", origin: "manual", reason: "dee-1151 native live bind" },
      );
      killSwitchId = trip.row.id;
      expectIssuedBeforeBind(await lockProofState(input));
      const liveInput: BindExecutionAuthorityV2Input = {
        ...input,
        executionMode: "live",
        credentialId,
        strategyId,
        strategyVersion,
      };
      const refused = await nativeSettled(
        bindExecutionAuthorityV2Postgres(db, { organizationId: orgA }, liveInput),
      );
      expect(refused).toMatchObject({
        ok: false,
        error: expect.objectContaining({ reason: "KILL_SWITCH_TRIPPED" }),
      });
      const state = await lockProofState(liveInput);
      expect(state.allowance[0]).toMatchObject({ lifecycle_state: "REVOKED", bound_order_id: null });
      expectRiskChain(state, ["ALLOWANCE_ISSUED", "ALLOWANCE_REVOKED"], "0.00000000", "0.00000000");
      expect(state.counts).toEqual({
        policies: 0, plans: 0, orders: 0, attempts: 0, reports: 0, events: 2,
      });
      expect(state.reports).toEqual([]);
    } finally {
      if (killSwitchId) {
        await sql`DELETE FROM trader_kill_switches WHERE id = ${killSwitchId}::uuid`;
      }
      await sql`DELETE FROM exchange_credentials WHERE id = ${credentialId}::uuid`;
      await sql`DELETE FROM trader_strategy_promotion_records WHERE id = ${promotionId}::uuid`;
      await sql`DELETE FROM trader_org_live_enable WHERE organization_id = ${orgA}::uuid`;
      if (originalOrg0 === undefined) delete process.env.WAIA_TRADER_ORG0_ORGANIZATION_ID;
      else process.env.WAIA_TRADER_ORG0_ORGANIZATION_ID = originalOrg0;
    }
  }, 30_000);

  it("DEE-1134 serializes replayed bind behind actual dispatch and submits once", async () => {
    const input = await admittedBindInput({ validForMs: 60_000 });
    const original = await bindExecutionAuthorityV2Postgres(db, { organizationId: orgA }, input);
    const before = await lockProofState(input);
    const trace: LockTrace = [{ kind: "before", state: before }];
    const binder = lockClient("replay-bind", orgA, trace);
    const dispatcher = lockClient("dispatch", orgA, trace,
      { resource: "account", identity: input.allowance.accountId });
    const operations: Promise<unknown>[] = [];
    let callbacks = 0;
    let proof!: Awaited<ReturnType<typeof finishLockProof>>;
    try {
      operations.push(nativeSettled(dispatchCommittedExecutionAttemptV2(dispatcher.db, { organizationId: orgA },
        original.attempt.executionAttemptId, async () => {
          callbacks += 1;
          trace.push({ kind: "inert-callback", callbacks });
          const reports = await listExecutionReportsV2Postgres(dispatcher.plainDb, { organizationId: orgA },
            original.attempt.executionAttemptId);
          expect(reports.filter((report) => report.reportType === "SUBMIT_STARTED")).toHaveLength(1);
          await dispatcher.plainDb.transaction(async (tx) => {
            await tx.execute(sqlQuery`SET LOCAL lock_timeout = '2s'`);
            await tx.execute(sqlQuery`SET LOCAL statement_timeout = '5s'`);
            await tx.select().from(pgSchema.traderRiskAccountStateV2).where(and(
              eq(pgSchema.traderRiskAccountStateV2.organizationId, orgA),
              eq(pgSchema.traderRiskAccountStateV2.accountId, input.allowance.accountId),
            )).for("update");
          });
          trace.push({ kind: "callback-commit-and-lock-release-observed" });
          return { synthetic: true };
        })));
      await expect.poll(() => dispatcher.paused, { timeout: 5_000 }).toBe(true);
      operations.push(nativeSettled(bindExecutionAuthorityV2Postgres(binder.db, { organizationId: orgA }, input)));
      await observeLockWait(dispatcher, binder, "account", trace);
    } catch (error) {
      trace.push({ kind: "harness-failure", causes: nativeErrorCauses(error) });
      throw error;
    } finally {
      proof = await finishLockProof("replay-bind/dispatch", input, trace, [binder, dispatcher], operations);
    }
    expect(proof.outcomes).toMatchObject([
      { ok: true, value: { status: "SUBMITTED" } },
      { ok: true, value: { consumedNow: false, plan: original.plan, attempt: original.attempt, order: original.order } },
    ]);
    expect(callbacks).toBe(1);
    expect(trace.find((event) => event.actor === binder.label && event.kind === "lock-acquired")?.resource).toBe("account");
    expectRiskChain(proof.state, ["ALLOWANCE_ISSUED", "ALLOWANCE_CONSUMED"], "0.00000000", "25.00000000");
    expect(proof.state.events).toEqual(before.events);
    expect(proof.state.allowance).toEqual(before.allowance);
    expect(proof.state.counts).toEqual({ policies: 1, plans: 1, orders: 1, attempts: 1, reports: 4, events: 2 });
    expect(proof.state.reports.map((report) => report.type)).toEqual([
      "PLAN_SEALED", "ALLOWANCE_CLAIMED", "ATTEMPT_BOUND", "SUBMIT_STARTED",
    ]);
    expect(proof.state.reports.slice(0, 3)).toEqual(before.reports);
    expect(proof.state.reports[3]).toMatchObject({ sequence: "4", previous: before.reports[2]!.digest });
  }, 30_000);

  it("DEE-1134 refuses a fresh bind when its plan closes during an account wait", async () => {
    const original = await admittedBindInput({ validForMs: 60_000 });
    const [clock] = await sql<{ deadline: Date | string }[]>`SELECT clock_timestamp() + interval '3 seconds' AS deadline`;
    const deadlineDate = new Date(clock!.deadline);
    expect(Number.isFinite(deadlineDate.getTime())).toBe(true);
    const deadline = deadlineDate.toISOString();
    const input = { ...original, plan: { ...original.plan,
      timingWindow: { ...original.plan.timingWindow, closesAtUtc: deadline } } };
    const before = await lockProofState(input);
    const trace: LockTrace = [{ kind: "before", state: before, deadline }];
    const binder = lockClient("fresh-window", orgA, trace);
    const holder = lockClient("account-holder", orgA, trace,
      { resource: "account", identity: input.allowance.accountId });
    const operations: Promise<unknown>[] = [];
    let proof!: Awaited<ReturnType<typeof finishLockProof>>;
    try {
      operations.push(nativeSettled(holder.db.transaction(async (tx) => {
        await tx.select().from(pgSchema.traderRiskAccountStateV2).where(and(
          eq(pgSchema.traderRiskAccountStateV2.organizationId, orgA),
          eq(pgSchema.traderRiskAccountStateV2.accountId, input.allowance.accountId),
        )).for("update");
      })));
      await expect.poll(() => holder.paused, { timeout: 5_000 }).toBe(true);
      operations.push(nativeSettled(bindExecutionAuthorityV2Postgres(binder.db, { organizationId: orgA }, input)));
      await observeLockWait(holder, binder, "account", trace);
      await waitPastDeadline(holder, deadline, trace);
    } catch (error) {
      trace.push({ kind: "harness-failure", causes: nativeErrorCauses(error) });
      throw error;
    } finally {
      proof = await finishLockProof("fresh-window/account-wait", input, trace, [binder, holder], operations);
    }
    expect(proof.outcomes).toMatchObject([{ ok: true }, { ok: false,
      error: expect.any(ExecutionV2AuthorityRefusedError), causes: [{ reason: "EXECUTION_WINDOW_CLOSED" }] }]);
    expect(proof.state).toEqual(before);
    expectRiskChain(proof.state, ["ALLOWANCE_ISSUED"], "25.00000000", "0.00000000");
  }, 30_000);

  it("DEE-1134 refuses a replay when its policy closes during a later attempt wait", async () => {
    const original = await admittedBindInput({ validForMs: 60_000 });
    const [clock] = await sql<{ deadline: Date | string }[]>`SELECT clock_timestamp() + interval '3 seconds' AS deadline`;
    const deadlineDate = new Date(clock!.deadline);
    expect(Number.isFinite(deadlineDate.getTime())).toBe(true);
    const deadline = deadlineDate.toISOString();
    // The actual contract requires plan.close <= policy.until. Their shared
    // deadline proves late policy expiry without constructing an invalid seal.
    const { schemaVersion: _schemaVersion, semanticDigestHex: _semanticDigestHex,
      contentDigestHex: _contentDigestHex, ...policyDraft } = original.policy;
    void _schemaVersion;
    void _semanticDigestHex;
    void _contentDigestHex;
    const policy = createExecutionPolicyBindingV2({ ...policyDraft, effectiveUntilUtc: deadline });
    expect(validateExecutionPolicyBindingV2(policy)).toBe(true);
    const input = { ...original, policy,
      plan: { ...original.plan, timingWindow: { ...original.plan.timingWindow, closesAtUtc: deadline } } };
    const bound = await bindExecutionAuthorityV2Postgres(db, { organizationId: orgA }, input);
    const before = await lockProofState(input);
    const trace: LockTrace = [{ kind: "before", state: before, deadline }];
    const binder = lockClient("replay-window", orgA, trace);
    const holder = lockClient("attempt-holder", orgA, trace,
      { resource: "attempt", identity: bound.attempt.executionAttemptId });
    const operations: Promise<unknown>[] = [];
    let proof!: Awaited<ReturnType<typeof finishLockProof>>;
    try {
      operations.push(nativeSettled(holder.db.transaction(async (tx) => {
        await tx.select().from(pgSchema.traderExecutionAttemptsV2).where(and(
          eq(pgSchema.traderExecutionAttemptsV2.organizationId, orgA),
          eq(pgSchema.traderExecutionAttemptsV2.id, bound.attempt.executionAttemptId),
        )).for("update");
      })));
      await expect.poll(() => holder.paused, { timeout: 5_000 }).toBe(true);
      operations.push(nativeSettled(bindExecutionAuthorityV2Postgres(binder.db, { organizationId: orgA }, input)));
      await observeLockWait(holder, binder, "attempt", trace);
      const clockSamples = trace.filter((event) => event.actor === binder.label && event.kind === "clock");
      expect(clockSamples.length).toBeGreaterThan(0);
      expect(clockSamples.every((event) => new Date(String(event.at)).getTime() < new Date(deadline).getTime())).toBe(true);
      await waitPastDeadline(holder, deadline, trace);
    } catch (error) {
      trace.push({ kind: "harness-failure", causes: nativeErrorCauses(error) });
      throw error;
    } finally {
      proof = await finishLockProof("replay-policy/attempt-wait", input, trace, [binder, holder], operations);
    }
    expect(proof.outcomes).toMatchObject([{ ok: true }, { ok: false,
      error: expect.any(ExecutionV2AuthorityRefusedError), causes: [{ reason: "EXECUTION_WINDOW_CLOSED" }] }]);
    expect(proof.state).toEqual(before);
    expect(await readExecutionAttemptV2Postgres(db, { organizationId: orgA }, bound.attempt.executionAttemptId)).toEqual(bound.attempt);
  }, 30_000);

  it("DEE-1134 preserves typed missing-account refusal without durable bind effects", async () => {
    const input = await admittedBindInput({ validForMs: 60_000 });
    await initializeRiskAccountStateV2Postgres(db, { organizationId: orgB }, account(input.allowance.accountId));
    const foreignBefore = await lockProofState(input, orgB);
    // Only this synthetic fixture row is removed; existing guards stay enabled.
    await sql`DELETE FROM trader_risk_account_state_v2
      WHERE organization_id = ${orgA}::uuid AND account_id = ${input.allowance.accountId}`;
    const before = await lockProofState(input);
    const outcome = await nativeSettled(bindExecutionAuthorityV2Postgres(db, { organizationId: orgA }, input));
    const after = await lockProofState(input);
    const foreignAfter = await lockProofState(input, orgB);
    printLockProof("missing-account", { before, outcome, after, foreignBefore, foreignAfter });
    expect(outcome).toMatchObject({ ok: false, error: expect.any(RiskV2AdmissionRefusedError),
      causes: [{ name: "RiskV2AdmissionRefusedError", reason: "RISK_ACCOUNT_STATE_MISSING" }] });
    expect(before.account).toBeNull();
    expect(after).toEqual(before);
    expect(after.counts).toEqual({ policies: 0, plans: 0, orders: 0, attempts: 0, reports: 0, events: 1 });
    expect(foreignAfter).toEqual(foreignBefore);
  }, 30_000);

  it("persists tenant-scoped immutable authority and a raw append-only report chain", async () => {
    const { accountId, attempt } = await persistAuthority();
    expect(
      await readExecutionAttemptV2Postgres(
        db,
        { organizationId: orgA },
        attempt.executionAttemptId,
      ),
    ).toEqual(attempt);
    expect(
      await readExecutionAttemptV2Postgres(
        db,
        { organizationId: orgB },
        attempt.executionAttemptId,
      ),
    ).toBeNull();

    const first = await appendExecutionReportV2Postgres(
      db,
      { organizationId: orgA },
      {
        executionReportId: uuid(667_301),
        accountId,
        executionAttemptId: attempt.executionAttemptId,
        reportType: "ATTEMPT_BOUND",
        source: "EXECUTION",
        rawObservation: { committed: true },
        observedAtUtc: "2026-08-21T00:00:00.002Z",
      },
    );
    const second = await appendExecutionReportV2Postgres(
      db,
      { organizationId: orgA },
      {
        executionReportId: uuid(667_302),
        accountId,
        executionAttemptId: attempt.executionAttemptId,
        reportType: "CONNECTOR_UNCERTAIN",
        source: "CONNECTOR",
        rawObservation: { timeout: true, body: null },
        observedAtUtc: "2026-08-21T00:00:05.000Z",
      },
    );
    expect(second.previousReportDigestHex).toBe(first.contentDigestHex);
    expect(
      await listExecutionReportsV2Postgres(
        db,
        { organizationId: orgA },
        attempt.executionAttemptId,
      ),
    ).toEqual([first, second]);
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
    await appendExecutionReportV2Postgres(db, { organizationId: orgA }, forgedProjection);
    const projection = await readExecutionAttemptProjectionV2Postgres(
      db,
      { organizationId: orgA },
      attempt.executionAttemptId,
    );
    expect(projection?.lifecycleState).toBe("BOUND");
  });

  it("refuses caller-labeled terminal reports without exact matching raw evidence", async () => {
    const { accountId, attempt } = await persistAuthority();
    await appendExecutionReportV2Postgres(
      db,
      { organizationId: orgA },
      {
        executionReportId: uuid(667_304),
        accountId,
        executionAttemptId: attempt.executionAttemptId,
        reportType: "SUBMIT_STARTED",
        source: "EXECUTION",
        rawObservation: { effectIdentityDigestHex: attempt.effectIdentityDigestHex },
        observedAtUtc: "2026-08-21T00:00:00.002Z",
      },
    );
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
    await expect(
      appendExecutionReportV2Postgres(
        db,
        { organizationId: orgA },
        {
          executionReportId: uuid(667_305),
          accountId,
          executionAttemptId: attempt.executionAttemptId,
          reportType: "VENUE_REJECTED",
          source: "CONNECTOR",
          rawObservation: { order: openOrder },
          venueOrderId: openOrder.orderId,
          observedAtUtc: "2026-08-21T00:00:00.003Z",
        },
      ),
    ).rejects.toThrow(/exact bound order evidence/);
    await expect(
      appendExecutionReportV2Postgres(
        db,
        { organizationId: orgA },
        {
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
        },
      ),
    ).rejects.toThrow(/exact raw trade evidence/);
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

    await sql.unsafe(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ${executionTables.join(", ")} TO authenticated, anon`,
    );
    try {
      for (const role of ["authenticated", "anon"] as const) {
        const roleSql = postgres(url!, { max: 1 });
        try {
          await roleSql.unsafe(`SET ROLE ${role}`);
          for (const table of executionTables) {
            await expect(roleSql.unsafe(`SELECT * FROM ${table}`)).resolves.toEqual([]);
            await expect(
              roleSql.unsafe(
                `UPDATE ${table} SET organization_id = organization_id RETURNING organization_id`,
              ),
            ).resolves.toEqual([]);
            await expect(
              roleSql.unsafe(`DELETE FROM ${table} RETURNING organization_id`),
            ).resolves.toEqual([]);
          }
          await expect(
            roleSql.unsafe(`
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
          `),
          ).rejects.toThrow(/row-level security/);
        } finally {
          try {
            await roleSql.unsafe("RESET ROLE");
          } catch {}
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
    expect(outcomes[0]?.order.openingCausalLineageJson).toBeTruthy();
    const openingLineage = parseOpeningCausalLineageV1(
      outcomes[0]!.order.openingCausalLineageJson!,
    );
    expect(openingLineage).toMatchObject({
      forecastId: input.allowance.decision.forecastId,
      forecastContentDigest: input.allowance.decision.forecastContentDigestHex,
      canonicalCausalLineageDigest: input.allowance.decision.canonicalCausalLineageDigestHex,
      decisionId: input.allowance.decision.decisionId,
      riskAllowanceId: input.allowance.riskAllowanceId,
    });
    expect(outcomes[0]?.order.openingCausalLineageDigest).toBe(openingLineage.contentDigest);
    const counts = await sql<
      { order_count: string; attempt_count: string; report_count: string }[]
    >`
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
    const riskState = await sql<
      {
        outstanding: string;
        pending: string;
      }[]
    >`
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
      async (payload, submittedAuthority) => {
        networkCalls += 1;
        expect(payload).toEqual(outcomes[0]!.attempt.exactRequestPayload);
        expect(submittedAuthority.timeoutMs).toBe(input.policy.timeoutMs);
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
    await expect(
      insertExecutionPlanV2Postgres(db, { organizationId: orgA }, forgedPlan),
    ).rejects.toThrow(/locked Risk allowance/);
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

    await expect(
      insertExecutionPlanV2Postgres(db, { organizationId: orgA }, forgedPlan),
    ).rejects.toThrow(/stored Execution policy or notional authority/);
  });

  it("reconstructs the complete durable effect binding before any network call", async () => {
    const input = await admittedBindInput();
    const bound = await bindExecutionAuthorityV2Postgres(db, { organizationId: orgA }, input);
    await sql`
      UPDATE trader_orders SET idempotency_key = 'tampered-after-bind'
      WHERE organization_id = ${orgA}::uuid AND id = ${bound.order.id}::uuid
    `;
    let networkCalls = 0;
    await expect(
      dispatchCommittedExecutionAttemptV2(
        db,
        { organizationId: orgA },
        bound.attempt.executionAttemptId,
        async () => {
          networkCalls += 1;
          return { forbidden: true };
        },
      ),
    ).rejects.toThrow(/INCOMPLETE_DURABLE_EFFECT_BINDING/);
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
    await expect(
      dispatchCommittedExecutionAttemptV2(
        db,
        { organizationId: orgA },
        bound.attempt.executionAttemptId,
        async () => {
          networkCalls += 1;
          return { forbidden: true };
        },
      ),
    ).rejects.toThrow(/EXECUTION_WINDOW_CLOSED/);
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

  it("rechecks current Risk authority under lock and commits revocation of a TOCTOU bind", async () => {
    const input = await admittedBindInput();
    await sql`
      UPDATE trader_risk_account_state_v2 SET kill_state = 'TRIPPED'
      WHERE organization_id = ${orgA}::uuid AND account_id = ${input.allowance.accountId}
    `;
    await expect(
      bindExecutionAuthorityV2Postgres(db, { organizationId: orgA }, input),
    ).rejects.toThrow(/CURRENT_AUTHORITY_BINDING_MISMATCH/);
    const rows = await sql<
      {
        lifecycle_state: string;
        reservation: string;
        policy_count: string;
        plan_count: string;
        order_count: string;
        attempt_count: string;
      }[]
    >`
      SELECT a.lifecycle_state,
        s.outstanding_reservation_notional::text AS reservation,
        (SELECT count(*)::text FROM trader_execution_policies_v2
          WHERE organization_id = ${orgA}::uuid) AS policy_count,
        (SELECT count(*)::text FROM trader_execution_plans_v2
          WHERE organization_id = ${orgA}::uuid) AS plan_count,
        (SELECT count(*)::text FROM trader_orders
          WHERE organization_id = ${orgA}::uuid) AS order_count,
        (SELECT count(*)::text FROM trader_execution_attempts_v2
          WHERE organization_id = ${orgA}::uuid) AS attempt_count
      FROM trader_risk_allowances_v2 a
      JOIN trader_risk_account_state_v2 s
        ON s.organization_id = a.organization_id AND s.account_id = a.account_id
      WHERE a.organization_id = ${orgA}::uuid AND a.id = ${input.allowance.riskAllowanceId}::uuid
    `;
    expect(rows[0]).toEqual({
      lifecycle_state: "REVOKED",
      reservation: "0.00000000",
      policy_count: "0",
      plan_count: "0",
      order_count: "0",
      attempt_count: "0",
    });
  });

  it.each([
    ["kill", { killState: "TRIPPED" as const }, "CURRENT_AUTHORITY_BINDING_MISMATCH"],
    ["unknown kill", { killState: "UNKNOWN" as const }, "CURRENT_AUTHORITY_BINDING_MISMATCH"],
    ["halt", { posture: "HALT" as const }, "EXECUTION_FAIL_CLOSED"],
    ["close only", { posture: "CLOSE_ONLY" as const }, "CURRENT_POSTURE_RESTRICTED"],
    [
      "divergent reconciliation",
      { reconciliationStatus: "DIVERGENT" as const },
      "CURRENT_AUTHORITY_BINDING_MISMATCH",
    ],
    [
      "stale reconciliation",
      { reconciliationStatus: "STALE" as const },
      "CURRENT_AUTHORITY_BINDING_MISMATCH",
    ],
    [
      "changed Reality",
      { realitySnapshotId: "new-reality-after-bind" },
      "CURRENT_AUTHORITY_BINDING_MISMATCH",
    ],
    [
      "changed reconciliation authority",
      { reconciliationAuthorityDigest: hex64("new-reconciliation") },
      "CURRENT_AUTHORITY_BINDING_MISMATCH",
    ],
  ])("refuses post-bind %s before submission admission", async (_name, patch, reason) => {
    const input = await admittedBindInput();
    const bound = await bindExecutionAuthorityV2Postgres(db, { organizationId: orgA }, input);
    await db
      .update(pgSchema.traderRiskAccountStateV2)
      .set(patch)
      .where(
        and(
          eq(pgSchema.traderRiskAccountStateV2.organizationId, orgA),
          eq(pgSchema.traderRiskAccountStateV2.accountId, input.allowance.accountId),
        ),
      );
    let networkCalls = 0;
    await expect(
      dispatchCommittedExecutionAttemptV2(
        db,
        { organizationId: orgA },
        bound.attempt.executionAttemptId,
        async () => {
          networkCalls += 1;
          return { synthetic: true };
        },
      ),
    ).rejects.toThrow(reason);
    expect(networkCalls).toBe(0);
    const projection = await readExecutionAttemptProjectionV2Postgres(
      db,
      { organizationId: orgA },
      bound.attempt.executionAttemptId,
    );
    expect(projection?.lifecycleState).toBe("BOUND");
    const reports = await listExecutionReportsV2Postgres(
      db,
      { organizationId: orgA },
      bound.attempt.executionAttemptId,
    );
    expect(reports.some((report) => report.reportType === "SUBMIT_STARTED")).toBe(false);
  });

  async function expectBindRefusalLeavesNoAuthority(
    input: BindExecutionAuthorityV2Input,
    reason: string,
    lifecycle: "EXPIRED" | "REVOKED",
  ) {
    await expect(
      bindExecutionAuthorityV2Postgres(db, { organizationId: orgA }, input),
    ).rejects.toMatchObject({ name: "ExecutionV2AuthorityRefusedError", reason });
    const [allowance] = await sql<{ lifecycle_state: string; reservation: string }[]>`
      SELECT a.lifecycle_state, s.outstanding_reservation_notional::text AS reservation
      FROM trader_risk_allowances_v2 a
      JOIN trader_risk_account_state_v2 s
        ON s.organization_id = a.organization_id AND s.account_id = a.account_id
      WHERE a.organization_id = ${orgA}::uuid AND a.id = ${input.allowance.riskAllowanceId}::uuid`;
    expect(allowance).toEqual({ lifecycle_state: lifecycle, reservation: "0.00000000" });
    const [counts] = await sql<
      { policies: number; plans: number; attempts: number; orders: number }[]
    >`
      SELECT
        (SELECT count(*)::int FROM trader_execution_policies_v2 WHERE organization_id = ${orgA}::uuid) AS policies,
        (SELECT count(*)::int FROM trader_execution_plans_v2 WHERE organization_id = ${orgA}::uuid) AS plans,
        (SELECT count(*)::int FROM trader_execution_attempts_v2 WHERE organization_id = ${orgA}::uuid) AS attempts,
        (SELECT count(*)::int FROM trader_orders WHERE organization_id = ${orgA}::uuid) AS orders`;
    expect(counts).toEqual({ policies: 0, plans: 0, attempts: 0, orders: 0 });
  }

  it("commits expiry when bind is refused after validUntil and inserts no authority", async () => {
    const input = await admittedBindInput({ validForMs: 1_500 });
    await sql`SELECT pg_sleep(2)`;
    await expectBindRefusalLeavesNoAuthority(input, "ALLOWANCE_EXPIRED", "EXPIRED");
  }, 30_000);

  it("commits revocation when bind is refused by kill and inserts no authority", async () => {
    const input = await admittedBindInput();
    await sql`
      UPDATE trader_risk_account_state_v2
      SET kill_state = 'TRIPPED'
      WHERE organization_id = ${orgA}::uuid AND account_id = ${input.allowance.accountId}`;
    await expectBindRefusalLeavesNoAuthority(
      input,
      "CURRENT_AUTHORITY_BINDING_MISMATCH",
      "REVOKED",
    );
  });

  async function expectRequestRefusalLeavesIssuedAllowance(
    input: BindExecutionAuthorityV2Input,
    reason: string,
    reservationBefore: string,
  ) {
    await expect(
      bindExecutionAuthorityV2Postgres(db, { organizationId: orgA }, input),
    ).rejects.toMatchObject({ name: "ExecutionV2AuthorityRefusedError", reason });
    const [allowance] = await sql<{ lifecycle_state: string; reservation: string }[]>`
      SELECT a.lifecycle_state, s.outstanding_reservation_notional::text AS reservation
      FROM trader_risk_allowances_v2 a
      JOIN trader_risk_account_state_v2 s
        ON s.organization_id = a.organization_id AND s.account_id = a.account_id
      WHERE a.organization_id = ${orgA}::uuid AND a.id = ${input.allowance.riskAllowanceId}::uuid`;
    expect(allowance?.lifecycle_state).toBe("ISSUED");
    expect(allowance?.reservation).toBe(reservationBefore);
    expect(allowance?.reservation).not.toBe("0.00000000");
    const [counts] = await sql<
      { policies: number; plans: number; attempts: number; orders: number }[]
    >`
      SELECT
        (SELECT count(*)::int FROM trader_execution_policies_v2 WHERE organization_id = ${orgA}::uuid) AS policies,
        (SELECT count(*)::int FROM trader_execution_plans_v2 WHERE organization_id = ${orgA}::uuid) AS plans,
        (SELECT count(*)::int FROM trader_execution_attempts_v2 WHERE organization_id = ${orgA}::uuid) AS attempts,
        (SELECT count(*)::int FROM trader_orders WHERE organization_id = ${orgA}::uuid) AS orders`;
    expect(counts).toEqual({ policies: 0, plans: 0, attempts: 0, orders: 0 });
  }

  it("leaves an issued allowance reserved when the bind ceiling exceeds it", async () => {
    const input = await admittedBindInput();
    const [before] = await sql<{ reservation: string }[]>`
      SELECT outstanding_reservation_notional::text AS reservation
      FROM trader_risk_account_state_v2
      WHERE organization_id = ${orgA}::uuid AND account_id = ${input.allowance.accountId}`;
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
    await expectRequestRefusalLeavesIssuedAllowance(
      forgedInput,
      "EFFECT_NOTIONAL_EXCEEDS_ALLOWANCE_RESERVATION",
      before!.reservation,
    );
  });

  it("leaves an issued allowance reserved when the bind nonce does not match", async () => {
    const input = await admittedBindInput();
    const [before] = await sql<{ reservation: string }[]>`
      SELECT outstanding_reservation_notional::text AS reservation
      FROM trader_risk_account_state_v2
      WHERE organization_id = ${orgA}::uuid AND account_id = ${input.allowance.accountId}`;
    await expectRequestRefusalLeavesIssuedAllowance(
      { ...input, allowance: { ...input.allowance, nonce: uuid(667_199) } },
      "ALLOWANCE_NONCE_MISMATCH",
      before!.reservation,
    );
  });

  it("leaves an issued allowance reserved when the bind order does not match", async () => {
    const input = await admittedBindInput();
    const [before] = await sql<{ reservation: string }[]>`
      SELECT outstanding_reservation_notional::text AS reservation
      FROM trader_risk_account_state_v2
      WHERE organization_id = ${orgA}::uuid AND account_id = ${input.allowance.accountId}`;
    await expectRequestRefusalLeavesIssuedAllowance(
      { ...input, allowance: { ...input.allowance, symbol: "ETHUSDT" } },
      "ORDER_DOES_NOT_MATCH_ALLOWANCE",
      before!.reservation,
    );
  });

  it("rewrites expiry after the bind savepoint when validUntil passes between preflight and consume", async () => {
    const input = await admittedBindInput({ validForMs: 8_000 });
    const trace: LockTrace = [];
    const binder = lockClient("savepoint-expiry", orgA, trace, {
      resource: "allowance",
      identity: input.allowance.riskAllowanceId,
    });
    const pending = nativeSettled(
      bindExecutionAuthorityV2Postgres(binder.db, { organizationId: orgA }, input),
    );
    try {
      await expect.poll(() => binder.paused, { timeout: 5_000 }).toBe(true);
      const [clock] = await sql<{ still_valid: boolean }[]>`
        SELECT clock_timestamp() < ${input.allowance.validUntilUtc}::timestamptz AS still_valid`;
      expect(clock?.still_valid).toBe(true);
      await sql`SELECT pg_sleep(9)`;
      binder.release();
      const outcome = await pending;
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.causes[0]).toMatchObject({
          name: "ExecutionV2AuthorityRefusedError",
          reason: "ALLOWANCE_EXPIRED",
        });
      }
      const [allowance] = await sql<{ lifecycle_state: string; reservation: string }[]>`
        SELECT a.lifecycle_state, s.outstanding_reservation_notional::text AS reservation
        FROM trader_risk_allowances_v2 a
        JOIN trader_risk_account_state_v2 s
          ON s.organization_id = a.organization_id AND s.account_id = a.account_id
        WHERE a.organization_id = ${orgA}::uuid AND a.id = ${input.allowance.riskAllowanceId}::uuid`;
      expect(allowance).toEqual({ lifecycle_state: "EXPIRED", reservation: "0.00000000" });
      const [counts] = await sql<{ policies: number; plans: number; orders: number }[]>`
        SELECT
          (SELECT count(*)::int FROM trader_execution_policies_v2 WHERE organization_id = ${orgA}::uuid) AS policies,
          (SELECT count(*)::int FROM trader_execution_plans_v2 WHERE organization_id = ${orgA}::uuid) AS plans,
          (SELECT count(*)::int FROM trader_orders WHERE organization_id = ${orgA}::uuid) AS orders`;
      expect(counts).toEqual({ policies: 0, plans: 0, orders: 0 });
    } finally {
      binder.release();
      await pending;
      await binder.client.end({ timeout: 5 });
    }
  }, 30_000);

  it("refuses a consumed allowance expiring before the still-open execution window", async () => {
    const input = await admittedBindInput({ validForMs: 2_000 });
    const bound = await bindExecutionAuthorityV2Postgres(db, { organizationId: orgA }, input);
    await sql`SELECT pg_sleep(2.2)`;
    let networkCalls = 0;
    await expect(
      dispatchCommittedExecutionAttemptV2(
        db,
        { organizationId: orgA },
        bound.attempt.executionAttemptId,
        async () => {
          networkCalls += 1;
          return { synthetic: true };
        },
      ),
    ).rejects.toThrow("ALLOWANCE_EXPIRED");
    expect(networkCalls).toBe(0);
  });

  it.each([false, true])(
    "rechecks current strict reduction under CLOSE_ONLY, exposure changed=%s",
    async (changed) => {
      const input = await admittedBindInput({ reduction: true });
      const bound = await bindExecutionAuthorityV2Postgres(db, { organizationId: orgA }, input);
      await db
        .update(pgSchema.traderRiskAccountStateV2)
        .set({
          posture: "CLOSE_ONLY",
          reconciledInstrumentExposures: [
            {
              instrumentIdentityDigestHex: input.allowance.instrumentIdentityDigestHex,
              symbol: "BTCUSDT",
              baseQuantity: changed ? "0.0005" : "0.002",
            },
          ],
        })
        .where(
          and(
            eq(pgSchema.traderRiskAccountStateV2.organizationId, orgA),
            eq(pgSchema.traderRiskAccountStateV2.accountId, input.allowance.accountId),
          ),
        );
      let networkCalls = 0;
      const dispatch = dispatchCommittedExecutionAttemptV2(
        db,
        { organizationId: orgA },
        bound.attempt.executionAttemptId,
        async () => {
          networkCalls += 1;
          return { synthetic: true };
        },
      );
      if (changed) await expect(dispatch).rejects.toThrow("STRICT_REDUCTION_PROOF_INVALID");
      else expect((await dispatch).status).toBe("SUBMITTED");
      expect(networkCalls).toBe(changed ? 0 : 1);
    },
  );

  it("waits for an in-flight Risk restriction and observes its commit before admission", async () => {
    const input = await admittedBindInput();
    const bound = await bindExecutionAuthorityV2Postgres(db, { organizationId: orgA }, input);
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let signalLocked!: (pid: number) => void;
    const locked = new Promise<number>((resolve) => {
      signalLocked = resolve;
    });
    const restriction = sql.begin(async (tx) => {
      await tx`UPDATE trader_risk_account_state_v2 SET kill_state='TRIPPED'
        WHERE organization_id=${orgA}::uuid AND account_id=${input.allowance.accountId}`;
      const [row] = await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      signalLocked(row!.pid);
      await released;
    });
    const blockerPid = await locked;
    let networkCalls = 0;
    const dispatch = dispatchCommittedExecutionAttemptV2(
      db,
      { organizationId: orgA },
      bound.attempt.executionAttemptId,
      async () => {
        networkCalls += 1;
        return { synthetic: true };
      },
    ).then(
      (result) => ({ result, error: null }),
      (error: Error) => ({ result: null, error }),
    );
    try {
      // Observe an actual PostgreSQL lock wait, rather than relying on a sleep
      // to guess whether dispatch reached its admission boundary.
      await expect
        .poll(
          async () => {
            const [row] = await sql<{ waiting: boolean }[]>`SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity WHERE ${blockerPid} = ANY(pg_blocking_pids(pid))
        ) AS waiting`;
            return row!.waiting;
          },
          { timeout: 5_000 },
        )
        .toBe(true);
      expect(networkCalls).toBe(0);
    } finally {
      release();
      await restriction;
    }
    const outcome = await dispatch;
    expect(outcome.error?.message).toContain("CURRENT_AUTHORITY_BINDING_MISMATCH");
    expect(networkCalls).toBe(0);
  }, 15_000);

  it("admits one concurrent sender and releases Risk locks before network I/O", async () => {
    const input = await admittedBindInput();
    const bound = await bindExecutionAuthorityV2Postgres(db, { organizationId: orgA }, input);
    let networkCalls = 0;
    const submit = async () => {
      networkCalls += 1;
      const reports = await listExecutionReportsV2Postgres(
        db,
        { organizationId: orgA },
        bound.attempt.executionAttemptId,
      );
      expect(reports.filter((report) => report.reportType === "SUBMIT_STARTED")).toHaveLength(1);
      // A restriction AFTER admission must not deadlock on locks held across
      // the callback, and does not license a retry of this admitted effect.
      await sql.begin(async (tx) => {
        await tx`SET LOCAL lock_timeout='2s'`;
        await tx`UPDATE trader_risk_account_state_v2 SET kill_state='TRIPPED'
          WHERE organization_id=${orgA}::uuid AND account_id=${input.allowance.accountId}`;
      });
      return { synthetic: true };
    };
    const outcomes = await Promise.all(
      [0, 1].map(() =>
        dispatchCommittedExecutionAttemptV2(
          db,
          { organizationId: orgA },
          bound.attempt.executionAttemptId,
          submit,
        ),
      ),
    );
    expect(outcomes.map((result) => result.status).sort()).toEqual([
      "REFUSED_ALREADY_STARTED",
      "SUBMITTED",
    ]);
    expect(networkCalls).toBe(1);
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
    await expect(
      bindExecutionAuthorityV2Postgres(db, { organizationId: orgA }, forgedInput),
    ).rejects.toThrow(/locked Risk allowance|EFFECT_NOTIONAL_EXCEEDS_ALLOWANCE_RESERVATION/);
    const [allowance] = await sql<{ lifecycle_state: string; reservation: string }[]>`
      SELECT a.lifecycle_state, s.outstanding_reservation_notional::text AS reservation
      FROM trader_risk_allowances_v2 a
      JOIN trader_risk_account_state_v2 s
        ON s.organization_id = a.organization_id AND s.account_id = a.account_id
      WHERE a.organization_id = ${orgA}::uuid AND a.id = ${input.allowance.riskAllowanceId}::uuid`;
    expect(allowance).toEqual({ lifecycle_state: "ISSUED", reservation: "25.00000000" });
    const counts = await sql<{ policies: string; plans: string; orders: string; attempts: string }[]>`
      SELECT
        (SELECT count(*)::text FROM trader_execution_policies_v2
          WHERE organization_id = ${orgA}::uuid) AS policies,
        (SELECT count(*)::text FROM trader_execution_plans_v2
          WHERE organization_id = ${orgA}::uuid) AS plans,
        (SELECT count(*)::text FROM trader_orders
          WHERE organization_id = ${orgA}::uuid) AS orders,
        (SELECT count(*)::text FROM trader_execution_attempts_v2
          WHERE organization_id = ${orgA}::uuid) AS attempts
    `;
    expect(counts[0]).toEqual({ policies: "0", plans: "0", orders: "0", attempts: "0" });
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
      async () => {
        throw unknownState;
      },
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
        trades: [
          {
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
            rawVenueObservation: {
              "trade-id": "htx-trade-over-notional",
              "order-id": order.orderId,
              price: "26000",
              "filled-amount": bound.attempt.exactRequestPayload.quantity,
              "filled-fees": "0.01",
              "fee-currency": "usdt",
            },
          },
        ],
        raw: { state: "filled", price: "25000", filledAmount: "0.001" },
      }),
    );
    expect(result.status).toBe("RECONCILIATION_REQUIRED");
    const reports = await listExecutionReportsV2Postgres(
      db,
      { organizationId: orgA },
      bound.attempt.executionAttemptId,
    );
    expect(reports.at(-2)?.rawObservation).toMatchObject({
      trades: [
        {
          tradeId: "htx-trade-over-notional",
          rawVenueObservation: {
            "trade-id": "htx-trade-over-notional",
            price: "26000",
          },
        },
      ],
    });
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
        trades: [
          {
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
          },
        ],
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

  it("DEE-1151 submits one paper order through Execution V2 to the connector", async () => {
    const input = await admittedBindInput();
    const connector = new MockExchangeConnector();
    await connector.validateCredentials({ apiKey: "mock", apiSecret: "mock" });
    const placeOrder = vi.spyOn(connector, "placeOrder");
    const path = createOrgScopedExecutionV2OrderPath({
      db,
      connectorFor: () => connector,
    });
    const result = await path.service.submit({ organizationId: orgA }, input);
    expect(placeOrder).toHaveBeenCalledTimes(1);
    expect(result.outcome.status).toBe("VENUE_ACCEPTED");
    const projection = await readExecutionAttemptProjectionV2Postgres(
      db,
      { organizationId: orgA },
      result.authority.attempt.executionAttemptId,
    );
    expect(projection?.lifecycleState).toBe("VENUE_ACCEPTED");
  });

  it("DEE-1151 refuses a live bind when a live gate is absent and still admits paper", async () => {
    const input = await admittedBindInput();
    const live = { ...input, executionMode: "live" as const };
    const before = await lockProofState(input);
    await expect(
      bindExecutionAuthorityV2Postgres(db, { organizationId: orgA }, live),
    ).rejects.toBeInstanceOf(ExecutionV2AuthorityRefusedError);
    await expect(
      createAssertExecutionV2LiveAuthorized(db)({ organizationId: orgA }, live),
    ).rejects.toBeInstanceOf(ExecutionV2AuthorityRefusedError);
    try {
      await bindExecutionAuthorityV2Postgres(db, { organizationId: orgA }, live);
      throw new Error("live bind should have refused");
    } catch (error) {
      expect(error).toBeInstanceOf(ExecutionV2AuthorityRefusedError);
      expect(EXECUTION_V2_LIVE_GATE_REASONS).toContain(
        (error as ExecutionV2AuthorityRefusedError).reason,
      );
    }
    const after = await lockProofState(input);
    expect(after.allowance).toEqual(before.allowance);
    expect(after.counts).toEqual(before.counts);
    const connector = new MockExchangeConnector();
    await connector.validateCredentials({ apiKey: "mock", apiSecret: "mock" });
    const placeOrder = vi.spyOn(connector, "placeOrder");
    const path = createOrgScopedExecutionV2OrderPath({
      db,
      connectorFor: () => connector,
    });
    const paper = await path.service.submit({ organizationId: orgA }, input);
    expect(placeOrder).toHaveBeenCalledTimes(1);
    expect(paper.outcome.status).toBe("VENUE_ACCEPTED");
  });

  async function pendingNotional(accountId: string): Promise<string> {
    const rows = await sql<{ pending: string }[]>`
      SELECT worst_case_pending_exposure_notional::text AS pending
      FROM trader_risk_account_state_v2
      WHERE organization_id = ${orgA}::uuid AND account_id = ${accountId}`;
    return rows[0]?.pending ?? "";
  }

  it("DEE-1151 records an HTX business reject and releases the pending reserve", async () => {
    const input = await admittedBindInput();
    const bound = await bindExecutionAuthorityV2Postgres(db, { organizationId: orgA }, input);
    let posts = 0;
    const rejected = await dispatchAndRecordExecutionAttemptV2(
      db,
      { organizationId: orgA },
      bound.attempt.executionAttemptId,
      async () => {
        posts += 1;
        throw new HtxPlacementRejectedError("venue rejected the placement", {
          httpStatus: 200,
          errCode: "order-value-min-error",
        });
      },
    );
    expect(posts).toBe(1);
    expect(rejected.status).toBe("VENUE_REJECTED");
    expect(await pendingNotional(input.allowance.accountId)).toMatch(/^0(\.0+)?$/);
    const again = await dispatchAndRecordExecutionAttemptV2(
      db,
      { organizationId: orgA },
      bound.attempt.executionAttemptId,
      async () => {
        posts += 1;
        throw new Error("must not post again");
      },
    );
    expect(again.status).toBe("REFUSED_ALREADY_TERMINAL");
    expect(posts).toBe(1);
    expect(await pendingNotional(input.allowance.accountId)).toMatch(/^0(\.0+)?$/);
  });

  it("DEE-1151 reduces reconciliation to a reject only after its own venue read is absent", async () => {
    const input = await admittedBindInput();
    const bound = await bindExecutionAuthorityV2Postgres(db, { organizationId: orgA }, input);
    const unknown = await dispatchAndRecordExecutionAttemptV2(
      db,
      { organizationId: orgA },
      bound.attempt.executionAttemptId,
      async () => {
        throw new Error("socket reset");
      },
    );
    expect(unknown.status).toBe("RECONCILIATION_REQUIRED");
    expect(await pendingNotional(input.allowance.accountId)).not.toMatch(/^0(\.0+)?$/);
    const stayed = await resolveReconciliationRequiredV2Postgres(
      db,
      { organizationId: orgA },
      bound.attempt.executionAttemptId,
      async () => ({ status: "UNKNOWN" }),
    );
    expect(stayed.status).toBe("RECONCILIATION_REQUIRED");
    expect(await pendingNotional(input.allowance.accountId)).not.toMatch(/^0(\.0+)?$/);
    const callerAbsent = await resolveReconciliationRequiredV2Postgres(
      db,
      { organizationId: orgA },
      bound.attempt.executionAttemptId,
      async () => ({ status: "ABSENT" }),
    );
    expect(callerAbsent.status).toBe("RECONCILIATION_REQUIRED");
    expect(await pendingNotional(input.allowance.accountId)).not.toMatch(/^0(\.0+)?$/);
    let ownReads = 0;
    const absent = await resolveReconciliationRequiredV2Postgres(
      db,
      { organizationId: orgA },
      bound.attempt.executionAttemptId,
      async () => ({ status: "ABSENT" }),
      async () => {
        ownReads += 1;
        return { status: "ABSENT" };
      },
    );
    expect(absent.status).toBe("VENUE_REJECTED");
    expect(ownReads).toBe(1);
    expect(await pendingNotional(input.allowance.accountId)).toMatch(/^0(\.0+)?$/);
    let lookups = 0;
    const terminal = await resolveReconciliationRequiredV2Postgres(
      db,
      { organizationId: orgA },
      bound.attempt.executionAttemptId,
      async () => {
        lookups += 1;
        return { status: "ABSENT" };
      },
      async () => {
        lookups += 1;
        return { status: "ABSENT" };
      },
    );
    expect(terminal.status).toBe("REFUSED_ALREADY_TERMINAL");
    expect(lookups).toBe(0);
  });

  it("DEE-1151 reduces reconciliation to an accepted order without releasing the reserve", async () => {
    const input = await admittedBindInput();
    const bound = await bindExecutionAuthorityV2Postgres(db, { organizationId: orgA }, input);
    const unknown = await dispatchAndRecordExecutionAttemptV2(
      db,
      { organizationId: orgA },
      bound.attempt.executionAttemptId,
      async () => {
        throw new Error("timeout");
      },
    );
    expect(unknown.status).toBe("RECONCILIATION_REQUIRED");
    const held = await pendingNotional(input.allowance.accountId);
    const payload = bound.attempt.exactRequestPayload;
    const found = await resolveReconciliationRequiredV2Postgres(
      db,
      { organizationId: orgA },
      bound.attempt.executionAttemptId,
      async () => ({
        status: "FOUND",
        observation: {
          order: {
            orderId: "htx-reconciled-1",
            clientOrderId: payload.clientOrderId,
            symbol: payload.symbol,
            side: payload.side,
            type: payload.type,
            status: "open",
            price: payload.price ?? undefined,
            quantity: payload.quantity,
            filledQuantity: "0",
            createdAt: "2026-08-21T00:00:00.000Z",
            updatedAt: "2026-08-21T00:00:01.000Z",
          },
          trades: [],
          raw: { lookup: "FOUND" },
        },
      }),
    );
    expect(found.status).toBe("VENUE_ACCEPTED");
    expect(await pendingNotional(input.allowance.accountId)).toBe(held);
  });

  it("DEE-1151 timestamps a recovery report after waiting for the attempt lock", async () => {
    const input = await admittedBindInput({ validForMs: 60_000 });
    const bound = await bindExecutionAuthorityV2Postgres(db, { organizationId: orgA }, input);
    const before = await lockProofState(input);
    const trace: LockTrace = [{ kind: "before", state: before }];
    const recovery = lockClient("recovery-clock", orgA, trace);
    const holder = lockClient("recovery-attempt-holder", orgA, trace,
      { resource: "attempt", identity: bound.attempt.executionAttemptId });
    const operations: Promise<unknown>[] = [];
    let proof!: Awaited<ReturnType<typeof finishLockProof>>;
    let boundary = "";
    try {
      operations.push(nativeSettled(holder.db.transaction(async (tx) => {
        await tx.select().from(pgSchema.traderExecutionAttemptsV2).where(and(
          eq(pgSchema.traderExecutionAttemptsV2.organizationId, orgA),
          eq(pgSchema.traderExecutionAttemptsV2.id, bound.attempt.executionAttemptId),
        )).for("update");
      })));
      await expect.poll(() => holder.paused, { timeout: 5_000 }).toBe(true);
      operations.push(nativeSettled(markExecutionAttemptReconciliationRequiredV2Postgres(
        recovery.db,
        { organizationId: orgA },
        bound.attempt.executionAttemptId,
        "LOCK_WAIT_CLOCK_PROOF",
      )));
      await observeLockWait(holder, recovery, "attempt", trace);
      const [deadline] = await holder.tx!.execute<{ at: Date | string }>(sqlQuery`
        SELECT clock_timestamp() + interval '50 milliseconds' AS at`);
      boundary = new Date(deadline!.at).toISOString();
      trace.push({ kind: "recovery-report-time-boundary", at: boundary });
      await waitPastDeadline(holder, boundary, trace);
    } catch (error) {
      trace.push({ kind: "harness-failure", causes: nativeErrorCauses(error) });
      throw error;
    } finally {
      proof = await finishLockProof("recovery-report/attempt-wait-clock", input, trace,
        [recovery, holder], operations);
    }

    expect(proof.outcomes).toMatchObject([{ ok: true }, { ok: true }]);
    expect(proof.state!.reports).toHaveLength(before.reports!.length + 1);
    const report = proof.state!.reports!.at(-1)!;
    expect(report.type).toBe("RECONCILIATION_REQUIRED");
    expect(report.sequence).toBe(String(before.reports!.length + 1));
    expect(report.previous).toBe(before.reports!.at(-1)?.digest ?? null);
    expect(report.digest).toMatch(/^[0-9a-f]{64}$/);
    const [persisted] = await sql<{ observed_at: Date | string }[]>`
      SELECT observed_at FROM trader_execution_reports_v2
      WHERE organization_id = ${orgA}::uuid
        AND execution_attempt_id = ${bound.attempt.executionAttemptId}::uuid
      ORDER BY report_sequence DESC LIMIT 1`;
    expect(persisted).toBeDefined();
    expect(new Date(persisted!.observed_at).getTime()).toBeGreaterThanOrEqual(new Date(boundary).getTime());
    expect({ ...proof.state!.counts, reports: before.counts!.reports }).toEqual(before.counts);
    expect(proof.state!.allowance).toEqual(before.allowance);
    expect(proof.state!.events).toEqual(before.events);
    expect(proof.state!.account).toEqual(before.account);
    expect(proof.state!.reports!.slice(0, -1)).toEqual(before.reports);
    const projection = await readExecutionAttemptProjectionV2Postgres(
      db, { organizationId: orgA }, bound.attempt.executionAttemptId,
    );
    expect(projection?.lifecycleState).toBe("RECONCILIATION_REQUIRED");
    expect(projection?.attempt).toEqual(bound.attempt);
  }, 30_000);

  it("DEE-1151 does not post after SUBMIT_STARTED when a kill switch is tripped", async () => {
    const input = await admittedBindInput();
    const bound = await bindExecutionAuthorityV2Postgres(db, { organizationId: orgA }, input);
    const service = createPostgresKillSwitchService(db);
    try {
      let posts = 0;
      const refused = await dispatchAndRecordExecutionAttemptV2(
        db,
        { organizationId: orgA },
        bound.attempt.executionAttemptId,
        async () => {
          posts += 1;
          throw new Error("post must not be sent");
        },
        async () => {
          await service.trip(
            { actorType: "service", actorId: null },
            requireOrgContext(orgA),
            { scopeType: "organization", organizationId: orgA },
            { scopeType: "organization", scopeRef: null, switchType: "EMERGENCY_STOP" },
            { enforcementMode: "REJECT", origin: "manual", reason: "dee-1151 pre-post" },
          );
        },
      );
      expect(posts).toBe(0);
      expect(refused.status).toBe("VENUE_REJECTED");
      expect(await pendingNotional(input.allowance.accountId)).toMatch(/^0(\.0+)?$/);
      const reports = await listExecutionReportsV2Postgres(
        db,
        { organizationId: orgA },
        bound.attempt.executionAttemptId,
      );
      expect(reports.at(-1)?.rawObservation).toMatchObject({
        postSent: false,
        reason: "KILL_SWITCH_TRIPPED",
      });
    } finally {
      await sql`delete from trader_kill_switches where organization_id = ${orgA}::uuid`;
    }
  });

  it("DEE-1151 keeps a transient pre-POST database failure non-terminal and does not post", async () => {
    const input = await admittedBindInput();
    const bound = await bindExecutionAuthorityV2Postgres(db, { organizationId: orgA }, input);
    const held = await pendingNotional(input.allowance.accountId);
    let posts = 0;
    prePostGate.fail = true;
    const unavailable = await dispatchAndRecordExecutionAttemptV2(
      db,
      { organizationId: orgA },
      bound.attempt.executionAttemptId,
      async () => {
        posts += 1;
        throw new Error("post must not be sent");
      },
    );
    expect(posts).toBe(0);
    expect(unavailable.status).toBe("RECONCILIATION_REQUIRED");
    expect(await pendingNotional(input.allowance.accountId)).toBe(held);
    const reports = await listExecutionReportsV2Postgres(
      db,
      { organizationId: orgA },
      bound.attempt.executionAttemptId,
    );
    expect(reports.at(-1)).toMatchObject({
      reportType: "RECONCILIATION_REQUIRED",
      rawObservation: { cause: "PRE_POST_RECHECK_UNAVAILABLE", postSent: false },
    });
    const projection = await readExecutionAttemptProjectionV2Postgres(
      db,
      { organizationId: orgA },
      bound.attempt.executionAttemptId,
    );
    expect(projection?.lifecycleState).toBe("RECONCILIATION_REQUIRED");
    prePostGate.fail = false;
    let retryPosts = 0;
    const retry = await dispatchAndRecordExecutionAttemptV2(
      db,
      { organizationId: orgA },
      bound.attempt.executionAttemptId,
      async () => {
        retryPosts += 1;
        throw new Error("post must not be sent");
      },
    );
    expect(retryPosts).toBe(0);
    expect(retry.status).toBe("REFUSED_ALREADY_TERMINAL");
  });

  function publishedClientOrderFetch(body: Record<string, unknown>) {
    let posts = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const json = (payload: unknown, status = 200) =>
        new Response(JSON.stringify(payload), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      if (url.pathname === "/v1/account/accounts") {
        return json({ status: "ok", data: [{ id: 100009, type: "spot", state: "working" }] });
      }
      if (url.pathname === "/v2/user/uid") return json({ code: 200, data: 63628520 });
      if (url.pathname === "/v2/user/api-key") {
        return json({
          code: 200,
          data: [{ accessKey: "test-access-key", permission: "readOnly,trade", status: "normal" }],
        });
      }
      if (url.pathname === "/v1/order/orders/place") {
        posts += 1;
        const posted = JSON.parse(String(init?.body)) as { "client-order-id": string };
        body["client-order-id"] = posted["client-order-id"];
        return json({ status: "ok", data: body.id });
      }
      if (url.pathname === "/v1/order/orders/getClientOrder") {
        return json({ status: "ok", data: body });
      }
      throw new Error(`Unhandled HTX mock fetch: ${url.pathname}`);
    };
    return { fetchImpl, posts: () => posts };
  }

  it("DEE-1151 accepts a published getClientOrder body after venue decimals are normalized", async () => {
    const input = await admittedBindInput({ symbol: "BTC/USDT", baseAsset: "BTC/" });
    // Published GET /v1/order/orders/getClientOrder shape: field-* and 18 fractional zeros.
    // Allowances seal symbol as base+quote, so this fixture's base is "BTC/" and the
    // sealed symbol is BTC/USDT — the same string htxSymbolToInternal("btcusdt") returns.
    const published: Record<string, unknown> = {
      id: 357632718898331,
      symbol: "btcusdt",
      "account-id": 13496526,
      amount: "0.001000000000000000",
      price: "25000.000000000000000000",
      "created-at": 1630649406687,
      type: "buy-limit",
      "field-amount": "0.0",
      "field-cash-amount": "0.0",
      "field-fees": "0.0",
      "finished-at": 0,
      source: "spot-api",
      state: "submitted",
      "canceled-at": 0,
    };
    const transport = publishedClientOrderFetch(published);
    const connector = new HtxExchangeConnector({
      apiKey: "test-access-key",
      apiSecret: "test-secret-key",
      restHost: HTX_DEFAULT_REST_HOST,
      fetchImpl: transport.fetchImpl,
    });
    const validated = await connector.validateCredentials({
      apiKey: "test-access-key",
      apiSecret: "test-secret-key",
    });
    expect(validated.valid).toBe(true);
    const service = createPostgresExecutionV2Service({
      db,
      connectorFor: () => connector,
    });
    const submitted = await service.submit({ organizationId: orgA }, input);
    expect(transport.posts()).toBe(1);
    expect(submitted.outcome.status).toBe("VENUE_ACCEPTED");
    const reports = await listExecutionReportsV2Postgres(
      db,
      { organizationId: orgA },
      submitted.authority.attempt.executionAttemptId,
    );
    expect(reports.at(-1)).toMatchObject({
      reportType: "VENUE_ACCEPTED",
      rawObservation: {
        order: { price: "25000", quantity: "0.001", filledQuantity: "0", status: "open" },
        connector: {
          order: {
            amount: "0.001000000000000000",
            price: "25000.000000000000000000",
            "field-amount": "0.0",
          },
        },
      },
    });
  });

  it("DEE-1151 does not accept a venue decimal with a non-zero digit past scale 8", async () => {
    const input = await admittedBindInput({ symbol: "BTC/USDT", baseAsset: "BTC/" });
    const published: Record<string, unknown> = {
      id: 357632718898331,
      symbol: "btcusdt",
      "account-id": 13496526,
      amount: "0.001000000000000000",
      price: "25000.000000001",
      "created-at": 1630649406687,
      type: "buy-limit",
      "field-amount": "0.0",
      "field-cash-amount": "0.0",
      "field-fees": "0.0",
      state: "submitted",
    };
    const transport = publishedClientOrderFetch(published);
    const connector = new HtxExchangeConnector({
      apiKey: "test-access-key",
      apiSecret: "test-secret-key",
      restHost: HTX_DEFAULT_REST_HOST,
      fetchImpl: transport.fetchImpl,
    });
    expect((await connector.validateCredentials({
      apiKey: "test-access-key",
      apiSecret: "test-secret-key",
    })).valid).toBe(true);
    const service = createPostgresExecutionV2Service({
      db,
      connectorFor: () => connector,
    });
    const submitted = await service.submit({ organizationId: orgA }, input);
    expect(transport.posts()).toBe(1);
    expect(submitted.outcome.status).toBe("RECONCILIATION_REQUIRED");
    expect(submitted.outcome.status).not.toBe("VENUE_ACCEPTED");
  });
});
