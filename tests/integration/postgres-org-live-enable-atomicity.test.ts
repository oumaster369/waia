import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { assertOrgLiveEnabled } from "@/lib/trader/live/assert-org-live-enabled";
import { handleAdminOrgLiveEnableCommandPost } from "@/lib/trader/live/admin-route-handler";
import { REQUIRED_ORG_LIVE_ENABLE_ACK } from "@/lib/trader/live/config";
import { createPostgresOrgLiveEnableService } from "@/lib/trader/live/org-live-enable-service";
import { listOrgLiveEnableEventsPostgres } from "@/lib/trader/live/repository-postgres";
import { verifyOrgLiveEnableEventDigest } from "@/lib/trader/live/serialize-org-live-enable";
import type { OrgLiveEnableView } from "@/lib/trader/live/types";

const url = process.env.DATABASE_URL_POSTGRES?.trim();
const enabled = process.env.WAIA_PG_INTEGRATION === "1" && !!url;
const actor = { actorType: "admin" as const, actorId: "dee1115-synthetic-operator" };
const transitions = ["requestEnable", "confirmEnable", "markEnabled", "disable", "cancel"] as const;
type Transition = (typeof transitions)[number];
const tables = [
  "trader_org_live_enable_events",
  "trader_org_live_enable",
  "audit_logs",
  "trader_admin_change_log",
] as const;
type FaultTable = (typeof tables)[number];
const faultName = "dee1115_test_fault";
let client: postgres.Sql;
let observer: postgres.Sql;
let database: WaiaPostgresDb;
let now: number;
const service = (db = database) => createPostgresOrgLiveEnableService(db, { nowMs: () => now });

async function seed() {
  const userId = randomUUID();
  const organizationId = randomUUID();
  await client`INSERT INTO auth.users (id) VALUES (${userId}::uuid)`;
  await database
    .insert(schema.users)
    .values({ id: userId, identityLabel: "DEE1115 synthetic", email: `${userId}@waia.invalid` });
  await database
    .insert(schema.organizations)
    .values({
      id: organizationId,
      ownerUserId: userId,
      kind: "personal",
      name: "DEE1115 synthetic",
    });
  return { organizationId, userId };
}

async function snapshot(organizationId: string) {
  return {
    state:
      await observer`SELECT * FROM trader_org_live_enable WHERE organization_id=${organizationId}::uuid`,
    events:
      await observer`SELECT * FROM trader_org_live_enable_events WHERE organization_id=${organizationId}::uuid ORDER BY seq`,
    audits:
      await observer`SELECT * FROM audit_logs WHERE organization_id=${organizationId}::uuid ORDER BY id`,
    changes:
      await observer`SELECT * FROM trader_admin_change_log WHERE organization_id=${organizationId}::uuid AND source_table='trader_org_live_enable' ORDER BY entity_version`,
  };
}

async function prepare(transition: Transition) {
  now = Date.parse("2026-01-01T00:00:00Z");
  const { organizationId } = await seed();
  const context = { organizationId };
  const ready = service();
  let state: OrgLiveEnableView | null = null;
  if (transition !== "requestEnable")
    state = await ready.requestEnable(actor, context, { maxNotionalCap: "100.00" });
  if (transition === "markEnabled" || transition === "disable") {
    state = await ready.confirmEnable(actor, context, {
      expectedStateVersion: state!.stateVersion,
      ackPhrase: REQUIRED_ORG_LIVE_ENABLE_ACK,
    });
    now = state.coolingOffEndsAt!.getTime();
  }
  if (transition === "disable")
    state = await ready.markEnabled(actor, context, { expectedStateVersion: state!.stateVersion });
  const invoke = (db = database) => {
    const target = service(db);
    if (transition === "requestEnable")
      return target.requestEnable(actor, context, { maxNotionalCap: "100.00" });
    if (transition === "confirmEnable")
      return target.confirmEnable(actor, context, {
        expectedStateVersion: state!.stateVersion,
        ackPhrase: REQUIRED_ORG_LIVE_ENABLE_ACK,
      });
    return target[transition](actor, context, {
      expectedStateVersion: state!.stateVersion,
      reason: "synthetic drill",
    });
  };
  return { context, state, invoke };
}

