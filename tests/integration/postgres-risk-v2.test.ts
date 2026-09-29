import { createHash } from "node:crypto";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import {
  admitRiskAllowanceV2Postgres,
  consumeRiskAllowanceForOrderV2Postgres,
  initializeRiskAccountStateV2Postgres as initializeRiskAccountStateRaw,
  readRiskAccountStateV2Postgres,
  expireRiskAllowanceV2Postgres,
  revokeRiskAllowanceV2Postgres,
  RiskV2AdmissionRefusedError,
  RiskV2PersistenceConflictError,
  type AdmitRiskAllowanceV2Input,
} from "@/lib/trader/risk/v2/risk-allowance-repository-postgres";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { divideDecimal } from "@/lib/trader/risk/numeric";
import { cleanupWp13Org, seedWp13User } from "./wp13-intelligence-test-helpers";
import {
  deleteLiveCapitalEnvelopeRows,
  publishMirroredLiveCapitalEnvelopeV2,
} from "../helpers/live-capital-test-envelope";

const enabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();
const USER_A = "00000000-0000-4000-8000-000000065701";
const USER_B = "00000000-0000-4000-8000-000000065702";
const hex64 = (seed: string) => createHash("sha256").update(seed).digest("hex");
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;

const riskTables = [
  "trader_risk_account_state_v2",
  "trader_risk_verdicts_v2",
  "trader_risk_allowances_v2",
  "trader_risk_enforcement_events_v2",
] as const;

async function initializeRiskAccountStateV2Postgres(
  database: Parameters<typeof initializeRiskAccountStateRaw>[0],
  context: Parameters<typeof initializeRiskAccountStateRaw>[1],
  state: Parameters<typeof initializeRiskAccountStateRaw>[2],
) {
  await initializeRiskAccountStateRaw(database, context, state);
  await publishMirroredLiveCapitalEnvelopeV2({
    organizationId: context.organizationId,
    accountId: state.accountId,
    exposureLimitNotional: state.accounting.exposureLimitNotional,
  });
}

async function clearRisk(sqlClient: postgres.Sql, organizationId: string) {
  await deleteLiveCapitalEnvelopeRows(sqlClient, organizationId);
  await sqlClient.unsafe(
    "ALTER TABLE trader_risk_enforcement_events_v2 DISABLE TRIGGER trader_risk_enforcement_events_v2_block_delete",
  );
  await sqlClient.unsafe(
    "ALTER TABLE trader_risk_allowances_v2 DISABLE TRIGGER trader_risk_allowances_v2_block_delete",
  );
  await sqlClient.unsafe(
    "ALTER TABLE trader_risk_verdicts_v2 DISABLE TRIGGER trader_risk_verdicts_v2_block_delete",
  );
  try {
    await sqlClient.begin(async (tx) => {
      await tx.unsafe("SET CONSTRAINTS ALL DEFERRED");
      await tx`DELETE FROM trader_risk_enforcement_events_v2 WHERE organization_id = ${organizationId}::uuid`;
      await tx`DELETE FROM trader_risk_allowances_v2 WHERE organization_id = ${organizationId}::uuid`;
      await tx`DELETE FROM trader_orders WHERE organization_id = ${organizationId}::uuid AND risk_allowance_id IS NOT NULL`;
      await tx`DELETE FROM trader_risk_verdicts_v2 WHERE organization_id = ${organizationId}::uuid`;
      await tx`DELETE FROM trader_risk_account_state_v2 WHERE organization_id = ${organizationId}::uuid`;
    });
  } finally {
    await sqlClient.unsafe(
      "ALTER TABLE trader_risk_verdicts_v2 ENABLE TRIGGER trader_risk_verdicts_v2_block_delete",
    );
    await sqlClient.unsafe(
      "ALTER TABLE trader_risk_allowances_v2 ENABLE TRIGGER trader_risk_allowances_v2_block_delete",
    );
    await sqlClient.unsafe(
      "ALTER TABLE trader_risk_enforcement_events_v2 ENABLE TRIGGER trader_risk_enforcement_events_v2_block_delete",
    );
  }
}

async function resetUser(userId: string) {
  const organizationId = personalOrganizationIdFromUserId(userId);
  const client = postgres(url!, { max: 1 });
  try {
    await clearRisk(client, organizationId);
  } catch {
    // The first clean apply has no fixture rows yet.
  } finally {
    await client.end({ timeout: 5 });
  }
  await cleanupWp13Org(url!, userId);
}

function account(
  accountId: string,
  options: { posture?: "NORMAL" | "CLOSE_ONLY"; btcBaseQuantity?: string } = {},
) {
  return {
    accountId,
    posture: options.posture ?? "NORMAL" as const,
    killState: "CLEAR" as const,
    reconciliationStatus: "RECONCILED" as const,
    realitySnapshotId: `reality-${accountId}`,
    realityContentDigestHex: hex64(`reality-${accountId}`),
    reconciliationAuthorityDigestHex: hex64(`reconciliation-${accountId}`),
    reconciledInstrumentExposures: [{
      instrumentIdentityDigestHex: hex64("BTCUSDT-SPOT"),
      symbol: "BTCUSDT",
      baseQuantity: options.btcBaseQuantity ?? "0",
    }],
    accounting: {
      reconciledExposureNotional: "0",
      worstCasePendingExposureNotional: "0",
      outstandingReservationNotional: "0",
      exposureLimitNotional: "100",
    },
  };
}

