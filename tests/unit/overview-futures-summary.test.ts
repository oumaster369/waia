import { describe, expect, it } from "vitest";
import {
  summarizeOverviewFutures,
  type OverviewFuturesRow,
} from "@/lib/trader/account-observation/overview-futures-summary";
import { ACCOUNT_OBSERVATION_STALE_AFTER_MS } from "@/lib/trader/account-observation/cabinet-view";

const now = 1_800_000_000_000;
function row(id: string, equity = "100"): OverviewFuturesRow {
  return {
    organizationId: `org-${id}`,
    credentialId: `credential-${id}`,
    exchangeAccountId: `account-${id}`,
    htxUid: id,
    observation: "ready",
    futures: {
      equityUsd: equity,
      availableMarginUsd: "50.01",
      profitUnrealUsd: "-1.000000000001",
      readCompletedAtMs: now - 1_000,
      stale: false,
      hasLegacyDerivatives: false,
      hasFuturesProjection: true,
    },
  };
}
function balance(
  input: OverviewFuturesRow,
  patch: Partial<NonNullable<OverviewFuturesRow["futures"]>>,
): OverviewFuturesRow {
  return { ...input, futures: { ...input.futures!, ...patch } };
}

describe("main overview futures display summary", () => {
  it("sums three unique observed accounts exactly in USD, including signed values beyond 8dp", () => {
    const result = summarizeOverviewFutures(
      [row("1", "207.480000000001"), row("2", "5000"), row("3", "0.000000000009")],
      now,
    );
    expect(result).toMatchObject({
      state: "complete",
      currency: "USD",
      included: 3,
      total: 3,
      equityUsd: "5207.48000000001",
      availableMarginUsd: "150.03",
      profitUnrealUsd: "-3.000000000003",
      oldestReadCompletedAtMs: now - 1_000,
      excluded: [],
    });
  });

  it("preserves large integers and scientific fractions without Number rounding", () => {
    const result = summarizeOverviewFutures(
      [row("1", "9007199254740993.1"), row("2", "2e-1"), row("3", "-0.3")],
      now,
    );
    expect(result.equityUsd).toBe("9007199254740993");
    expect(summarizeOverviewFutures([row("1", "1e-128")], now).equityUsd).toBe(
      `0.${"0".repeat(127)}1`,
    );
  });

  it("distinguishes all-missing from an observed zero and no connected accounts", () => {
    expect(summarizeOverviewFutures([{ ...row("1"), futures: null }], now)).toMatchObject({
      state: "unavailable",
      equityUsd: null,
      included: 0,
      total: 1,
    });
    expect(
      summarizeOverviewFutures(
        [
          balance(row("1", "-0e2"), {
            availableMarginUsd: "0.00",
            profitUnrealUsd: "-0.000",
          }),
        ],
        now,
      ),
    ).toMatchObject({
      state: "complete",
      equityUsd: "0",
      availableMarginUsd: "0",
      profitUnrealUsd: "0",
    });
    expect(summarizeOverviewFutures([], now)).toMatchObject({
      state: "empty",
      equityUsd: null,
      included: 0,
      total: 0,
    });
  });

  it("labels a known subtotal partial and excludes stale and unknown rows", () => {
    const stale = balance(row("2", "5000"), {
      readCompletedAtMs: now - ACCOUNT_OBSERVATION_STALE_AFTER_MS,
    });
    const result = summarizeOverviewFutures(
      [row("1", "207.48"), stale, { ...row("3"), futures: null }],
      now,
    );
    expect(result).toMatchObject({
      state: "partial",
      included: 1,
      total: 3,
      equityUsd: "207.48",
      excluded: [
        { exchangeAccountId: "account-2", reason: "STALE" },
        { exchangeAccountId: "account-3", reason: "FUTURES_UNAVAILABLE" },
      ],
    });
  });

  it.each(["htxUid", "credentialId", "exchangeAccountId"] as const)(
    "excludes both members of a duplicate %s rather than guessing or double counting",
    (key) => {
      const first = row("1", "100");
      const duplicate = { ...row("2", "100"), [key]: first[key] };
      expect(summarizeOverviewFutures([first, duplicate, row("3", "7")], now)).toMatchObject({
        state: "partial",
        equityUsd: "7",
        included: 1,
        total: 3,
        excluded: [
          expect.objectContaining({ reason: "DUPLICATE_IDENTITY" }),
          expect.objectContaining({ reason: "DUPLICATE_IDENTITY" }),
        ],
      });
    },
  );

  it.each([null, now + 1, Number.NaN, -1, 2 ** 53])(
    "rejects invalid/future read time %s",
    (readCompletedAtMs) => {
      expect(
        summarizeOverviewFutures([balance(row("1"), { readCompletedAtMs })], now),
      ).toMatchObject({
        state: "unavailable",
        equityUsd: null,
        excluded: [expect.objectContaining({ reason: "TIME_INVALID" })],
      });
    },
  );

  it("expires values as the display clock advances independently of fetching", () => {
    expect(summarizeOverviewFutures([row("1")], now).state).toBe("complete");
    expect(
      summarizeOverviewFutures([row("1")], now + ACCOUNT_OBSERVATION_STALE_AFTER_MS).state,
    ).toBe("unavailable");
    expect(summarizeOverviewFutures([row("1")], Number.NaN).equityUsd).toBeNull();
  });

  it.each(["1e999", "1e-129", "NaN", "Infinity", "+1", "", "1".repeat(81)])(
    "refuses unsupported amount %s without rounding or substituting zero",
    (equity) => {
      expect(summarizeOverviewFutures([row("1", equity)], now)).toMatchObject({
        state: "unavailable",
        equityUsd: null,
        excluded: [expect.objectContaining({ reason: "AMOUNT_UNSUPPORTED" })],
      });
    },
  );

  it("does not sum retained data while the account directory cannot be refreshed", () => {
    expect(summarizeOverviewFutures([row("1"), row("2")], now, false)).toMatchObject({
      state: "unavailable",
      included: 0,
      total: 2,
      equityUsd: null,
      oldestReadCompletedAtMs: null,
      excluded: [
        expect.objectContaining({ reason: "DIRECTORY_STALE" }),
        expect.objectContaining({ reason: "DIRECTORY_STALE" }),
      ],
    });
  });

  it.each(["loading", "waiting", "unavailable"] as const)(
    "does not admit retained numbers in %s rows",
    (observation) => {
      expect(summarizeOverviewFutures([{ ...row("1"), observation }], now).equityUsd).toBeNull();
    },
  );

  it("does not assume UID or V5 coverage from a legacy derivatives or null-field observation", () => {
    for (const candidate of [
      { ...row("1"), htxUid: null },
      balance(row("1"), { hasLegacyDerivatives: true }),
      balance(row("1"), { hasFuturesProjection: false }),
      balance(row("1"), { availableMarginUsd: null }),
      balance(row("1"), { profitUnrealUsd: null }),
    ])
      expect(summarizeOverviewFutures([candidate], now).equityUsd).toBeNull();
  });
});
