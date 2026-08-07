import type { OrderRepository } from "@/lib/trader/execution/order-repository.types";
import { bumpIdhpsCounter } from "@/lib/trader/execution/idhps-hot-path-counters";
import type { AccountRiskState } from "@/lib/trader/risk/capital-limits.types";
import { addDecimal, compareDecimal, multiplyDecimal } from "@/lib/trader/risk/numeric";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

import { derivePaperBook } from "@/lib/trader/paper/derive-paper-book";

export type DeriveAccountRiskStateInput = {
  context: OrgContext;
  orderRepository: OrderRepository;
  executionMode?: "mock";
};

function parseQuoteCurrency(symbol: string): string {
  const parts = symbol.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`[trader/paper] invalid symbol for quote currency: ${symbol}`);
  }
  return parts[1];
}

/**
 * Rebuilds {@link AccountRiskState} from persisted mock orders (full re-derive, idempotent).
 *
 * **Legacy path (pre-M2):** Used when {@link PortfolioCycleContext} is absent — fixture replay,
 * research v1 forensic parity, and scripts that have not adopted the portfolio adapter.
 *
 * `positions[]` come from {@link derivePaperBook}. Exposure fields are risk-projection
 * snapshots, not PnL or paper-book balances. `quoteExposureByCurrency` accumulates buy
 * notionals only; sells do not unwind quote exposure in this slice (known limitation).
 *
 * **M2 deposit-aware paths** must use {@link derivePortfolioAccountState} +
 * {@link toAccountRiskState} instead (see `paper-cycle-runner`, `run-paper-loop-cycle`,
 * research v2 / optional backtest `portfolio` input).
 *
 * `dailyPnl` and `drawdown` remain `"0"` on this legacy path.
 */
export async function deriveAccountRiskStateFromMockOrders(
  input: DeriveAccountRiskStateInput,
): Promise<AccountRiskState> {
  bumpIdhpsCounter("deriveAccountRiskStateFromMockOrdersCalls");
  const executionMode = input.executionMode ?? "mock";
  const filter = { executionMode };

  const [book, orders, openOrders] = await Promise.all([
    derivePaperBook({
      context: input.context,
      orderRepository: input.orderRepository,
      executionMode,
    }),
    input.orderRepository.listOrders(input.context, filter),
    input.orderRepository.listOpenOrders(input.context, filter),
  ]);

  const quoteExposureByCurrency: Record<string, string> = {};

  for (const order of orders) {
    if (compareDecimal(order.filledQuantity, "0") <= 0) {
      continue;
    }

    if (order.side === "buy" && order.avgFillPrice) {
      const quote = parseQuoteCurrency(order.symbol);
      const notional = multiplyDecimal(order.avgFillPrice, order.filledQuantity);
      const currentExposure = quoteExposureByCurrency[quote] ?? "0";
      quoteExposureByCurrency[quote] = addDecimal(currentExposure, notional);
    }
  }

  return {
    positions: book.positions,
    openOrderCount: openOrders.length,
    dailyPnl: "0",
    drawdown: "0",
    quoteExposureByCurrency,
  };
}
