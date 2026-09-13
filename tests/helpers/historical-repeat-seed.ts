/** Local synthetic seed admission only; never imported by product runtime. */
import { createHash } from "node:crypto";
import { closeSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import type postgres from "postgres";
import { exportRepeatEvidence, REPEAT_ORGANIZATION_ID, REPEAT_TABLES,
  writeExclusiveEvidence, type RepeatConfig } from "./historical-independent-repeat";

export type HistoricalRepeatSeedConfig = Readonly<{ mode: "write" | "read"; directory: string }>;
export function historicalRepeatSeedConfig(
  env: Readonly<Record<string, string | undefined>>, repeat: RepeatConfig | null,
): HistoricalRepeatSeedConfig | null {
  const mode = env.WAIA_LOCAL_HISTORICAL_SEED_MODE;
  const directory = env.WAIA_LOCAL_HISTORICAL_SEED_DIRECTORY;
  if (mode === undefined && directory === undefined) return null;
  if (!repeat || !["write", "read"].includes(mode ?? "") || !directory ||
      !isAbsolute(directory) || basename(directory) !== "seed" ||
      dirname(directory) !== dirname(repeat.output) ||
      !basename(dirname(directory)).startsWith("waia-historical-repeat-pair-") ||
      !new RegExp(`^waia_hsv2_it_repeat_[a-z0-9]+_${mode === "write" ? "a" : "b"}$`).test(repeat.database)) {
    throw new Error("REPEAT_SEED_PAIRED_SCOPE_REQUIRED");
  }
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() ||
      (stat.mode & 0o777) !== 0o700 || realpathSync(directory) !== directory) {
    throw new Error("REPEAT_SEED_PRIVATE_DIRECTORY_REQUIRED");
  }
  return Object.freeze({ mode: mode as "write" | "read", directory });
}

