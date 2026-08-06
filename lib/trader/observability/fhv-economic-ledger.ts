import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";

/**
 * FHV append-only economic ledger (ADR-0025 AD-2).
 *
 * The historical economic record — order rows, order events, fills and lifecycle events — is the
 * only unbounded growth surface in `session.sqlite`, and every epoch checkpoint copies and hashes
 * that whole database. Streaming these rows into digest-chained segments lets the hot-state
 * database stay bounded while the history remains authoritative and reconstructable.
 *
 * Rows are sealed here BEFORE they are pruned from SQLite. A crash between seal and prune leaves
 * the rows in both places, which is recoverable; the reverse order would lose economic history.
 */

export const FHV_ECONOMIC_LEDGER_SCHEMA = "fhv-economic-ledger-segment/v1" as const;
export const FHV_ECONOMIC_LEDGER_DIRNAME = "economic-ledger";
export const FHV_ECONOMIC_LEDGER_MANIFEST_FILENAME = "economic-ledger-manifest.v1.json";

export type FhvEconomicLedgerKind =
  | "trader_orders"
  | "trader_order_events"
  | "trader_fills"
  | "trader_lifecycle_events";

export type FhvEconomicLedgerRow = Readonly<{
  kind: FhvEconomicLedgerKind;
  row: Readonly<Record<string, unknown>>;
}>;

export type FhvEconomicLedgerSegmentV1 = Readonly<{
  schemaVersion: typeof FHV_ECONOMIC_LEDGER_SCHEMA;
  epochId: number;
  seq: number;
  rowCount: number;
  countsByKind: Readonly<Record<string, number>>;
  prevChainDigest: string;
  payloadDigest: string;
  chainDigest: string;
}>;

export type FhvEconomicLedgerManifestV1 = Readonly<{
  schemaVersion: "fhv-economic-ledger-manifest/v1";
  segments: readonly FhvEconomicLedgerSegmentV1[];
  chainDigest: string;
  totalRowCount: number;
}>;

const GENESIS_DIGEST = "0".repeat(64);

export function resolveFhvEconomicLedgerDir(runDir: string): string {
  return join(runDir, FHV_ECONOMIC_LEDGER_DIRNAME);
}

function resolveManifestPath(runDir: string): string {
  return join(resolveFhvEconomicLedgerDir(runDir), FHV_ECONOMIC_LEDGER_MANIFEST_FILENAME);
}

function resolveSegmentPath(runDir: string, seq: number): string {
  return join(
    resolveFhvEconomicLedgerDir(runDir),
    `segment-${String(seq).padStart(8, "0")}.ndjson`,
  );
}

export function readFhvEconomicLedgerManifest(runDir: string): FhvEconomicLedgerManifestV1 {
  const path = resolveManifestPath(runDir);
  if (!existsSync(path)) {
    return {
      schemaVersion: "fhv-economic-ledger-manifest/v1",
      segments: [],
      chainDigest: GENESIS_DIGEST,
      totalRowCount: 0,
    };
  }
  return JSON.parse(readFileSync(path, "utf8")) as FhvEconomicLedgerManifestV1;
}

function writeFileAtomicFsync(path: string, contents: string): void {
  const tempPath = `${path}.tmp-${process.pid}`;
  const fd = openSync(tempPath, "w");
  try {
    writeSync(fd, contents);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tempPath, path);
}

/**
 * Seal one epoch's economic rows into a durable, digest-chained segment.
 *
 * Returns the updated manifest. Sealing an empty row set is a no-op so epochs without economic
 * activity do not perturb the chain.
 */
