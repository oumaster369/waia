import { sql } from "drizzle-orm";

import type { AdminPostgresDb } from "@/lib/trader/admin-console/repositories/snapshot.postgres";
import { withAdminReadSnapshot } from "@/lib/trader/admin-console/repositories/snapshot.postgres";
import { parseAccountObservation } from "@/lib/trader/account-observation/validation";
import {
  valueObservation,
  type ValuationBalance,
} from "@/lib/trader/admin-console/money/valuation";
import type { AssetQuote } from "@/lib/trader/admin-console/money/quotes";
import { dedupeAccounts, type AccountCredential } from "@/lib/trader/admin-console/accounts/dedupe";
import {
  buildOverview,
  type OverviewAccount,
} from "@/lib/trader/admin-console/read-models/overview";
import { ADMIN_REASON } from "@/lib/trader/admin-console/reason-codes";

const ACCOUNT_CAP = 64;

function rowsOf(result: unknown): Record<string, unknown>[] {
  return Array.isArray(result) ? (result as Record<string, unknown>[]) : [];
}

function text(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  return null;
}

export async function readOverviewSnapshot(
  db: AdminPostgresDb,
  input: { currency: "USDT" | "USD"; mode: string; start: string; end: string; nowMs: number },
) {
  return withAdminReadSnapshot(db, async (tx) => {
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
      const createdAt = text(row.created_at);
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
    const grouped = dedupeAccounts(credentials);
    const quoteRows = rowsOf(
      await tx.execute(sql`
        SELECT base, last, source, source_ts, observed_at
        FROM trader_admin_market_quote_latest
        WHERE last IS NOT NULL
      `),
    );
    const quotes: AssetQuote[] = quoteRows.flatMap((row) => {
      const asset = text(row.base);
      const price = text(row.last);
      const source = text(row.source);
      const observedAt = text(row.observed_at);
      if (!asset || !price || !source || !observedAt) return [];
      return [{ asset, price, source, sourceTs: text(row.source_ts), observedAt }];
    });
    const accounts: OverviewAccount[] = [];
    for (const group of grouped.slice(0, ACCOUNT_CAP)) {
      if (group.conflict) {
        accounts.push({
          id: `${group.venue}:${group.exchangeAccountId}`,
          valuationKey: "conflict",
          included: false,
          reason: ADMIN_REASON.ownershipConflict,
          stale: false,
          equity: null,
          freeQuote: null,
          lockedQuote: null,
          holdingsValue: null,
          traderPnl: null,
        });
        continue;
      }
      const observation = rowsOf(
        await tx.execute(sql`
          SELECT o.observation_id::text AS observation_id, o.payload, o.recorded_at
          FROM trader_account_collection_state s
          JOIN trader_account_observations o
            ON o.organization_id = s.organization_id
           AND o.observation_id = s.last_observation_id
          WHERE s.organization_id = ${group.organizationIds[0]}::uuid
            AND s.exchange_account_id = ${group.exchangeAccountId}
          ORDER BY o.recorded_at DESC
          LIMIT 1
        `),
      )[0];
      if (!observation) {
        accounts.push({
          id: `${group.venue}:${group.exchangeAccountId}`,
          valuationKey: "missing-observation",
          included: false,
          reason: "OBSERVATION_MISSING",
          stale: false,
          equity: null,
          freeQuote: null,
          lockedQuote: null,
          holdingsValue: null,
          traderPnl: null,
        });
        continue;
      }
      let balances: ValuationBalance[] = [];
      try {
        const parsed = parseAccountObservation(observation.payload);
        balances =
          parsed.balances.values?.map((balance) => ({
            asset: balance.asset,
            free: balance.free,
            locked: balance.locked,
          })) ?? [];
      } catch {
        accounts.push({
          id: `${group.venue}:${group.exchangeAccountId}`,
          valuationKey: "invalid-observation",
          included: false,
          reason: "OBSERVATION_INVALID",
          stale: false,
          equity: null,
          freeQuote: null,
          lockedQuote: null,
          holdingsValue: null,
          traderPnl: null,
        });
        continue;
      }
      const recordedAt = text(observation.recorded_at) ?? new Date(0).toISOString();
      const valued = valueObservation({
        observationId: text(observation.observation_id) ?? "unknown",
        recordedAt,
        balances,
        lots: [],
        lotsRevision: "0",
        quotes,
        currency: input.currency,
        nowMs: input.nowMs,
      });
      accounts.push({
        id: `${group.venue}:${group.exchangeAccountId}`,
        valuationKey: valued.valuationKey,
        included: valued.equity !== null && (valued.state === "ok" || valued.state === "stale"),
        reason: valued.reasons[0] ?? null,
        stale: valued.reasons.includes(ADMIN_REASON.quoteStale),
        equity: valued.equity,
        freeQuote: valued.freeQuote,
        lockedQuote: valued.lockedQuote,
        holdingsValue: valued.holdingsValue,
        traderPnl: null,
      });
    }
    return {
      overview: buildOverview(accounts, {
        currency: input.currency,
        method: input.currency === "USD" ? "usdt_usd:coinbase" : "htx_spot_last:usdt",
        periodBounds: { start: input.start, end: input.end },
        mode: input.mode,
      }),
      accounts,
      capped: grouped.length > ACCOUNT_CAP,
    };
  });
}
