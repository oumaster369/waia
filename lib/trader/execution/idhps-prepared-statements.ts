import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type Database from "better-sqlite3";

import type { FillRow, OrderRow } from "@/lib/trader/execution/order-repository.types";
import type { OrderExecutionMode } from "@/lib/trader/execution/types";
import { TERMINAL_ORDER_STATES } from "@/lib/trader/execution/order-state-machine";
import { bumpIdhpsCounter } from "@/lib/trader/execution/idhps-hot-path-counters";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

export const IDHPS_PREPARED_STATEMENT_COUNT = 5 as const;

export class IdhpsFillIdempotencyConflictError extends Error {
  readonly code = "BLOCKED_BY_H_ARCH_1_FILL_IDEMPOTENCY_CONFLICT" as const;
  constructor(orderId: string, exchangeTradeId: string) {
    super(
      `BLOCKED_BY_H_ARCH_1_FILL_IDEMPOTENCY_CONFLICT: orderId=${orderId} exchangeTradeId=${exchangeTradeId}`,
    );
    this.name = "IdhpsFillIdempotencyConflictError";
  }
}

type OrderSelectRow = {
  id: string;
  organization_id: string;
  credential_id: string | null;
  venue: string;
  execution_mode: string;
  symbol: string;
  side: string;
  type: string;
  price: string | null;
  quantity: string;
  filled_quantity: string;
  avg_fill_price: string | null;
  state: string;
  state_version: number;
  exchange_order_id: string | null;
  client_order_id: string;
  idempotency_key: string;
  risk_decision_id: string;
  strategy_signal_id: string | null;
  allocation_decision_id: string | null;
  created_at: number;
  updated_at: number;
};

type FillSelectRow = {
  id: string;
  organization_id: string;
  order_id: string;
  exchange_trade_id: string;
  price: string;
  quantity: string;
  fee: string;
  fee_asset: string;
  executed_at: number;
  created_at: number;
};

