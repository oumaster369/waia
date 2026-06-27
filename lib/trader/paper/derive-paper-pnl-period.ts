import type { OrderRepository } from "@/lib/trader/execution/order-repository.types";
import {
  buildPaperPnLFromLedger,
  buildQuoteCurrencyBySymbol,
  computeUnrealizedFromLedgerForMarks,
  loadPaperFillEvents,
  resolvePaperPnLQuoteCurrency,
  walkFillsForPnL,
  type PaperPnLFillEvent,
} from "@/lib/trader/paper/derive-paper-pnl";
import { PaperPnLScopeError, PaperPnLWindowError } from "@/lib/trader/paper/paper-pnl.errors";
import type { PaperPnLMarkPrices } from "@/lib/trader/paper/paper-pnl.types";
import type {
  PaperPnLPeriodRollup,
  PaperPnLWindow,
} from "@/lib/trader/paper/paper-pnl-period.types";
import type { PaperBookExecutionMode } from "@/lib/trader/paper/paper-book.types";
import { addDecimal, subtractDecimal } from "@/lib/trader/risk/numeric";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type DerivePaperPnLPeriodInput = {
  context: OrgContext;
  orderRepository: OrderRepository;
  executionMode?: PaperBookExecutionMode;
  window: PaperPnLWindow;
  markPrices?: PaperPnLMarkPrices;
  /** Skip repository load when batching with strategy evaluation export. */
  fillEvents?: PaperPnLFillEvent[];
  derivedAt?: Date;
};

function assertValidWindow(window: PaperPnLWindow): void {
  if (window.start.getTime() >= window.end.getTime()) {
    throw new PaperPnLWindowError(
      `invalid window: start ${window.start.toISOString()} must be before end ${window.end.toISOString()}`,
    );
  }
}

function partitionFillEventsByWindow(
  fillEvents: readonly PaperPnLFillEvent[],
  window: PaperPnLWindow,
): {
  openingEvents: PaperPnLFillEvent[];
  inWindowEvents: PaperPnLFillEvent[];
} {
  const openingEvents: PaperPnLFillEvent[] = [];
  const inWindowEvents: PaperPnLFillEvent[] = [];
  const startMs = window.start.getTime();
  const endMs = window.end.getTime();

  for (const event of fillEvents) {
    const executedMs = event.fill.executedAt.getTime();
    if (executedMs < startMs) {
      openingEvents.push(event);
    } else if (executedMs >= startMs && executedMs < endMs) {
      inWindowEvents.push(event);
    }
  }

  return { openingEvents, inWindowEvents };
}

function collectSymbols(fillEvents: readonly PaperPnLFillEvent[]): string[] {
  return [...new Set(fillEvents.map((event) => event.order.symbol))];
}

/**
 * Idempotent derived Paper PnL period rollup for caller-supplied windows.
 *
 * Operational read model — not billing, HWM, equity, or accounting ledger.
 */
export async function derivePaperPnLPeriod(
  input: DerivePaperPnLPeriodInput,
): Promise<PaperPnLPeriodRollup> {
  const executionMode = input.executionMode ?? "mock";
  if (executionMode !== "mock" && executionMode !== "paper") {
    throw new PaperPnLScopeError(
      `execution mode ${executionMode} is out of scope for paper PnL period rollup`,
    );
  }

  assertValidWindow(input.window);

  const { fillEvents } =
    input.fillEvents !== undefined
      ? { fillEvents: input.fillEvents }
      : await loadPaperFillEvents({
          context: input.context,
          orderRepository: input.orderRepository,
          executionMode,
        });

  const symbols = collectSymbols(fillEvents);
  const quoteCurrency = resolvePaperPnLQuoteCurrency(symbols, input.markPrices);
  const quoteCurrencyBySymbol = buildQuoteCurrencyBySymbol(symbols);

  const { openingEvents, inWindowEvents } = partitionFillEventsByWindow(fillEvents, input.window);

  const openingWalk = walkFillsForPnL(openingEvents, quoteCurrencyBySymbol);
  const endWalk = walkFillsForPnL(
    inWindowEvents,
    quoteCurrencyBySymbol,
    openingWalk.ledgerBySymbol,
  );

  const periodRealizedPnl = subtractDecimal(endWalk.realizedPnl, openingWalk.realizedPnl);
  const periodTotalFees = subtractDecimal(endWalk.totalFees, openingWalk.totalFees);
  const periodFeesByAsset = { ...endWalk.feesByAsset };
  const periodValuationGaps = [...endWalk.valuationGaps];

  const derivedAt = input.derivedAt ?? new Date();
  const endSnapshot = buildPaperPnLFromLedger({
    organizationId: input.context.organizationId,
    executionMode,
    quoteCurrency,
    walk: endWalk,
    markPrices: input.markPrices,
    derivedAt,
  });

  let periodUnrealizedChange: string | null = null;
  let periodTotalPnlChange: string | null = null;

  if (input.markPrices !== undefined) {
    const startGaps: string[] = [];
    const startUnrealized = computeUnrealizedFromLedgerForMarks(
      openingWalk.ledgerBySymbol,
      input.markPrices,
      startGaps,
    );
    periodValuationGaps.push(...startGaps);

    if (startUnrealized !== null && endSnapshot.unrealizedPnl !== null) {
      periodUnrealizedChange = subtractDecimal(endSnapshot.unrealizedPnl, startUnrealized);
      periodTotalPnlChange = addDecimal(periodRealizedPnl, periodUnrealizedChange);
    }
  }

  return {
    organizationId: input.context.organizationId,
    executionMode,
    quoteCurrency,
    window: input.window,
    periodRealizedPnl,
    periodTotalFees,
    periodFeesByAsset,
    periodValuationGaps,
    periodUnrealizedChange,
    periodTotalPnlChange,
    endSnapshot,
    derivedAt,
  };
}
