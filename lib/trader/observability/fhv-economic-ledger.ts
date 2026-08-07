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

/* -------------------------------------------------------------------------- */
/* Verified immutable snapshot (WP-6A OPTION_E)                               */
/* -------------------------------------------------------------------------- */

export class SealedLedgerRowContractError extends Error {
  constructor(
    readonly classification: string,
    detail: string,
  ) {
    super(`${classification}: ${detail}`);
    this.name = "SealedLedgerRowContractError";
  }
}

/** SQLite rowid captured at prune time, used only to replicate legacy export ordering. */
export function readLegacyRowid(row: Readonly<Record<string, unknown>>, kind: string): number {
  const raw = row.__rowid;
  if (raw == null) {
    throw new SealedLedgerRowContractError(
      "FHV_SEALED_LEDGER_MISSING_ROWID",
      `${kind} row ${String(row.id)} has no captured legacy rowid`,
    );
  }
  const value = typeof raw === "bigint" ? Number(raw) : Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new SealedLedgerRowContractError(
      "FHV_SEALED_LEDGER_UNSAFE_ROWID",
      `${kind} row ${String(row.id)} rowid ${String(raw)} exceeds safe integer range`,
    );
  }
  return value;
}

function requireString(row: Readonly<Record<string, unknown>>, column: string): string {
  const value = row[column];
  if (typeof value !== "string") {
    throw new SealedLedgerRowContractError(
      "FHV_SEALED_LEDGER_ROW_CONTRACT",
      `column ${column} expected string, got ${typeof value}`,
    );
  }
  return value;
}

function nullableString(row: Readonly<Record<string, unknown>>, column: string): string | null {
  const value = row[column];
  return value == null ? null : String(value);
}

/** `timestamp_ms` integer columns reconstruct to the exact same Date the legacy mapper returns. */
function requireDate(row: Readonly<Record<string, unknown>>, column: string): Date {
  const value = row[column];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new SealedLedgerRowContractError(
      "FHV_SEALED_LEDGER_ROW_CONTRACT",
      `column ${column} expected timestamp_ms number, got ${typeof value}`,
    );
  }
  return new Date(value);
}

export type FhvSealedLedgerIndex = Readonly<{
  chainDigest: string;
  segmentCount: number;
  rowCount: number;
  /** Sealed orders in ascending legacy rowid order. */
  orders: readonly { rowid: number; row: Readonly<Record<string, unknown>> }[];
  ordersById: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
  eventsByOrderId: ReadonlyMap<string, readonly Readonly<Record<string, unknown>>[]>;
  fillsByOrderId: ReadonlyMap<string, readonly Readonly<Record<string, unknown>>[]>;
}>;

/**
 * Verify the ledger once and build every index once.
 *
 * Reads never re-verify, re-hash or rescan. Construction is O(rows); each later lookup is an
 * indexed map hit bounded by output size.
 */
export function openFhvVerifiedEconomicLedgerSnapshot(runDir: string): FhvSealedLedgerIndex {
  const verification = verifyFhvEconomicLedger(runDir);
  if (!verification.ok) {
    throw new SealedLedgerRowContractError(
      "FHV_SEALED_LEDGER_DIGEST_MISMATCH",
      verification.failures.join(","),
    );
  }

  const rows = readFhvEconomicLedgerRows(runDir);
  const orders: { rowid: number; row: Readonly<Record<string, unknown>> }[] = [];
  const ordersById = new Map<string, Readonly<Record<string, unknown>>>();
  const eventsByOrderId = new Map<string, Readonly<Record<string, unknown>>[]>();
  const fillsByOrderId = new Map<string, Readonly<Record<string, unknown>>[]>();

  for (const entry of rows) {
    const row = entry.row;
    if (entry.kind === "trader_orders") {
      const id = requireString(row, "id");
      if (ordersById.has(id)) {
        throw new SealedLedgerRowContractError(
          "FHV_SEALED_LEDGER_CONFLICTING_OVERLAP",
          `duplicate sealed order ${id}`,
        );
      }
      ordersById.set(id, row);
      orders.push({ rowid: readLegacyRowid(row, "trader_orders"), row });
    } else if (entry.kind === "trader_order_events") {
      const orderId = requireString(row, "order_id");
      const list = eventsByOrderId.get(orderId) ?? [];
      list.push(row);
      eventsByOrderId.set(orderId, list);
    } else if (entry.kind === "trader_fills") {
      const orderId = requireString(row, "order_id");
      const list = fillsByOrderId.get(orderId) ?? [];
      list.push(row);
      fillsByOrderId.set(orderId, list);
    }
  }

  orders.sort((a, b) => a.rowid - b.rowid);
  // Legacy listEvents orders by seq; the unique (order_id, seq) index makes this total.
  for (const [orderId, list] of eventsByOrderId) {
    const seen = new Set<number>();
    for (const row of list) {
      const seq = Number(row.seq);
      if (seen.has(seq)) {
        throw new SealedLedgerRowContractError(
          "FHV_SEALED_LEDGER_SEQUENCE_GAP",
          `duplicate event seq ${seq} for order ${orderId}`,
        );
      }
      seen.add(seq);
    }
    list.sort((a, b) => Number(a.seq) - Number(b.seq));
  }
  // Legacy listFills under an IDHPS session orders by (executed_at, id).
  for (const list of fillsByOrderId.values()) {
    list.sort(
      (a, b) =>
        Number(a.executed_at) - Number(b.executed_at) ||
        String(a.id).localeCompare(String(b.id)),
    );
  }

  return {
    chainDigest: verification.chainDigest,
    segmentCount: verification.segmentCount,
    rowCount: rows.length,
    orders,
    ordersById,
    eventsByOrderId,
    fillsByOrderId,
  };
}

