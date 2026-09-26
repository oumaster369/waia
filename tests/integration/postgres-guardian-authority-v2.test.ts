import { createHash, randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import * as schema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import {
  buildGuardianAssessmentV2,
  buildProtectiveMandateConsumptionV2,
  createPostgresGuardianAssessmentRepositoryV2,
  createPostgresProtectiveMandateConsumptionRepositoryV2,
} from "@/lib/trader/guardian/v2";
import { createPostgresLifecycleRepository } from "@/lib/trader/lifecycle/lifecycle-repository-postgres";
import { TRADE_LIFECYCLE_SEMANTICS_VERSION_V2 } from "@/lib/trader/lifecycle";
import { seedWp13User } from "./wp13-intelligence-test-helpers";

const url = process.env.DATABASE_URL_POSTGRES?.trim();
const enabled = process.env.WAIA_PG_INTEGRATION === "1" && !!url;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const AT = "2026-08-30T03:00:00.000Z";

function nativeCause(error: unknown): { code?: string; constraint_name?: string } {
  let value = error as { code?: string; constraint_name?: string; cause?: unknown };
  while (value.cause) value = value.cause as typeof value;
  return value;
}

describe.skipIf(!enabled)("Postgres Guardian assessment and one-use protective authority", () => {
  let client: postgres.Sql;
  let db: WaiaPostgresDb;
  let fixture: { organizationId: string; tradeId: string; lotId: string };
  const context = () => ({ organizationId: fixture.organizationId });
  const assessments = () => createPostgresGuardianAssessmentRepositoryV2(db);
  const consumptions = () => createPostgresProtectiveMandateConsumptionRepositoryV2(db);

  beforeAll(() => {
    if (!new Set(["localhost", "127.0.0.1", "::1", "[::1]"]).has(new URL(url!).hostname)) {
      throw new Error("GUARDIAN_TEST_REQUIRES_LOOPBACK_POSTGRES");
    }
    client = postgres(url!, { max: 2 });
    db = drizzle(client, { schema });
  });
  beforeEach(async () => { fixture = await seed(); });
  afterAll(async () => { await client?.end({ timeout: 5 }); });

  async function seed() {
    const organizationId = await seedWp13User(url!, randomUUID(), "Guardian native test");
    const tradeId = randomUUID(), lotId = randomUUID();
    const lifecycle = createPostgresLifecycleRepository(db);
    const openedAt = new Date(AT);
    await lifecycle.insertTrade({ organizationId }, { trade: {
      id: tradeId, organizationId, symbol: "BTCUSDT", venue: "HTX", accountKey: "synthetic-account",
      positionSide: "LONG", instrumentKind: "SPOT", strategySignalId: "synthetic-signal",
      strategyId: "synthetic-strategy", strategyVersion: "v1", state: "OPEN",
      semanticsVersion: TRADE_LIFECYCLE_SEMANTICS_VERSION_V2, openedAt, closedAt: null,
      realizedPnl: "0", markedPnl: "0", hypothesisId: null, patternId: null,
      riskDecisionId: "synthetic-risk", allocationDecisionId: null, reasoningSessionId: null,
      signalConfidence: null, openingRegime: null, openingMsvId: null, openingFeatureSetId: null,
      closingMsvId: null, closingFeatureSetId: null, closingRegime: null, frozenAt: null,
    } });
    await lifecycle.insertPositionLot({ organizationId }, { lot: {
      id: lotId, organizationId, symbol: "BTCUSDT", venue: "HTX", accountKey: "synthetic-account",
      positionSide: "LONG", instrumentKind: "SPOT", strategySignalId: "synthetic-signal", state: "OPEN",
      openQty: "1", remainingQty: "0.5", avgCost: "60000", openedAt, closedAt: null,
      tradeId, hedgeGroupId: null, targetLotId: null,
    } });
    return { organizationId, tradeId, lotId };
  }

  function assessment(binding = fixture) {
    return buildGuardianAssessmentV2({
      organizationId: binding.organizationId, positionId: binding.tradeId, lotId: binding.lotId,
      symbol: "BTCUSDT", openingCausalLineageDigest: digest("synthetic-lineage"),
      realityFrontierId: "synthetic-reality", realityContentDigest: digest("synthetic-reality"),
      qualifiedEvidenceBundleId: "synthetic-evidence", qualifiedEvidenceContentDigest: digest("synthetic-evidence"),
      informationSufficiencyProfile: "OPEN_POSITION_REASSESSMENT", openPositionSufficiency: "SUFFICIENT",
      newOpportunitySufficiency: "INSUFFICIENT", recommendation: "HOLD", targetReductionBps: 0,
      reasonCodes: ["THESIS_INTACT"],
    });
  }
  function consumption(trigger = "synthetic-trigger", organizationId = fixture.organizationId) {
    return buildProtectiveMandateConsumptionV2({
      organizationId, mandateId: "synthetic-mandate", mandateContentDigest: digest("synthetic-mandate"),
      triggerProofContentDigest: digest(trigger), adjudicatedAtUtc: AT,
    });
  }

  it("replays assessment bytes after reconnect and isolates reads and writes by tenant", async () => {
    const value = assessment();
    await assessments().append(context(), value);
    const connection = postgres(url!, { max: 1 });
    try {
      const read = createPostgresGuardianAssessmentRepositoryV2(drizzle(connection, { schema }));
      expect(await read.append(context(), JSON.parse(JSON.stringify(value)))).toEqual(value);
      expect(await read.getById(context(), value.assessmentId)).toEqual(value);
      expect(await read.listByLot(context(), fixture.lotId)).toEqual([value]);
      const other = await seed();
      const foreign = { organizationId: other.organizationId };
      expect(await read.getById(foreign, value.assessmentId)).toBeNull();
      expect(await read.listByLot(foreign, fixture.lotId)).toEqual([]);
      await expect(read.append(foreign, value)).rejects.toThrow("GUARDIAN_ASSESSMENT_TENANT_MISMATCH");
    } finally { await connection.end({ timeout: 5 }); }
  });

  it("converges assessment replays from eight independent connections to one row", async () => {
    const connections = Array.from({ length: 8 }, () => postgres(url!, { max: 1 }));
    try {
      const pids = await Promise.all(connections.map(async connection => (await connection`SELECT pg_backend_pid() AS pid`)[0]!.pid));
      expect(new Set(pids).size).toBe(8);
      const value = assessment();
      const results = await Promise.all(connections.map(connection =>
        createPostgresGuardianAssessmentRepositoryV2(drizzle(connection, { schema })).append(context(), value)));
      expect(results).toEqual(Array.from({ length: 8 }, () => value));
      expect(await assessments().listByLot(context(), fixture.lotId)).toEqual([value]);
    } finally { await Promise.all(connections.map(connection => connection.end({ timeout: 5 }))); }
  });

  it.each(["trade", "lot"] as const)("rejects a foreign %s through the native scoped foreign key", async kind => {
    const other = await seed();
    const value = assessment({ ...fixture, ...(kind === "trade" ? { tradeId: other.tradeId } : { lotId: other.lotId }) });
    const error = await assessments().append(context(), value).then(() => null, caught => caught);
    expect(error).not.toBeNull();
    expect(nativeCause(error)).toMatchObject({ code: "23503", constraint_name: `trader_guardian_assessments_v2_${kind}_scope_fk` });
    expect(await assessments().listByLot(context(), fixture.lotId)).toEqual([]);
  });

  it("enforces assessment and consumption append-only triggers without removing them", async () => {
    await assessments().append(context(), assessment());
    await consumptions().claimOnce(consumption());
    for (const table of ["trader_guardian_assessments_v2", "trader_guardian_protective_consumptions_v2"]) {
      for (const operation of ["UPDATE", "DELETE"]) {
        const query = operation === "UPDATE" ? `UPDATE ${table} SET created_at = created_at WHERE organization_id = $1::uuid` : `DELETE FROM ${table} WHERE organization_id = $1::uuid`;
        await expect(client.unsafe(query, [fixture.organizationId])).rejects.toThrow("append-only");
      }
    }
    expect(await assessments().listByLot(context(), fixture.lotId)).toHaveLength(1);
    expect(await consumptions().claimOnce(consumption())).toBe("ALREADY_CONSUMED");
  });

  it("admits exactly one mandate claim under observed eight-connection contention", async () => {
    const gate = postgres(url!, { max: 1 });
    const connections = Array.from({ length: 8 }, () => postgres(url!, { max: 1 }));
    let pending: Promise<string[]> | undefined;
    let released = false;
    try {
      const pids = await Promise.all(connections.map(async connection => (await connection`SELECT pg_backend_pid() AS pid`)[0]!.pid));
      expect(new Set(pids).size).toBe(8);
      await gate`BEGIN`;
      await gate`SET LOCAL idle_in_transaction_session_timeout = '10s'`;
      await createPostgresProtectiveMandateConsumptionRepositoryV2(drizzle(gate, { schema })).claimOnce(consumption("gate-rolled-back"));
      // Every contender has different content bytes but the same org/mandate key.
      pending = Promise.all(connections.map((connection, index) =>
        createPostgresProtectiveMandateConsumptionRepositoryV2(drizzle(connection, { schema })).claimOnce(consumption(`trigger-${index}`))));
      let blocked = 0;
      try {
        for (let attempt = 0; attempt < 200; attempt++) {
          const rows = await client`SELECT count(*)::int AS count FROM pg_stat_activity
            WHERE pid = ANY(${pids}::int[]) AND wait_event_type = 'Lock' AND wait_event = 'transactionid'`;
          blocked = rows[0]!.count;
          if (blocked === 8) break;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      } finally { await gate`ROLLBACK`; released = true; }
      const outcomes = await pending;
      expect(blocked).toBe(8);
      expect(outcomes.filter(outcome => outcome === "CLAIMED")).toHaveLength(1);
      expect(outcomes.filter(outcome => outcome === "ALREADY_CONSUMED")).toHaveLength(7);
      const stored = await client`SELECT trigger_proof_content_digest FROM trader_guardian_protective_consumptions_v2
        WHERE organization_id = ${fixture.organizationId}::uuid AND mandate_id = 'synthetic-mandate'`;
      expect(stored).toHaveLength(1);
      expect(stored[0]!.trigger_proof_content_digest).toBe(digest(`trigger-${outcomes.indexOf("CLAIMED")}`));
    } finally {
      if (!released) await gate`ROLLBACK`.catch(() => undefined);
      if (pending) await pending.catch(() => undefined);
      await Promise.all([...connections, gate].map(connection => connection.end({ timeout: 5 })));
    }
  });

  it("retains consumption across reconnect and changed trigger/time without blocking another tenant", async () => {
    const first = consumption();
    expect(await consumptions().claimOnce(first)).toBe("CLAIMED");
    const connection = postgres(url!, { max: 1 });
    try {
      const repository = createPostgresProtectiveMandateConsumptionRepositoryV2(drizzle(connection, { schema }));
      expect(await repository.claimOnce(first)).toBe("ALREADY_CONSUMED");
      const changed = buildProtectiveMandateConsumptionV2({
        organizationId: first.organizationId, mandateId: first.mandateId,
        mandateContentDigest: first.mandateContentDigest,
        triggerProofContentDigest: digest("changed-trigger"), adjudicatedAtUtc: "2026-08-30T03:01:00.000Z",
      });
      expect(await repository.claimOnce(changed)).toBe("ALREADY_CONSUMED");
      const other = await seed();
      expect(await repository.claimOnce(consumption("synthetic-trigger", other.organizationId))).toBe("CLAIMED");
    } finally { await connection.end({ timeout: 5 }); }
  });

  it("rolls back an uncommitted claim and allows its first durable consumption", async () => {
    const value = consumption();
    await expect(db.transaction(async tx => {
      expect(await createPostgresProtectiveMandateConsumptionRepositoryV2(tx).claimOnce(value)).toBe("CLAIMED");
      throw new Error("SIMULATED_PRECOMMIT_FAILURE");
    })).rejects.toThrow("SIMULATED_PRECOMMIT_FAILURE");
    expect(await consumptions().claimOnce(value)).toBe("CLAIMED");
    expect(await consumptions().claimOnce(value)).toBe("ALREADY_CONSUMED");
  });
});
