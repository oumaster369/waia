import { enforceServerOnly } from "@/lib/enforce-server-only";
import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import {
  traderAdminDiagnosticEvent,
  traderAdminFearGreed,
  traderAdminIncident,
  traderAdminIncidentEvent,
  traderAdminJobRun,
  traderAdminMarketQuoteLatest,
  traderAdminMarketQuoteMinute,
  traderAdminNewsItem,
  traderAdminNewsItemVersion,
} from "@/db/schema.postgres";
import type { AdminPostgresDb } from "@/lib/trader/admin-console/repositories/snapshot.postgres";
import type {
  CollectorStore,
  JobRunWrite,
} from "@/lib/trader/admin-console/collectors/collector-store";
import type { FearGreedRow } from "@/lib/trader/admin-console/collectors/fear-greed-rows";
import type {
  QuoteLatestRow,
  QuoteMinuteRow,
} from "@/lib/trader/admin-console/collectors/quote-rows";
import { RETENTION_DAYS, retentionCutoff } from "@/lib/trader/admin-console/collectors/schedule";
import { fingerprintDiagnostic } from "@/lib/trader/admin-console/diagnostics/fingerprint";
import { incidentAfterDiagnostic } from "@/lib/trader/admin-console/diagnostics/incident-follow";
import { redactDiagnosticText } from "@/lib/trader/admin-console/diagnostics/redact";
import { collectAccountValuations } from "@/lib/trader/admin-console/collectors/valuation-persist";

enforceServerOnly();

const BATCH = 5000;

export function diagnosticsEnvironment(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.WAIA_DIAGNOSTICS_ENVIRONMENT?.trim();
  if (value === "production" || value === "preview" || value === "local" || value === "ci") {
    return value;
  }
  return "unknown";
}

