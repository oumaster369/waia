/** Disposable local PostgreSQL only; synthetic append-only evidence is retained. */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema.postgres";
import { createPostgresCollectorStore } from "@/lib/trader/admin-console/collectors/postgres-store";
import { handleAdminConsoleIncidentPost } from "@/lib/trader/admin-console/handlers/incident-commands";
import { presentIncident } from "@/lib/trader/admin-console/diagnostics/incident-view";
import { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";
import type { AdminRouteHandlerDeps } from "@/lib/trader/admin-route-shared";

const url = process.env.DATABASE_URL_POSTGRES;
describe.skipIf(process.env.WAIA_PG_INTEGRATION !== "1" || !url)(
  "atomic diagnostic incidents on PostgreSQL",
  () => {
    const prefix = `ia_${randomUUID()}`;
    const admin = randomUUID();
    let client: ReturnType<typeof postgres>;
    let db: ReturnType<typeof drizzle<typeof schema>>;
    let store: ReturnType<typeof createPostgresCollectorStore>;
    function input(key: string) {
      const error = new Error(`Synthetic ${key}`);
      error.stack = `Error: Synthetic ${key}\n at collector (fixture.ts:1:1)`;
      return { service: `${prefix}-${key}`, error, jobKey: "admin_news" };
    }
    async function incident(key: string) {
      const [row] =
        await client`SELECT * FROM trader_admin_incident WHERE service=${input(key).service}`;
      return row;
    }
    async function evidence(key: string) {
      return client`SELECT e.from_status,e.to_status,e.actor_user_id::text FROM trader_admin_incident_event e JOIN trader_admin_incident i ON i.id=e.incident_id WHERE i.service=${input(key).service} ORDER BY e.created_at`;
    }
    async function diagnostics(key: string) {
      return client`SELECT id FROM trader_admin_diagnostic_event WHERE service=${input(key).service}`;
    }
    async function trigger(table: string, action: string, body: string) {
      const name = `ia_${randomUUID().replaceAll("-", "")}`;
      await client.unsafe(
        `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN ${body} RETURN NEW; END $$`,
      );
      await client.unsafe(
        `CREATE TRIGGER ${name} BEFORE ${action} ON ${table} FOR EACH ROW EXECUTE FUNCTION ${name}()`,
      );
      return async () => {
        await client.unsafe(`DROP TRIGGER ${name} ON ${table}`);
        await client.unsafe(`DROP FUNCTION ${name}()`);
      };
    }
    beforeAll(async () => {
      if (!["localhost", "127.0.0.1"].includes(new URL(url!).hostname))
        throw new Error("LOCAL_TEST_DATABASE_REQUIRED");
      client = postgres(url!, {
        max: 10,
        prepare: false,
        connection: { application_name: prefix },
      });
      db = drizzle(client, { schema });
      store = createPostgresCollectorStore(db);
      await client`INSERT INTO auth.users (id) VALUES (${admin}::uuid)`;
      await client`INSERT INTO users (id,identity_label,email) VALUES (${admin}::uuid,'Incident test',${`${admin}@waia.invalid`})`;
      await ensureUserCoreSeedPostgres(db, { userId: admin, displayName: "Incident test" });
      await client`UPDATE user_platform_roles SET role='admin' WHERE user_id=${admin}::uuid`;
    });
    afterAll(async () => {
      await client?.end();
    });
    it("serializes concurrent first diagnostics into one incident and one creation history", async () => {
      const drop = await trigger(
        "trader_admin_incident",
        "INSERT",
        `IF NEW.service='${input("first").service}' THEN PERFORM pg_sleep(0.03); END IF;`,
      );
      try {
        const results = await Promise.allSettled(
          Array.from({ length: 6 }, () => store.recordDiagnostic(input("first"))),
        );
        expect(results.map((r) => r.status)).toEqual(Array(6).fill("fulfilled"));
        expect(await incident("first")).toMatchObject({
          occurrences: 6,
          state_version: 6,
          status: "new",
        });
        expect(await diagnostics("first")).toHaveLength(6);
        expect(await evidence("first")).toHaveLength(1);
      } finally {
        await drop();
      }
    });
    it("does not lose occurrence counts or revisions for simultaneous repeats", async () => {
      await store.recordDiagnostic(input("repeat"));
      const drop = await trigger(
        "trader_admin_incident",
        "UPDATE",
        `IF NEW.service='${input("repeat").service}' THEN PERFORM pg_sleep(0.03); END IF;`,
      );
      try {
        await Promise.all(Array.from({ length: 6 }, () => store.recordDiagnostic(input("repeat"))));
        expect(await incident("repeat")).toMatchObject({
          occurrences: 7,
          state_version: 7,
          status: "new",
        });
        expect(await diagnostics("repeat")).toHaveLength(7);
        expect(await evidence("repeat")).toHaveLength(1);
      } finally {
        await drop();
      }
    });
    it("records resolved recurrence once and clears the old resolution timestamp", async () => {
      await store.recordDiagnostic(input("recurrence"));
      await client`UPDATE trader_admin_incident SET status='resolved',resolved_at=now() WHERE service=${input("recurrence").service}`;
      const drop = await trigger(
        "trader_admin_incident",
        "UPDATE",
        `IF NEW.service='${input("recurrence").service}' THEN PERFORM pg_sleep(0.03); END IF;`,
      );
      try {
        await Promise.all(
          Array.from({ length: 6 }, () => store.recordDiagnostic(input("recurrence"))),
        );
        expect(await incident("recurrence")).toMatchObject({
          occurrences: 7,
          state_version: 7,
          status: "regressed",
          resolved_at: null,
        });
        expect(
          (await evidence("recurrence")).filter((e) => e.from_status === "resolved"),
        ).toHaveLength(1);
      } finally {
        await drop();
      }
    });
    for (const existing of [false, true]) {
      it(`rolls back diagnostic and ${existing ? "recurrence" : "creation"} if required history fails`, async () => {
        const key = existing ? "rollback-existing" : "rollback-first";
        if (existing) {
          await store.recordDiagnostic(input(key));
          await client`UPDATE trader_admin_incident SET status='resolved',resolved_at=now() WHERE service=${input(key).service}`;
        }
        const before = await incident(key);
        const drop = await trigger(
          "trader_admin_incident_event",
          "INSERT",
          `IF EXISTS(SELECT 1 FROM trader_admin_incident WHERE id=NEW.incident_id AND service='${input(key).service}') THEN RAISE EXCEPTION 'INCIDENT_HISTORY_TEST_FAILURE'; END IF;`,
        );
        try {
          await expect(store.recordDiagnostic(input(key))).rejects.toThrow();
          expect(await incident(key)).toEqual(before);
          expect(await diagnostics(key)).toHaveLength(existing ? 1 : 0);
          expect(await evidence(key)).toHaveLength(existing ? 1 : 0);
        } finally {
          await drop();
        }
        await store.recordDiagnostic(input(key));
        expect(await incident(key)).toMatchObject({
          occurrences: existing ? 2 : 1,
          status: existing ? "regressed" : "new",
        });
      });
    }
    for (const target of ["investigating", "resolved"] as const) {
      it(`preserves a guarded ${target} transition and chronological recurrence evidence`, async () => {
        const key = `operator-${target}`;
        const from = target === "resolved" ? "deployed_verifying" : "new";
        await store.recordDiagnostic(input(key));
        if (target === "resolved")
          await client`UPDATE trader_admin_incident SET status='deployed_verifying' WHERE service=${input(key).service}`;
        const before = presentIncident(await incident(key));
        const lockKey = `test-operator-${prefix}-${target}`;
        const gate = await client.reserve();
        const drop = await trigger(
          "trader_admin_incident",
          "UPDATE",
          `IF NEW.service='${input(key).service}' AND NEW.status='${target}' AND OLD.status='${from}' THEN PERFORM pg_advisory_xact_lock(hashtextextended('${lockKey}',0)); END IF;`,
        );
        let operation: ReturnType<typeof handleAdminConsoleIncidentPost> | undefined;
        let diagnostic: Promise<void> | undefined;
        const waitForLocks = async (count: number) => {
          await expect
            .poll(
              async () => {
                const [row] =
                  await client`SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name=${prefix} AND wait_event_type='Lock'`;
                return row.count;
              },
              { timeout: 4000, interval: 20 },
            )
            .toBeGreaterThanOrEqual(count);
        };
        try {
          await gate`SELECT pg_advisory_lock(hashtextextended(${lockKey},0))`;
          const deps: AdminRouteHandlerDeps = {
            getUserId: async () => admin,
            getRuntimeDb: async () => ({ kind: "postgres", db, _sql: client }),
            disposeRuntimeDb: async () => undefined,
          };
          operation = handleAdminConsoleIncidentPost(
            new Request("http://localhost/api/trader/admin/console/incidents", {
              method: "POST",
              headers: { origin: "http://localhost", "content-type": "application/json" },
              body: JSON.stringify({
                id: before.id,
                expectedRevision: before.revision,
                status: target,
                reason: "Local concurrency proof",
                evidence: "Guarded operator retains authority",
              }),
            }),
            deps,
          );
          await waitForLocks(1);
          diagnostic = store.recordDiagnostic(input(key));
          await waitForLocks(2);
          await gate`SELECT pg_advisory_unlock(hashtextextended(${lockKey},0))`;
          expect((await operation).status).toBe(200);
          await diagnostic;
          expect(await incident(key)).toMatchObject({
            status: target === "resolved" ? "regressed" : target,
            resolved_at: null,
            occurrences: 2,
            state_version: 3,
          });
          expect((await evidence(key)).filter((e) => e.actor_user_id === admin)).toEqual([
            { from_status: from, to_status: target, actor_user_id: admin },
          ]);
          if (target === "resolved") {
            expect((await evidence(key)).map((e) => e.to_status)).toEqual([
              "new",
              "resolved",
              "regressed",
            ]);
          }
        } finally {
          await gate`SELECT pg_advisory_unlock_all()`;
          await Promise.allSettled([operation, diagnostic].filter(Boolean));
          gate.release();
          await drop();
        }
      });
    }
  },
);
