import { sql } from "drizzle-orm";

import type { AdminReadTx } from "@/lib/trader/admin-console/repositories/snapshot.postgres";
import {
  STREAM_MAX_PAGES,
  STREAM_PAGE_LIMIT,
  type ChangeLogRow,
} from "@/lib/trader/admin-console/stream/protocol";

function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  if (result && typeof result === "object" && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: Record<string, unknown>[] }).rows;
  }
  return [];
}

function text(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return null;
}

function toRow(raw: Record<string, unknown>): ChangeLogRow | null {
  const seq = text(raw.seq);
  const xid = text(raw.xid);
  const changedAt =
    raw.changed_at instanceof Date ? raw.changed_at.toISOString() : text(raw.changed_at);
  const sourceTable = text(raw.source_table);
  const op = text(raw.op);
  const entityId = text(raw.entity_id);
  if (!seq || !xid || !changedAt || !sourceTable || !entityId) return null;
  if (op !== "INSERT" && op !== "UPDATE" && op !== "DELETE") return null;
  return {
    seq,
    xid,
    changedAt,
    sourceTable,
    op,
    entityId,
    organizationId: text(raw.organization_id),
    entityVersion: text(raw.entity_version),
  };
}

export async function readChangeLogPage(
  tx: AdminReadTx,
  watermark: string,
  afterSeq: string,
  sentSeqs: readonly string[] = [],
): Promise<ChangeLogRow[]> {
  const result = await tx.execute(sql`
    SELECT seq::text AS seq,
           xid::text AS xid,
           changed_at,
           source_table,
           op,
           entity_id,
           organization_id::text AS organization_id,
           entity_version::text AS entity_version
    FROM trader_admin_change_log
    WHERE xid >= ${watermark}::xid8
      AND seq > ${afterSeq}::bigint
      AND NOT (seq = ANY(string_to_array(${sentSeqs.join(",")}, ',')::bigint[]))
    ORDER BY trader_admin_change_log.seq
    LIMIT ${STREAM_PAGE_LIMIT}
  `);
  return rowsOf(result).flatMap((row) => {
    const parsed = toRow(row);
    return parsed ? [parsed] : [];
  });
}

export async function readChangeLogSince(
  tx: AdminReadTx,
  watermark: string,
  sentSeqs: readonly string[] = [],
): Promise<{ rows: ChangeLogRow[]; moreRemain: boolean }> {
  const rows: ChangeLogRow[] = [];
  let afterSeq = "0";
  let moreRemain = false;
  for (let page = 0; page < STREAM_MAX_PAGES; page += 1) {
    const batch = await readChangeLogPage(tx, watermark, afterSeq, sentSeqs);
    rows.push(...batch);
    if (batch.length < STREAM_PAGE_LIMIT) return { rows, moreRemain: false };
    afterSeq = batch[batch.length - 1]?.seq ?? afterSeq;
    moreRemain = page === STREAM_MAX_PAGES - 1;
  }
  return { rows, moreRemain };
}

export async function readChangeLogBacklog(tx: AdminReadTx, watermark: string): Promise<number> {
  const result = await tx.execute(sql`
    SELECT count(*)::text AS count
    FROM trader_admin_change_log
    WHERE xid >= ${watermark}::xid8
  `);
  const count = text(rowsOf(result)[0]?.count);
  return count ? Number(count) : 0;
}

export async function readMinChangeLogXid(tx: AdminReadTx): Promise<string | null> {
  const result = await tx.execute(sql`SELECT min(xid)::text AS xid FROM trader_admin_change_log`);
  return text(rowsOf(result)[0]?.xid);
}

export async function credentialRevoked(tx: AdminReadTx, credentialId: string): Promise<boolean> {
  const result = await tx.execute(sql`
    SELECT revoked_at
    FROM exchange_credentials
    WHERE id = ${credentialId}::uuid
  `);
  const row = rowsOf(result)[0];
  if (!row) return true;
  return row.revoked_at != null;
}
