import { createHash } from "node:crypto";

import { tryNormalizeHistoricalInstrument } from "@/lib/trader/symbols/historical-instrument";

export const CONTROL_REPLAY_TEST_ONLY_INTENT_SCHEMA = "control-replay-test-only-intent/v1" as const;

export class ControlReplayCrossSymbolForecastError extends Error {
  readonly code = "CONTROL_REPLAY_CROSS_SYMBOL_FORECAST_FORBIDDEN" as const;
  constructor(message: string) {
    super(message);
    this.name = "ControlReplayCrossSymbolForecastError";
  }
}

export type ControlReplayTestOnlyIntentV1 = Readonly<{
  schemaVersion: typeof CONTROL_REPLAY_TEST_ONLY_INTENT_SCHEMA;
  authorityClass: "TEST_ONLY";
  capitalEligible: false;
  symbol: "BTCUSDT" | "ETHUSDT";
  side: "buy" | "sell";
  scientificClaim: false;
  identityDigest: string;
}>;

export function compactControlReplaySymbol(symbol: string): "BTCUSDT" | "ETHUSDT" {
  const normalized = tryNormalizeHistoricalInstrument(symbol);
  if (normalized !== "BTCUSDT" && normalized !== "ETHUSDT") {
    throw new ControlReplayCrossSymbolForecastError(`unsupported Control Replay symbol ${symbol}`);
  }
  return normalized;
}

export function assertForecastSymbolMatchesMarket(input: {
  forecastSymbol: string;
  marketSymbol: string;
}): void {
  const forecast = compactControlReplaySymbol(input.forecastSymbol);
  const market = compactControlReplaySymbol(input.marketSymbol);
  if (forecast !== market) {
    throw new ControlReplayCrossSymbolForecastError(
      `BTC/ETH Forecast identity mismatch: forecast=${forecast} market=${market}`,
    );
  }
}

export function buildControlReplayTestOnlyIntent(input: {
  symbol: string;
  side?: "buy" | "sell";
  horizonMinutes?: number;
}): ControlReplayTestOnlyIntentV1 {
  const symbol = compactControlReplaySymbol(input.symbol);
  const side = input.side ?? "buy";
  const horizonMinutes = input.horizonMinutes ?? 30;
  const identityDigest = createHash("sha256")
    .update(
      JSON.stringify({
        schemaVersion: CONTROL_REPLAY_TEST_ONLY_INTENT_SCHEMA,
        authorityClass: "TEST_ONLY",
        capitalEligible: false,
        symbol,
        side,
        horizonMinutes,
        scientificClaim: false,
      }),
      "utf8",
    )
    .digest("hex");
  return {
    schemaVersion: CONTROL_REPLAY_TEST_ONLY_INTENT_SCHEMA,
    authorityClass: "TEST_ONLY",
    capitalEligible: false,
    symbol,
    side,
    scientificClaim: false,
    identityDigest,
  };
}
