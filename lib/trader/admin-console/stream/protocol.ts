import type { AdminStreamTopic } from "@/lib/trader/admin-console/contracts";

export type ChangeLogRow = {
  seq: string;
  xid: string;
  changedAt: string;
  sourceTable: string;
  op: "INSERT" | "UPDATE" | "DELETE";
  entityId: string;
  organizationId: string | null;
  entityVersion: string | null;
};

export type ConsoleStreamEvent = {
  eventId: string;
  schemaVersion: "admin-stream/v1";
  type:
    | "upsert"
    | "entity_removed"
    | "snapshot"
    | "resync_required"
    | "access_revoked"
    | "heartbeat";
  topic: string;
  entityId: string;
  organizationId: string | null;
  entityVersion: string;
  occurredAt: string;
  acceptedAt: string;
  detectedAt: string;
  projectedAt: string;
  sentAt: string;
  cursor: string;
  payload: unknown;
};

export const STREAM_PAGE_LIMIT = 500;
export const STREAM_MAX_PAGES = 10;
export const STREAM_BACKLOG_RESYNC = 20_000;
export const STREAM_SENT_CAP = 10_000;

const TABLE_TOPIC: Record<string, AdminStreamTopic> = {
  trader_orders: "orders",
  trader_fills: "fills",
  trader_trade_legs: "positions",
  trader_position_lots: "positions",
  trader_trades: "positions",
  trader_account_collection_state: "accounts",
  exchange_credentials: "accounts",
  trader_risk_account_state_v2: "accounts",
  trader_kill_switches: "accounts",
  trader_org_live_enable: "accounts",
  trader_account_status: "accounts",
  trader_invoices: "billing",
  trader_invoice_corrections: "billing",
  trader_invoice_disputes: "billing",
  trader_settlement_applications: "billing",
  trader_settlement_reconciliation_cases: "billing",
  trader_reporting_periods: "billing",
  trader_strategy_promotion_records: "strategies",
  trader_strategy_lifecycle_event: "strategies",
  trader_human_promotion_proposal_v2: "strategies",
  trader_historical_simulation_run_lifecycle_event_v2: "research_runs",
  trader_backtest_runs: "research_runs",
  trader_admin_incident: "incidents",
  trader_admin_diagnostic_event: "diagnostics",
  trader_admin_job_run: "jobs",
  trader_admin_news_item: "news",
  trader_admin_market_quote_latest: "market",
  trader_admin_fear_greed: "market",
};

export const DERIVED_TOPICS = ["overview", "attention", "clients"] as const;

