import { sql } from "drizzle-orm";
import type { AdminReadTx } from "@/lib/trader/admin-console/repositories/snapshot.postgres";
import type { AccountFinance } from "@/lib/trader/admin-console/read-models/account-finance";
import {
  attributeLegs,
  type AttributionCredential,
  type AttributionOrder,
} from "@/lib/trader/admin-console/attribution/trade-attribution";
import { orderMode } from "@/lib/trader/admin-console/modes/order-mode";
import {
  periodResult,
  type EquityEvidencePoint,
  type PeriodResult,
} from "@/lib/trader/admin-console/money/period-result";
import type { OperationalLeg } from "@/lib/trader/admin-console/money/operational-pnl";
import { adminRevision } from "@/lib/trader/admin-console/revision";
import { multiplyDecimal } from "@/lib/trader/risk/numeric";
import {
  quoteIsStale,
  selectUsdQuote,
  type AssetQuote,
} from "@/lib/trader/admin-console/money/quotes";
import {
  periodSeries,
  aggregatePeriodSeries,
  type PeriodSeriesPoint,
} from "@/lib/trader/admin-console/money/period-series";

import { verifiedCloseFee } from "../money/verified-close-fee";

type Row = Record<string, unknown>;

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? (value as Row[]) : [];
}
function stamp(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}
function nullable(value: unknown): string | null {
  return value == null ? null : String(value);
}
const key = (organization: string, account: string) => `${organization}:${account}`;
export type PeriodAccountEvidence = {
  result: PeriodResult;
  revision: string;
  points: EquityEvidencePoint[];
  pointsCurrency: "USDT";
  currency: "USDT" | "USD";
  method: string;
  fx: AssetQuote | null;
  series: PeriodSeriesPoint[];
};