function admission(input: {
  accountId: string;
  identity: number;
  reservation: string;
}): AdmitRiskAllowanceV2Input {
  const decision = `decision-${input.accountId}-${input.identity}`;
  return {
    accountId: input.accountId,
    riskVerdictId: uuid(657_100 + input.identity * 10),
    riskAllowanceId: uuid(657_101 + input.identity * 10),
    issuanceEventId: uuid(657_102 + input.identity * 10),
    nonce: uuid(657_103 + input.identity * 10),
    validForMs: 30_000,
    verdict: {
      venue: "HTX",
      market: "SPOT",
      symbol: "BTCUSDT",
      baseAsset: "BTC",
      quoteAsset: "USDT",
      instrumentIdentityDigestHex: hex64("BTCUSDT-SPOT"),
      decision: {
        decisionId: decision,
        semanticDigestHex: hex64(`${decision}-semantic`),
        contentDigestHex: hex64(`${decision}-content`),
        action: "ENTER_LONG",
        economicSizeSetId: `${decision}-sizes`,
        economicSizeSetDigestHex: hex64(`${decision}-sizes`),
      },
      riskPolicyVersion: "risk-v2-integration",
      riskPolicyDigestHex: hex64("risk-v2-integration"),
      limitVersions: [{ layer: "L2", version: "position-v1", digestHex: hex64("position-v1") }],
      reality: {
        snapshotId: `reality-${input.accountId}`,
        contentDigestHex: hex64(`reality-${input.accountId}`),
        asOfUtc: "2026-08-21T00:00:00.000Z",
        reconciliationAuthorityDigestHex: hex64(`reconciliation-${input.accountId}`),
        reconciliationStatus: "RECONCILED",
      },
      referencePrice: {
        authorityId: "test-median",
        authorityVersion: "v1",
        contentDigestHex: hex64("test-median-v1"),
        price: divideDecimal(input.reservation, "0.001"),
      },
      verdict: "APPROVE_CLAMPED",
      approvedQualifiedQuantity: "0.001",
      bindingLayers: ["L2"],
      reasonCodes: ["POSITION_LIMIT_BINDING"],
    },
  };
}

/** Longer than the 10s lock-waiter poll, so the allowance is still open when the wait is observed. */
const LOCK_CROSSING_VALID_FOR_MS = 20_000;

function claim(input: AdmitRiskAllowanceV2Input, orderIdentity: number) {
  return {
    accountId: input.accountId,
    riskAllowanceId: input.riskAllowanceId,
    nonce: input.nonce,
    consumptionEventId: uuid(658_000 + orderIdentity * 10),
    order: {
      id: uuid(658_001 + orderIdentity * 10),
      executionMode: "paper" as const,
      symbol: input.verdict.symbol,
      side: input.verdict.decision.action === "ENTER_LONG" ? "buy" as const : "sell" as const,
      type: "market" as const,
      price: null,
      quantity: input.verdict.approvedQualifiedQuantity!,
      clientOrderId: `risk-v2-client-${orderIdentity}`,
      idempotencyKey: `risk-v2-idempotency-${orderIdentity}`,
      strategySignalId: null,
      allocationDecisionId: null,
      credentialId: null,
    },
  };
}

