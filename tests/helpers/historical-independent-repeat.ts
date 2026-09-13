/** Local synthetic experiment only. Never imported by product runtime. */
import { createHash } from "node:crypto";
import { closeSync, fstatSync, lstatSync, openSync, realpathSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import type postgres from "postgres";

export const REPEAT_USER_ID = "8e931c41-a568-49e8-a40b-c2467bb06f91";
export const REPEAT_RUN_ID = "dee-920-independent-synthetic-repeat-v1";
export const REPEAT_ORGANIZATION_ID = "3c50b4e9-1138-43a5-a29f-e65088124cfc";
export type RepeatConfig = Readonly<{ database: string; output: string }>;

export function repeatConfig(env: Readonly<Record<string, string | undefined>>, databaseUrl: string): RepeatConfig | null {
  if (env.WAIA_LOCAL_HISTORICAL_REPEAT === undefined) {
    if (env.WAIA_LOCAL_HISTORICAL_REPEAT_OUTPUT !== undefined) throw new Error("REPEAT_OUTPUT_WITHOUT_OPT_IN");
    return null;
  }
  if (env.WAIA_LOCAL_HISTORICAL_REPEAT !== "1" || env.WAIA_PG_INTEGRATION !== "1" ||
      env.WAIA_HISTORICAL_KNOWLEDGE_CONTINUATION_PROOF === "1") {
    throw new Error("REPEAT_EXPLICIT_35_CYCLE_TEST_ONLY_REQUIRED");
  }
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.port === "6543" || url.search || url.hash ||
      !/^\/waia_hsv2_it_repeat_[a-z0-9]+_[ab]$/.test(url.pathname)) {
    throw new Error("REPEAT_FRESH_NAMED_LOCAL_DATABASE_REQUIRED");
  }
  const output = env.WAIA_LOCAL_HISTORICAL_REPEAT_OUTPUT ?? "";
  if (!isAbsolute(output) || !basename(output).startsWith("waia-historical-repeat-")) {
    throw new Error("REPEAT_PRIVATE_DIRECTORY_REQUIRED");
  }
  const stat = lstatSync(output);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700 ||
      stat.uid !== process.getuid?.() || realpathSync(output) !== output) {
    throw new Error("REPEAT_PRIVATE_DIRECTORY_REQUIRED");
  }
  return Object.freeze({ database: url.pathname.slice(1), output });
}

// Explicit allowlist: no identity/user/account credential tables. All data belongs
// to the synthetic organization, in a database that was empty before this suite.
export const REPEAT_TABLES = [
  "trader_historical_simulation_resume_checkpoint_v2",
  "trader_historical_simulation_resume_snapshot_link_v2",
  "trader_historical_simulation_resume_stage_link_v2",
  "trader_historical_simulation_atomic_stage_v2",
  "trader_historical_simulation_reason_ledger_v2",
  "trader_historical_simulation_durable_snapshot_v2",
  "trader_historical_simulation_modeled_evidence_v2",
  "trader_historical_simulation_run_start_v2",
  "trader_historical_simulation_run_lifecycle_event_v2",
  "trader_historical_dataset_authority_v2",
  "trader_historical_four_surface_ratified_admission_v2",
  "trader_historical_ratification_request_v2",
  "trader_historical_technical_proposal_v2",
  "trader_historical_proposal_ratification_v2",
  "trader_historical_qualified_execution_extent_v2",
  "trader_dee659_authority_bundle_v2",
  "trader_dee659_authority_preregistration_v2",
  "trader_historical_forecast_input_pit_v2",
  "trader_historical_forecast_input_knowledge_link_v2",
  "trader_forecast_runtime_input_source_v2",
  "trader_forecast_bundle_v2",
  "trader_forecast_v2",
  "trader_forecast_outcome_v2",
  "trader_forecast_calibration_observation_v2",
  "trader_forecast_scenario_v2",
  "trader_forecast_target_bucket_v2",
  "trader_forecast_target_definition_v2",
  "trader_forecast_replica_artifact_v2",
  "trader_predictive_package_manifest_v1",
  "trader_predictive_package_chunk_v1",
  "trader_intelligence_cycle_envelope",
  "trader_knowledge_confidence_update_record",
  "trader_knowledge_state_checkpoint_v2",
  "trader_orders",
  "trader_fills",
  "trader_accounting_frontier",
] as const;

export function writeExclusiveEvidence(path: string, body: string): void {
  const fd = openSync(path, "wx", 0o600);
  try {
    if ((fstatSync(fd).mode & 0o777) !== 0o600) throw new Error("REPEAT_FILE_MODE_INVALID");
    writeFileSync(fd, body);
  } finally { closeSync(fd); }
}

export async function assertRepeatEmpty(sql: postgres.Sql): Promise<void> {
  for (const table of REPEAT_TABLES) {
    const rows = await sql`SELECT 1 FROM ${sql(table)} LIMIT 1`;
    if (rows.length) throw new Error(`REPEAT_POPULATED_DATABASE:${table}`);
  }
}

/** Raw export only; no normalization or claim of scientific repeat PASS. */
export async function exportRepeatEvidence(
  sql: postgres.Sql, config: RepeatConfig, sourceSha: string,
  scenario: Readonly<Record<string, unknown>>,
): Promise<void> {
  if (!/^[0-9a-f]{40}$/.test(sourceSha)) throw new Error("REPEAT_EXACT_SOURCE_SHA_REQUIRED");
  const tables: Record<string, { rows: number; sha256: string }> = {};
  // Claim once before exporting. Failed/partial output is deliberately preserved.
  writeExclusiveEvidence(join(config.output, "started.json"), JSON.stringify({ sourceSha, scenario }));
  await sql.begin("isolation level repeatable read read only", async tx => {
    for (const table of REPEAT_TABLES) {
      const fd = openSync(join(config.output, `${table}.jsonl`), "wx", 0o600);
      const hash = createHash("sha256");
      let rows = 0;
      try {
        // PostgreSQL JSON text retains numeric precision. Ordering is raw lexical
        // order, not UUID/timestamp removal. No payload is omitted or rewritten.
        for await (const batch of tx<{ raw: string }[]>`
          SELECT row_to_json(t)::text AS raw FROM ${tx(table)} t
          WHERE organization_id=${REPEAT_ORGANIZATION_ID}::uuid
          ORDER BY row_to_json(t)::text COLLATE "C"
        `.cursor(8)) {
          for (const row of batch) {
            const line = `${row.raw}\n`;
            writeFileSync(fd, line); hash.update(line); rows += 1;
          }
        }
      } finally { closeSync(fd); }
      tables[table] = { rows, sha256: hash.digest("hex") };
    }
  });
  writeExclusiveEvidence(join(config.output, "complete.json"), JSON.stringify({
    schema: "waia.local.synthetic-independent-repeat-raw.v1", sourceSha,
    database: config.database, scenario, tables,
    qualification: false, semanticRepeatPass: false,
    limitation: "Qualified upstream K/M evaluator fixture; raw evidence export, not comparison PASS",
  }, null, 2));
}