/** Only already persisted evidence is read. Called inside the financial snapshot. */
export async function readPeriodFinance(
  tx: AdminReadTx,
  input: {
    accounts: readonly AccountFinance[];
    start: string;
    end: string;
    currency: "USDT" | "USD";
    mode: string;
    quotes: readonly AssetQuote[];
    nowMs: number;
    currentPeriod?: boolean;
  },
) {
  const accounts = input.accounts.filter((account) => account.organizationId !== null);
  const bindings = accounts.map((account) => ({
    organization_id: account.organizationId,
    exchange_account_id: account.exchangeAccountId,
  }));
  const byAccount = new Map<string, PeriodAccountEvidence>();
  if (!accounts.length || (input.mode !== "live" && input.mode !== "all"))
    return {
      byAccount,
      serviceFees: [],
      missing: [] as string[],
      series: [],
      seriesCurrency: input.currency,
      seriesReason: null as string | null,
      seriesFx: null as AssetQuote | null,
      grain: "hour" as const,
    };
  const chosen = JSON.stringify(bindings);
  const rawLegs = rows(
    await tx.execute(sql`
    WITH chosen AS (SELECT * FROM jsonb_to_recordset(${chosen}::jsonb) AS c(organization_id uuid, exchange_account_id text)),
    trades AS (
      SELECT t.id, t.organization_id, t.symbol, t.account_key, t.strategy_signal_id,t.state,t.opened_at,t.closed_at
      FROM trader_trades t
      WHERE EXISTS (SELECT 1 FROM chosen c WHERE c.organization_id = t.organization_id)
        AND (EXISTS (SELECT 1 FROM trader_trade_legs p WHERE p.trade_id = t.id AND p.organization_id = t.organization_id
          AND p.executed_at >= ${input.start}::timestamptz AND p.executed_at < ${input.end}::timestamptz)
          OR (t.opened_at >= ${input.start}::timestamptz AND t.opened_at < ${input.end}::timestamptz)
          OR (t.closed_at >= ${input.start}::timestamptz AND t.closed_at < ${input.end}::timestamptz))
      ORDER BY t.id LIMIT 5001
    )
    SELECT t.id::text AS trade_id, t.organization_id::text, t.symbol, t.account_key, t.strategy_signal_id,t.state AS trade_state,t.opened_at,t.closed_at,
      l.id::text AS leg_id, l.kind, l.executed_at, l.leg_pnl, l.fee, l.price, l.quantity,
      (SELECT array_agg(e.payload) FROM trader_lifecycle_events e WHERE e.organization_id = l.organization_id
        AND e.entity_type = 'FILL' AND e.entity_id = l.fill_id::text AND e.phase = 'ORDER_FILLED') AS fee_evidence,
      o.id::text AS order_id, o.execution_mode, o.historical_run_id, o.credential_id::text,
      c.id::text AS credential_row_id, c.exchange_account_id, f.fee_asset
    FROM trades t LEFT JOIN trader_trade_legs l ON l.trade_id = t.id AND l.organization_id = t.organization_id
    LEFT JOIN trader_orders o ON o.id = l.order_id AND o.organization_id = l.organization_id
    LEFT JOIN exchange_credentials c ON c.id = o.credential_id AND c.organization_id = o.organization_id
    LEFT JOIN trader_fills f ON f.id = l.fill_id AND f.organization_id = l.organization_id AND f.order_id = o.id
    ORDER BY t.id, l.executed_at, l.id
    LIMIT 50001
  `),
  );
  const byTrade = new Map<string, Row[]>();
  for (const row of rawLegs) {
    const id = String(row.trade_id);
    const values = byTrade.get(id) ?? [];
    values.push(row);
    byTrade.set(id, values);
  }
  const capped = byTrade.size > 5000 || rawLegs.length > 50000;
  const legsByAccount = new Map<string, OperationalLeg[]>();
  const missingByOrg = new Map<string, Set<string>>();
  const miss = (org: string, reason: string) => {
    const set = missingByOrg.get(org) ?? new Set<string>();
    set.add(reason);
    missingByOrg.set(org, set);
  };
  for (const trade of byTrade.values()) {
    const first = trade[0]!;
    const org = String(first.organization_id);
    const orders: AttributionOrder[] = trade.flatMap((row) =>
      row.order_id
        ? [
            {
              id: String(row.order_id),
              organizationId: org,
              historicalRunId: nullable(row.historical_run_id),
              executionMode: String(row.execution_mode),
              credentialId: nullable(row.credential_id),
              strategySignalId: nullable(row.strategy_signal_id),
              symbol: String(row.symbol),
            },
          ]
        : [],
    );
    // A completely known research/paper/mock trade does not block live accounting.
    if (orders.length === trade.length && orders.every((order) => orderMode(order) !== "live"))
      continue;
    const credentials: AttributionCredential[] = trade.flatMap((row) =>
      row.credential_row_id && row.exchange_account_id
        ? [
            {
              id: String(row.credential_row_id),
              organizationId: org,
              exchangeAccountId: String(row.exchange_account_id),
            },
          ]
        : [],
    );
    const attribution = attributeLegs(
      trade.map((row) => ({
        id: String(row.leg_id),
        organizationId: org,
        orderId: nullable(row.order_id),
        strategySignalId: nullable(row.strategy_signal_id),
        symbol: String(row.symbol),
        accountKey: nullable(row.account_key),
      })),
      orders,
      credentials,
    );
    if (attribution.state !== "attributed") {
      miss(org, attribution.reason);
      continue;
    }
    if (attribution.mode !== "live") continue;
    if (
      first.trade_state !== "OPEN" &&
      !trade.some((row) => row.kind === "CLOSE_FILL" || row.kind === "FORCED_FLAT")
    ) {
      miss(org, "TRADE_CLOSURE_LEGS_MISSING");
      continue;
    }
    const accountKey = key(org, attribution.exchangeAccountId);
    if (
      !bindings.some(
        (binding) =>
          binding.organization_id === org &&
          binding.exchange_account_id === attribution.exchangeAccountId,
      )
    )
      continue;
    const symbol = String(first.symbol).toUpperCase();
    if (!symbol.endsWith("USDT") || symbol.length <= 4) {
      miss(org, "TRADE_QUOTE_NOT_USDT");
      continue;
    }
    const values = legsByAccount.get(accountKey) ?? [];
    for (const row of trade) {
      if (row.kind !== "OPEN_FILL" && row.kind !== "CLOSE_FILL") {
        miss(org, "LIVE_LEG_KIND_UNSUPPORTED");
        continue;
      }
      values.push({
        kind: row.kind === "OPEN_FILL" ? "OPEN" : "CLOSE",
        executedAt: stamp(row.executed_at),
        legPnl: String(row.leg_pnl),
        fee: String(row.fee),
        feeAsset: row.fee_asset == null ? "" : String(row.fee_asset),
        price: String(row.price),
        baseAsset: symbol.slice(0, -4).replace(/[\/_-]$/, ""),
        verifiedCloseFeeQuote: verifiedCloseFee(row),
        quoteAsset: "USDT",
      });
    }
    legsByAccount.set(accountKey, values);
  }
  const duration = Date.parse(input.end) - Date.parse(input.start);
  const grain = duration <= 2 * 86400000 ? "minute" : duration <= 31 * 86400000 ? "hour" : "day";
  const grainSql = grain === "minute" ? sql`'minute'` : grain === "hour" ? sql`'hour'` : sql`'day'`;
  const rawPoints = rows(
    await tx.execute(sql`
    WITH chosen AS (SELECT * FROM jsonb_to_recordset(${chosen}::jsonb) AS c(organization_id uuid, exchange_account_id text)),
    samples AS (
      SELECT DISTINCT ON (p.organization_id,p.exchange_account_id,date_trunc(${grainSql},p.bucket)) p.*
      FROM trader_admin_equity_point p JOIN chosen c USING (organization_id,exchange_account_id)
      WHERE p.bucket >= ${input.start}::timestamptz AND p.bucket <= ${input.end}::timestamptz
        AND p.method_version = 'htx_spot_last:usdt'
      ORDER BY p.organization_id,p.exchange_account_id,date_trunc(${grainSql},p.bucket),p.bucket DESC
    ), boundaries AS (
      SELECT p.* FROM chosen c CROSS JOIN LATERAL (
        SELECT p.* FROM trader_admin_equity_point p WHERE p.organization_id=c.organization_id AND p.exchange_account_id=c.exchange_account_id
          AND p.method_version='htx_spot_last:usdt' AND p.bucket <= ${input.start}::timestamptz
          AND p.bucket >= ${input.start}::timestamptz - interval '5 minutes' ORDER BY p.bucket DESC LIMIT 1
      ) p
      UNION
      SELECT p.* FROM chosen c CROSS JOIN LATERAL (
        SELECT p.* FROM trader_admin_equity_point p WHERE p.organization_id=c.organization_id AND p.exchange_account_id=c.exchange_account_id
          AND p.method_version='htx_spot_last:usdt' AND p.bucket >= ${input.start}::timestamptz
          AND p.bucket <= ${input.end}::timestamptz ORDER BY p.bucket LIMIT 1
      ) p
    ) SELECT p.*, GREATEST(p.bucket,COALESCE(v.computed_at,p.bucket + interval '5 minutes')) AS evidence_at
      FROM (SELECT * FROM samples UNION SELECT * FROM boundaries) p
      LEFT JOIN trader_admin_account_valuation v ON v.organization_id=p.organization_id
        AND v.exchange_account_id=p.exchange_account_id AND v.valuation_key=p.valuation_key
      ORDER BY p.organization_id,p.exchange_account_id,p.bucket LIMIT 20001
  `),
  );
  const pointsCapped = rawPoints.length > 20000;
  const pointsByAccount = new Map<string, EquityEvidencePoint[]>();
  for (const row of rawPoints) {
    const accountKey = key(String(row.organization_id), String(row.exchange_account_id));
    const values = pointsByAccount.get(accountKey) ?? [];
    values.push({
      at: stamp(row.evidence_at),
      bucket: stamp(row.bucket),
      equity: String(row.equity),
      unrealized: String(row.trader_unrealized),
      valuationKey: String(row.valuation_key),
      state: String(row.state),
    });
    pointsByAccount.set(accountKey, values);
  }
  const fx = selectUsdQuote(input.quotes, input.nowMs);
  for (const account of accounts) {
    const accountKey = key(account.organizationId!, account.exchangeAccountId);
    const legs = legsByAccount.get(accountKey) ?? [];
    const points = pointsByAccount.get(accountKey) ?? [];
    const reasons = [
      ...(missingByOrg.get(account.organizationId!) ?? []),
      ...(capped ? ["PNL_LEGS_CAPPED"] : []),
      ...(pointsCapped ? ["EQUITY_HISTORY_CAPPED"] : []),
    ];
    const currentEndpoint: EquityEvidencePoint | undefined =
      input.currentPeriod && account.included && account.nativeValuation !== null
        ? { at: input.end, ...account.nativeValuation, state: "ok" }
        : undefined;
    let result = periodResult({
      legs,
      points,
      currentEndpoint,
      start: input.start,
      end: input.end,
      reasons,
    });
    let method = result.method as string;
    if (input.currency === "USD") {
      if (!fx || quoteIsStale(fx, input.nowMs)) {
        result = {
          ...result,
          state: "unavailable",
          reasons: [...result.reasons, fx ? "QUOTE_STALE" : "NO_QUOTE:USDT-USD"],
          total: null,
          realized: null,
          unrealizedChange: null,
          openFees: null,
          closeFees: null,
          tradingFees: null,
        };
      } else {
        const convert = (value: string | null) =>
          value === null ? null : multiplyDecimal(value, fx.price);
        result = {
          ...result,
          total: convert(result.total),
          realized: convert(result.realized),
          unrealizedChange: convert(result.unrealizedChange),
          openFees: convert(result.openFees),
          closeFees: convert(result.closeFees),
          tradingFees: convert(result.tradingFees),
        };
      }
      method = `operational_pnl:usdt_usd:${fx?.source ?? "unavailable"}`;
      result = { ...result, method, currency: "USD" };
    }
    byAccount.set(accountKey, {
      result,
      points,
      pointsCurrency: "USDT",
      currency: input.currency,
      method,
      fx: input.currency === "USD" ? (fx ?? null) : null,
      series: periodSeries({ points, legs, start: input.start, end: input.end, reasons }),
      revision: adminRevision({
        legs,
        points,
        result,
        fx: input.currency === "USD" ? (fx ?? null) : null,
      }),
    });
  }
  const feeRows = rows(
    await tx.execute(sql`
    WITH chosen AS (SELECT * FROM jsonb_to_recordset(${chosen}::jsonb) AS c(organization_id uuid, exchange_account_id text))
    SELECT i.currency,i.status::text,count(*)::int AS count,sum(i.performance_fee::numeric)::text AS amount
    FROM trader_invoices i WHERE i.status IN ('DRAFT','ISSUED','PAID') AND i.billable=true
      AND i.period_start < ${input.end}::timestamptz AND i.period_end >= ${input.start}::timestamptz
      AND EXISTS (SELECT 1 FROM chosen c WHERE c.organization_id=i.organization_id AND c.exchange_account_id=i.exchange_account_id)
    GROUP BY i.currency,i.status ORDER BY i.currency,i.status
  `),
  );
  const serviceFees = feeRows.map((row) => ({
    currency: String(row.currency),
    status: String(row.status),
    count: Number(row.count),
    amount: String(row.amount),
    method: "saved_invoice",
  }));
  const rawSeries = aggregatePeriodSeries(
    [
      ...byAccount.values(),
      ...input.accounts
        .filter((account) => account.organizationId === null)
        .map(() => ({ series: [] })),
    ],
    grain,
  );
  const usableFx = fx && !quoteIsStale(fx, input.nowMs) ? fx : null;
  const series =
    input.currency === "USDT"
      ? rawSeries
      : rawSeries.map((point) => ({
          ...point,
          equity:
            usableFx && point.equity !== null
              ? multiplyDecimal(point.equity, usableFx.price)
              : null,
          pnl: usableFx && point.pnl !== null ? multiplyDecimal(point.pnl, usableFx.price) : null,
          drawdown:
            usableFx && point.drawdown !== null
              ? multiplyDecimal(point.drawdown, usableFx.price)
              : null,
        }));
  return {
    byAccount,
    series,
    seriesCurrency: input.currency,
    seriesReason: input.currency === "USD" && !usableFx ? "NO_QUOTE:USDT-USD" : null,
    seriesFx: input.currency === "USD" ? usableFx : null,
    grain,
    serviceFees,
    missing: [
      ...new Set(
        [...missingByOrg.values()]
          .flatMap((set) => [...set])
          .concat(capped ? ["PNL_LEGS_CAPPED"] : [], pointsCapped ? ["EQUITY_HISTORY_CAPPED"] : []),
      ),
    ],
  };
}
