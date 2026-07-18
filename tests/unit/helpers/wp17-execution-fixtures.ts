import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb, resetWaiaSqliteSingleton } from "@/db/client";
import {
  applyHistoricalExecutionEconomics,
  buildRecordFillPayload,
  createHistoricalSimulatedExchange,
} from "@/lib/trader/execution/historical-simulated-exchange";
import { createHistoricalExecutionModelV1 } from "@/lib/trader/execution/historical-execution-model";
import type { HistoricalExecutionModelV1 } from "@/lib/trader/execution/historical-execution-model.types";
import type {
  HistoricalExecutionPersistencePort,
  HistoricalSimulatedExchange,
} from "@/lib/trader/execution/historical-simulated-exchange";
import type {
  OrderRepository,
  OrderRow,
  RecordFillProgressInput,
} from "@/lib/trader/execution/order-repository.types";
import { OrderNotFoundError } from "@/lib/trader/execution";
import { createSqliteOrderRepository } from "@/lib/trader/execution/repository-adapters";
import type { Bar } from "@/lib/trader/intelligence/types";
import {
  addDecimal,
  compareDecimal,
  divideDecimal,
  multiplyDecimal,
} from "@/lib/trader/risk/numeric";
import type { AccountRiskState } from "@/lib/trader/risk/capital-limits.types";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

export const WP17_USER_ID = "00000000-0000-4000-8000-0000000417u1";

let wp17SessionCounter = 0;

export async function refreshWp17AccountState(
  repo: OrderRepository,
  context: ReturnType<typeof requireOrgContext>,
): Promise<AccountRiskState> {
  const openOrders = await repo.listOpenOrders(context, { executionMode: "mock" });
  return {
    positions: [],
    openOrderCount: openOrders.length,
    dailyPnl: "0",
    drawdown: "0",
    quoteExposureByCurrency: {},
  };
}

export function makeWp17Bar(barIndex: number, overrides?: Partial<Bar>): Bar {
  const baseMs = Date.parse("2026-01-01T00:00:00.000Z") + barIndex * 60_000;
  const barOpenTime = new Date(baseMs).toISOString();
  const barCloseTime = new Date(baseMs + 60_000 - 1).toISOString();
  return {
    symbol: "BTCUSDT",
    interval: "1m",
    open: "50000",
    high: "50100",
    low: "49900",
    close: "50000",
    volume: "1.0",
    barOpenTime,
    barCloseTime,
    ...overrides,
  };
}

export function createWp17Model(): HistoricalExecutionModelV1 {
  return createHistoricalExecutionModelV1();
}

export type Wp17SqliteSession = {
  orgId: string;
  context: ReturnType<typeof requireOrgContext>;
  repo: OrderRepository;
  model: HistoricalExecutionModelV1;
  exchange: HistoricalSimulatedExchange;
  cleanup: () => void;
};

export function createWp17SqliteSession(userId?: string): Wp17SqliteSession {
  wp17SessionCounter += 1;
  resetWaiaSqliteSingleton();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `waia-wp17-${wp17SessionCounter}-`));
  process.env.DATABASE_URL = `file:${path.join(tmpDir, "wp17.sqlite")}`;
  migrateDatabaseFromEnv();
  const db = getDb();
  const resolvedUserId =
    userId ?? `00000000-0000-4000-8000-${String(417_000 + wp17SessionCounter).padStart(12, "0")}`;
  insertEmailPasswordUser(db, {
    id: resolvedUserId,
    email: `${resolvedUserId}@waia.invalid`,
    password: "password123",
    identityLabel: "WP17 Execution",
  });
  const orgId = ensureUserCoreSeedSqlite(db, {
    userId: resolvedUserId,
    displayName: "WP17 Execution",
  });
  const model = createWp17Model();
  return {
    orgId,
    context: requireOrgContext(orgId),
    repo: createSqliteOrderRepository(db),
    model,
    exchange: createHistoricalSimulatedExchange(model),
    cleanup: () => {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    },
  };
}

