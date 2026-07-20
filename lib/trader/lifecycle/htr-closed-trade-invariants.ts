import { addDecimal, compareDecimal } from "@/lib/trader/risk/numeric";

export type ClosedTradeRecordV1 = {
  tradeId: string;
  symbol: string;
  grossRealizedPnl: string;
  netRealizedPnl: string;
  closedAt: string;
};

export class ClosedTradeInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClosedTradeInvariantError";
  }
}

export function assertClosedTradeRealityInvariants(input: {
  closedTrades: ClosedTradeRecordV1[];
  accountingGrossRealized: string;
  accountingNetRealized: string;
}): void {
  let grossSum = "0";
  let netSum = "0";

  for (const trade of input.closedTrades) {
    grossSum = addDecimal(grossSum, trade.grossRealizedPnl);
    netSum = addDecimal(netSum, trade.netRealizedPnl);
  }

  if (compareDecimal(grossSum, input.accountingGrossRealized) !== 0) {
    throw new ClosedTradeInvariantError(
      `closed-trade gross sum ${grossSum} != accounting gross ${input.accountingGrossRealized}`,
    );
  }
  if (compareDecimal(netSum, input.accountingNetRealized) !== 0) {
    throw new ClosedTradeInvariantError(
      `closed-trade net sum ${netSum} != accounting net ${input.accountingNetRealized}`,
    );
  }
}