async function runAcrossAccountLockPastExpiry<T>(input: {
  sqlClient: postgres.Sql;
  organizationId: string;
  accountId: string;
  allowanceId: string;
  applicationName: string;
  run: (operationDb: WaiaPostgresDb) => Promise<T>;
}): Promise<T> {
  const locker = postgres(url!, { max: 1 });
  const operationClient = postgres(url!, {
    max: 1,
    connection: { application_name: input.applicationName },
  });
  const operationDb = drizzle(operationClient, { schema: pgSchema }) as WaiaPostgresDb;
  let operation: Promise<T> | undefined;
  try {
    await locker`BEGIN`;
    await locker`
      SELECT account_id FROM trader_risk_account_state_v2
      WHERE organization_id = ${input.organizationId}::uuid AND account_id = ${input.accountId}
      FOR UPDATE`;
    operation = input.run(operationDb);
    const started = Date.now();
    let waiting = false;
    while (Date.now() - started < 10_000) {
      const [row] = await input.sqlClient<{ n: number }[]>`
        select count(*)::int as n from pg_stat_activity
        where datname = current_database()
          and application_name = ${input.applicationName}
          and wait_event_type = 'Lock'`;
      if (row!.n > 0) {
        waiting = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    expect(waiting).toBe(true);
    const [stillOpen] = await input.sqlClient<{ open: boolean }[]>`
      select valid_until > clock_timestamp() as open
      from trader_risk_allowances_v2
      where id = ${input.allowanceId}::uuid`;
    expect(stillOpen!.open).toBe(true);
    await locker`
      select pg_sleep(greatest(0, extract(epoch from (
        (select valid_until from trader_risk_allowances_v2 where id = ${input.allowanceId}::uuid)
        - clock_timestamp())) + 0.05))`;
    await locker`COMMIT`;
    return await operation;
  } finally {
    await locker`ROLLBACK`.catch(() => undefined);
    await locker.end({ timeout: 5 });
    await operation?.catch(() => undefined);
    await operationClient.end({ timeout: 5 });
  }
}describe.skipIf(!enabled || !url)("Postgres Risk V2 (DEE-650 / R650-C+D)", () => {
  let sqlClient: postgres.Sql;
  let db: WaiaPostgresDb;
  let orgA: string;
  let orgB: string;

  beforeAll(async () => {
    await resetUser(USER_A);
    await resetUser(USER_B);
    orgA = await seedWp13User(url!, USER_A, "DEE-650 Risk Org A");
    orgB = await seedWp13User(url!, USER_B, "DEE-650 Risk Org B");
    sqlClient = postgres(url!, { max: 8 });
    db = drizzle(sqlClient, { schema: pgSchema }) as WaiaPostgresDb;
  }, 120_000);

  beforeEach(async () => {
    await clearRisk(sqlClient, orgA);
    await clearRisk(sqlClient, orgB);
  });

  afterAll(async () => {
    if (sqlClient) {
      await clearRisk(sqlClient, orgA);
      await clearRisk(sqlClient, orgB);
      await sqlClient.end({ timeout: 10 });
    }
    await cleanupWp13Org(url!, USER_A);
    await cleanupWp13Org(url!, USER_B);
  });

  it("atomically persists the verdict, allowance, reservation, and chained issue event", async () => {
    await initializeRiskAccountStateV2Postgres(db, { organizationId: orgA }, account("atomic"));
    const input = admission({ accountId: "atomic", identity: 1, reservation: "25" });
    const first = await admitRiskAllowanceV2Postgres(db, { organizationId: orgA }, input);
    const replay = await admitRiskAllowanceV2Postgres(db, { organizationId: orgA }, input);
    expect(first.insertedNew).toBe(true);
    expect(replay).toEqual({ ...first, insertedNew: false });
    expect(first.verdict.admissionSequence).toBe("1");
    expect(first.allowance).toMatchObject({ lifecycleState: "ISSUED", reservedExposureNotional: "25" });

    const state = await readRiskAccountStateV2Postgres(db, { organizationId: orgA }, "atomic");
    expect(state).toMatchObject({
      nextAdmissionSequence: "2",
      nextEnforcementEventSequence: "2",
      accounting: { outstandingReservationNotional: "25" },
    });
    await expect(readRiskAccountStateV2Postgres(
      db,
      { organizationId: orgB },
      "atomic",
    )).resolves.toBeNull();
  });

  it("serializes concurrent admission so the envelope cannot be over-reserved", async () => {
    await initializeRiskAccountStateV2Postgres(db, { organizationId: orgA }, account("contention"));
    const outcomes = await Promise.allSettled([
      admitRiskAllowanceV2Postgres(
        db,
        { organizationId: orgA },
        admission({ accountId: "contention", identity: 2, reservation: "60" }),
      ),
      admitRiskAllowanceV2Postgres(
        db,
        { organizationId: orgA },
        admission({ accountId: "contention", identity: 3, reservation: "60" }),
      ),
    ]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((result) => result.status === "rejected");
    expect(rejected?.status).toBe("rejected");
    if (rejected?.status === "rejected") {
      expect(rejected.reason).toBeInstanceOf(RiskV2AdmissionRefusedError);
      expect(rejected.reason.reason).toBe("RESERVATION_EXCEEDS_REMAINING_ENVELOPE");
    }
    const state = await readRiskAccountStateV2Postgres(db, { organizationId: orgA }, "contention");
    expect(state).toMatchObject({
      nextAdmissionSequence: "2",
      nextEnforcementEventSequence: "2",
      accounting: { outstandingReservationNotional: "60" },
    });
  });

  it("refuses a replay that fits only when a foreign reservation is ignored", async () => {
    await initializeRiskAccountStateV2Postgres(
      db,
      { organizationId: orgA },
      account("replay-foreign"),
    );
    const foreign = admission({ accountId: "replay-foreign", identity: 90, reservation: "30" });
    const target = admission({ accountId: "replay-foreign", identity: 91, reservation: "40" });
    await admitRiskAllowanceV2Postgres(db, { organizationId: orgA }, foreign);
    await admitRiskAllowanceV2Postgres(db, { organizationId: orgA }, target);
    await sqlClient`
      UPDATE trader_risk_account_state_v2
      SET reconciled_exposure_notional = 25,
          worst_case_pending_exposure_notional = 20
      WHERE organization_id = ${orgA}::uuid AND account_id = 'replay-foreign'`;
    await expect(
      admitRiskAllowanceV2Postgres(db, { organizationId: orgA }, target),
    ).rejects.toMatchObject({
      name: "RiskV2AdmissionRefusedError",
      reason: "RESERVATION_EXCEEDS_REMAINING_ENVELOPE",
    });
    const rows = await sqlClient<{ id: string; lifecycle_state: string }[]>`
      select id::text as id, lifecycle_state
      from trader_risk_allowances_v2
      where organization_id = ${orgA}::uuid and account_id = 'replay-foreign'
      order by id`;
    expect(rows).toEqual([
      { id: foreign.riskAllowanceId, lifecycle_state: "ISSUED" },
      { id: target.riskAllowanceId, lifecycle_state: "REVOKED" },
    ]);
    await expect(
      readRiskAccountStateV2Postgres(db, { organizationId: orgA }, "replay-foreign"),
    ).resolves.toMatchObject({
      accounting: {
        outstandingReservationNotional: "30",
        reconciledExposureNotional: "25",
        worstCasePendingExposureNotional: "20",
      },
    });
    const [event] = await sqlClient<{ event_type: string }[]>`
      select event_type from trader_risk_enforcement_events_v2
      where organization_id = ${orgA}::uuid and account_id = 'replay-foreign'
        and risk_allowance_id = ${target.riskAllowanceId}::uuid
      order by event_sequence desc limit 1`;
    expect(event!.event_type).toBe("ALLOWANCE_REVOKED");
  });

  it("replays an issued allowance without charging its own reservation twice", async () => {
    await initializeRiskAccountStateV2Postgres(
      db,
      { organizationId: orgA },
      account("replay-sixty"),
    );
    const sixty = admission({ accountId: "replay-sixty", identity: 50, reservation: "60" });
    const first = await admitRiskAllowanceV2Postgres(db, { organizationId: orgA }, sixty);
    const replay = await admitRiskAllowanceV2Postgres(db, { organizationId: orgA }, sixty);
    expect(first.insertedNew).toBe(true);
    expect(replay).toEqual({ ...first, insertedNew: false });
    expect(replay.allowance.riskAllowanceId).toBe(sixty.riskAllowanceId);
    await expect(
      readRiskAccountStateV2Postgres(db, { organizationId: orgA }, "replay-sixty"),
    ).resolves.toMatchObject({
      accounting: { outstandingReservationNotional: "60", exposureLimitNotional: "100" },
    });

    await initializeRiskAccountStateV2Postgres(
      db,
      { organizationId: orgA },
      account("replay-forties"),
    );
    const firstForty = admission({ accountId: "replay-forties", identity: 51, reservation: "40" });
    const secondForty = admission({ accountId: "replay-forties", identity: 52, reservation: "40" });
    const admittedFirst = await admitRiskAllowanceV2Postgres(
      db,
      { organizationId: orgA },
      firstForty,
    );
    const admittedSecond = await admitRiskAllowanceV2Postgres(
      db,
      { organizationId: orgA },
      secondForty,
    );
    const replayFirst = await admitRiskAllowanceV2Postgres(
      db,
      { organizationId: orgA },
      firstForty,
    );
    const replaySecond = await admitRiskAllowanceV2Postgres(
      db,
      { organizationId: orgA },
      secondForty,
    );
    expect(replayFirst).toEqual({ ...admittedFirst, insertedNew: false });
    expect(replaySecond).toEqual({ ...admittedSecond, insertedNew: false });
    await expect(
      readRiskAccountStateV2Postgres(db, { organizationId: orgA }, "replay-forties"),
    ).resolves.toMatchObject({
      accounting: { outstandingReservationNotional: "80", exposureLimitNotional: "100" },
    });
    const [count] = await sqlClient<{ n: number }[]>`
      select count(*)::int as n from trader_risk_allowances_v2
      where organization_id = ${orgA}::uuid and account_id = 'replay-forties'`;
    expect(count!.n).toBe(2);
  });

  it("releases reservations once, terminates lifecycle, and preserves the digest chain", async () => {
    await initializeRiskAccountStateV2Postgres(db, { organizationId: orgA }, account("revoke"));
    const admitted = await admitRiskAllowanceV2Postgres(
      db,
      { organizationId: orgA },
      admission({ accountId: "revoke", identity: 4, reservation: "40" }),
    );
    await expect(revokeRiskAllowanceV2Postgres(db, { organizationId: orgA }, {
      accountId: "revoke",
      riskAllowanceId: admitted.allowance.riskAllowanceId,
      eventId: uuid(657_149),
      reasonCode: "CURRENT_POSTURE_RESTRICTED",
    })).resolves.toBe(true);
    await expect(revokeRiskAllowanceV2Postgres(db, { organizationId: orgA }, {
      accountId: "revoke",
      riskAllowanceId: admitted.allowance.riskAllowanceId,
      eventId: uuid(657_150),
      reasonCode: "CURRENT_POSTURE_RESTRICTED",
    })).resolves.toBe(false);

    const state = await readRiskAccountStateV2Postgres(db, { organizationId: orgA }, "revoke");
    expect(state).toMatchObject({
      nextEnforcementEventSequence: "3",
      accounting: { outstandingReservationNotional: "0" },
    });
    const events = await sqlClient<{
      event_sequence: string;
      previous_event_digest: string | null;
      content_digest: string;
    }[]>`
      SELECT event_sequence, previous_event_digest, content_digest
      FROM trader_risk_enforcement_events_v2
      WHERE organization_id = ${orgA}::uuid AND account_id = 'revoke'
      ORDER BY event_sequence
    `;
    expect(events).toHaveLength(2);
    expect(events[0]!.previous_event_digest).toBeNull();
    expect(events[1]!.previous_event_digest).toBe(events[0]!.content_digest);
  });

  it("blocks verdict/event mutation and invalid allowance lifecycle mutation", async () => {
    await initializeRiskAccountStateV2Postgres(db, { organizationId: orgA }, account("append"));
    const admitted = await admitRiskAllowanceV2Postgres(
      db,
      { organizationId: orgA },
      admission({ accountId: "append", identity: 5, reservation: "10" }),
    );
    await expect(sqlClient`
      UPDATE trader_risk_verdicts_v2 SET content_digest = content_digest
      WHERE id = ${admitted.verdict.riskVerdictId}::uuid
    `).rejects.toThrow(/append-only/);
    await expect(sqlClient`
      DELETE FROM trader_risk_enforcement_events_v2
      WHERE risk_allowance_id = ${admitted.allowance.riskAllowanceId}::uuid
    `).rejects.toThrow(/append-only/);
    await expect(sqlClient`
      UPDATE trader_risk_allowances_v2 SET exact_qualified_quantity = 1
      WHERE id = ${admitted.allowance.riskAllowanceId}::uuid
    `).rejects.toThrow(/immutable authority fields/);
  });

  it("atomically consumes once, binds the exact order, and leaves no residual authority", async () => {
    await initializeRiskAccountStateV2Postgres(db, { organizationId: orgA }, account("claim"));
    const authority = admission({ accountId: "claim", identity: 7, reservation: "25" });
    await admitRiskAllowanceV2Postgres(db, { organizationId: orgA }, authority);
    const exactClaim = claim(authority, 1);
    const consumed = await consumeRiskAllowanceForOrderV2Postgres(
      db,
      { organizationId: orgA },
      exactClaim,
    );
    const continuation = await consumeRiskAllowanceForOrderV2Postgres(
      db,
      { organizationId: orgA },
      exactClaim,
    );
    expect(consumed).toMatchObject({ status: "CONSUMED", consumedNow: true });
    expect(continuation).toMatchObject({
      status: "CONSUMED",
      consumedNow: false,
      order: { id: exactClaim.order.id, riskAllowanceId: authority.riskAllowanceId },
    });
    if (consumed.status !== "CONSUMED" || continuation.status !== "CONSUMED") {
      throw new Error("expected consumed allowance and same-bound continuation");
    }
    expect(continuation.orderBindingDigestHex).toBe(consumed.orderBindingDigestHex);
    await sqlClient`
      UPDATE trader_risk_account_state_v2 SET posture = 'HALT'
      WHERE organization_id = ${orgA}::uuid AND account_id = 'claim'
    `;
    await expect(consumeRiskAllowanceForOrderV2Postgres(
      db,
      { organizationId: orgA },
      exactClaim,
    )).rejects.toMatchObject({ reason: "EXECUTION_FAIL_CLOSED" });
    const differentOrder = claim(authority, 2);
    await expect(consumeRiskAllowanceForOrderV2Postgres(
      db,
      { organizationId: orgA },
      differentOrder,
    )).rejects.toMatchObject({ reason: "ALLOWANCE_ALREADY_CONSUMED_BY_DIFFERENT_ORDER" });
    const state = await readRiskAccountStateV2Postgres(db, { organizationId: orgA }, "claim");
    expect(state).toMatchObject({
      accounting: {
        outstandingReservationNotional: "0",
        worstCasePendingExposureNotional: "25",
      },
      nextEnforcementEventSequence: "3",
    });
    const allowanceRows = await sqlClient<{
      lifecycle_state: string;
      bound_order_id: string;
      bound_order_digest: string;
    }[]>`
      SELECT lifecycle_state, bound_order_id, bound_order_digest
      FROM trader_risk_allowances_v2
      WHERE id = ${authority.riskAllowanceId}::uuid
    `;
    expect(allowanceRows[0]).toEqual({
      lifecycle_state: "CONSUMED",
      bound_order_id: exactClaim.order.id,
      bound_order_digest: consumed.orderBindingDigestHex,
    });
  });

  it("rechecks posture, kill, reconciliation, Reality, nonce, and exact order at claim time", async () => {
    const cases = [
      { accountId: "halted", identity: 8, set: "posture = 'HALT'", reason: "EXECUTION_FAIL_CLOSED" },
      { accountId: "killed", identity: 9, set: "kill_state = 'TRIPPED'", reason: "CURRENT_AUTHORITY_BINDING_MISMATCH" },
      { accountId: "stale", identity: 10, set: "reconciliation_status = 'STALE'", reason: "CURRENT_AUTHORITY_BINDING_MISMATCH" },
      { accountId: "reality-drift", identity: 11, set: `reality_content_digest = '${hex64("changed-reality")}'`, reason: "CURRENT_AUTHORITY_BINDING_MISMATCH" },
    ] as const;
    for (const entry of cases) {
      await initializeRiskAccountStateV2Postgres(db, { organizationId: orgA }, account(entry.accountId));
      const authority = admission({ accountId: entry.accountId, identity: entry.identity, reservation: "10" });
      await admitRiskAllowanceV2Postgres(db, { organizationId: orgA }, authority);
      await sqlClient.unsafe(
        `UPDATE trader_risk_account_state_v2 SET ${entry.set} WHERE organization_id = $1::uuid AND account_id = $2`,
        [orgA, entry.accountId],
      );
      await expect(consumeRiskAllowanceForOrderV2Postgres(
        db,
        { organizationId: orgA },
        claim(authority, entry.identity),
      )).resolves.toMatchObject({ status: "REFUSED", reason: entry.reason });
    }

    await initializeRiskAccountStateV2Postgres(db, { organizationId: orgA }, account("exact"));
    const exact = admission({ accountId: "exact", identity: 12, reservation: "10" });
    await admitRiskAllowanceV2Postgres(db, { organizationId: orgA }, exact);
    const wrongQuantity = claim(exact, 12);
    await expect(consumeRiskAllowanceForOrderV2Postgres(
      db,
      { organizationId: orgA },
      { ...wrongQuantity, order: { ...wrongQuantity.order, quantity: "0.002" } },
    )).resolves.toMatchObject({ status: "REFUSED", reason: "ORDER_DOES_NOT_MATCH_ALLOWANCE" });
    await initializeRiskAccountStateV2Postgres(db, { organizationId: orgA }, account("nonce"));
    const nonce = admission({ accountId: "nonce", identity: 13, reservation: "10" });
    await admitRiskAllowanceV2Postgres(db, { organizationId: orgA }, nonce);
    await expect(consumeRiskAllowanceForOrderV2Postgres(
      db,
      { organizationId: orgA },
      { ...claim(nonce, 13), nonce: uuid(999_999) },
    )).resolves.toMatchObject({ status: "REFUSED", reason: "ALLOWANCE_NONCE_MISMATCH" });
    const orderCount = await sqlClient<{ count: string }[]>`
      SELECT count(*)::text AS count FROM trader_orders
      WHERE organization_id = ${orgA}::uuid AND risk_allowance_id = ${exact.riskAllowanceId}::uuid
    `;
    expect(orderCount[0]!.count).toBe("0");
  });

  it("derives CLOSE_ONLY reduction proof and entry reservation from sealed current authority", async () => {
    await initializeRiskAccountStateV2Postgres(
      db,
      { organizationId: orgA },
      account("close-only", { posture: "CLOSE_ONLY", btcBaseQuantity: "0.002" }),
    );
    const reduction = admission({ accountId: "close-only", identity: 16, reservation: "25" });
    const reductionAuthority: AdmitRiskAllowanceV2Input = {
      ...reduction,
      verdict: {
        ...reduction.verdict,
        decision: { ...reduction.verdict.decision, action: "REDUCE" },
        verdict: "CLOSE_ONLY",
      },
    };
    expect(reductionAuthority).not.toHaveProperty("requestedReservationNotional");
    const admitted = await admitRiskAllowanceV2Postgres(
      db,
      { organizationId: orgA },
      reductionAuthority,
    );
    expect(admitted.allowance).toMatchObject({
      strictExposureReduction: true,
      reservedExposureNotional: "0",
    });
    await expect(consumeRiskAllowanceForOrderV2Postgres(
      db,
      { organizationId: orgA },
      claim(reductionAuthority, 16),
    )).resolves.toMatchObject({ status: "CONSUMED", consumedNow: true });

    for (const [accountId, identity, baseQuantity, quantity, action] of [
      ["close-entry", 17, "1", "0.001", "ENTER_LONG"],
      ["close-empty", 18, "0", "0.001", "REDUCE"],
      ["close-overshoot", 19, "0.0005", "0.001", "CLOSE"],
    ] as const) {
      await initializeRiskAccountStateV2Postgres(
        db,
        { organizationId: orgA },
        account(accountId, { posture: "CLOSE_ONLY", btcBaseQuantity: baseQuantity }),
      );
      const invalid = admission({ accountId, identity, reservation: "25" });
      const invalidAuthority: AdmitRiskAllowanceV2Input = {
        ...invalid,
        verdict: {
          ...invalid.verdict,
          approvedQualifiedQuantity: quantity,
          decision: { ...invalid.verdict.decision, action },
          verdict: "CLOSE_ONLY",
        },
      };
      await expect(admitRiskAllowanceV2Postgres(
        db,
        { organizationId: orgA },
        invalidAuthority,
      )).rejects.toBeInstanceOf(RiskV2AdmissionRefusedError);
    }
  });

  it("rounds a non-terminating entry reservation conservatively at scale 8", async () => {
    await initializeRiskAccountStateV2Postgres(
      db,
      { organizationId: orgA },
      account("conservative-reservation"),
    );
    const base = admission({
      accountId: "conservative-reservation",
      identity: 32,
      reservation: "25",
    });
    const authority: AdmitRiskAllowanceV2Input = {
      ...base,
      verdict: {
        ...base.verdict,
        approvedQualifiedQuantity: "0.00123456",
        referencePrice: {
          ...base.verdict.referencePrice,
          price: "25000.12345678",
        },
      },
    };

    const admitted = await admitRiskAllowanceV2Postgres(
      db,
      { organizationId: orgA },
      authority,
    );
    expect(admitted.allowance.reservedExposureNotional).toBe("30.86415242");
    await expect(readRiskAccountStateV2Postgres(
      db,
      { organizationId: orgA },
      "conservative-reservation",
    )).resolves.toMatchObject({
      accounting: { outstandingReservationNotional: "30.86415242" },
    });
  });

  it("refuses an expired consumed order that never reached first dispatch", async () => {
    await initializeRiskAccountStateV2Postgres(db, { organizationId: orgA }, account("replay-expiry"));
    const authority = {
      ...admission({ accountId: "replay-expiry", identity: 31, reservation: "25" }),
      validForMs: 2_000,
    };
    await admitRiskAllowanceV2Postgres(db, { organizationId: orgA }, authority);
    const exactClaim = claim(authority, 31);
    await expect(consumeRiskAllowanceForOrderV2Postgres(
      db,
      { organizationId: orgA },
      exactClaim,
    )).resolves.toMatchObject({ status: "CONSUMED", consumedNow: true });
    await sqlClient`SELECT pg_sleep(2.1)`;
    await expect(consumeRiskAllowanceForOrderV2Postgres(
      db,
      { organizationId: orgA },
      exactClaim,
    )).rejects.toMatchObject({ reason: "ALLOWANCE_EXPIRED" });
  });

  it("serializes competing claims so exactly one bound order consumes the allowance", async () => {
    await initializeRiskAccountStateV2Postgres(db, { organizationId: orgA }, account("claim-race"));
    const authority = admission({ accountId: "claim-race", identity: 14, reservation: "20" });
    await admitRiskAllowanceV2Postgres(db, { organizationId: orgA }, authority);
    const outcomes = await Promise.allSettled([
      consumeRiskAllowanceForOrderV2Postgres(
        db,
        { organizationId: orgA },
        claim(authority, 14),
      ),
      consumeRiskAllowanceForOrderV2Postgres(
        db,
        { organizationId: orgA },
        claim(authority, 15),
      ),
    ]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === "rejected")).toHaveLength(1);
    const rows = await sqlClient<{ order_count: string; consume_event_count: string }[]>`
      SELECT
        (SELECT count(*)::text FROM trader_orders
          WHERE organization_id = ${orgA}::uuid
            AND risk_allowance_id = ${authority.riskAllowanceId}::uuid) AS order_count,
        (SELECT count(*)::text FROM trader_risk_enforcement_events_v2
          WHERE organization_id = ${orgA}::uuid
            AND risk_allowance_id = ${authority.riskAllowanceId}::uuid
            AND event_type = 'ALLOWANCE_CONSUMED') AS consume_event_count
    `;
    expect(rows[0]).toEqual({ order_count: "1", consume_event_count: "1" });
  });

  it("enables deny RLS and proves authenticated/anon CRUD denial after temporary grants", async () => {
    await initializeRiskAccountStateV2Postgres(db, { organizationId: orgA }, account("rls"));
    await admitRiskAllowanceV2Postgres(
      db,
      { organizationId: orgA },
      admission({ accountId: "rls", identity: 6, reservation: "10" }),
    );
    const metadata = await sqlClient<{ relname: string; relrowsecurity: boolean }[]>`
      SELECT c.relname, c.relrowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY(${riskTables as unknown as string[]})
      ORDER BY c.relname
    `;
    expect(metadata).toHaveLength(4);
    expect(metadata.every((row) => row.relrowsecurity)).toBe(true);
    const policies = await sqlClient<{ tablename: string; roles: string[]; cmd: string; qual: string; with_check: string }[]>`
      SELECT tablename, roles, cmd, qual, with_check FROM pg_policies
      WHERE schemaname = 'public' AND tablename = ANY(${riskTables as unknown as string[]})
      ORDER BY tablename
    `;
    expect(policies).toHaveLength(4);
    expect(policies.every((policy) =>
      policy.cmd === "ALL" && policy.qual === "false" && policy.with_check === "false" &&
      policy.roles.includes("authenticated") && policy.roles.includes("anon")
    )).toBe(true);

    await sqlClient.unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${riskTables.join(", ")} TO authenticated, anon`);
    try {
      for (const role of ["authenticated", "anon"] as const) {
        const roleSql = postgres(url!, { max: 1 });
        try {
          await roleSql.unsafe(`SET ROLE ${role}`);
          for (const table of riskTables) {
            await expect(roleSql.unsafe(`SELECT * FROM ${table}`)).resolves.toEqual([]);
            await expect(roleSql.unsafe(`UPDATE ${table} SET organization_id = organization_id RETURNING organization_id`))
              .resolves.toEqual([]);
            await expect(roleSql.unsafe(`DELETE FROM ${table} RETURNING organization_id`))
              .resolves.toEqual([]);
          }
          await expect(roleSql.unsafe(`
            INSERT INTO trader_risk_account_state_v2 (
              organization_id, account_id, market, quote_asset, posture, kill_state,
              reconciliation_status, reality_snapshot_id, reality_content_digest,
              reconciliation_authority_digest, reconciled_instrument_exposures,
              reconciled_exposure_notional,
              worst_case_pending_exposure_notional, outstanding_reservation_notional,
              exposure_limit_notional, next_admission_sequence,
              next_enforcement_event_sequence, state_version
            ) VALUES (
              '${orgA}', '${role}-denied', 'SPOT', 'USDT', 'NORMAL', 'CLEAR',
              'RECONCILED', 'denied', '${hex64(`${role}-reality`)}',
              '${hex64(`${role}-reconciliation`)}', '[]'::jsonb,
              0, 0, 0, 1, 1, 1, 1
            )
          `)).rejects.toThrow(/row-level security/);
        } finally {
          try { await roleSql.unsafe("RESET ROLE"); } catch {}
          await roleSql.end({ timeout: 5 });
        }
      }
    } finally {
      await sqlClient.unsafe(`REVOKE SELECT, INSERT, UPDATE, DELETE ON ${riskTables.join(", ")} FROM authenticated, anon`);
    }
    const grants = await sqlClient<{ grantee: string }[]>`
      SELECT grantee FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND table_name = ANY(${riskTables as unknown as string[]})
        AND grantee IN ('authenticated', 'anon')
    `;
    expect(grants).toEqual([]);
  });

  it("refuses an allowance replay against drifted reality when the stored verdict still binds", async () => {
    await initializeRiskAccountStateV2Postgres(
      db,
      { organizationId: orgA },
      account("stored-replay"),
    );
    const input = admission({ accountId: "stored-replay", identity: 40, reservation: "10" });
    await admitRiskAllowanceV2Postgres(db, { organizationId: orgA }, input);
    const drifted = "reality-stored-replay-drift";
    await sqlClient`
      UPDATE trader_risk_account_state_v2
      SET reality_snapshot_id = ${drifted}
      WHERE organization_id = ${orgA}::uuid AND account_id = 'stored-replay'`;
    await expect(
      admitRiskAllowanceV2Postgres(
        db,
        { organizationId: orgA },
        {
          ...input,
          verdict: { ...input.verdict, reality: { ...input.verdict.reality, snapshotId: drifted } },
        },
      ),
    ).rejects.toMatchObject({ reason: "CURRENT_AUTHORITY_BINDING_MISMATCH" });
    const [count] = await sqlClient<{ n: number }[]>`
      select count(*)::int as n from trader_risk_allowances_v2
      where organization_id = ${orgA}::uuid and account_id = 'stored-replay'`;
    expect(count!.n).toBe(1);
    const [row] = await sqlClient<{ lifecycle_state: string; terminal_reason_code: string }[]>`
      select lifecycle_state, terminal_reason_code
      from trader_risk_allowances_v2
      where organization_id = ${orgA}::uuid and account_id = 'stored-replay'`;
    expect(row).toEqual({
      lifecycle_state: "REVOKED",
      terminal_reason_code: "CURRENT_AUTHORITY_BINDING_MISMATCH",
    });
    await expect(
      readRiskAccountStateV2Postgres(db, { organizationId: orgA }, "stored-replay"),
    ).resolves.toMatchObject({
      accounting: { outstandingReservationNotional: "0" },
    });
    const [event] = await sqlClient<{ event_type: string }[]>`
      select event_type from trader_risk_enforcement_events_v2
      where organization_id = ${orgA}::uuid and account_id = 'stored-replay'
      order by event_sequence desc limit 1`;
    expect(event!.event_type).toBe("ALLOWANCE_REVOKED");
    await expect(
      admitRiskAllowanceV2Postgres(db, { organizationId: orgA }, input),
    ).rejects.toBeInstanceOf(RiskV2AdmissionRefusedError);
    await expect(
      admitRiskAllowanceV2Postgres(db, { organizationId: orgA }, input),
    ).rejects.not.toBeInstanceOf(RiskV2PersistenceConflictError);
  });

  it("expires an allowance on the clock after the account lock, not the transaction start", async () => {
    await initializeRiskAccountStateV2Postgres(
      db,
      { organizationId: orgA },
      account("fresh-clock"),
    );
    const authority = {
      ...admission({ accountId: "fresh-clock", identity: 41, reservation: "10" }),
      validForMs: LOCK_CROSSING_VALID_FOR_MS,
    };
    await admitRiskAllowanceV2Postgres(db, { organizationId: orgA }, authority);
    const expired = await runAcrossAccountLockPastExpiry({
      sqlClient,
      organizationId: orgA,
      accountId: "fresh-clock",
      allowanceId: authority.riskAllowanceId,
      applicationName: "dee1135-fresh-clock",
      run: (operationDb) =>
        expireRiskAllowanceV2Postgres(
          operationDb,
          { organizationId: orgA },
          {
            accountId: "fresh-clock",
            riskAllowanceId: authority.riskAllowanceId,
            eventId: uuid(657_900),
            reasonCode: "ALLOWANCE_EXPIRED",
          },
        ),
    });
    expect(expired).toBe(true);
    const [row] = await sqlClient<{ lifecycle_state: string }[]>`
      select lifecycle_state from trader_risk_allowances_v2
      where id = ${authority.riskAllowanceId}::uuid`;
    expect(row!.lifecycle_state).toBe("EXPIRED");
  }, 60_000);

  it("terminalizes a replay refused by kill, stale reconciliation, or posture and releases the reservation", async () => {
    const cases = [
      {
        accountId: "replay-kill",
        identity: 70,
        set: "kill_state = 'TRIPPED'",
        reason: "CURRENT_AUTHORITY_BINDING_MISMATCH",
      },
      {
        accountId: "replay-stale",
        identity: 71,
        set: "reconciliation_status = 'STALE'",
        reason: "RECONCILIATION_NOT_CURRENT",
      },
      {
        accountId: "replay-halt",
        identity: 72,
        set: "posture = 'HALT'",
        reason: "POSTURE_REFUSED",
      },
    ] as const;
    for (const entry of cases) {
      await initializeRiskAccountStateV2Postgres(
        db,
        { organizationId: orgA },
        account(entry.accountId),
      );
      const authority = admission({
        accountId: entry.accountId,
        identity: entry.identity,
        reservation: "10",
      });
      await admitRiskAllowanceV2Postgres(db, { organizationId: orgA }, authority);
      await sqlClient.unsafe(
        `UPDATE trader_risk_account_state_v2 SET ${entry.set} WHERE organization_id = $1::uuid AND account_id = $2`,
        [orgA, entry.accountId],
      );
      await expect(
        admitRiskAllowanceV2Postgres(db, { organizationId: orgA }, authority),
      ).rejects.toMatchObject({ reason: entry.reason });
      const [row] = await sqlClient<
        {
          lifecycle_state: string;
          terminal_reason_code: string;
          n: number;
        }[]
      >`
        select lifecycle_state, terminal_reason_code,
          (select count(*)::int from trader_risk_allowances_v2
            where organization_id = ${orgA}::uuid and account_id = ${entry.accountId}) as n
        from trader_risk_allowances_v2
        where id = ${authority.riskAllowanceId}::uuid`;
      expect(row).toMatchObject({
        lifecycle_state: "REVOKED",
        terminal_reason_code: entry.reason,
        n: 1,
      });
      await expect(
        readRiskAccountStateV2Postgres(db, { organizationId: orgA }, entry.accountId),
      ).resolves.toMatchObject({
        accounting: { outstandingReservationNotional: "0" },
      });
    }
  });

  it("expires an issued allowance when replay is evaluated after validUntil", async () => {
    await initializeRiskAccountStateV2Postgres(
      db,
      { organizationId: orgA },
      account("replay-expired"),
    );
    const authority = {
      ...admission({ accountId: "replay-expired", identity: 80, reservation: "10" }),
      validForMs: 1_500,
    };
    await admitRiskAllowanceV2Postgres(db, { organizationId: orgA }, authority);
    await sqlClient`select pg_sleep(2)`;
    await expect(
      admitRiskAllowanceV2Postgres(db, { organizationId: orgA }, authority),
    ).rejects.toMatchObject({ reason: "ALLOWANCE_EXPIRED" });
    const [row] = await sqlClient<{ lifecycle_state: string; n: number }[]>`
      select lifecycle_state,
        (select count(*)::int from trader_risk_allowances_v2
          where organization_id = ${orgA}::uuid and account_id = 'replay-expired') as n
      from trader_risk_allowances_v2
      where id = ${authority.riskAllowanceId}::uuid`;
    expect(row).toEqual({ lifecycle_state: "EXPIRED", n: 1 });
    await expect(
      readRiskAccountStateV2Postgres(db, { organizationId: orgA }, "replay-expired"),
    ).resolves.toMatchObject({
      accounting: { outstandingReservationNotional: "0" },
    });
  });

  it("refuses consume on the clock after the account lock, not the transaction start", async () => {
    await initializeRiskAccountStateV2Postgres(
      db,
      { organizationId: orgA },
      account("consume-clock"),
    );
    const authority = {
      ...admission({ accountId: "consume-clock", identity: 81, reservation: "10" }),
      validForMs: LOCK_CROSSING_VALID_FOR_MS,
    };
    await admitRiskAllowanceV2Postgres(db, { organizationId: orgA }, authority);
    const consumed = await runAcrossAccountLockPastExpiry({
      sqlClient,
      organizationId: orgA,
      accountId: "consume-clock",
      allowanceId: authority.riskAllowanceId,
      applicationName: "dee1135-consume-clock",
      run: (operationDb) =>
        consumeRiskAllowanceForOrderV2Postgres(
          operationDb,
          { organizationId: orgA },
          claim(authority, 81),
        ),
    });
    expect(consumed).toMatchObject({ status: "REFUSED", reason: "ALLOWANCE_EXPIRED" });
    const [row] = await sqlClient<{ lifecycle_state: string; order_count: string }[]>`
      select lifecycle_state,
        (select count(*)::text from trader_orders
          where organization_id = ${orgA}::uuid
            and risk_allowance_id = ${authority.riskAllowanceId}::uuid) as order_count
      from trader_risk_allowances_v2
      where id = ${authority.riskAllowanceId}::uuid`;
    expect(row).toEqual({ lifecycle_state: "EXPIRED", order_count: "0" });
    await expect(
      readRiskAccountStateV2Postgres(db, { organizationId: orgA }, "consume-clock"),
    ).resolves.toMatchObject({
      accounting: { outstandingReservationNotional: "0" },
    });
  }, 60_000);

  it("stamps issuedAt from the clock after the account lock is released", async () => {
    await initializeRiskAccountStateV2Postgres(
      db,
      { organizationId: orgA },
      account("issue-clock"),
    );
    const authority = admission({ accountId: "issue-clock", identity: 60, reservation: "10" });
    const locker = postgres(url!, { max: 1 });
    const admitClient = postgres(url!, {
      max: 1,
      connection: { application_name: "dee1135-issue-clock" },
    });
    const admitDb = drizzle(admitClient, { schema: pgSchema }) as WaiaPostgresDb;
    let admitting: Promise<Awaited<ReturnType<typeof admitRiskAllowanceV2Postgres>>> | undefined;
    try {
      await locker`BEGIN`;
      await locker`
        SELECT account_id FROM trader_risk_account_state_v2
        WHERE organization_id = ${orgA}::uuid AND account_id = 'issue-clock'
        FOR UPDATE`;
      admitting = admitRiskAllowanceV2Postgres(admitDb, { organizationId: orgA }, authority);
      const started = Date.now();
      let waiting = false;
      while (Date.now() - started < 10_000) {
        const [row] = await sqlClient<{ n: number }[]>`
          select count(*)::int as n from pg_stat_activity
          where datname = current_database()
            and application_name = 'dee1135-issue-clock'
            and wait_event_type = 'Lock'`;
        if (row!.n > 0) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      expect(waiting).toBe(true);
      const [floor] = await locker<{ released_at: Date }[]>`
        select date_trunc('milliseconds', clock_timestamp()) as released_at`;
      const releasedAt = new Date(floor!.released_at);
      expect(Number.isFinite(releasedAt.getTime())).toBe(true);
      await locker`COMMIT`;
      const admitted = await admitting;
      expect(admitted.insertedNew).toBe(true);
      expect(new Date(admitted.allowance.issuedAtUtc).getTime()).toBeGreaterThanOrEqual(
        releasedAt.getTime(),
      );
      expect(
        new Date(admitted.allowance.validUntilUtc).getTime() -
          new Date(admitted.allowance.issuedAtUtc).getTime(),
      ).toBe(authority.validForMs);
      const [stored] = await sqlClient<{ issued_at: Date }[]>`
        select issued_at from trader_risk_allowances_v2
        where id = ${authority.riskAllowanceId}::uuid`;
      expect(new Date(stored!.issued_at).getTime()).toBeGreaterThanOrEqual(releasedAt.getTime());
    } finally {
      await locker`ROLLBACK`.catch(() => undefined);
      await locker.end({ timeout: 5 });
      await admitting?.catch(() => undefined);
      await admitClient.end({ timeout: 5 });
    }
  }, 30_000);

  it("DEE-1151 refuses admission when the live capital envelope is missing", async () => {
    await initializeRiskAccountStateV2Postgres(db, { organizationId: orgA }, account("capital-absent"));
    await sqlClient`
      delete from trader_live_capital_envelope_current_v2
      where organization_id = ${orgA}::uuid and account_id = 'capital-absent'`;
    await expect(
      admitRiskAllowanceV2Postgres(
        db,
        { organizationId: orgA },
        admission({ accountId: "capital-absent", identity: 910, reservation: "1" }),
      ),
    ).rejects.toMatchObject({ reason: "LIVE_CAPITAL_ENVELOPE_ABSENT" });
  });

  it("DEE-1151 refuses admission when loss limit is below the reservation", async () => {
    await initializeRiskAccountStateV2Postgres(db, { organizationId: orgA }, account("capital-loss"));
    await publishMirroredLiveCapitalEnvelopeV2({
      sql: sqlClient,
      organizationId: orgA,
      accountId: "capital-loss",
      exposureLimitNotional: "100",
      lossLimitNotional: "1",
    });
    await expect(
      admitRiskAllowanceV2Postgres(
        db,
        { organizationId: orgA },
        admission({ accountId: "capital-loss", identity: 911, reservation: "25" }),
      ),
    ).rejects.toMatchObject({ reason: "RESERVATION_EXCEEDS_REMAINING_ENVELOPE" });
  });

  it("DEE-1151 refuses admission when capital does not equal the exposure limit", async () => {
    await initializeRiskAccountStateV2Postgres(db, { organizationId: orgA }, account("capital-mismatch"));
    await publishMirroredLiveCapitalEnvelopeV2({
      sql: sqlClient,
      organizationId: orgA,
      accountId: "capital-mismatch",
      exposureLimitNotional: "10",
      lossLimitNotional: "10",
    });
    await expect(
      admitRiskAllowanceV2Postgres(
        db,
        { organizationId: orgA },
        admission({ accountId: "capital-mismatch", identity: 912, reservation: "1" }),
      ),
    ).rejects.toMatchObject({ reason: "LIVE_CAPITAL_LIMIT_MISMATCH" });
  });
});