export function sealFhvEconomicLedgerEpoch(input: {
  runDir: string;
  epochId: number;
  rows: readonly FhvEconomicLedgerRow[];
}): FhvEconomicLedgerManifestV1 {
  const manifest = readFhvEconomicLedgerManifest(input.runDir);
  if (input.rows.length === 0) {
    return manifest;
  }

  const dir = resolveFhvEconomicLedgerDir(input.runDir);
  mkdirSync(dir, { recursive: true });

  const seq = manifest.segments.length;
  const payload = `${input.rows.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
  const payloadDigest = createHash("sha256").update(payload).digest("hex");
  const prevChainDigest = manifest.chainDigest;
  const chainDigest = createHash("sha256")
    .update(`${prevChainDigest}:${payloadDigest}`)
    .digest("hex");

  const countsByKind: Record<string, number> = {};
  for (const entry of input.rows) {
    countsByKind[entry.kind] = (countsByKind[entry.kind] ?? 0) + 1;
  }

  writeFileAtomicFsync(resolveSegmentPath(input.runDir, seq), payload);

  const segment: FhvEconomicLedgerSegmentV1 = {
    schemaVersion: FHV_ECONOMIC_LEDGER_SCHEMA,
    epochId: input.epochId,
    seq,
    rowCount: input.rows.length,
    countsByKind,
    prevChainDigest,
    payloadDigest,
    chainDigest,
  };
  const next: FhvEconomicLedgerManifestV1 = {
    schemaVersion: "fhv-economic-ledger-manifest/v1",
    segments: [...manifest.segments, segment],
    chainDigest,
    totalRowCount: manifest.totalRowCount + input.rows.length,
  };
  writeFileAtomicFsync(resolveManifestPath(input.runDir), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

/** Reconstruct every sealed economic row in seal order. */
export function readFhvEconomicLedgerRows(runDir: string): FhvEconomicLedgerRow[] {
  const dir = resolveFhvEconomicLedgerDir(runDir);
  if (!existsSync(dir)) {
    return [];
  }
  const rows: FhvEconomicLedgerRow[] = [];
  const segments = readdirSync(dir)
    .filter((name) => name.startsWith("segment-") && name.endsWith(".ndjson"))
    .sort();
  for (const name of segments) {
    const contents = readFileSync(join(dir, name), "utf8");
    for (const line of contents.split("\n")) {
      if (line.trim().length > 0) {
        rows.push(JSON.parse(line) as FhvEconomicLedgerRow);
      }
    }
  }
  return rows;
}

/**
 * Fail-closed integrity check: every segment must rehash to its recorded digest and the chain
 * must link. Missing or contradictory evidence is a failure, never a neutral result.
 */
export function verifyFhvEconomicLedger(runDir: string): {
  ok: boolean;
  chainDigest: string;
  segmentCount: number;
  failures: string[];
} {
  const manifest = readFhvEconomicLedgerManifest(runDir);
  const failures: string[] = [];
  let expectedPrev = GENESIS_DIGEST;

  for (const segment of manifest.segments) {
    const path = resolveSegmentPath(runDir, segment.seq);
    if (!existsSync(path)) {
      failures.push(`missing_segment:${segment.seq}`);
      continue;
    }
    const payload = readFileSync(path, "utf8");
    const payloadDigest = createHash("sha256").update(payload).digest("hex");
    if (payloadDigest !== segment.payloadDigest) {
      failures.push(`payload_digest_mismatch:${segment.seq}`);
    }
    if (segment.prevChainDigest !== expectedPrev) {
      failures.push(`chain_break:${segment.seq}`);
    }
    const chainDigest = createHash("sha256")
      .update(`${segment.prevChainDigest}:${segment.payloadDigest}`)
      .digest("hex");
    if (chainDigest !== segment.chainDigest) {
      failures.push(`chain_digest_mismatch:${segment.seq}`);
    }
    expectedPrev = segment.chainDigest;
  }

  if (manifest.segments.length > 0 && manifest.chainDigest !== expectedPrev) {
    failures.push("manifest_chain_digest_mismatch");
  }

  return {
    ok: failures.length === 0,
    chainDigest: manifest.chainDigest,
    segmentCount: manifest.segments.length,
    failures,
  };
}
