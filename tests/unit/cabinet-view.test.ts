import { describe, expect, it } from "vitest";
import {
  ACCOUNT_OBSERVATION_STALE_AFTER_MS,
  cabinetLiveLabel,
  nonUsdtInventory,
  secondsUntilNextPoll,
  summarizeFuturesBalance,
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

  it("counts down to the next collector cycle", () => {
    expect(secondsUntilNextPoll(now, now + 15_000)).toBe(165);
    expect(secondsUntilNextPoll(now, now + 180_000)).toBe(0);
  });

  it("keeps Live as the headline while a snapshot is on screen", () => {
    expect(
      cabinetLiveLabel({
        status: "ERROR",
        observation,
        stale: false,
        transport: "RECONNECTING",
      }),
    ).toBe("Live");
    expect(
      cabinetLiveLabel({
        status: "ERROR",
        observation: null,
        stale: false,
      }),
    ).toBe("Connecting");
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

  it("does not infer a futures balance from an older observation version", () => {
    expect(summarizeFuturesBalance(observation, now)).toMatchObject({
      equityUsd: null,
      availableMarginUsd: null,
      profitUnrealUsd: null,
      readCompletedAtMs: null,
      hasLegacyDerivatives: false,
      hasFuturesProjection: false,
    });
    const legacyDerivatives = {
      ...observation,
      schemaVersion: "account-observation/v2",
      derivatives: {} as never,
    } as AccountObservation;
    expect(summarizeFuturesBalance(legacyDerivatives, now)).toMatchObject({
      equityUsd: null,
      hasLegacyDerivatives: true,
      hasFuturesProjection: false,
    });
  });

  it.each(["account-observation/v3", "account-observation/v4"] as const)("keeps %s futures USD fields separate and preserves observed zero strings", schemaVersion => {
    const v3 = {
      ...observation,
      schemaVersion,
      htxV5: {
        balance: {
          status: "COMPLETE",
          value: {
            account: {
              equityUsd: "0",
              availableMarginUsd: "0.00",
              profitUnrealUsd: "-0.000",
            },
          },
          readCompletedAtMs: now - 1_000,
        },
      },
    } as unknown as AccountObservation;

    expect(summarizeFuturesBalance(v3, now)).toMatchObject({
      equityUsd: "0",
      availableMarginUsd: "0.00",
      profitUnrealUsd: "-0.000",
      readCompletedAtMs: now - 1_000,
      stale: false,
    });
  });

  it("uses the V5 balance read time for stale status and treats errors as unavailable", () => {
    const staleAt = now - ACCOUNT_OBSERVATION_STALE_AFTER_MS - 1;
    const stale = {
      ...observation,
      schemaVersion: "account-observation/v3",
      htxV5: {
        balance: {
          status: "COMPLETE",
          value: {
            account: { equityUsd: "8", availableMarginUsd: "7", profitUnrealUsd: "1" },
          },
          readCompletedAtMs: staleAt,
        },
      },
    } as unknown as AccountObservation;
    expect(summarizeFuturesBalance(stale, now).stale).toBe(true);

    const error = {
      ...stale,
      htxV5: {
        balance: { status: "ERROR", value: null, readCompletedAtMs: now, error: "READ_FAILED" },
      },
    } as unknown as AccountObservation;
    expect(summarizeFuturesBalance(error, now)).toMatchObject({
      equityUsd: null,
      availableMarginUsd: null,
      profitUnrealUsd: null,
      stale: false,
    });
  });
});
