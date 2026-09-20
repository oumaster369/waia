import { describe, expect, it } from "vitest";
import {
  nonUsdtInventory,
  secondsUntilNextPoll,
  summarizeCabinetObservation,
  usdtSpot,
} from "@/lib/trader/account-observation/cabinet-view";
import type { AccountObservation } from "@/lib/trader/account-observation/types";

const now = 1_800_000_000_000;
const observation: AccountObservation = {
  schemaVersion: "account-observation/v1",
  observationId: "33333333-3333-4333-8333-333333333333",
  binding: {
    organizationId: "11111111-1111-4111-8111-111111111111",
    credentialId: "22222222-2222-4222-8222-222222222222",
    exchangeAccountId: "73750148",
    credentialRevision: "1",
    configurationRevision: "1",
  },
  collectionStartedAtMs: now - 100,
  collectionCompletedAtMs: now,
  status: "COMPLETE",
  balances: {
    values: [
      { asset: "USDT", free: "12.50", locked: "3.00", total: "15.50" },
      { asset: "BTC", free: "0.010", locked: "0", total: "0.010" },
      { asset: "1INCH", free: "0", locked: "0", total: "0" },
    ],
    status: "COMPLETE",
    sourceAsOfMs: now,
    readStartedAtMs: now - 100,
    readCompletedAtMs: now,
    error: null,
  },
  holdings: [
    { asset: "USDT", free: "12.50", locked: "3.00", total: "15.50" },
    { asset: "BTC", free: "0.010", locked: "0", total: "0.010" },
    { asset: "1INCH", free: "0", locked: "0", total: "0" },
  ],
  openOrders: {
    values: [],
    status: "COMPLETE",
    sourceAsOfMs: now,
    readStartedAtMs: now - 100,
    readCompletedAtMs: now,
    error: null,
  },
  trades: [
    {
      symbol: "BTCUSDT",
      component: {
        values: [],
        status: "COMPLETE",
        sourceAsOfMs: now,
        readStartedAtMs: now - 100,
        readCompletedAtMs: now,
        error: null,
      },
    },
  ],
};

describe("cabinet observation view", () => {
  it("reads USDT cash without converting decimals", () => {
    expect(usdtSpot(observation.balances.values)).toEqual({
      free: "12.50",
      locked: "3.00",
      total: "15.50",
    });
  });

  it("hides USDT and zero dust from inventory", () => {
    expect(nonUsdtInventory(observation.balances.values)).toEqual([
      { asset: "BTC", free: "0.010", locked: "0", total: "0.010" },
    ]);
  });

  it("counts down to the next 60s collector poll", () => {
    expect(secondsUntilNextPoll(now, now + 15_000)).toBe(45);
    expect(secondsUntilNextPoll(now, now + 60_000)).toBe(0);
  });

  it("summarizes a cabinet without inventing PnL", () => {
    expect(summarizeCabinetObservation(observation)).toEqual({
      usdtFree: "12.50",
      usdtLocked: "3.00",
      openOrdersCount: 0,
      lastTickMs: now,
      observationStatus: "COMPLETE",
    });
    expect(summarizeCabinetObservation(null)).toEqual({
      usdtFree: null,
      usdtLocked: null,
      openOrdersCount: null,
      lastTickMs: null,
      observationStatus: null,
    });
  });
});