export function mapSealedOrderRow(row: Readonly<Record<string, unknown>>): {
  id: string;
  organizationId: string;
  credentialId: string | null;
  venue: string;
  executionMode: string;
  symbol: string;
  side: string;
  type: string;
  price: string | null;
  quantity: string;
  filledQuantity: string;
  avgFillPrice: string | null;
  state: string;
  stateVersion: number;
  exchangeOrderId: string | null;
  clientOrderId: string;
  idempotencyKey: string;
  riskDecisionId: string;
  strategySignalId: string | null;
  allocationDecisionId: string | null;
  createdAt: Date;
  updatedAt: Date;
} {
  return {
    id: requireString(row, "id"),
    organizationId: requireString(row, "organization_id"),
    credentialId: nullableString(row, "credential_id"),
    venue: requireString(row, "venue"),
    executionMode: requireString(row, "execution_mode"),
    symbol: requireString(row, "symbol"),
    side: requireString(row, "side"),
    type: requireString(row, "type"),
    price: nullableString(row, "price"),
    quantity: requireString(row, "quantity"),
    filledQuantity: requireString(row, "filled_quantity"),
    avgFillPrice: nullableString(row, "avg_fill_price"),
    state: requireString(row, "state"),
    stateVersion: Number(row.state_version),
    exchangeOrderId: nullableString(row, "exchange_order_id"),
    clientOrderId: requireString(row, "client_order_id"),
    idempotencyKey: requireString(row, "idempotency_key"),
    riskDecisionId: requireString(row, "risk_decision_id"),
    strategySignalId: nullableString(row, "strategy_signal_id"),
    allocationDecisionId: nullableString(row, "allocation_decision_id"),
    createdAt: requireDate(row, "created_at"),
    updatedAt: requireDate(row, "updated_at"),
  };
}

export function mapSealedEventRow(row: Readonly<Record<string, unknown>>): {
  id: string;
  organizationId: string;
  orderId: string;
  seq: number;
  fromState: string | null;
  toState: string;
  eventType: string;
  payload: string | null;
  occurredAt: Date;
  createdAt: Date;
} {
  return {
    id: requireString(row, "id"),
    organizationId: requireString(row, "organization_id"),
    orderId: requireString(row, "order_id"),
    seq: Number(row.seq),
    fromState: nullableString(row, "from_state"),
    toState: requireString(row, "to_state"),
    eventType: requireString(row, "event_type"),
    payload: nullableString(row, "payload"),
    occurredAt: requireDate(row, "occurred_at"),
    createdAt: requireDate(row, "created_at"),
  };
}

export function mapSealedFillRow(row: Readonly<Record<string, unknown>>): {
  id: string;
  organizationId: string;
  orderId: string;
  exchangeTradeId: string;
  price: string;
  quantity: string;
  fee: string;
  feeAsset: string;
  executedAt: Date;
  createdAt: Date;
} {
  return {
    id: requireString(row, "id"),
    organizationId: requireString(row, "organization_id"),
    orderId: requireString(row, "order_id"),
    exchangeTradeId: requireString(row, "exchange_trade_id"),
    price: requireString(row, "price"),
    quantity: requireString(row, "quantity"),
    fee: requireString(row, "fee"),
    feeAsset: requireString(row, "fee_asset"),
    executedAt: requireDate(row, "executed_at"),
    createdAt: requireDate(row, "created_at"),
  };
}
