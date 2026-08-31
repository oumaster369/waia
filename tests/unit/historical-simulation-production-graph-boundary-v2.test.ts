import { describe, expect, it } from "vitest";
import { assertHistoricalForecastPitAuthorityReceiptV2, assertHistoricalSimulationV2ClosedGraphRequest,
  createHistoricalForecastPitAuthorityReceiptV2 } from
  "@/lib/trader/historical-simulation-v2/production-graph-boundary-v2";

const sql = Object.assign(() => undefined, { reserve: () => undefined }) as never;
const safe = { sql, organizationId: "org", accountId: "account", runId: "run",
  partition: "DEVELOPMENT" as const, symbol: "BTCUSDT" as const,
  expectedCycleSequence: 0,
};
const identity = { organizationId: "org", accountId: "account", runId: "run", cycleId: "cycle-1",
  pitAnchor: "2026-08-30T00:00:00.000Z", datasetMembershipContentDigestHex: "1".repeat(64),
  datasetSealDigestHex: "2".repeat(64), buildSha: "a".repeat(40) };

describe("Historical Simulation V2 closed production graph boundary", () => {
  it("accepts only the pre-holdout identity-only launch request", () => {
    expect(() => assertHistoricalSimulationV2ClosedGraphRequest(safe)).not.toThrow();
  });
  it.each(["resolveForecastInput", "persistEvidence", "capitalAuthority", "privateCredentials", "realityPort",
    "blindHoldout", "connector", "cycles", "repoRoot", "datasetRoot"])("rejects caller authority %s", (key) => {
    expect(() => assertHistoricalSimulationV2ClosedGraphRequest({ ...safe, [key]: { nested: () => undefined } }))
      .toThrow("UNSAFE_LAUNCH_REQUEST");
  });
  it.each([null, undefined, [], "request"])("rejects non-object %s", (value) => {
    expect(() => assertHistoricalSimulationV2ClosedGraphRequest(value)).toThrow("UNSAFE_LAUNCH_REQUEST");
  });
  it("rejects caller-supplied quantity authority", () => {
    expect(() => assertHistoricalSimulationV2ClosedGraphRequest({ ...safe, defaultQuantity: "0.01" }))
      .toThrow("UNSAFE_LAUNCH_REQUEST");
  });
  it.each([-1, 0.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])("rejects cycle sequence %s", (expectedCycleSequence) => {
    expect(() => assertHistoricalSimulationV2ClosedGraphRequest({ ...safe, expectedCycleSequence }))
      .toThrow("UNSAFE_LAUNCH_REQUEST");
  });
  it("seals and validates exact PIT scope and rejects cross-cycle substitution", () => {
    const receipt = createHistoricalForecastPitAuthorityReceiptV2({ ...identity,
      forecastId: "00000000-0000-4000-8000-000000000101",
      forecastAuthorityContentDigestHex: "3".repeat(64), verificationReceiptDigestHex: "4".repeat(64),
      preregistrationId: "00000000-0000-4000-8000-000000000102", authorityBundleDigestHex: "5".repeat(64) });
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(() => assertHistoricalForecastPitAuthorityReceiptV2(receipt, identity)).not.toThrow();
    expect(() => assertHistoricalForecastPitAuthorityReceiptV2(receipt, { ...identity, cycleId: "cycle-2" }))
      .toThrow("HISTORICAL_PIT_AUTHORITY_REFUSED");
    expect(() => assertHistoricalForecastPitAuthorityReceiptV2({ ...receipt,
      datasetSealDigestHex: "9".repeat(64) }, identity)).toThrow("HISTORICAL_PIT_AUTHORITY_REFUSED");
    for (const extra of [{ privateCredential: "secret" }, { connector: () => undefined }]) {
      const body = { ...receipt, ...extra } as Record<string, unknown>;
      delete body.contentDigestHex;
      expect(() => assertHistoricalForecastPitAuthorityReceiptV2({ ...body,
        contentDigestHex: "0".repeat(64) }, identity)).toThrow("HISTORICAL_PIT_AUTHORITY_REFUSED");
    }
  });
  it("requires the SQL capability and every exact request key", () => {
    expect(() => assertHistoricalSimulationV2ClosedGraphRequest({ ...safe, sql: undefined }))
      .toThrow("UNSAFE_LAUNCH_REQUEST");
    const { runId: _runId, ...missing } = safe;
    expect(() => assertHistoricalSimulationV2ClosedGraphRequest(missing)).toThrow("UNSAFE_LAUNCH_REQUEST");
  });
});