async function clearFault() {
  for (const table of tables)
    await client.unsafe(`DROP TRIGGER IF EXISTS ${faultName} ON public.${table}`);
  await client.unsafe(`DROP FUNCTION IF EXISTS public.${faultName}()`);
}

async function injectFault(table: FaultTable, timing: "BEFORE" | "AFTER", organizationId: string) {
  // Both identifiers and UUID come from this loopback-only fixture; never disable protective triggers.
  if (!/^[0-9a-f-]{36}$/.test(organizationId)) throw new Error("INVALID_FIXTURE_UUID");
  await client.unsafe(`CREATE FUNCTION public.${faultName}() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.organization_id = '${organizationId}'::uuid THEN RAISE EXCEPTION 'DEE1115_INJECTED_FAILURE'; END IF;
      RETURN NEW;
    END; $$`);
  await client.unsafe(`CREATE TRIGGER ${faultName} ${timing} INSERT OR UPDATE ON public.${table}
    FOR EACH ROW EXECUTE FUNCTION public.${faultName}()`);
}

async function expectInjectedFailure(invoke: () => Promise<unknown>) {
  let caught: unknown;
  try {
    await invoke();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeDefined();
  let cause = caught as Error & { cause?: unknown };
  while (cause.cause) cause = cause.cause as typeof cause;
  expect(cause.message).toContain("DEE1115_INJECTED_FAILURE");
}

async function contend(
  organizationId: string,
  calls: ((db: WaiaPostgresDb) => Promise<OrgLiveEnableView>)[],
  whileBlocked?: () => Promise<void>,
) {
  const blocker = postgres(url!, { max: 1 });
  const connections = calls.map(() => postgres(url!, { max: 1, prepare: false }));
  let released = false;
  let pending: Promise<PromiseSettledResult<OrgLiveEnableView>[]> | undefined;
  try {
    const pids = await Promise.all(
      connections.map(async (connection) => {
        // An implicit session default must not leave stale snapshots after waiting for the org mutex.
        await connection`SET default_transaction_isolation = 'repeatable read'`;
        return (await connection`SELECT pg_backend_pid() AS pid`)[0]!.pid as number;
      }),
    );
    expect(new Set(pids).size).toBe(calls.length);
    await blocker`BEGIN`;
    await blocker`SELECT id FROM organizations WHERE id=${organizationId}::uuid FOR UPDATE`;
    pending = Promise.allSettled(
      calls.map((call, index) => call(drizzle(connections[index]!, { schema }))),
    );
    let waiting = 0;
    for (let attempt = 0; attempt < 200; attempt++) {
      const rows = await observer`SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE pid = ANY(${pids}::int[]) AND wait_event_type='Lock'`;
      waiting = rows[0]!.n;
      if (waiting === calls.length) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(waiting, "all native connections must block on the existing org row").toBe(calls.length);
    if (whileBlocked) await whileBlocked();
    await blocker`ROLLBACK`;
    released = true;
    return await pending;
  } finally {
    if (!released) await blocker`ROLLBACK`.catch(() => undefined);
    if (pending) await pending.catch(() => undefined);
    await Promise.all(
      [...connections, blocker].map((connection) => connection.end({ timeout: 5 })),
    );
  }
}

describe.skipIf(!enabled)("DEE-1115 native PG org live permission atomicity", () => {
  beforeAll(async () => {
    if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(new URL(url!).hostname))
      throw new Error("LIVE_PERMISSION_PROOF_REQUIRES_LOOPBACK");
    client = postgres(url!, { max: 1, prepare: false, onnotice: () => undefined });
    observer = postgres(url!, { max: 1, prepare: false });
    database = drizzle(client, { schema });
    // Preserve the real configured cooling delay; advance only the injected service clock.
    vi.stubEnv("TRADER_ORG_LIVE_ENABLE_COOLING_OFF_MS", "");
  });
  afterEach(async () => {
    await clearFault();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await Promise.all([client?.end({ timeout: 5 }), observer?.end({ timeout: 5 })]);
    // Append-only fixture evidence stays in the disposable database.
  });

  for (const transition of transitions) {
    for (const table of tables.slice(0, 3)) {
      for (const timing of ["BEFORE", "AFTER"] as const) {
        it(`${transition}: ${timing} ${table} failure rolls back every effect and retries once`, async () => {
          const fixture = await prepare(transition);
          const before = await snapshot(fixture.context.organizationId);
          await injectFault(table, timing, fixture.context.organizationId);
          await expectInjectedFailure(fixture.invoke);
          expect(await snapshot(fixture.context.organizationId)).toEqual(before);
          // A failed disable preserves legitimate previous ENABLED authority. A failed enable cannot grant it.
          if (transition === "disable")
            await expect(assertOrgLiveEnabled(service(), fixture.context)).resolves.toBeUndefined();
          else
            await expect(assertOrgLiveEnabled(service(), fixture.context)).rejects.toMatchObject({
              code: "ORG_LIVE_ENABLE_REQUIRED",
            });
          await clearFault();
          const result = await fixture.invoke();
          expect(result.stateVersion).toBe((fixture.state?.stateVersion ?? 0) + 1);
          const after = await snapshot(fixture.context.organizationId);
          expect(after.events).toHaveLength(before.events.length + 1);
          expect(after.audits).toHaveLength(before.audits.length + 1);
          expect(after.changes).toHaveLength(before.changes.length + 1);
          const events = await listOrgLiveEnableEventsPostgres(database, fixture.context);
          for (let index = 0; index < events.length; index++) {
            verifyOrgLiveEnableEventDigest(events[index]!);
            expect(events[index]!.prevEventDigest).toBe(
              events[index - 1]?.recordContentDigest ?? null,
            );
            expect(events[index]!.seq).toBe(index + 1);
          }
          expect(result.lastEventDigest).toBe(events.at(-1)!.recordContentDigest);
          await expect(fixture.invoke()).rejects.toThrow();
          expect(await snapshot(fixture.context.organizationId)).toEqual(after);
        });
      }
    }
    it(`${transition}: native change-log trigger failure rolls back event, state and Core audit`, async () => {
      const fixture = await prepare(transition);
      const before = await snapshot(fixture.context.organizationId);
      await injectFault("trader_admin_change_log", "AFTER", fixture.context.organizationId);
      await expectInjectedFailure(fixture.invoke);
      expect(await snapshot(fixture.context.organizationId)).toEqual(before);
      await clearFault();
      await fixture.invoke();
      const after = await snapshot(fixture.context.organizationId);
      expect(after.events).toHaveLength(before.events.length + 1);
      expect(after.changes).toHaveLength(before.changes.length + 1);
      expect(after.audits).toHaveLength(before.audits.length + 1);
    });
  }

  for (const transition of transitions) {
    it(`${transition}: two blocked native connections produce one transition, refreshed refusal and one audit`, async () => {
      const fixture = await prepare(transition);
      const before = await snapshot(fixture.context.organizationId);
      const results = await contend(fixture.context.organizationId, [
        fixture.invoke,
        fixture.invoke,
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const refused = results.filter((result) => result.status === "rejected");
      expect(refused).toHaveLength(1);
      const codes = {
        requestEnable: "ORG_LIVE_ENABLE_IN_PROGRESS",
        confirmEnable: "ORG_LIVE_ENABLE_CONFIRM_NOT_ALLOWED",
        markEnabled: "ORG_LIVE_ENABLE_MARK_ENABLED_NOT_ALLOWED",
        disable: "ORG_LIVE_ENABLE_DISABLE_NOT_ALLOWED",
        cancel: "ORG_LIVE_ENABLE_CANCEL_NOT_ALLOWED",
      };
      expect((refused[0] as PromiseRejectedResult).reason).toMatchObject({
        code: codes[transition],
      });
      const after = await snapshot(fixture.context.organizationId);
      expect(after.events).toHaveLength(before.events.length + 1);
      expect(after.audits).toHaveLength(before.audits.length + 1);
      expect(after.changes).toHaveLength(before.changes.length + 1);
      expect(await service().getState(fixture.context)).toMatchObject({
        stateVersion: (fixture.state?.stateVersion ?? 0) + 1,
      });
    });
  }

  it("conflicting confirmation/cancellation respects the caller revision after waiting", async () => {
    const fixture = await prepare("confirmEnable");
    const before = await snapshot(fixture.context.organizationId);
    const results = await contend(fixture.context.organizationId, [
      fixture.invoke,
      (db) => service(db).cancel(actor, fixture.context, { expectedStateVersion: 1 }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const loser = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect([
      "ORG_LIVE_ENABLE_STATE_VERSION_MISMATCH",
      "ORG_LIVE_ENABLE_CONFIRM_NOT_ALLOWED",
    ]).toContain(loser.reason.code);
    const after = await snapshot(fixture.context.organizationId);
    expect(after.events).toHaveLength(before.events.length + 1);
    expect(after.audits).toHaveLength(before.audits.length + 1);
    expect(after.changes).toHaveLength(before.changes.length + 1);
  });

  it("captures scope, actor and inputs before the wait; another organization proceeds independently", async () => {
    const fixture = await prepare("requestEnable");
    const other = await seed();
    const original = fixture.context.organizationId;
    const mutableContext = { organizationId: original };
    const mutableActor = { ...actor };
    const mutableInput = { maxNotionalCap: "100.00" };
    const results = await contend(
      original,
      [(db) => service(db).requestEnable(mutableActor, mutableContext, mutableInput)],
      async () => {
        mutableContext.organizationId = other.organizationId;
        mutableActor.actorId = "mutated-caller";
        mutableInput.maxNotionalCap = "900";
        const second = await service().requestEnable(actor, other, { maxNotionalCap: "7" });
        expect(second.organizationId).toBe(other.organizationId);
        expect(await service().getState({ organizationId: original })).toBeNull();
      },
    );
    expect(results[0]!.status).toBe("fulfilled");
    const saved = await snapshot(original);
    expect(saved.state[0]).toMatchObject({ organization_id: original, max_notional_cap: "100.00" });
    expect(saved.events[0]).toMatchObject({ actor_id: actor.actorId, max_notional_cap: "100.00" });
    expect(saved.audits[0]).toMatchObject({ actor_id: actor.actorId, organization_id: original });
    expect(await service().getState(other)).toMatchObject({ maxNotionalCap: "7", stateVersion: 1 });
  });

  it("preserves acknowledgement, cooling, stale revision, cap and tenant refusals without effects", async () => {
    const fixture = await prepare("confirmEnable");
    const before = await snapshot(fixture.context.organizationId);
    await expect(
      service().confirmEnable(actor, fixture.context, {
        expectedStateVersion: 1,
        ackPhrase: "wrong",
      }),
    ).rejects.toMatchObject({ code: "ORG_LIVE_ENABLE_ACK_REQUIRED" });
    await expect(
      service().confirmEnable(actor, fixture.context, {
        expectedStateVersion: 0,
        ackPhrase: REQUIRED_ORG_LIVE_ENABLE_ACK,
      }),
    ).rejects.toMatchObject({ code: "ORG_LIVE_ENABLE_STATE_VERSION_MISMATCH" });
    expect(await snapshot(fixture.context.organizationId)).toEqual(before);
    const confirmed = await fixture.invoke();
    expect(confirmed.coolingOffEndsAt!.getTime() - now).toBe(900_000);
    const cooling = await snapshot(fixture.context.organizationId);
    await expect(
      service().markEnabled(actor, fixture.context, { expectedStateVersion: 2 }),
    ).rejects.toMatchObject({ code: "ORG_LIVE_ENABLE_COOLING_OFF_NOT_ELAPSED" });
    now = confirmed.coolingOffEndsAt!.getTime();
    await expect(
      service().markEnabled(actor, fixture.context, { expectedStateVersion: 1 }),
    ).rejects.toMatchObject({ code: "ORG_LIVE_ENABLE_STATE_VERSION_MISMATCH" });
    await expect(
      service().cancel(actor, fixture.context, { expectedStateVersion: 1 }),
    ).rejects.toMatchObject({ code: "ORG_LIVE_ENABLE_STATE_VERSION_MISMATCH" });
    expect(await snapshot(fixture.context.organizationId)).toEqual(cooling);
    const other = await seed();
    await expect(
      service().requestEnable(actor, other, { maxNotionalCap: "0" }),
    ).rejects.toMatchObject({ code: "ORG_LIVE_ENABLE_CAP_INVALID" });
    await expect(
      service().confirmEnable(actor, other, {
        expectedStateVersion: 2,
        ackPhrase: REQUIRED_ORG_LIVE_ENABLE_ACK,
      }),
    ).rejects.toMatchObject({ code: "ORG_LIVE_ENABLE_CONFIRM_NOT_ALLOWED" });
    expect(await service().getState(other)).toBeNull();
    expect(await listOrgLiveEnableEventsPostgres(database, other)).toEqual([]);
    expect(await snapshot(fixture.context.organizationId)).toEqual(cooling);
  });

  it("read-only state, preview and events work after reconnect with a read-only session", async () => {
    const fixture = await prepare("markEnabled");
    const before = await snapshot(fixture.context.organizationId);
    const connection = postgres(url!, { max: 1 });
    try {
      await connection`SET default_transaction_read_only = on`;
      const db = drizzle(connection, { schema });
      expect(await service(db).getState(fixture.context)).toEqual(fixture.state);
      expect(await service(db).preview(fixture.context)).toMatchObject({
        state: fixture.state,
        enableEligible: true,
      });
      expect(await listOrgLiveEnableEventsPostgres(db, fixture.context)).toHaveLength(2);
      await expect(assertOrgLiveEnabled(service(db), fixture.context)).rejects.toMatchObject({
        code: "ORG_LIVE_ENABLE_REQUIRED",
      });
      expect(await snapshot(fixture.context.organizationId)).toEqual(before);
    } finally {
      await connection.end({ timeout: 5 });
    }
  });

  it("failed cancellation during cooling preserves all prior evidence and permits a valid retry", async () => {
    const fixture = await prepare("markEnabled");
    const before = await snapshot(fixture.context.organizationId);
    const cancel = () =>
      service().cancel(actor, fixture.context, {
        expectedStateVersion: 2,
        reason: "synthetic cancellation",
      });
    await injectFault("audit_logs", "AFTER", fixture.context.organizationId);
    await expectInjectedFailure(cancel);
    expect(await snapshot(fixture.context.organizationId)).toEqual(before);
    await expect(assertOrgLiveEnabled(service(), fixture.context)).rejects.toMatchObject({
      code: "ORG_LIVE_ENABLE_REQUIRED",
    });
    await clearFault();
    expect(await cancel()).toMatchObject({ state: "CANCELLED", stateVersion: 3 });
    const after = await snapshot(fixture.context.organizationId);
    expect(after.events).toHaveLength(3);
    expect(after.audits).toHaveLength(3);
    expect(after.changes).toHaveLength(3);
    await expect(cancel()).rejects.toMatchObject({ code: "ORG_LIVE_ENABLE_CANCEL_NOT_ALLOWED" });
    expect(await snapshot(fixture.context.organizationId)).toEqual(after);
  });

  it("a nonexistent org refuses before event/audit/projection writes", async () => {
    const context = { organizationId: randomUUID() };
    await expect(
      service().requestEnable(actor, context, { maxNotionalCap: "1" }),
    ).rejects.toMatchObject({ code: "ORG_LIVE_ENABLE_ORGANIZATION_NOT_FOUND" });
    expect(await snapshot(context.organizationId)).toEqual({
      state: [],
      events: [],
      audits: [],
      changes: [],
    });
  });

  it("the registered admin handler uses the atomic factory, preserving auth and rollback", async () => {
    const fixture = await seed();
    await database
      .insert(schema.userPlatformRoles)
      .values({ userId: fixture.userId, role: "admin" });
    const runtime = { kind: "postgres" as const, db: database };
    const disposeRuntimeDb = vi.fn(async () => undefined);
    const deps = {
      getUserId: async () => fixture.userId,
      getRuntimeDb: async () => runtime,
      disposeRuntimeDb,
    };
    const request = () =>
      new Request("http://localhost/api/trader/admin/org-live-enable/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: "request",
          organization_id: fixture.organizationId,
          max_notional_cap: "12.00",
        }),
      });
    const before = await snapshot(fixture.organizationId);
    await injectFault("audit_logs", "AFTER", fixture.organizationId);
    expect((await handleAdminOrgLiveEnableCommandPost(request(), deps)).status).toBe(400);
    expect(await snapshot(fixture.organizationId)).toEqual(before);
    expect(disposeRuntimeDb).toHaveBeenLastCalledWith(runtime);
    await clearFault();
    expect((await handleAdminOrgLiveEnableCommandPost(request(), deps)).status).toBe(200);
    const after = await snapshot(fixture.organizationId);
    expect(after.audits[0]).toMatchObject({ actor_type: "admin", actor_id: fixture.userId });
    const ordinary = await seed();
    await database
      .insert(schema.userPlatformRoles)
      .values({ userId: ordinary.userId, role: "user" });
    expect(
      (
        await handleAdminOrgLiveEnableCommandPost(request(), {
          ...deps,
          getUserId: async () => ordinary.userId,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await handleAdminOrgLiveEnableCommandPost(request(), {
          ...deps,
          getUserId: async () => null,
        })
      ).status,
    ).toBe(401);
    expect(await snapshot(fixture.organizationId)).toEqual(after);
    // This fixture owns its client; it does not claim all-path production runtime disposal.
  });

  it("retains event/Core audit append-only triggers and denies direct browser-role access", async () => {
    const fixture = await prepare("confirmEnable");
    const before = await snapshot(fixture.context.organizationId);
    for (const table of ["trader_org_live_enable_events", "audit_logs"] as const) {
      await expect(
        observer.unsafe(
          `UPDATE ${table} SET organization_id=organization_id WHERE organization_id=$1`,
          [fixture.context.organizationId],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        observer.unsafe(`DELETE FROM ${table} WHERE organization_id=$1`, [
          fixture.context.organizationId,
        ]),
      ).rejects.toMatchObject({ code: "23514" });
    }
    for (const role of ["authenticated", "anon"] as const) {
      // Temporary GRANTs prove RLS rather than missing GRANTs. Every GRANT rolls back.
      await expect(
        observer.begin(async (tx) => {
          await tx.unsafe(
            `GRANT SELECT, INSERT, UPDATE, DELETE ON trader_org_live_enable, trader_org_live_enable_events, audit_logs TO ${role}`,
          );
          await tx.unsafe(`SET LOCAL ROLE ${role}`);
          expect(
            await tx`SELECT * FROM trader_org_live_enable WHERE organization_id=${fixture.context.organizationId}::uuid`,
          ).toEqual([]);
          expect(
            await tx`SELECT * FROM trader_org_live_enable_events WHERE organization_id=${fixture.context.organizationId}::uuid`,
          ).toEqual([]);
          expect(
            await tx`SELECT * FROM audit_logs WHERE organization_id=${fixture.context.organizationId}::uuid`,
          ).toEqual([]);
          expect(
            await tx`UPDATE trader_org_live_enable SET state='ENABLED' WHERE organization_id=${fixture.context.organizationId}::uuid RETURNING *`,
          ).toEqual([]);
          await tx`INSERT INTO trader_org_live_enable (organization_id, max_notional_cap) VALUES (${randomUUID()}::uuid, '1')`;
        }),
      ).rejects.toMatchObject({ code: "42501" });
    }
    expect(await snapshot(fixture.context.organizationId)).toEqual(before);
  });
});
