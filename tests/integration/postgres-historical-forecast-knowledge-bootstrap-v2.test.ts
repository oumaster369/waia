import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { describe, expect, it } from "vitest";

import {
  bindPostgresReservedSession,
  withPostgresSessionTransaction,
} from "@/db/postgres-session-transaction";
import {
  buildHistoricalForecastKnowledgeBootstrapV2,
  persistHistoricalForecastKnowledgeBootstrapWithinTransactionV2,
} from
  "@/lib/trader/historical-simulation-v2/forecast-knowledge-bootstrap-v2";

const enabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES_SESSION?.trim() ?? "";
const parsed = (() => {
  try { return url ? new URL(url) : null; } catch { return null; }
})();
const databaseName = parsed?.pathname.replace(/^\//, "") ?? "";
const disposable = Boolean(
  parsed && ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname) &&
  ["waia_it", "waia_validate"].includes(databaseName) && parsed.port !== "6543",
);

if (enabled && url && !disposable) {
  throw new Error("FORECAST_KNOWLEDGE_PG_REFUSED:LOCAL_DISPOSABLE_DATABASE_REQUIRED");
}

describe.skipIf(!enabled || !url || !disposable)(
  "historical Forecast knowledge bootstrap PostgreSQL integration",
  () => {
    it("persists and replays the exact cold-start edge on the held atomic backend", async () => {
      const pool = postgres(url, { max: 2 });
      const reserved = await pool.reserve();
      const held = bindPostgresReservedSession(pool, reserved);
      const userId = randomUUID();
      const organizationId = randomUUID();
      const edge = buildHistoricalForecastKnowledgeBootstrapV2({
        organizationId,
        symbol: "BTCUSDT",
        horizonMinutes: 30,
        predictivePackageContentDigestHex: "a".repeat(64),
      });
      try {
        await expect(withPostgresSessionTransaction(
          held,
          "SERIALIZABLE",
          async (transaction) => {
            const pid = await transaction<Array<Readonly<{ pid: number }>>>
              `SELECT pg_backend_pid()::int AS pid`;
            await transaction`INSERT INTO auth.users (id) VALUES (${userId}::uuid)`;
            await transaction`INSERT INTO users (id,identity_label,email) VALUES
              (${userId}::uuid,'Forecast knowledge integration',${`${userId}@invalid.local`})`;
            await transaction`INSERT INTO organizations (id,owner_user_id,kind,name) VALUES
              (${organizationId}::uuid,${userId}::uuid,'personal','Forecast knowledge integration')`;

            await expect(persistHistoricalForecastKnowledgeBootstrapWithinTransactionV2(
              transaction,
              edge,
            )).resolves.toEqual({ insertedNew: true });
            await expect(persistHistoricalForecastKnowledgeBootstrapWithinTransactionV2(
              transaction,
              edge,
            )).resolves.toEqual({ insertedNew: false });

            const durable = await transaction<Array<Readonly<{
              pid: number;
              confidence: string;
              strength: string;
              failure_cases_json: string;
              hypothesis_id: string | null;
              verified: boolean;
            }>>>`
              SELECT pg_backend_pid()::int AS pid,confidence,strength,
                     failure_cases_json,hypothesis_id::text AS hypothesis_id,verified
              FROM trader_knowledge_edges
              WHERE organization_id=${organizationId}::uuid AND id=${edge.knowledgeEdgeId}::uuid
            `;
            expect(durable).toEqual([{
              pid: pid[0]!.pid,
              confidence: edge.confidence,
              strength: edge.strength,
              failure_cases_json: edge.failureCasesJson,
              hypothesis_id: null,
              verified: false,
            }]);
            const invisible = await pool<Array<Readonly<{ count: number }>>>
              `SELECT count(*)::int AS count FROM trader_knowledge_edges
               WHERE organization_id=${organizationId}::uuid AND id=${edge.knowledgeEdgeId}::uuid`;
            expect(invisible[0]?.count).toBe(0);
            throw new Error("EXPECTED_KNOWLEDGE_ROLLBACK");
          },
        )).rejects.toThrow("EXPECTED_KNOWLEDGE_ROLLBACK");

        const absent = await pool<Array<Readonly<{ count: number }>>>
          `SELECT count(*)::int AS count FROM trader_knowledge_edges
           WHERE organization_id=${organizationId}::uuid AND id=${edge.knowledgeEdgeId}::uuid`;
        expect(absent[0]?.count).toBe(0);

        await expect(withPostgresSessionTransaction(
          held,
          "SERIALIZABLE",
          async (transaction) => {
            await transaction`INSERT INTO auth.users (id) VALUES (${userId}::uuid)`;
            await transaction`INSERT INTO users (id,identity_label,email) VALUES
              (${userId}::uuid,'Forecast knowledge conflict',${`${userId}@invalid.local`})`;
            await transaction`INSERT INTO organizations (id,owner_user_id,kind,name) VALUES
              (${organizationId}::uuid,${userId}::uuid,'personal','Forecast knowledge conflict')`;
            await transaction`
              INSERT INTO trader_knowledge_edges
                (id,organization_id,from_ref,to_ref,relation_kind,confidence,strength,
                 regime_scope,failure_cases_json,hypothesis_id,verified)
              VALUES (${edge.knowledgeEdgeId}::uuid,${organizationId}::uuid,${edge.fromRef},
                ${edge.toRef},${edge.relationKind},${edge.confidence},${edge.strength},
                ${edge.regimeScope},${edge.failureCasesJson},${randomUUID()}::uuid,false)
            `;
            await persistHistoricalForecastKnowledgeBootstrapWithinTransactionV2(
              transaction,
              edge,
            );
          },
        )).rejects.toThrow(
          "HISTORICAL_FORECAST_KNOWLEDGE_BOOTSTRAP_REFUSED:DURABLE_LINEAGE",
        );
        const conflictAbsent = await pool<Array<Readonly<{ count: number }>>>
          `SELECT count(*)::int AS count FROM trader_knowledge_edges
           WHERE organization_id=${organizationId}::uuid AND id=${edge.knowledgeEdgeId}::uuid`;
        expect(conflictAbsent[0]?.count).toBe(0);
      } finally {
        reserved.release();
        await pool.end({ timeout: 5 });
      }
    }, 30_000);
  },
);
