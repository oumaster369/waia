import { sql } from "drizzle-orm";

import type { AdminPostgresDb } from "@/lib/trader/admin-console/repositories/snapshot.postgres";
import { withAdminReadSnapshot } from "@/lib/trader/admin-console/repositories/snapshot.postgres";
import {
  assembleAttributedLots,
  lotsForExchangeAccount,
  type LotLegSource,
} from "@/lib/trader/admin-console/money/account-lots";
import type { AssetQuote } from "@/lib/trader/admin-console/money/quotes";
import { selectMarketQuote } from "@/lib/trader/admin-console/money/market-quote";
import { dedupeAccounts, type AccountCredential } from "@/lib/trader/admin-console/accounts/dedupe";
import { buildOverview } from "@/lib/trader/admin-console/read-models/overview";
import type { AdminScope } from "@/lib/trader/admin-console/contracts";
import {
  buildAccountFinance,
  type ObservationEvidence,
} from "@/lib/trader/admin-console/read-models/account-finance";

const ACCOUNT_CAP = 64;

function rowsOf(result: unknown): Record<string, unknown>[] {
  return Array.isArray(result) ? (result as Record<string, unknown>[]) : [];
}

function text(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  return null;
}

function iso(value: unknown): string | null {
  const stamp = text(value);
  return stamp && Number.isFinite(Date.parse(stamp)) ? new Date(stamp).toISOString() : null;
}

