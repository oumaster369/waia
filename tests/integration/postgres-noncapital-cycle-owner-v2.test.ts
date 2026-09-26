import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { claimRuntimeControlLeaseAtDatabaseTimeV2 } from "@/lib/trader/runtime-authority/v2/runtime-control-lease-database-clock-postgres-v2";
import { commitRecordedNoncapitalCyclePostgresV2, runRecordedNoncapitalPrefixPostgresV2 } from "@/lib/trader/runtime-v2/noncapital-cycle-owner-postgres-v2";
import type { RecordedNoncapitalInputV2 } from "@/lib/trader/runtime-v2/noncapital-cycle-receipt-v2";
import { seedWp13User } from "./wp13-intelligence-test-helpers";

const url = process.env.DATABASE_URL_POSTGRES?.trim();
const enabled = process.env.WAIA_PG_INTEGRATION === "1" && !!url;
const children = new Set<ChildProcess>();
function worker(payload: Record<string, unknown>) {
  const child = spawn(process.execPath, ["--import", "tsx", "--conditions=react-server",
    "tests/helpers/noncapital-cycle-owner-process.ts"], { cwd: process.cwd(),
    env: { PATH: process.env.PATH, NODE_ENV: "test", WAIA_TRADER_CLI: "1",
      WAIA_NONCAPITAL_TEST_URL: url, WAIA_NONCAPITAL_TEST_PAYLOAD: JSON.stringify(payload) },
    stdio: ["ignore", "pipe", "pipe"] });
  children.add(child);
  let output = ""; let errors = "";
  const event = new Promise<Record<string, unknown>>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`NONCAPITAL_CHILD_TIMEOUT:${errors}`)), 15000);
    child.stdout!.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes("\n")) {
        clearTimeout(timeout);
        try { resolve(JSON.parse(output.slice(0, output.indexOf("\n")))); } catch (error) { reject(error); }
      }
    });
    child.stderr!.on("data", (chunk: Buffer) => { errors += chunk.toString(); });
    child.on("error", error => { clearTimeout(timeout); reject(error); });
    child.on("exit", code => {
      clearTimeout(timeout);
      if (!output.includes("\n")) reject(new Error(`NONCAPITAL_CHILD_EXIT:${code}:${errors}`));
    });
  });
  return { child, event };
}
async function kill(child: ChildProcess) {
  if (child.exitCode === null && child.signalCode === null) {
    const closed = once(child, "exit"); child.kill("SIGKILL"); await closed;
  }
  children.delete(child);
}