function mapOrder(row: OrderSelectRow): OrderRow {
  return {
    id: row.id,
    organizationId: row.organization_id,
    credentialId: row.credential_id,
    venue: row.venue,
    executionMode: row.execution_mode as OrderExecutionMode,
    symbol: row.symbol,
    side: row.side as OrderRow["side"],
    type: row.type as OrderRow["type"],
    price: row.price,
    quantity: row.quantity,
    filledQuantity: row.filled_quantity,
    avgFillPrice: row.avg_fill_price,
    state: row.state as OrderRow["state"],
    stateVersion: row.state_version,
    exchangeOrderId: row.exchange_order_id,
    clientOrderId: row.client_order_id,
    idempotencyKey: row.idempotency_key,
    riskDecisionId: row.risk_decision_id,
    strategySignalId: row.strategy_signal_id,
    allocationDecisionId: row.allocation_decision_id,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function mapFill(row: FillSelectRow): FillRow {
  return {
    id: row.id,
    organizationId: row.organization_id,
    orderId: row.order_id,
    exchangeTradeId: row.exchange_trade_id,
    price: row.price,
    quantity: row.quantity,
    fee: row.fee,
    feeAsset: row.fee_asset,
    executedAt: new Date(row.executed_at),
    createdAt: new Date(row.created_at),
  };
}

const ORDER_SELECT_COLS = `id, organization_id, credential_id, venue, execution_mode, symbol, side, type,
  price, quantity, filled_quantity, avg_fill_price, state, state_version,
  exchange_order_id, client_order_id, idempotency_key, risk_decision_id,
  strategy_signal_id, allocation_decision_id, created_at, updated_at`;

const FILL_SELECT_COLS = `id, organization_id, order_id, exchange_trade_id, price, quantity,
  fee, fee_asset, executed_at, created_at`;

const TERMINAL_SQL = TERMINAL_ORDER_STATES.map((s) => `'${s}'`).join(",");

export type IdhpsPreparedStatements = {
  getOrderByIdPrepared: (context: OrgContext, id: string) => OrderRow | null;
  listOpenOrdersPrepared: (
    context: OrgContext,
    executionMode: OrderExecutionMode,
    venue: string,
  ) => OrderRow[];
  appendFillPrepared: (input: {
    id: string;
    organizationId: string;
    orderId: string;
    exchangeTradeId: string;
    price: string;
    quantity: string;
    fee: string;
    feeAsset: string;
    executedAtMs: number;
    createdAtMs: number;
  }) => FillRow;
  listFillsSincePrepared: (
    context: OrgContext,
    orderId: string,
    cursorExecutedAtMs: number,
    cursorId: string,
    limit: number,
  ) => FillRow[];
  getFillByOrderExchangeTradePrepared: (
    context: OrgContext,
    orderId: string,
    exchangeTradeId: string,
  ) => FillRow | null;
  statementCount: typeof IDHPS_PREPARED_STATEMENT_COUNT;
  finalize: () => void;
};

function immutableFillFieldsMatch(
  existing: FillRow,
  candidate: {
    orderId: string;
    exchangeTradeId: string;
    price: string;
    quantity: string;
    fee: string;
    feeAsset: string;
    executedAtMs: number;
  },
): boolean {
  return (
    existing.orderId === candidate.orderId &&
    existing.exchangeTradeId === candidate.exchangeTradeId &&
    existing.price === candidate.price &&
    existing.quantity === candidate.quantity &&
    existing.fee === candidate.fee &&
    existing.feeAsset === candidate.feeAsset &&
    existing.executedAt.getTime() === candidate.executedAtMs
  );
}

export function createIdhpsPreparedStatements(sqlite: Database.Database): IdhpsPreparedStatements {
  const getOrderStmt = sqlite.prepare(
    `SELECT ${ORDER_SELECT_COLS} FROM trader_orders WHERE id = ? AND organization_id = ? LIMIT 1`,
  );
  bumpIdhpsCounter("preparedStatementBuilds");

  const listOpenStmt = sqlite.prepare(
    `SELECT ${ORDER_SELECT_COLS} FROM trader_orders
     WHERE organization_id = ?
       AND execution_mode = ?
       AND venue = ?
       AND state NOT IN (${TERMINAL_SQL})
     ORDER BY symbol ASC, id ASC`,
  );
  bumpIdhpsCounter("preparedStatementBuilds");

  const insertFillStmt = sqlite.prepare(
    `INSERT INTO trader_fills (
      id, organization_id, order_id, exchange_trade_id, price, quantity,
      fee, fee_asset, executed_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  bumpIdhpsCounter("preparedStatementBuilds");

  const listFillsSinceStmt = sqlite.prepare(
    `SELECT ${FILL_SELECT_COLS} FROM trader_fills
     WHERE organization_id = ?
       AND order_id = ?
       AND (
         executed_at > ?
         OR (executed_at = ? AND id > ?)
       )
     ORDER BY executed_at ASC, id ASC
     LIMIT ?`,
  );
  bumpIdhpsCounter("preparedStatementBuilds");

  const getFillByKeyStmt = sqlite.prepare(
    `SELECT ${FILL_SELECT_COLS} FROM trader_fills
     WHERE organization_id = ?
       AND order_id = ?
       AND exchange_trade_id = ?
     LIMIT 1`,
  );
  bumpIdhpsCounter("preparedStatementBuilds");

  const getFillByOrderExchangeTradePrepared = (
    context: OrgContext,
    orderId: string,
    exchangeTradeId: string,
  ): FillRow | null => {
    const scoped = requireOrgContext(context.organizationId);
    const row = getFillByKeyStmt.get(scoped.organizationId, orderId, exchangeTradeId) as
      | FillSelectRow
      | undefined;
    return row ? mapFill(row) : null;
  };

  return {
    statementCount: IDHPS_PREPARED_STATEMENT_COUNT,
    getOrderByIdPrepared: (context, id) => {
      const scoped = requireOrgContext(context.organizationId);
      const row = getOrderStmt.get(id, scoped.organizationId) as OrderSelectRow | undefined;
      return row ? mapOrder(row) : null;
    },
    listOpenOrdersPrepared: (context, executionMode, venue) => {
      const scoped = requireOrgContext(context.organizationId);
      const rows = listOpenStmt.all(
        scoped.organizationId,
        executionMode,
        venue,
      ) as OrderSelectRow[];
      bumpIdhpsCounter("listOpenOrdersSqliteCalls");
      bumpIdhpsCounter("listOpenOrdersSqliteRows", rows.length);
      return rows.map(mapOrder);
    },
    listFillsSincePrepared: (context, orderId, cursorExecutedAtMs, cursorId, limit) => {
      const scoped = requireOrgContext(context.organizationId);
      const capped = Math.min(256, Math.max(1, limit));
      const rows = listFillsSinceStmt.all(
        scoped.organizationId,
        orderId,
        cursorExecutedAtMs,
        cursorExecutedAtMs,
        cursorId,
        capped,
      ) as FillSelectRow[];
      bumpIdhpsCounter("listFillsSqliteCalls");
      bumpIdhpsCounter("listFillsSqliteRows", rows.length);
      return rows.map(mapFill);
    },
    getFillByOrderExchangeTradePrepared,
    appendFillPrepared: (input) => {
      const existing = getFillByOrderExchangeTradePrepared(
        { organizationId: input.organizationId },
        input.orderId,
        input.exchangeTradeId,
      );
      if (existing) {
        if (
          !immutableFillFieldsMatch(existing, {
            orderId: input.orderId,
            exchangeTradeId: input.exchangeTradeId,
            price: input.price,
            quantity: input.quantity,
            fee: input.fee,
            feeAsset: input.feeAsset,
            executedAtMs: input.executedAtMs,
          })
        ) {
          throw new IdhpsFillIdempotencyConflictError(input.orderId, input.exchangeTradeId);
        }
        return existing;
      }
      try {
        insertFillStmt.run(
          input.id,
          input.organizationId,
          input.orderId,
          input.exchangeTradeId,
          input.price,
          input.quantity,
          input.fee,
          input.feeAsset,
          input.executedAtMs,
          input.createdAtMs,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/UNIQUE|constraint/i.test(message)) {
          throw error;
        }
        const raced = getFillByOrderExchangeTradePrepared(
          { organizationId: input.organizationId },
          input.orderId,
          input.exchangeTradeId,
        );
        if (
          !raced ||
          !immutableFillFieldsMatch(raced, {
            orderId: input.orderId,
            exchangeTradeId: input.exchangeTradeId,
            price: input.price,
            quantity: input.quantity,
            fee: input.fee,
            feeAsset: input.feeAsset,
            executedAtMs: input.executedAtMs,
          })
        ) {
          throw new IdhpsFillIdempotencyConflictError(input.orderId, input.exchangeTradeId);
        }
        return raced;
      }
      const inserted = getFillByOrderExchangeTradePrepared(
        { organizationId: input.organizationId },
        input.orderId,
        input.exchangeTradeId,
      );
      if (!inserted) {
        throw new Error("BLOCKED_BY_H_ARCH_1_FILL_INSERT_MISSING_ROW");
      }
      return inserted;
    },
    finalize: () => {
      // better-sqlite3 statements are released with the Database; keep hook for session close.
    },
  };
}
