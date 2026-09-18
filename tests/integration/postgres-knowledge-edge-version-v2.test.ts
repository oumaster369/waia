import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { describe, expect, it } from "vitest";

import { getPostgresDrizzle } from "@/db/postgres-client";
import {
  insertKnowledgeEdgePostgres,
  updateKnowledgeEdgePostgres,
} from "@/lib/trader/knowledge/knowledge-edge-repository-postgres";
import { KNOWLEDGE_AUTHORITY_REASON } from "@/lib/trader/knowledge/knowledge-edge-version-v2";
import { deleteKnowledgeAuthorityRowsForOrg } from "@/tests/helpers/knowledge-authority-test-cleanup";

const enabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim() ?? "";
const parsed = (() => {
  try {
    return url ? new URL(url) : null;
  } catch {
    return null;
  }
})();
const databaseName = parsed?.pathname.replace(/^\//, "") ?? "";
const disposable = Boolean(
  parsed &&
  ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname) &&
  ["waia_it", "waia_validate"].includes(databaseName) &&
  parsed.port !== "6543",
);

describe.skipIf(!enabled || !url || !disposable)("DEE-771 Knowledge authority PostgreSQL", () => {
  it("blocks in-place UPDATE/DELETE at the database layer for every relation kind", async () => {
    const sql = postgres(url, { max: 1 });
    const userId = randomUUID();
    const organizationId = randomUUID();
    const edgeId = randomUUID();
    try {
      await sql`INSERT INTO auth.users (id) VALUES (${userId}::uuid)`;
      await sql`INSERT INTO users (id,identity_label,email) VALUES
        (${userId}::uuid,'DEE-771 knowledge authority',${`${userId}@invalid.local`})`;
      await sql`INSERT INTO organizations (id,owner_user_id,kind,name) VALUES
        (${organizationId}::uuid,${userId}::uuid,'personal','DEE-771 knowledge authority')`;

      const db = getPostgresDrizzle();
      const context = { organizationId };
      const now = new Date("2026-01-01T00:00:00.000Z");
      await insertKnowledgeEdgePostgres(db, context, {
        id: edgeId,
        fromRef: "from:dee771",
        toRef: "to:dee771",
        relationKind: "observes",
        confidence: "0.7000",
        strength: "1",
        regimeScope: "ALL",
        failureCasesJson: "[]",
        verified: true,
        createdAt: now,
        updatedAt: now,
      });

      await expect(
        updateKnowledgeEdgePostgres(db, context, edgeId, {
          confidence: "0.9000",
          updatedAt: new Date(),
        }),
      ).rejects.toMatchObject({ code: KNOWLEDGE_AUTHORITY_REASON.LEGACY_MKB_MUTATION_DISABLED });

      let updateCode: string | undefined;
      try {
        await sql.unsafe(`UPDATE trader_knowledge_edges SET confidence = '0.9000' WHERE id = $1`, [
          edgeId,
        ]);
      } catch (error) {
        updateCode = (error as { code?: string }).code;
      }
      expect(updateCode).toBe("23514");

      let deleteCode: string | undefined;
      try {
        await sql.unsafe(
          `DELETE FROM trader_knowledge_edge_version_v2 WHERE knowledge_edge_id = $1`,
          [edgeId],
        );
      } catch (error) {
        deleteCode = (error as { code?: string }).code;
      }
      expect(deleteCode).toBe("23514");

      const privileges = await sql<Array<{ update: boolean; delete: boolean }>>`
        SELECT
          has_table_privilege('waia_historical_runner','public.trader_knowledge_edges','UPDATE') AS update,
          has_table_privilege('waia_historical_runner','public.trader_knowledge_edges','DELETE') AS delete
      `;
      expect(privileges[0]).toEqual({ update: false, delete: false });
    } finally {
      await deleteKnowledgeAuthorityRowsForOrg(sql, organizationId);
      await sql`DELETE FROM organizations WHERE id=${organizationId}::uuid`;
      await sql`DELETE FROM users WHERE id=${userId}::uuid`;
      await sql`DELETE FROM auth.users WHERE id=${userId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  });
});