export async function createAcceptedMarketOrder(
  repo: OrderRepository,
  context: ReturnType<typeof requireOrgContext>,
  overrides?: Partial<{
    quantity: string;
    symbol: string;
    side: "buy" | "sell";
  }>,
): Promise<OrderRow> {
  const created = await repo.createOrder(context, {
    venue: "HTX",
    executionMode: "mock",
    symbol: overrides?.symbol ?? "BTCUSDT",
    side: overrides?.side ?? "buy",
    type: "market",
    quantity: overrides?.quantity ?? "0.5",
    clientOrderId: `client-${crypto.randomUUID()}`,
    idempotencyKey: `idem-${crypto.randomUUID()}`,
    riskDecisionId: crypto.randomUUID(),
  });
  let order = await repo.transitionOrder(context, {
    orderId: created.id,
    expectedStateVersion: 1,
    toState: "RISK_APPROVED",
  });
  order = await repo.transitionOrder(context, {
    orderId: order.id,
    expectedStateVersion: 2,
    toState: "SENT_TO_EXCHANGE",
  });
  return repo.transitionOrder(context, {
    orderId: order.id,
    expectedStateVersion: 3,
    toState: "ACCEPTED",
  });
}

export function createWp17PersistencePort(
  repo: OrderRepository,
  model: HistoricalExecutionModelV1,
): HistoricalExecutionPersistencePort {
  async function latestOrder(
    context: ReturnType<typeof requireOrgContext>,
    orderId: string,
  ): Promise<OrderRow> {
    const current = await repo.getOrderById(context, orderId);
    if (!current) {
      throw new OrderNotFoundError(orderId);
    }
    return current;
  }

  return {
    async recordSimulatedFill(context, order, event, isFirstSlice) {
      const current = await latestOrder(context, order.id);
      const economics = applyHistoricalExecutionEconomics(event, model);
      const newFilledQty = addDecimal(current.filledQuantity, event.sliceQuantity);
      const avgFillPrice =
        compareDecimal(current.filledQuantity, "0") === 0
          ? economics.netFillPrice
          : divideDecimal(
              addDecimal(
                multiplyDecimal(current.avgFillPrice ?? "0", current.filledQuantity),
                multiplyDecimal(economics.netFillPrice, event.sliceQuantity),
              ),
              newFilledQty,
            );

      const payload = buildRecordFillPayload(
        event,
        economics,
        context.organizationId,
        current.id,
        current.side,
        avgFillPrice,
        newFilledQty,
        !isFirstSlice,
      );

      if (isFirstSlice) {
        const fillTarget =
          compareDecimal(event.remainingQuantityAfter, "0") === 0 ? "FILLED" : "PARTIALLY_FILLED";
        await repo.transitionOrder(context, {
          orderId: current.id,
          expectedStateVersion: current.stateVersion,
          toState: fillTarget,
          filledQuantity: newFilledQty,
          avgFillPrice,
        });
        await repo.recordFill(context, payload);
        return;
      }

      await repo.recordFillProgress(context, payload as RecordFillProgressInput);
      if (compareDecimal(event.remainingQuantityAfter, "0") === 0) {
        const updated = await latestOrder(context, current.id);
        await repo.transitionOrder(context, {
          orderId: updated.id,
          expectedStateVersion: updated.stateVersion,
          toState: "FILLED",
          filledQuantity: newFilledQty,
          avgFillPrice,
        });
      }
    },
    async transitionOrderExpired(context, order) {
      const current = await latestOrder(context, order.id);
      return repo.transitionOrder(context, {
        orderId: current.id,
        expectedStateVersion: current.stateVersion,
        toState: "EXPIRED",
      });
    },
    async transitionOrderCancelled(context, order) {
      const current = await latestOrder(context, order.id);
      if (current.state === "CANCELLED") {
        return current;
      }
      const cancelRequested =
        current.state === "CANCEL_REQUESTED"
          ? current
          : await repo.transitionOrder(context, {
              orderId: current.id,
              expectedStateVersion: current.stateVersion,
              toState: "CANCEL_REQUESTED",
            });
      return repo.transitionOrder(context, {
        orderId: cancelRequested.id,
        expectedStateVersion: cancelRequested.stateVersion,
        toState: "CANCELLED",
      });
    },
  };
}

export type AdvanceWp17BarInput = {
  session: Wp17SqliteSession;
  barIndex: number;
  bar?: Bar;
  replayNowMs?: number;
};

export async function advanceWp17Bar(
  input: AdvanceWp17BarInput,
): Promise<{ fillEvents: unknown[]; accountState: AccountRiskState }> {
  const { session, barIndex } = input;
  const closedBar = input.bar ?? makeWp17Bar(barIndex);
  const replayNowMs = input.replayNowMs ?? Date.parse(closedBar.barCloseTime);
  const persistence = createWp17PersistencePort(session.repo, session.model);

  return session.exchange.advanceOnClosedBar({
    context: session.context,
    closedBar,
    barIndex,
    model: session.model,
    persistence,
    replayNowMs,
    refreshAccountState: () => refreshWp17AccountState(session.repo, session.context),
    reconcileOrder: async () => undefined,
  });
}