describe.skipIf(!enabled)("Postgres fenced noncapital owner process recovery", () => {
  let client: postgres.Sql; let db: WaiaPostgresDb; let organizationId: string;
  const context = () => ({ organizationId });
  const input = (): RecordedNoncapitalInputV2 => ({ organizationId, accountId: "inert-account",
    releaseSha: "e".repeat(40), bar: { symbol: "BTCUSDT", interval: "1m", open: "100", high: "102",
      low: "99", close: "101", volume: "1", barOpenTime: "2026-01-01T00:00:00.000Z",
      barCloseTime: "2026-01-01T00:01:00.000Z" } });
  const claim = async (durationMs = 30000, runtimeInstanceId = "owner") => {
    const value = await claimRuntimeControlLeaseAtDatabaseTimeV2(db, { organizationId, runtimeInstanceId, durationMs });
    expect(value).not.toBeNull(); return value!;
  };
  const count = async () => (await client`SELECT count(*)::int AS n FROM trader_runtime_noncapital_cycles_v2
    WHERE organization_id = ${organizationId}::uuid`)[0]!.n;
  async function waitForLeaseExpiry() {
    await client`SELECT pg_sleep(GREATEST(0, EXTRACT(EPOCH FROM valid_until_utc - clock_timestamp())) + 0.01)
      FROM trader_runtime_control_lease_heads_v2 WHERE organization_id = ${organizationId}::uuid`;
  }
  beforeAll(() => {
    if (!new Set(["127.0.0.1", "localhost", "::1", "[::1]"]).has(new URL(url!).hostname)) throw new Error("NONCAPITAL_TEST_REQUIRES_LOOPBACK");
    client = postgres(url!, { max: 2 }); db = drizzle(client, { schema });
  });
  beforeEach(async () => { organizationId = await seedWp13User(url!, randomUUID(), "Noncapital isolated fixture"); });
  afterAll(async () => { await Promise.all([...children].map(kill)); await client?.end({ timeout: 2 }); });

  it("has one winner among two actual processes queued at the existing organization lock", async () => {
    const gate = postgres(url!, { max: 1 });
    let released = false;
    await gate`BEGIN`;
    await gate`SELECT pg_advisory_xact_lock(hashtextextended(${organizationId}, 637))`;
    const names = [0, 1].map(n => `nc-${n}-${randomUUID()}`);
    const contenders = names.map((applicationName, n) => worker({ applicationName, operation: "claim",
      request: { organizationId, runtimeInstanceId: `process-${n}`, durationMs: 30000 } }));
    try {
      let blocked = 0;
      for (let retry = 0; retry < 500 && blocked < 2; retry++) {
        blocked = (await client`SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE application_name = ANY(${names}::text[]) AND wait_event = 'advisory'`)[0]!.n;
        if (blocked < 2) await new Promise(resolve => setTimeout(resolve, 10));
      }
      const releasedAt = (await client`SELECT clock_timestamp() AS now`)[0]!.now;
      await gate`ROLLBACK`; released = true;
      const events = await Promise.all(contenders.map(value => value.event));
      expect(blocked).toBe(2);
      const winners = events.filter(value => value.claim !== null);
      expect(winners).toHaveLength(1);
      expect(Date.parse((winners[0]!.claim as { adjudicatedAtUtc: string }).adjudicatedAtUtc)).toBeGreaterThanOrEqual(new Date(releasedAt).getTime());
      expect((await client`SELECT count(*)::int AS n FROM trader_runtime_control_lease_epoch_history_v2
        WHERE organization_id = ${organizationId}::uuid`)[0]!.n).toBe(1);
    } finally { if (!released) await gate`ROLLBACK`.catch(() => undefined); await Promise.all(contenders.map(value => kill(value.child))); await gate.end({ timeout: 2 }); }
  }, 20000);

  it("persists canonical refusal, replays after reconnect and acknowledges only ordered supplied input", async () => {
    const holder = await claim();
    const next = { ...input(), bar: { ...input().bar, barOpenTime: "2026-01-01T00:01:00.000Z", barCloseTime: "2026-01-01T00:02:00.000Z" } };
    const first = await runRecordedNoncapitalPrefixPostgresV2(db, context(), holder, [input(), next]);
    expect(first).toHaveLength(2);
    expect(first[0]!.result.reasonCodes).toContain("UNAVAILABLE:qualificationTuple");
    const other = postgres(url!, { max: 1 });
    try {
      expect(await runRecordedNoncapitalPrefixPostgresV2(drizzle(other, { schema }), context(), holder, [input(), next])).toEqual(first);
      expect((await commitRecordedNoncapitalCyclePostgresV2(db, context(), holder, input())).outcome).toBe("REPLAYED");
      await expect(runRecordedNoncapitalPrefixPostgresV2(db, context(), holder, [next, input()])).rejects.toThrow("PREFIX_INVALID");
      expect(await count()).toBe(2);
    } finally { await other.end({ timeout: 2 }); }
  });

  it("conflicts on changed full bar or release, distinguishes intervals and refuses other tenants", async () => {
    const holder = await claim(); await commitRecordedNoncapitalCyclePostgresV2(db, context(), holder, input());
    for (const changed of [{ ...input(), releaseSha: "f".repeat(40) },
      { ...input(), bar: { ...input().bar, volume: "2" } }]) {
      await expect(commitRecordedNoncapitalCyclePostgresV2(db, context(), holder, changed)).rejects.toThrow("INPUT_CONFLICT");
    }
    await commitRecordedNoncapitalCyclePostgresV2(db, context(), holder, { ...input(), bar: { ...input().bar, interval: "15m" } });
    const foreign = randomUUID();
    await expect(commitRecordedNoncapitalCyclePostgresV2(db, { organizationId: foreign }, holder, input())).rejects.toThrow("TENANT_MISMATCH");
    await expect(commitRecordedNoncapitalCyclePostgresV2(db, context(), { ...holder, organizationId: foreign }, input())).rejects.toThrow("TENANT_MISMATCH");
    expect(await count()).toBe(2);
  });

  it("denies expiry and old owner after successor, and never renews an active lease", async () => {
    const first = await claim(500);
    expect(await claimRuntimeControlLeaseAtDatabaseTimeV2(db, { organizationId, runtimeInstanceId: first.runtimeInstanceId, durationMs: 30000 })).toBeNull();
    await waitForLeaseExpiry();
    await expect(commitRecordedNoncapitalCyclePostgresV2(db, context(), first, input())).rejects.toThrow("STALE_HOLDER");
    const next = await claim();
    expect(next.leaseEpoch).toBe(2); expect(next.expectedPreviousDigest).toBe(first.leaseContentDigest);
    await expect(commitRecordedNoncapitalCyclePostgresV2(db, context(), first, input())).rejects.toThrow("STALE_HOLDER");
    await commitRecordedNoncapitalCyclePostgresV2(db, context(), next, input()); expect(await count()).toBe(1);
  });

  it("rolls back when the lease expires after staging but before an outer transaction commits", async () => {
    const holder = await claim(500);
    let staged = false;
    let failure: unknown;
    try {
      await db.transaction(async tx => {
        await commitRecordedNoncapitalCyclePostgresV2(tx, context(), holder, input());
        staged = true;
        await tx.execute(sql`SELECT pg_sleep(0.6)`);
      });
    } catch (error) { failure = error; }
    expect(failure).toBeDefined();
    let cause = failure as { message?: string; cause?: unknown };
    while (cause.cause) cause = cause.cause as typeof cause;
    expect(cause.message).toContain("RUNTIME_CONTROL_LEASE_STALE_HOLDER");
    expect(staged).toBe(true);
    expect(await count()).toBe(0);
  });

  it("kills a real process before commit, observes rollback, and recovers under successor epoch", async () => {
    const holder = await claim(4000);
    const child = worker({ applicationName: `nc-stage-${randomUUID()}`, operation: "stage", context: context(), holder, input: input() });
    try { expect((await child.event).event).toBe("staged"); expect(await count()).toBe(0); }
    finally { await kill(child.child); }
    expect(await count()).toBe(0);
    await waitForLeaseExpiry(); const next = await claim();
    expect((await commitRecordedNoncapitalCyclePostgresV2(db, context(), next, input())).outcome).toBe("COMMITTED");
    expect(await count()).toBe(1);
  }, 15000);

  it("kills a real process after commit but before acknowledgement and recovers exactly one receipt", async () => {
    const holder = await claim();
    const child = worker({ applicationName: `nc-done-${randomUUID()}`, operation: "commit-hold", context: context(), holder, input: input() });
    try { expect((await child.event).event).toBe("committed"); expect(await count()).toBe(1); }
    finally { await kill(child.child); }
    const result = await commitRecordedNoncapitalCyclePostgresV2(db, context(), holder, input());
    expect(result.outcome).toBe("REPLAYED"); expect(await count()).toBe(1);
  }, 15000);

  it("enforces append-only and actual browser-role denial", async () => {
    const holder = await claim(); await commitRecordedNoncapitalCyclePostgresV2(db, context(), holder, input());
    await expect(client`UPDATE trader_runtime_noncapital_cycles_v2 SET account_id = 'forged'
      WHERE organization_id = ${organizationId}::uuid`).rejects.toThrow("APPEND_ONLY");
    await expect(client`DELETE FROM trader_runtime_noncapital_cycles_v2 WHERE organization_id = ${organizationId}::uuid`).rejects.toThrow("APPEND_ONLY");
    const row = (await client`SELECT * FROM trader_runtime_noncapital_cycles_v2
      WHERE organization_id = ${organizationId}::uuid`)[0]!;
    for (const role of ["anon", "authenticated"]) {
      const rollback = new Error("ROLL_BACK_TEST_GRANTS");
      await expect(client.begin(async tx => {
        // Transaction-local grant proves deny RLS itself, then rolls the grant back.
        await tx.unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON trader_runtime_noncapital_cycles_v2 TO ${role}`);
        await tx.unsafe(`SET LOCAL ROLE ${role}`);
        expect(await tx`SELECT * FROM trader_runtime_noncapital_cycles_v2 WHERE organization_id = ${organizationId}::uuid`).toHaveLength(0);
        expect((await tx`UPDATE trader_runtime_noncapital_cycles_v2 SET account_id = 'forged'
          WHERE organization_id = ${organizationId}::uuid RETURNING account_id`).length).toBe(0);
        expect((await tx`DELETE FROM trader_runtime_noncapital_cycles_v2
          WHERE organization_id = ${organizationId}::uuid RETURNING account_id`).length).toBe(0);
        await expect(tx.savepoint(async nested => {
          await nested`INSERT INTO trader_runtime_noncapital_cycles_v2
            (organization_id, account_id, symbol, bar_interval, pit_anchor, input_digest, content_digest,
             canonical_json, runtime_instance_id, lease_epoch, lease_content_digest, recorded_at_utc)
            VALUES (${organizationId}::uuid, 'other-account', ${row.symbol}, ${row.bar_interval},
              ${row.pit_anchor}, ${row.input_digest}, ${row.content_digest}, ${row.canonical_json},
              ${row.runtime_instance_id}, ${row.lease_epoch}, ${row.lease_content_digest}, ${row.recorded_at_utc})`;
        })).rejects.toMatchObject({ code: "42501" });
        await tx.unsafe("RESET ROLE");
        throw rollback;
      })).rejects.toBe(rollback);
    }
    expect(await count()).toBe(1);
  });
});
