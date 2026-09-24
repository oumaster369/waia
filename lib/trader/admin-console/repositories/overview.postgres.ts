import { sql } from "drizzle-orm";

import type { AdminPostgresDb } from "@/lib/trader/admin-console/repositories/snapshot.postgres";
import { withAdminReadSnapshot } from "@/lib/trader/admin-console/repositories/snapshot.postgres";
import { parseAccountObservation } from "@/lib/trader/account-observation/validation";
import {
  equityInclusion,
  valueObservation,
  type ValuationBalance,
} from "@/lib/trader/admin-console/money/valuation";
import {
  assembleAttributedLots,
  lotsForExchangeAccount,
  type LotLegSource,
} from "@/lib/trader/admin-console/money/account-lots";
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
        const legCreatedAt = text(row.leg_created_at);
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
      const accountLots = lotsForExchangeAccount({
        exchangeAccountId: group.exchangeAccountId,
        mode: input.mode,
        lots: attributedLots,
      });
      const valued = valueObservation({
        observationId: text(observation.observation_id) ?? "unknown",
        recordedAt,
        balances,
        lots: accountLots.lots,
        lotsRevision: accountLots.lotsRevision,
        quotes,
        currency: input.currency,
        nowMs: input.nowMs,
      });
      const inclusion = equityInclusion(valued.reasons, valued.equity);
      accounts.push({
        id: `${group.venue}:${group.exchangeAccountId}`,
        valuationKey: valued.valuationKey,
        included: inclusion.included,
        reason: valued.reasons[0] ?? null,
        stale: inclusion.stale,
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
