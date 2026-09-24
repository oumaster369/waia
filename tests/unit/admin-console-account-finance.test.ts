import { describe, expect, it } from "vitest";
import { dedupeAccounts } from "@/lib/trader/admin-console/accounts/dedupe";
import { buildAccountFinance } from "@/lib/trader/admin-console/read-models/account-finance";
import { buildOverview } from "@/lib/trader/admin-console/read-models/overview";
import { consoleObservation } from "@/tests/helpers/admin-console-observation";

const now = Date.parse("2026-09-24T20:00:00Z");
const binding = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  credentialId: "00000000-0000-4000-8000-000000000002",
  exchangeAccountId: "123",
  credentialRevision: "1",
  configurationRevision: "test",
};
const group = dedupeAccounts([
  { ...binding, venue: "htx", ownerEmail: null, createdAt: new Date(now).toISOString() },
])[0]!;
function evidence(amount: string | null, at = now) {
  const payload = consoleObservation(binding, amount, at);
  return { id: payload.observationId, payload, recordedAt: new Date(at).toISOString() };
}
function account(overrides: Partial<Parameters<typeof buildAccountFinance>[0]> = {}) {
  return buildAccountFinance({
    group,
    latest: evidence("10"),
    lastComplete: null,
    connectedSince: null,
    currency: "USDT",
    mode: "live",
    nowMs: now,
    quotes: [],
    lots: [],
    lotsRevision: "0",
    ...overrides,
  });
}
const context = {
  currency: "USDT",
  method: "htx_spot_last:usdt",
  mode: "live",
  periodBounds: { start: "2026-09-23", end: "2026-09-24" },
};

describe("observed account finance", () => {
  it("keeps observed zero, missing, invalid and failed observations distinct", () => {
    expect(account({ latest: evidence("0") })).toMatchObject({
      equity: "0",
      state: "ok",
      included: true,
    });
    expect(account({ latest: null })).toMatchObject({
      equity: null,
      reason: "OBSERVATION_MISSING",
      included: false,
    });
    expect(account({ latest: { ...evidence("10"), payload: {} } })).toMatchObject({
      equity: null,
      reason: "OBSERVATION_INVALID",
    });
    expect(account({ latest: evidence(null) })).toMatchObject({
      equity: null,
      reason: "OBSERVATION_ERROR",
    });
  });
  it("retains the last complete value after a failure, outside current sums", () => {
    const prior = evidence("10", now - 60_000);
    const row = account({ latest: evidence(null), lastComplete: prior });
    expect(row).toMatchObject({
      equity: "10",
      observedAt: prior.recordedAt,
      state: "stale",
      included: false,
    });
    const overview = buildOverview([row], context);
    expect(overview.finance.equity).toMatchObject({ state: "unavailable", value: null });
    expect(overview.lastKnownEstimate).toBe("10");
  });
  it("does not call a seven-day-old USDT observation current", () => {
    const row = account({ latest: evidence("20", now - 7 * 86400_000) });
    expect(row).toMatchObject({ state: "stale", included: false, equity: "20" });
    expect(row.reasons).toContain("OBSERVATION_STALE");
  });
  it.each(["paper", "history"])("never repeats real cash in %s", (mode) => {
    expect(account({ mode })).toMatchObject({
      state: "not_applicable",
      equity: null,
      reason: "EXCHANGE_BALANCE_LIVE_ONLY",
    });
  });
  it("rejects an observation whose binding belongs to another account", () => {
    const latest = evidence("999");
    latest.payload = { ...latest.payload, binding: { ...binding, exchangeAccountId: "foreign" } };
    expect(account({ latest })).toMatchObject({ equity: null, reason: "OBSERVATION_INVALID" });
  });
  it("never invents five zero metrics for an empty scope", () => {
    const overview = buildOverview([], context);
    for (const fact of Object.values(overview.finance))
      expect(fact).toMatchObject({ state: "empty", value: null });
    expect(overview.finance.equity.reasons).toContain("NO_ACCOUNTS_IN_SCOPE");
    expect(buildOverview([account()], context).finance.pnl).toMatchObject({
      state: "unavailable",
      value: null,
    });
  });
});