export async function readOverviewSnapshot(
  db: AdminPostgresDb,
  input: {
    currency: "USDT" | "USD";
    mode: string;
    start: string;
    end: string;
    nowMs: number;
    scope?: AdminScope;
  },
) {
  return withAdminReadSnapshot(db, async (tx) => {
    const scope = input.scope ?? { kind: "fleet" };
    const organizationId = scope.kind === "fleet" ? null : scope.organizationId;
    const exchangeAccountId = scope.kind === "account" ? scope.exchangeAccountId : null;
    const mode = input.mode === "all" ? "live" : input.mode;
    const credentialRows = rowsOf(
      await tx.execute(sql`
        SELECT c.id::text AS credential_id,
               c.organization_id::text AS organization_id,
               c.venue,
               c.exchange_account_id,
               c.created_at,
               u.email AS owner_email
        FROM exchange_credentials c
        JOIN organizations o ON o.id = c.organization_id
        JOIN users u ON u.id = o.owner_user_id
        ORDER BY c.exchange_account_id, c.created_at
      `),
    );
    const credentials: AccountCredential[] = credentialRows.flatMap((row) => {
      const credentialId = text(row.credential_id);
      const organizationId = text(row.organization_id);
      const venue = text(row.venue);
      const exchangeAccountId = text(row.exchange_account_id);
      const createdAt = iso(row.created_at);
      if (!credentialId || !organizationId || !venue || !exchangeAccountId || !createdAt) return [];
      return [
        {
          credentialId,
          organizationId,
          venue,
          exchangeAccountId,
          ownerEmail: text(row.owner_email),
          createdAt,
        },
      ];
    });
    // Detect cross-tenant ownership conflicts before applying the requested scope.
    const grouped = dedupeAccounts(credentials).filter(
      (group) =>
        (!organizationId || group.organizationIds.includes(organizationId)) &&
        (!exchangeAccountId || group.exchangeAccountId === exchangeAccountId),
    );
    const observationRows = rowsOf(
      await tx.execute(sql`
      WITH keys AS (
        SELECT DISTINCT c.venue, c.organization_id, c.exchange_account_id
        FROM exchange_credentials c
        WHERE (${organizationId}::uuid IS NULL OR c.organization_id = ${organizationId}::uuid)
          AND (${exchangeAccountId}::text IS NULL OR c.exchange_account_id = ${exchangeAccountId})
      )
      SELECT k.venue, k.organization_id::text, k.exchange_account_id,
             latest.observation_id::text AS latest_id, latest.payload AS latest_payload,
             latest.recorded_at AS latest_recorded_at,
             good.observation_id::text AS good_id, good.payload AS good_payload,
             good.recorded_at AS good_recorded_at, first_connected.recorded_at AS connected_since
      FROM keys k
      LEFT JOIN LATERAL (
        SELECT o.observation_id, o.payload, o.recorded_at
        FROM trader_account_observations o
        JOIN trader_account_collection_state s
          ON s.organization_id = o.organization_id AND s.credential_id = o.credential_id
          AND s.exchange_account_id = o.exchange_account_id AND s.last_observation_id = o.observation_id
        JOIN exchange_credentials c ON c.id = o.credential_id AND c.organization_id = o.organization_id
          AND c.exchange_account_id = o.exchange_account_id
        WHERE o.organization_id = k.organization_id AND o.exchange_account_id = k.exchange_account_id
          AND c.venue = k.venue
        ORDER BY o.recorded_at DESC, o.observation_id DESC LIMIT 1
      ) latest ON true
      LEFT JOIN LATERAL (
        SELECT o.observation_id, o.payload, o.recorded_at
        FROM trader_account_observations o
        JOIN exchange_credentials c ON c.id = o.credential_id AND c.organization_id = o.organization_id
          AND c.exchange_account_id = o.exchange_account_id
        WHERE o.organization_id = k.organization_id AND o.exchange_account_id = k.exchange_account_id
          AND c.venue = k.venue AND o.payload->>'status' = 'COMPLETE'
          AND o.payload->'balances'->>'status' = 'COMPLETE'
        ORDER BY o.recorded_at DESC, o.observation_id DESC LIMIT 1
      ) good ON true
      LEFT JOIN LATERAL (
        SELECT o.recorded_at
        FROM trader_account_observations o
        JOIN exchange_credentials c ON c.id = o.credential_id AND c.organization_id = o.organization_id
          AND c.exchange_account_id = o.exchange_account_id
        WHERE o.organization_id = k.organization_id AND o.exchange_account_id = k.exchange_account_id
          AND c.venue = k.venue AND o.payload->>'status' = 'COMPLETE'
          AND o.payload->'balances'->>'status' = 'COMPLETE'
        ORDER BY o.recorded_at, o.observation_id LIMIT 1
      ) first_connected ON true
    `),
    );
    const observations = new Map(
      observationRows.map((row) => [
        `${row.venue}:${row.organization_id}:${row.exchange_account_id}`,
        row,
      ]),
    );
    const quoteRows = rowsOf(
      await tx.execute(sql`
        SELECT base, quote, last, source, source_ts, observed_at
        FROM trader_admin_market_quote_latest
        WHERE last IS NOT NULL
      `),
    );
    const quotes: AssetQuote[] = quoteRows.flatMap((row) => {
      const asset = text(row.base);
      const price = text(row.last);
      const source = text(row.source);
      const observedAt = iso(row.observed_at);
      const quoteCurrency = text(row.quote);
      if (
        !asset ||
        !price ||
        !source ||
        !observedAt ||
        (quoteCurrency !== "USD" && quoteCurrency !== "USDT")
      )
        return [];
      return [{ asset, price, source, sourceTs: iso(row.source_ts), observedAt, quoteCurrency }];
    });
    const lotRows = rowsOf(
      await tx.execute(sql`
        SELECT l.id::text AS lot_id,
               l.organization_id::text AS organization_id,
               l.symbol,
               l.remaining_qty,
               l.avg_cost,
               l.account_key,
               leg.id::text AS leg_id,
               leg.created_at AS leg_created_at,
               leg.order_id::text AS order_id,
               o.historical_run_id,
               o.execution_mode,
               o.credential_id::text AS credential_id,
               o.strategy_signal_id,
               o.symbol AS order_symbol,
               c.id::text AS credential_row_id,
               c.organization_id::text AS credential_organization_id,
               c.exchange_account_id
        FROM trader_position_lots l
        JOIN trader_trade_legs leg
          ON leg.position_lot_id = l.id
         AND leg.organization_id = l.organization_id
        LEFT JOIN trader_orders o
          ON o.id = leg.order_id
         AND o.organization_id = leg.organization_id
        LEFT JOIN exchange_credentials c
          ON c.id = o.credential_id
         AND c.organization_id = o.organization_id
        WHERE l.state = 'OPEN'
          AND (${organizationId}::uuid IS NULL OR l.organization_id = ${organizationId}::uuid)
      `),
    );
    const attributedLots = assembleAttributedLots(
      lotRows.flatMap((row) => {
        const lotId = text(row.lot_id);
        const organizationId = text(row.organization_id);
        const symbol = text(row.symbol);
        const remainingQty = text(row.remaining_qty);
        const avgCost = text(row.avg_cost);
        const accountKey = text(row.account_key);
        const legId = text(row.leg_id);
        const legCreatedAt = iso(row.leg_created_at);
        if (
          !lotId ||
          !organizationId ||
          !symbol ||
          !remainingQty ||
          !avgCost ||
          !accountKey ||
          !legId ||
          !legCreatedAt
        ) {
          return [];
        }
        const orderId = text(row.order_id);
        const executionMode = text(row.execution_mode);
        const credentialId = text(row.credential_id);
        const credentialRowId = text(row.credential_row_id);
        const credentialOrganizationId = text(row.credential_organization_id);
        const exchangeAccountId = text(row.exchange_account_id);
        const source: LotLegSource = {
          lotId,
          organizationId,
          symbol,
          remainingQty,
          avgCost,
          accountKey,
          legId,
          legCreatedAt,
          orderId,
          strategySignalId: text(row.strategy_signal_id),
          order:
            orderId && executionMode
              ? {
                  id: orderId,
                  organizationId,
                  historicalRunId: text(row.historical_run_id),
                  executionMode,
                  credentialId,
                  strategySignalId: text(row.strategy_signal_id),
                  symbol: text(row.order_symbol) ?? symbol,
                }
              : null,
          credential:
            credentialRowId && credentialOrganizationId && exchangeAccountId
              ? {
                  id: credentialRowId,
                  organizationId: credentialOrganizationId,
                  exchangeAccountId,
                }
              : null,
        };
        return [source];
      }),
    );
    const accounts = grouped.map((group, index) => {
      const row = observations.get(
        `${group.venue}:${group.organizationIds[0]}:${group.exchangeAccountId}`,
      );
      const evidence = (prefix: "latest" | "good"): ObservationEvidence | null => {
        const id = text(row?.[`${prefix}_id`]);
        const recordedAt = iso(row?.[`${prefix}_recorded_at`]);
        return id && recordedAt ? { id, recordedAt, payload: row?.[`${prefix}_payload`] } : null;
      };
      const accountLots = lotsForExchangeAccount({
        organizationId: group.organizationIds[0],
        exchangeAccountId: group.exchangeAccountId,
        mode: "live",
        lots: attributedLots,
      });
      return buildAccountFinance({
        group,
        latest: evidence("latest"),
        lastComplete: evidence("good"),
        connectedSince: iso(row?.connected_since),
        currency: input.currency,
        mode,
        nowMs: input.nowMs,
        quotes,
        valuationDeferred: index >= ACCOUNT_CAP,
        ...accountLots,
      });
    });
    return {
      market: selectMarketQuote(quoteRows, "BTC"),
      overview: buildOverview(accounts, {
        currency: input.currency,
        method:
          accounts.find((account) => account.included)?.method ??
          (input.currency === "USD" ? "usdt_usd:unavailable" : "htx_spot_last:usdt"),
        periodBounds: { start: input.start, end: input.end },
        mode,
      }),
      accounts,
      mode: mode as "live" | "paper" | "history",
      capped: grouped.length > ACCOUNT_CAP,
    };
  });
}
