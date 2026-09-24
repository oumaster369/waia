/**
 * AI-TRADER admin console tables (DEE-1050). DDL lives in migrations 0214–0215.
 * The change log stores identifiers only.
 */

import {
  bigint,
  bigserial,
  customType,
  date,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { pgTable } from "drizzle-orm/pg-core";

const xid8 = customType<{ data: string }>({ dataType: () => "xid8" });

const tz = { withTimezone: true, mode: "date" } as const;

export const traderAdminMarketQuoteLatest = pgTable(
  "trader_admin_market_quote_latest",
  {
    source: text("source").notNull(),
    symbol: text("symbol").notNull(),
    base: text("base").notNull(),
    quote: text("quote").notNull(),
    last: text("last"),
    bid: text("bid"),
    ask: text("ask"),
    open24h: text("open_24h"),
    high24h: text("high_24h"),
    low24h: text("low_24h"),
    volume24h: text("volume_24h"),
    priceDefinition: text("price_definition").notNull(),
    sourceTs: timestamp("source_ts", tz),
    observedAt: timestamp("observed_at", tz).notNull(),
  },
  (t) => [primaryKey({ columns: [t.source, t.symbol] })],
);

export const traderAdminMarketQuoteMinute = pgTable(
  "trader_admin_market_quote_minute",
  {
    source: text("source").notNull(),
    symbol: text("symbol").notNull(),
    minute: timestamp("minute", tz).notNull(),
    close: text("close").notNull(),
    observedAt: timestamp("observed_at", tz).notNull(),
  },
  (t) => [primaryKey({ columns: [t.source, t.symbol, t.minute] })],
);

export const traderAdminFearGreed = pgTable("trader_admin_fear_greed", {
  day: date("day").primaryKey(),
  value: integer("value").notNull(),
  classification: text("classification").notNull(),
  sourceTs: timestamp("source_ts", tz),
  nextUpdateAt: timestamp("next_update_at", tz),
  observedAt: timestamp("observed_at", tz).notNull(),
});

export const traderAdminChangeLog = pgTable(
  "trader_admin_change_log",
  {
    seq: bigserial("seq", { mode: "number" }).primaryKey(),
    xid: xid8("xid").notNull(),
    changedAt: timestamp("changed_at", tz).notNull(),
    sourceTable: text("source_table").notNull(),
    op: text("op").notNull(),
    entityId: text("entity_id").notNull(),
    organizationId: uuid("organization_id"),
    entityVersion: bigint("entity_version", { mode: "number" }),
  },
  (t) => [
    index("trader_admin_change_log_xid_idx").on(t.xid),
    index("trader_admin_change_log_changed_at_idx").on(t.changedAt),
  ],
);

export const traderAdminNewsItem = pgTable(
  "trader_admin_news_item",
  {
    id: uuid("id").primaryKey(),
    dedupeKey: text("dedupe_key").notNull(),
    clusterKey: text("cluster_key"),
    source: text("source").notNull(),
    url: text("url").notNull(),
    publishedAt: timestamp("published_at", tz),
    firstObservedAt: timestamp("first_observed_at", tz).notNull(),
    symbols: text("symbols").array().notNull(),
    category: text("category").notNull(),
    currentVersion: integer("current_version").notNull().default(1),
  },
  (t) => [
    unique("trader_admin_news_item_dedupe_key_unique").on(t.dedupeKey),
    index("trader_admin_news_item_cluster_key_idx").on(t.clusterKey),
  ],
);

export const traderAdminNewsItemVersion = pgTable(
  "trader_admin_news_item_version",
  {
    newsItemId: uuid("news_item_id").notNull(),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    summary: text("summary"),
    contentHash: text("content_hash").notNull(),
    observedAt: timestamp("observed_at", tz).notNull(),
  },
  (t) => [primaryKey({ columns: [t.newsItemId, t.version] })],
);

export const traderAdminAccountValuation = pgTable("trader_admin_account_valuation", {
  id: uuid("id").primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  exchangeAccountId: text("exchange_account_id").notNull(),
  valuationKey: text("valuation_key").notNull(),
  observationId: uuid("observation_id"),
  observationRecordedAt: timestamp("observation_recorded_at", tz),
  lotsRevision: text("lots_revision").notNull(),
  quoteSetJson: jsonb("quote_set_json").notNull(),
  quoteSetDigest: text("quote_set_digest").notNull(),
  methodVersion: text("method_version").notNull(),
  equity: text("equity").notNull(),
  freeQuote: text("free_quote").notNull(),
  lockedQuote: text("locked_quote").notNull(),
  holdingsValue: text("holdings_value").notNull(),
  traderLotsValue: text("trader_lots_value").notNull(),
  traderCostBasis: text("trader_cost_basis").notNull(),
  traderUnrealized: text("trader_unrealized").notNull(),
  currency: text("currency").notNull().default("USDT"),
  state: text("state").notNull(),
  reasons: jsonb("reasons").notNull(),
  computedAt: timestamp("computed_at", tz).notNull(),
});

export const traderAdminEquityPoint = pgTable(
  "trader_admin_equity_point",
  {
    organizationId: uuid("organization_id").notNull(),
    exchangeAccountId: text("exchange_account_id").notNull(),
    bucket: timestamp("bucket", tz).notNull(),
    equity: text("equity").notNull(),
    traderUnrealized: text("trader_unrealized").notNull(),
    valuationKey: text("valuation_key").notNull(),
    methodVersion: text("method_version").notNull(),
    state: text("state").notNull(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.exchangeAccountId, t.bucket] })],
);