export type SeedFileBinding = Readonly<{ path: string; bytes: number; sha256: string }>;
function ownedRegularFile(path: string): Buffer {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid?.()) {
    throw new Error("REPEAT_SEED_REGULAR_OWNED_FILE_REQUIRED");
  }
  return readFileSync(path);
}
function assertDatasetRoot(root: string): void {
  const stat = lstatSync(root);
  if (!isAbsolute(root) || !basename(root).startsWith("dee-919-first-cycle-") ||
      !stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() ||
      (stat.mode & 0o777) !== 0o700 || realpathSync(root) !== root) {
    throw new Error("REPEAT_SEED_SYNTHETIC_DATASET_REQUIRED");
  }
}
export function snapshotHistoricalSeedDataset(root: string): readonly SeedFileBinding[] {
  assertDatasetRoot(root); const files: SeedFileBinding[] = [];
  function visit(directory: string): void {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name); const stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error("REPEAT_SEED_SYMLINK_REFUSED");
      if (stat.isDirectory()) visit(path);
      else {
        const bytes = ownedRegularFile(path);
        files.push(Object.freeze({ path: relative(root, path), bytes: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex") }));
      }
    }
  }
  visit(root);
  if (!files.length) throw new Error("REPEAT_SEED_EMPTY_DATASET");
  return Object.freeze(files);
}
export function verifyHistoricalSeedDataset(root: string, files: readonly SeedFileBinding[]): void {
  assertDatasetRoot(root); const paths = new Set<string>();
  if (!files.length) throw new Error("REPEAT_SEED_EMPTY_DATASET");
  for (const file of files) {
    if (!file.path || isAbsolute(file.path) || file.path.split(/[\\/]/).some(p => !p || p === ".." || p === ".") ||
        paths.has(file.path) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 ||
        !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error("REPEAT_SEED_FILE_BINDING_INVALID");
    paths.add(file.path);
    const path = join(root, file.path);
    if (realpathSync(path) !== path) throw new Error("REPEAT_SEED_PATH_ESCAPE");
    const bytes = ownedRegularFile(path);
    if (bytes.length !== file.bytes || createHash("sha256").update(bytes).digest("hex") !== file.sha256) {
      throw new Error("REPEAT_SEED_DATASET_CHANGED");
    }
  }
}

const PRE_EXECUTION_TABLES = [
  "trader_historical_simulation_reason_ledger_v2", "trader_historical_simulation_atomic_stage_v2",
  "trader_historical_simulation_resume_checkpoint_v2", "trader_knowledge_state_checkpoint_v2",
  "trader_forecast_bundle_v2", "trader_forecast_outcome_v2", "trader_orders", "trader_fills",
  "trader_accounting_frontier",
] as const;
export async function assertHistoricalSeedBeforeExecution(sql: postgres.Sql): Promise<void> {
  for (const table of PRE_EXECUTION_TABLES) {
    if ((await sql`SELECT 1 FROM ${sql(table)} LIMIT 1`).length) {
      throw new Error(`REPEAT_SEED_ALREADY_EXECUTED:${table}`);
    }
  }
}

function privateFile(path: string): Buffer {
  if ((lstatSync(path).mode & 0o777) !== 0o600) throw new Error("REPEAT_SEED_FILE_MODE");
  return ownedRegularFile(path);
}
export async function captureHistoricalRepeatSeed(
  sql: postgres.Sql, repeat: RepeatConfig, seed: HistoricalRepeatSeedConfig,
  sourceSha: string, datasetRoot: string, metadata: unknown,
): Promise<void> {
  if (seed.mode !== "write" || !/^waia_hsv2_it_repeat_[a-z0-9]+_a$/.test(repeat.database) ||
      !/^[a-f0-9]{40}$/.test(sourceSha)) throw new Error("REPEAT_SEED_CAPTURE_SCOPE");
  await assertHistoricalSeedBeforeExecution(sql);
  const files = snapshotHistoricalSeedDataset(datasetRoot);
  await exportRepeatEvidence(sql, { ...repeat, output: seed.directory }, sourceSha, {
    phase: "PRE_EXECUTION_SEED", datasetRoot,
  });
  const metadataText = JSON.stringify({ sourceSha, datasetRoot, files, metadata });
  writeExclusiveEvidence(join(seed.directory, "metadata.json"), metadataText);
  const archive = join(seed.directory, "database.dump");
  const fd = openSync(archive, "wx", 0o600);
  try {
    execFileSync("docker", ["--context", "desktop-linux", "exec", "waia-dee946-pg17-20260906",
      "pg_dump", "-U", "waia946_test", "-d", repeat.database, "--format=custom", "--no-owner"],
    { stdio: ["ignore", fd, "pipe"], timeout: 120_000, killSignal: "SIGKILL" });
  } finally { closeSync(fd); }
  verifyHistoricalSeedDataset(datasetRoot, files);
  await assertHistoricalSeedBeforeExecution(sql);
  writeExclusiveEvidence(join(seed.directory, "seed-seal.json"), JSON.stringify({
    schema: "waia.local.synthetic-pre-execution-seed.v1", sourceSha,
    metadataSha256: createHash("sha256").update(metadataText).digest("hex"),
    databaseSha256: createHash("sha256").update(privateFile(archive)).digest("hex"),
    initialExportSha256: createHash("sha256").update(privateFile(join(seed.directory, "complete.json"))).digest("hex"),
    qualification: false,
  }));
}

export async function loadHistoricalRepeatSeed<T>(
  sql: postgres.Sql, seed: HistoricalRepeatSeedConfig, sourceSha: string,
): Promise<T> {
  if (seed.mode !== "read") throw new Error("REPEAT_SEED_READ_MODE");
  const seal = JSON.parse(privateFile(join(seed.directory, "seed-seal.json")).toString());
  if (seal.schema !== "waia.local.synthetic-pre-execution-seed.v1" || seal.sourceSha !== sourceSha) {
    throw new Error("REPEAT_SEED_SOURCE_MISMATCH");
  }
  for (const [file, expected] of [["metadata.json", seal.metadataSha256],
    ["database.dump", seal.databaseSha256], ["complete.json", seal.initialExportSha256]]) {
    if (createHash("sha256").update(privateFile(join(seed.directory, file))).digest("hex") !== expected) {
      throw new Error("REPEAT_SEED_ARCHIVE_CHANGED");
    }
  }
  const saved = JSON.parse(privateFile(join(seed.directory, "metadata.json")).toString());
  if (saved.sourceSha !== sourceSha) throw new Error("REPEAT_SEED_SOURCE_MISMATCH");
  verifyHistoricalSeedDataset(saved.datasetRoot, saved.files);
  await assertHistoricalSeedBeforeExecution(sql);
  const manifest = JSON.parse(privateFile(join(seed.directory, "complete.json")).toString());
  await sql.begin("isolation level repeatable read read only", async tx => {
    for (const table of REPEAT_TABLES) {
      const hash = createHash("sha256"); let count = 0;
      for await (const batch of tx<{ raw: string }[]>`
        SELECT row_to_json(t)::text AS raw FROM ${tx(table)} t
        WHERE organization_id=${REPEAT_ORGANIZATION_ID}::uuid
        ORDER BY row_to_json(t)::text COLLATE "C"
      `.cursor(8)) {
        for (const row of batch) { hash.update(`${row.raw}\n`); count++; }
      }
      if (count !== manifest.tables[table]?.rows || hash.digest("hex") !== manifest.tables[table]?.sha256) {
        throw new Error(`REPEAT_SEED_RESTORED_STATE_MISMATCH:${table}`);
      }
    }
  });
  return saved.metadata as T;
}
