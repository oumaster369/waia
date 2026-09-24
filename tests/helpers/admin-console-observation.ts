import { randomUUID } from "node:crypto";
import type {
  AccountObservation,
  ObservationBinding,
} from "@/lib/trader/account-observation/types";

export function consoleObservation(
  binding: ObservationBinding,
  amount: string | null,
  at: number,
): AccountObservation {
  const component = <T>(values: T[]) => ({
    status: amount === null ? ("ERROR" as const) : ("COMPLETE" as const),
    values: amount === null ? null : values,
    sourceAsOfMs: at,
    readStartedAtMs: at,
    readCompletedAtMs: at,
    error: amount === null ? ("READ_FAILED" as const) : null,
  });
  const balances = component([
    { asset: "USDT", free: amount ?? "0", locked: "0", total: amount ?? "0" },
  ]);
  return {
    schemaVersion: "account-observation/v1",
    observationId: randomUUID(),
    binding,
    collectionStartedAtMs: at,
    collectionCompletedAtMs: at,
    status: balances.status,
    balances,
    openOrders: component([]),
    trades: [{ symbol: "BTCUSDT", component: component([]) }],
    holdings: balances.values,
  };
}