export const traderAdminDiagnosticEvent = pgTable("trader_admin_diagnostic_event", {
  id: uuid("id").primaryKey(),
  occurredAt: timestamp("occurred_at", tz).notNull(),
  receivedAt: timestamp("received_at", tz).notNull(),
  service: text("service").notNull(),
  environment: text("environment").notNull(),
  release: text("release"),
  severity: text("severity").notNull(),
  errorClass: text("error_class").notNull(),
  messageRedacted: text("message_redacted").notNull(),
  stackRedacted: text("stack_redacted"),
  fingerprint: text("fingerprint").notNull(),
  route: text("route"),
  organizationId: uuid("organization_id"),
  exchangeAccountId: text("exchange_account_id"),
  strategyId: text("strategy_id"),
  stage: text("stage"),
  cycleId: text("cycle_id"),
  orderId: text("order_id"),
  traceId: text("trace_id"),
  contextJson: jsonb("context_json").notNull(),
});

export const traderAdminIncident = pgTable("trader_admin_incident", {
  id: uuid("id").primaryKey(),
  environment: text("environment").notNull(),
  service: text("service").notNull(),
  fingerprint: text("fingerprint").notNull(),
  title: text("title").notNull(),
  severity: text("severity").notNull(),
  status: text("status").notNull(),
  firstSeenAt: timestamp("first_seen_at", tz).notNull(),
  lastSeenAt: timestamp("last_seen_at", tz).notNull(),
  occurrences: integer("occurrences").notNull().default(1),
  affectedAccounts: integer("affected_accounts").notNull().default(0),
  firstRelease: text("first_release"),
  lastRelease: text("last_release"),
  resolvedAt: timestamp("resolved_at", tz),
  resolvedRelease: text("resolved_release"),
  assignee: text("assignee"),
  fixUrl: text("fix_url"),
  mutedUntil: timestamp("muted_until", tz),
  note: text("note"),
  stateVersion: integer("state_version").notNull().default(1),
});

export const traderAdminIncidentEvent = pgTable("trader_admin_incident_event", {
  id: uuid("id").primaryKey(),
  incidentId: uuid("incident_id").notNull(),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  actorUserId: uuid("actor_user_id"),
  reason: text("reason"),
  evidence: text("evidence"),
  createdAt: timestamp("created_at", tz).notNull(),
});

export const traderAdminJobRun = pgTable("trader_admin_job_run", {
  id: uuid("id").primaryKey(),
  jobKey: text("job_key").notNull(),
  startedAt: timestamp("started_at", tz).notNull(),
  finishedAt: timestamp("finished_at", tz),
  status: text("status").notNull(),
  processed: integer("processed").notNull().default(0),
  blocked: integer("blocked").notNull().default(0),
  errorClass: text("error_class"),
  errorMessageRedacted: text("error_message_redacted"),
  release: text("release"),
  detailsJson: jsonb("details_json").notNull(),
});

export const traderAdminAssistantConversation = pgTable("trader_admin_assistant_conversation", {
  id: uuid("id").primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  adminUserId: uuid("admin_user_id").notNull(),
  title: text("title").notNull(),
  createdAt: timestamp("created_at", tz).notNull(),
  updatedAt: timestamp("updated_at", tz).notNull(),
  archivedAt: timestamp("archived_at", tz),
});

export const traderAdminAssistantMessage = pgTable("trader_admin_assistant_message", {
  id: uuid("id").primaryKey(),
  conversationId: uuid("conversation_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  blocksJson: jsonb("blocks_json"),
  status: text("status").notNull(),
  scopeJson: jsonb("scope_json"),
  attachmentsJson: jsonb("attachments_json"),
  citationsJson: jsonb("citations_json"),
  dataRevisionsJson: jsonb("data_revisions_json"),
  cacheKey: text("cache_key"),
  provider: text("provider"),
  model: text("model"),
  providerLifecycle: text("provider_lifecycle"),
  promptVersion: text("prompt_version"),
  toolPolicyVersion: text("tool_policy_version"),
  latencyMs: integer("latency_ms"),
  usageJson: jsonb("usage_json"),
  errorCode: text("error_code"),
  createdAt: timestamp("created_at", tz).notNull(),
});

export const traderAdminAssistantToolCall = pgTable("trader_admin_assistant_tool_call", {
  id: uuid("id").primaryKey(),
  messageId: uuid("message_id").notNull(),
  toolName: text("tool_name").notNull(),
  toolVersion: text("tool_version").notNull(),
  argsJson: jsonb("args_json").notNull(),
  resultDigest: text("result_digest"),
  resultSummaryJson: jsonb("result_summary_json"),
  status: text("status").notNull(),
  startedAt: timestamp("started_at", tz).notNull(),
  finishedAt: timestamp("finished_at", tz),
  errorCode: text("error_code"),
});

export const traderAdminSavedView = pgTable("trader_admin_saved_view", {
  id: uuid("id").primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  adminUserId: uuid("admin_user_id").notNull(),
  section: text("section").notNull(),
  name: text("name").notNull(),
  stateJson: jsonb("state_json").notNull(),
  createdAt: timestamp("created_at", tz).notNull(),
  updatedAt: timestamp("updated_at", tz).notNull(),
});

export const traderAdminVisitMarker = pgTable("trader_admin_visit_marker", {
  adminUserId: uuid("admin_user_id").primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  lastSeenAt: timestamp("last_seen_at", tz).notNull(),
  previousSeenAt: timestamp("previous_seen_at", tz),
});
