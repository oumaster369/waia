import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { describe, beforeAll, afterAll, beforeEach, it, expect, vi } from "vitest";
const governedCommand = vi.hoisted(() => vi.fn());
vi.mock("@/lib/trader/validation-gate/admin-route-handler", () => ({
  handleAdminStrategyPromotionCommandPost: governedCommand,
}));
import * as schema from "@/db/schema.postgres";
import { handleAdminConsolePromotionCommandPost } from "@/lib/trader/admin-console/handlers/promotion-commands";
import { handleAdminConsolePromotionsGet } from "@/lib/trader/admin-console/handlers/promotions";
import type { AdminRouteHandlerDeps } from "@/lib/trader/admin-route-shared";
import type { AdminPostgresDb } from "@/lib/trader/admin-console/repositories/snapshot.postgres";
import { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
const url = process.env.DATABASE_URL_POSTGRES;
describe.skipIf(process.env.WAIA_PG_INTEGRATION !== "1" || !url)(
  "promotion console request precondition on Postgres",
  () => {
    let client: postgres.Sql, db: AdminPostgresDb;
    const admin = randomUUID(),
      org = personalOrganizationIdFromUserId(admin);
    const deps = (): AdminRouteHandlerDeps => ({
      getUserId: async () => admin,
      getRuntimeDb: async () => ({ kind: "postgres", db, _sql: client }),
      disposeRuntimeDb: async () => undefined,
    });
    const request = (strategy: string, revision?: string) =>
      new Request("http://localhost/api/trader/admin/console/promotions/commands", {
        method: "POST",
        headers: { origin: "http://localhost", "content-type": "application/json" },
        body: JSON.stringify({
          organization_id: org,
          strategy_id: strategy,
          command: "request",
          expectedRevision: revision,
        }),
      });
    const read = async (strategy: string) =>
      handleAdminConsolePromotionsGet(
        new Request(
          `http://localhost/api/trader/admin/console/promotions?organization_id=${org}&strategy_id=${strategy}`,
        ),
        deps(),
      );
    beforeAll(async () => {
      if (!["localhost", "127.0.0.1"].includes(new URL(url!).hostname))
        throw new Error("LOCAL_TEST_DATABASE_REQUIRED");
      client = postgres(url!, { max: 4, prepare: false });
      db = drizzle(client, { schema });
      await client`INSERT INTO auth.users(id) VALUES (${admin}::uuid)`;
      await client`INSERT INTO users(id,identity_label,email) VALUES (${admin}::uuid,'Promotion adapter fixture',${`${admin}@waia.invalid`})`;
      await ensureUserCoreSeedPostgres(db, {
        userId: admin,
        displayName: "Promotion adapter fixture",
      });
      await client`UPDATE user_platform_roles SET role='admin' WHERE user_id=${admin}::uuid`;
    });
    beforeEach(() => {
      governedCommand.mockReset();
    });
    afterAll(async () => {
      await client?.end();
    });
    async function insertThroughDelegate(req: Request, delegated: AdminRouteHandlerDeps) {
      const body = await req.json(),
        runtime = await delegated.getRuntimeDb();
      if (runtime.kind !== "postgres") throw new Error("POSTGRES_REQUIRED");
      await runtime.db.execute(
        sql`INSERT INTO trader_strategy_promotion_records(id,organization_id,strategy_id,strategy_version,git_commit_sha,target_deployment_state,hypothesis,intended_regime,cost_model_json,failure_modes_json,reason_code_distribution_json,paper_trading_evidence_json,research_evidence_json,evidence_content_digest,confidence_attestation_json,record_content_digest,schema_version,state,requested_at,state_version) VALUES (${randomUUID()}::uuid,${org}::uuid,${body.strategy_id},'v1',${"a".repeat(40)},'LIVE_LIMITED','Fixture','RANGE','{}','[]','{}','{}','{}','digest','{}','record','fixture','PENDING_CONFIRM',now(),1)`,
      );
    }
    it("requires a read revision and rejects a stale creation before the governed service", async () => {
      expect(
        (await handleAdminConsolePromotionCommandPost(request("missing"), deps())).status,
      ).toBe(400);
      expect(
        (await handleAdminConsolePromotionCommandPost(request("stale", "outdated"), deps())).status,
      ).toBe(409);
      expect(governedCommand).not.toHaveBeenCalled();
    });
    it("serializes two creations from one empty revision, preserving one saved request", async () => {
      const strategy = `race-${randomUUID()}`,
        revision = (await read(strategy)).body as { revision: string };
      governedCommand.mockImplementation(async (req, delegated) => {
        await insertThroughDelegate(req, delegated);
        return { status: 200, outcome: "success", body: { saved: true } };
      });
      const results = await Promise.all([
        handleAdminConsolePromotionCommandPost(request(strategy, revision.revision), deps()),
        handleAdminConsolePromotionCommandPost(request(strategy, revision.revision), deps()),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(governedCommand).toHaveBeenCalledTimes(1);
      expect(
        (
          await client`SELECT count(*)::integer AS n FROM trader_strategy_promotion_records WHERE organization_id=${org}::uuid AND strategy_id=${strategy}`
        )[0].n,
      ).toBe(1);
    });
    it("rolls back a saved record when the governed service maps an audit/write failure to an error", async () => {
      const strategy = `rollback-${randomUUID()}`,
        revision = (await read(strategy)).body as { revision: string };
      governedCommand.mockImplementation(async (req, delegated) => {
        await insertThroughDelegate(req, delegated);
        return {
          status: 500,
          outcome: "server_error",
          body: { error: { code: "AUDIT_FAILURE_FIXTURE" } },
        };
      });
      expect(
        (await handleAdminConsolePromotionCommandPost(request(strategy, revision.revision), deps()))
          .status,
      ).toBe(500);
      expect(
        (
          await client`SELECT count(*)::integer AS n FROM trader_strategy_promotion_records WHERE organization_id=${org}::uuid AND strategy_id=${strategy}`
        )[0].n,
      ).toBe(0);
    });
  },
);
