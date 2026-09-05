import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const TAG = "0200_historical_knowledge_checkpoint_namespace_v2";

describe("Historical Knowledge checkpoint namespace migration V2", () => {
  const sql = fs.readFileSync(
    path.join(process.cwd(), "db", "migrations_postgres", `${TAG}.sql`),
    "utf8",
  );

  it("preserves GENERAL semantics and creates the run/surface-scoped natural identity", () => {
    expect(sql).toMatch(/checkpoint_namespace text DEFAULT 'GENERAL' NOT NULL/);
    expect(sql).toMatch(/checkpoint_namespace = model_version/);
    expect(sql).toMatch(
      /checkpoint_namespace LIKE\s*'waia\.trader\.historical_simulation_knowledge_binding\.v2\|%'/,
    );
    expect(sql).toMatch(/DROP INDEX IF EXISTS public\.tksc_v2_org_checkpoint_seq_uq/);
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX tksc_v2_org_namespace_checkpoint_seq_uq[\s\S]*organization_id, checkpoint_namespace, checkpoint_seq/,
    );
  });

  it("moves only legacy Historical rows and restores the append-only update guard", () => {
    expect(sql).toMatch(/DISABLE TRIGGER trader_knowledge_state_checkpoint_v2_block_update/);
    expect(sql).toMatch(
      /model_version LIKE 'waia\.trader\.historical_simulation_knowledge_binding\.v2\|%'/,
    );
    expect(sql).toMatch(/ENABLE TRIGGER trader_knowledge_state_checkpoint_v2_block_update/);
    expect(sql).not.toMatch(/DISABLE TRIGGER trader_knowledge_state_checkpoint_v2_block_delete/);
  });
});