export function createPostgresCollectorStore(db: AdminPostgresDb): CollectorStore {
  return {
    collectValuations: (now) => collectAccountValuations(db, now),
    async upsertQuotes(latest, minute) {
      await upsertLatest(db, latest);
      await upsertMinute(db, minute);
    },
    async hasFearGreed() {
      const rows = await db
        .select({ day: traderAdminFearGreed.day })
        .from(traderAdminFearGreed)
        .limit(1);
      return rows.length > 0;
    },
    async upsertFearGreed(rows) {
      if (rows.length === 0) return;
      await db
        .insert(traderAdminFearGreed)
        .values(rows.map(fearGreedValues))
        .onConflictDoUpdate({
          target: traderAdminFearGreed.day,
          set: {
            value: sql`excluded.value`,
            classification: sql`excluded.classification`,
            sourceTs: sql`excluded.source_ts`,
            nextUpdateAt: sql`excluded.next_update_at`,
            observedAt: sql`excluded.observed_at`,
          },
        });
    },
    async findNews(dedupeKey) {
      const items = await db
        .select({
          id: traderAdminNewsItem.id,
          currentVersion: traderAdminNewsItem.currentVersion,
        })
        .from(traderAdminNewsItem)
        .where(eq(traderAdminNewsItem.dedupeKey, dedupeKey))
        .limit(1);
      const item = items[0];
      if (!item) return null;
      const versions = await db
        .select({ contentHash: traderAdminNewsItemVersion.contentHash })
        .from(traderAdminNewsItemVersion)
        .where(
          and(
            eq(traderAdminNewsItemVersion.newsItemId, item.id),
            eq(traderAdminNewsItemVersion.version, item.currentVersion),
          ),
        )
        .limit(1);
      const version = versions[0];
      if (!version) return null;
      return { id: item.id, contentHash: version.contentHash, currentVersion: item.currentVersion };
    },
    async applyNews(write) {
      if (write.action === "unchanged") return;
      await db.transaction(
        async (tx) => {
          // Plans are read before persistence; overlapping cron runs may share a
          // stale plan. Serialize even the first insert, then read the actual head.
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtextextended(${`admin-news:${write.dedupeKey}`}, 0))`,
          );
          const [item] = await tx
            .select({
              id: traderAdminNewsItem.id,
              currentVersion: traderAdminNewsItem.currentVersion,
            })
            .from(traderAdminNewsItem)
            .where(eq(traderAdminNewsItem.dedupeKey, write.dedupeKey))
            .for("update");
          let id: string;
          let version: number;
          if (item) {
            if (write.action === "version" && item.id !== write.newsItemId)
              throw new Error("ADMIN_NEWS_IDENTITY_CHANGED");
            const [head] = await tx
              .select({
                contentHash: traderAdminNewsItemVersion.contentHash,
                observedAt: traderAdminNewsItemVersion.observedAt,
              })
              .from(traderAdminNewsItemVersion)
              .where(
                and(
                  eq(traderAdminNewsItemVersion.newsItemId, item.id),
                  eq(traderAdminNewsItemVersion.version, item.currentVersion),
                ),
              );
            if (!head) throw new Error("ADMIN_NEWS_CURRENT_VERSION_MISSING");
            if (
              head.contentHash === write.version.contentHash ||
              head.observedAt.getTime() > Date.parse(write.version.observedAt)
            )
              return;
            id = item.id;
            version = item.currentVersion + 1;
          } else {
            if (write.action !== "insert") throw new Error("ADMIN_NEWS_ITEM_MISSING");
            id = randomUUID();
            version = 1;
            await tx.insert(traderAdminNewsItem).values({
              id,
              dedupeKey: write.dedupeKey,
              clusterKey: write.clusterKey,
              source: write.source,
              url: write.url,
              publishedAt: write.publishedAt ? new Date(write.publishedAt) : null,
              firstObservedAt: new Date(write.firstObservedAt),
              symbols: write.symbols,
              category: write.category,
              currentVersion: version,
            });
          }
          await tx.insert(traderAdminNewsItemVersion).values({
            newsItemId: id,
            version,
            title: write.version.title,
            summary: write.version.summary,
            contentHash: write.version.contentHash,
            observedAt: new Date(write.version.observedAt),
          });
          if (item)
            await tx
              .update(traderAdminNewsItem)
              .set({ currentVersion: version })
              .where(eq(traderAdminNewsItem.id, id));
        },
        { isolationLevel: "read committed" },
      );
    },
    async retain(now) {
      return retainBatch(db, now);
    },
    async recordJobRun(run) {
      await insertJobRun(db, run);
    },
    async recordDiagnostic(input) {
      await insertDiagnostic(db, input);
    },
  };
}

function fearGreedValues(row: FearGreedRow) {
  return {
    day: row.day,
    value: row.value,
    classification: row.classification,
    sourceTs: row.sourceTs ? new Date(row.sourceTs) : null,
    nextUpdateAt: row.nextUpdateAt ? new Date(row.nextUpdateAt) : null,
    observedAt: new Date(row.observedAt),
  };
}

async function upsertLatest(db: AdminPostgresDb, rows: readonly QuoteLatestRow[]): Promise<void> {
  for (let index = 0; index < rows.length; index += 200) {
    const chunk = rows.slice(index, index + 200);
    if (chunk.length === 0) continue;
    await db
      .insert(traderAdminMarketQuoteLatest)
      .values(chunk.map(quoteValues))
      .onConflictDoUpdate({
        target: [traderAdminMarketQuoteLatest.source, traderAdminMarketQuoteLatest.symbol],
        set: {
          base: sql`excluded.base`,
          quote: sql`excluded.quote`,
          last: sql`excluded.last`,
          bid: sql`excluded.bid`,
          ask: sql`excluded.ask`,
          open24h: sql`excluded.open_24h`,
          high24h: sql`excluded.high_24h`,
          low24h: sql`excluded.low_24h`,
          volume24h: sql`excluded.volume_24h`,
          priceDefinition: sql`excluded.price_definition`,
          sourceTs: sql`excluded.source_ts`,
          observedAt: sql`excluded.observed_at`,
        },
      });
  }
}

function quoteValues(row: QuoteLatestRow) {
  return {
    source: row.source,
    symbol: row.symbol,
    base: row.base,
    quote: row.quote,
    last: row.last,
    bid: row.bid,
    ask: row.ask,
    open24h: row.open24h,
    high24h: row.high24h,
    low24h: row.low24h,
    volume24h: row.volume24h,
    priceDefinition: row.priceDefinition,
    sourceTs: row.sourceTs ? new Date(row.sourceTs) : null,
    observedAt: new Date(row.observedAt),
  };
}

async function upsertMinute(db: AdminPostgresDb, rows: readonly QuoteMinuteRow[]): Promise<void> {
  if (rows.length === 0) return;
  await db
    .insert(traderAdminMarketQuoteMinute)
    .values(
      rows.map((row) => ({
        source: row.source,
        symbol: row.symbol,
        minute: new Date(row.minute),
        close: row.close,
        observedAt: new Date(row.observedAt),
      })),
    )
    .onConflictDoUpdate({
      target: [
        traderAdminMarketQuoteMinute.source,
        traderAdminMarketQuoteMinute.symbol,
        traderAdminMarketQuoteMinute.minute,
      ],
      set: {
        close: sql`excluded.close`,
        observedAt: sql`excluded.observed_at`,
      },
    });
}

async function insertJobRun(db: AdminPostgresDb, run: JobRunWrite): Promise<void> {
  await db.insert(traderAdminJobRun).values({
    id: randomUUID(),
    jobKey: run.jobKey,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    status: run.status,
    processed: run.processed,
    blocked: run.blocked,
    errorClass: run.errorClass,
    errorMessageRedacted: run.errorMessage,
    release: process.env.WAIA_RELEASE_SHA?.trim() || null,
    detailsJson: {},
  });
}

async function insertDiagnostic(
  db: AdminPostgresDb,
  input: { service: string; error: unknown; jobKey?: string },
): Promise<void> {
  const error = input.error instanceof Error ? input.error : new Error(String(input.error));
  const message = redactDiagnosticText(error.message);
  const stack = error.stack ? redactDiagnosticText(error.stack, 16_000) : null;
  const fingerprint = fingerprintDiagnostic({
    service: input.service,
    errorClass: error.name,
    message: error.message,
    stack: error.stack,
  });
  const now = new Date();
  const environment = diagnosticsEnvironment();
  const release = process.env.WAIA_RELEASE_SHA?.trim() || null;
  await db.insert(traderAdminDiagnosticEvent).values({
    id: randomUUID(),
    occurredAt: now,
    receivedAt: now,
    service: input.service,
    environment,
    release,
    severity: "error",
    errorClass: error.name,
    messageRedacted: message,
    stackRedacted: stack,
    fingerprint,
    route: null,
    organizationId: null,
    exchangeAccountId: null,
    strategyId: null,
    stage: null,
    cycleId: null,
    orderId: null,
    traceId: null,
    contextJson: input.jobKey ? { jobKey: input.jobKey } : {},
  });
  const existing = await db
    .select({
      id: traderAdminIncident.id,
      status: traderAdminIncident.status,
      occurrences: traderAdminIncident.occurrences,
      stateVersion: traderAdminIncident.stateVersion,
    })
    .from(traderAdminIncident)
    .where(
      and(
        eq(traderAdminIncident.environment, environment),
        eq(traderAdminIncident.service, input.service),
        eq(traderAdminIncident.fingerprint, fingerprint),
      ),
    )
    .limit(1);
  const current = existing[0];
  const next = incidentAfterDiagnostic(
    current
      ? {
          status: current.status as "new" | "resolved",
          occurrences: current.occurrences,
          stateVersion: current.stateVersion,
        }
      : null,
  );
  if (!current) {
    const id = randomUUID();
    await db.insert(traderAdminIncident).values({
      id,
      environment,
      service: input.service,
      fingerprint,
      title: message.slice(0, 200),
      severity: "error",
      status: next.status,
      firstSeenAt: now,
      lastSeenAt: now,
      occurrences: next.occurrences,
      affectedAccounts: 0,
      firstRelease: release,
      lastRelease: release,
      stateVersion: next.stateVersion,
    });
    if (next.history) {
      await db.insert(traderAdminIncidentEvent).values({
        id: randomUUID(),
        incidentId: id,
        fromStatus: next.history.from,
        toStatus: next.history.to,
        actorUserId: null,
        reason: "diagnostic",
        evidence: null,
        createdAt: now,
      });
    }
    return;
  }
  await db
    .update(traderAdminIncident)
    .set({
      status: next.status,
      lastSeenAt: now,
      occurrences: next.occurrences,
      lastRelease: release,
      stateVersion: next.stateVersion,
    })
    .where(eq(traderAdminIncident.id, current.id));
  if (next.history) {
    await db.insert(traderAdminIncidentEvent).values({
      id: randomUUID(),
      incidentId: current.id,
      fromStatus: next.history.from,
      toStatus: next.history.to,
      actorUserId: null,
      reason: "diagnostic",
      evidence: null,
      createdAt: now,
    });
  }
}

async function retainBatch(db: AdminPostgresDb, now: Date): Promise<number> {
  const cuts = {
    minute: retentionCutoff(now, RETENTION_DAYS.quoteMinute),
    news: retentionCutoff(now, RETENTION_DAYS.news),
    change: retentionCutoff(now, RETENTION_DAYS.changeLog),
    valuation: retentionCutoff(now, RETENTION_DAYS.valuation),
    equity: retentionCutoff(now, RETENTION_DAYS.equityPoint),
    diagnostic: retentionCutoff(now, RETENTION_DAYS.diagnostic),
    job: retentionCutoff(now, RETENTION_DAYS.jobRun),
  };
  const statements = [
    sql`DELETE FROM trader_admin_market_quote_minute WHERE (source, symbol, minute) IN (SELECT source, symbol, minute FROM trader_admin_market_quote_minute WHERE minute < ${cuts.minute}::timestamptz LIMIT ${BATCH})`,
    sql`DELETE FROM trader_admin_news_item WHERE id IN (SELECT id FROM trader_admin_news_item WHERE first_observed_at < ${cuts.news}::timestamptz LIMIT ${BATCH})`,
    sql`DELETE FROM trader_admin_change_log WHERE seq IN (SELECT seq FROM trader_admin_change_log WHERE changed_at < ${cuts.change}::timestamptz LIMIT ${BATCH})`,
    sql`DELETE FROM trader_admin_account_valuation WHERE id IN (SELECT id FROM trader_admin_account_valuation WHERE computed_at < ${cuts.valuation}::timestamptz LIMIT ${BATCH})`,
    sql`DELETE FROM trader_admin_equity_point WHERE (organization_id, exchange_account_id, bucket) IN (SELECT organization_id, exchange_account_id, bucket FROM trader_admin_equity_point WHERE bucket < ${cuts.equity}::timestamptz LIMIT ${BATCH})`,
    sql`DELETE FROM trader_admin_diagnostic_event WHERE id IN (SELECT id FROM trader_admin_diagnostic_event WHERE occurred_at < ${cuts.diagnostic}::timestamptz LIMIT ${BATCH})`,
    sql`DELETE FROM trader_admin_job_run WHERE id IN (SELECT id FROM trader_admin_job_run WHERE started_at < ${cuts.job}::timestamptz LIMIT ${BATCH})`,
  ];
  let removed = 0;
  for (const statement of statements) {
    const result = await db.execute(statement);
    removed += rowCount(result);
  }
  const changeDelete = sql`DELETE FROM trader_admin_change_log WHERE seq IN (SELECT seq FROM trader_admin_change_log WHERE changed_at < ${cuts.change}::timestamptz LIMIT ${BATCH})`;
  for (let extra = 1; extra < 24; extra += 1) {
    const result = await db.execute(changeDelete);
    const count = rowCount(result);
    removed += count;
    if (count < BATCH) break;
  }
  return removed;
}

function rowCount(result: unknown): number {
  if (result && typeof result === "object" && "count" in result) {
    const count = (result as { count?: unknown }).count;
    return typeof count === "number" ? count : 0;
  }
  return 0;
}