export function compareXid(left: string, right: string): number {
  const a = BigInt(left);
  const b = BigInt(right);
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function isXidCursor(value: string): boolean {
  return /^[0-9]+$/.test(value);
}

export function topicForTable(sourceTable: string): AdminStreamTopic | null {
  return TABLE_TOPIC[sourceTable] ?? null;
}

export function entityKey(row: Pick<ChangeLogRow, "sourceTable" | "entityId">): string {
  return `${row.sourceTable}:${row.entityId}`;
}

export function versionOf(row: ChangeLogRow): string {
  return row.entityVersion ?? row.seq;
}

export function collapseChangeRows(rows: readonly ChangeLogRow[]): ChangeLogRow[] {
  const chosen = new Map<string, ChangeLogRow>();
  const order: string[] = [];
  for (const row of rows) {
    const key = entityKey(row);
    if (!chosen.has(key)) order.push(key);
    const previous = chosen.get(key);
    if (!previous || BigInt(row.seq) >= BigInt(previous.seq)) chosen.set(key, row);
  }
  return order.map((key) => chosen.get(key)!);
}

export type ProjectedChange = {
  topic: string;
  removed: boolean;
  payload: unknown;
};

export function projectChangeRow(row: ChangeLogRow): ProjectedChange | null {
  const topic = topicForTable(row.sourceTable);
  if (!topic) return null;
  return {
    topic,
    removed: row.op === "DELETE",
    payload: {
      sourceTable: row.sourceTable,
      op: row.op,
      entityId: row.entityId,
    },
  };
}

export type StreamTickInput = {
  cursor: string | null;
  w1: string;
  rows: readonly ChangeLogRow[];
  moreRemain: boolean;
  backlog: number;
  sent: ReadonlyMap<string, string>;
  minRetainedXid: string | null;
  now: string;
  topics: readonly string[];
  project?: (row: ChangeLogRow) => ProjectedChange | null;
};

export type StreamTickResult = {
  events: ConsoleStreamEvent[];
  cursor: string;
  sentSeqs: string[];
  retained: Array<[string, string]>;
  resync: boolean;
  advanced: boolean;
};

function resyncEvent(now: string, cursor: string): ConsoleStreamEvent {
  return {
    eventId: `resync:${cursor}:${now}`,
    schemaVersion: "admin-stream/v1",
    type: "resync_required",
    topic: "overview",
    entityId: "stream",
    organizationId: null,
    entityVersion: "0",
    occurredAt: now,
    acceptedAt: now,
    detectedAt: now,
    projectedAt: now,
    sentAt: now,
    cursor,
    payload: { reason: "resync_required" },
  };
}

function emptyTick(now: string, cursor: string): StreamTickResult {
  return {
    events: [resyncEvent(now, cursor)],
    cursor,
    sentSeqs: [],
    retained: [],
    resync: true,
    advanced: false,
  };
}

export function planStreamTick(input: StreamTickInput): StreamTickResult {
  const project = input.project ?? projectChangeRow;
  if (input.cursor !== null && !isXidCursor(input.cursor)) return emptyTick(input.now, input.w1);
  if (
    input.cursor !== null &&
    input.minRetainedXid !== null &&
    compareXid(input.cursor, input.minRetainedXid) < 0
  ) {
    return emptyTick(input.now, input.w1);
  }
  if (input.backlog > STREAM_BACKLOG_RESYNC) return emptyTick(input.now, input.w1);

  const watermark = input.cursor ?? input.w1;
  const visible = input.rows.filter((row) => compareXid(row.xid, watermark) >= 0);
  const fresh = visible.filter((row) => !input.sent.has(row.seq));
  const collapsed = collapseChangeRows(fresh);
  const subscribed = new Set(input.topics);
  const advanced = !input.moreRemain;
  const nextCursor = advanced ? input.w1 : watermark;
  const events: ConsoleStreamEvent[] = [];
  let maxSeq = "0";
  for (const row of collapsed) {
    if (BigInt(row.seq) > BigInt(maxSeq)) maxSeq = row.seq;
    const projected = project(row);
    if (!projected || !subscribed.has(projected.topic)) continue;
    events.push({
      eventId: `cl:${row.seq}`,
      schemaVersion: "admin-stream/v1",
      type: projected.removed ? "entity_removed" : "upsert",
      topic: projected.topic,
      entityId: entityKey(row),
      organizationId: row.organizationId,
      entityVersion: versionOf(row),
      occurredAt: row.changedAt,
      acceptedAt: row.changedAt,
      detectedAt: input.now,
      projectedAt: input.now,
      sentAt: input.now,
      cursor: nextCursor,
      payload: projected.payload,
    });
  }

  if (fresh.length > 0) {
    for (const topic of DERIVED_TOPICS) {
      if (!subscribed.has(topic)) continue;
      events.push({
        eventId: `derived:${topic}:${maxSeq}`,
        schemaVersion: "admin-stream/v1",
        type: "snapshot",
        topic,
        entityId: `${topic}:fleet`,
        organizationId: null,
        entityVersion: maxSeq,
        occurredAt: input.now,
        acceptedAt: input.now,
        detectedAt: input.now,
        projectedAt: input.now,
        sentAt: input.now,
        cursor: nextCursor,
        payload: { reason: "source_changed" },
      });
    }
  }

  const retained = new Map<string, string>();
  for (const [seq, xid] of input.sent) {
    if (compareXid(xid, nextCursor) >= 0) retained.set(seq, xid);
  }
  for (const row of fresh) {
    if (compareXid(row.xid, nextCursor) >= 0) retained.set(row.seq, row.xid);
  }
  if (retained.size > STREAM_SENT_CAP) return emptyTick(input.now, input.w1);

  return {
    events,
    cursor: nextCursor,
    sentSeqs: [...retained.keys()],
    retained: [...retained],
    resync: false,
    advanced,
  };
}

export type EntityCache = Map<string, { version: string; payload: unknown }>;

export function applyConsoleEvent(
  cache: EntityCache,
  event: Pick<ConsoleStreamEvent, "type" | "entityId" | "entityVersion" | "payload">,
): "applied" | "ignored" {
  if (event.type !== "upsert" && event.type !== "entity_removed" && event.type !== "snapshot") {
    return "ignored";
  }
  const known = cache.get(event.entityId);
  if (known && BigInt(event.entityVersion) <= BigInt(known.version)) return "ignored";
  if (event.type === "entity_removed") {
    cache.delete(event.entityId);
    return "applied";
  }
  cache.set(event.entityId, { version: event.entityVersion, payload: event.payload });
  return "applied";
}

export function heartbeatEvent(cursor: string, now: string): ConsoleStreamEvent {
  return {
    eventId: `heartbeat:${now}`,
    schemaVersion: "admin-stream/v1",
    type: "heartbeat",
    topic: "overview",
    entityId: "stream",
    organizationId: null,
    entityVersion: "0",
    occurredAt: now,
    acceptedAt: now,
    detectedAt: now,
    projectedAt: now,
    sentAt: now,
    cursor,
    payload: { kind: "heartbeat" },
  };
}

export function accessRevokedEvent(now: string): ConsoleStreamEvent {
  return {
    eventId: `access:${now}`,
    schemaVersion: "admin-stream/v1",
    type: "access_revoked",
    topic: "overview",
    entityId: "stream",
    organizationId: null,
    entityVersion: "0",
    occurredAt: now,
    acceptedAt: now,
    detectedAt: now,
    projectedAt: now,
    sentAt: now,
    cursor: "0",
    payload: { reason: "access_revoked" },
  };
}
