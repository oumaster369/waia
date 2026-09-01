import { describe, expect, it, vi } from "vitest";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { HISTORICAL_DATASET_MEMBERSHIP_V2 } from "@/lib/trader/historical-simulation-v2/dataset-membership-v2";

const mocks = vi.hoisted(() => ({ loadPit: vi.fn(), loadAuthorities: vi.fn(), authorityFactory: vi.fn(), verificationFactory: vi.fn() }));
vi.mock("@/lib/trader/historical-simulation-v2/pit-forecast-input-loader-v2", () => ({
  loadPostgresHistoricalForecastInputPitInTransactionV2: mocks.loadPit,
}));
vi.mock("@/lib/trader/historical-simulation-v2/canonical-verification-receipt-postgres-v2", () => ({
  createPostgresCanonicalDecisionVerificationReceiptPortV2: mocks.verificationFactory,
}));
vi.mock("@/lib/trader/historical-simulation-v2/dee659-authority-repository-postgres-v2", () => ({
  createPostgresDee659AuthorityRepositoryV2: mocks.authorityFactory,
}));
vi.mock("@/lib/trader/historical-simulation-v2/modeled-execution-advance-v2", () => ({
  assertHistoricalMarketCycleV2: vi.fn(),
}));
vi.mock("@/lib/trader/market-data/bar-content-digest", () => ({ computeBarContentDigest: () => "5".repeat(64) }));
vi.mock("@/lib/trader/research/digest", () => ({ computeStableJsonDigest: () => "9".repeat(64) }));

import { createHistoricalSimulationProductionCyclePortV2 } from
  "@/lib/trader/historical-simulation-v2/production-cycle-port-v2";

const membershipBody = { schemaVersion: HISTORICAL_DATASET_MEMBERSHIP_V2, organizationId: "org", cycleId: "cycle",
  manifestSemanticDigestHex: "1".repeat(64), sealReceiptDigestHex: "2".repeat(64),
  partitionDigestHex: "3".repeat(64), partitionRawSha256Hex: "4".repeat(64), partition: "DEVELOPMENT" as const,
  symbol: "BTCUSDT" as const, recordIndex: 0, barContentDigestHex: "5".repeat(64),
  sealedCycleContentDigestHex: "6".repeat(64) };
const membership = { ...membershipBody, contentDigestHex: computeSemanticSha256Hex(membershipBody) };
const row = { forecast_id: "forecast", forecast_content_digest_hex: "f".repeat(64),
  forecast_authority_content_digest_hex: "7".repeat(64),
  knowledge_content_digest_hex: "8".repeat(64), dataset_authority_id: "dataset", dataset_authority_digest_hex: "2".repeat(64),
  dataset_membership_content_digest_hex: membership.contentDigestHex, dataset_membership_json: membership,
  pit_anchor: "2026-08-30T00:00:00.000Z", symbol: "BTCUSDT", partition: "DEVELOPMENT", record_index: 0,
  sealed_cycle_json: { cycleId: "cycle", contentDigestHex: "6".repeat(64),
    closedBar: { symbol: "BTC/USDT", barCloseTime: "2026-08-30T00:00:00.000Z" } },
  dataset_authority_content_digest_hex: "9".repeat(64), dee659_preregistration_id: "prereg",
  dee659_bundle_content_digest_hex: "a".repeat(64) };
const authorityRow = { dee659_preregistration_id: "prereg",
  dee659_bundle_content_digest_hex: "a".repeat(64) };

describe("Historical Simulation V2 transaction-scoped production cycle port", () => {
  it("loads PIT Forecast and 0187 authorities through the exact same transaction", async () => {
    let call = 0; const tx = (async () => (++call === 1 ? [row] : call === 2 ? [authorityRow] :
      [{ id: "verification" }])) as never;
    mocks.verificationFactory.mockReturnValue({});
    mocks.authorityFactory.mockReturnValue({ load: mocks.loadAuthorities });
    mocks.loadPit.mockResolvedValue({ runtime: "forecast" });
    mocks.loadAuthorities.mockResolvedValue({ forecastId: "forecast" });
    const result = await createHistoricalSimulationProductionCyclePortV2(tx).loadExact({ organizationId: "org",
      accountId: "account", runId: "run", cycleId: "cycle", partition: "DEVELOPMENT", symbol: "BTCUSDT",
      expectedRecordIndex: 0 });
    expect(mocks.loadPit).toHaveBeenCalledWith(tx, expect.objectContaining({ cycleId: "cycle", forecastId: "forecast" }));
    expect(mocks.verificationFactory).toHaveBeenCalledWith(tx);
    expect(mocks.authorityFactory).toHaveBeenCalledWith(expect.objectContaining({ sql: tx }));
    expect(mocks.loadAuthorities).toHaveBeenCalledWith({ organizationId: "org", accountId: "account",
      cycleId: "cycle", forecastAuthorityContentDigestHex: "7".repeat(64) });
    expect(result.membership).toEqual(membership);
    expect(result.canonicalVerificationReceiptId).toBe("verification");
  });
  it("rejects a record-index splice before either authority loader", async () => {
    const tx = (async () => [{ ...row, record_index: 1 }]) as never;
    await expect(createHistoricalSimulationProductionCyclePortV2(tx).loadExact({ organizationId: "org",
      accountId: "account", runId: "run", cycleId: "cycle", partition: "DEVELOPMENT", symbol: "BTCUSDT",
      expectedRecordIndex: 0 })).rejects.toThrow("MEMBERSHIP_BINDING");
  });
  it("derives the next immutable cycle identity from the exact record index inside the same transaction", async () => {
    let call = 0;
    const tx = (async () => (++call === 1 ? [{ cycle_id: "cycle" }] : call === 2 ? [row] :
      call === 3 ? [authorityRow] : [{ id: "verification" }])) as never;
    mocks.verificationFactory.mockReturnValue({});
    mocks.authorityFactory.mockReturnValue({ load: mocks.loadAuthorities });
    mocks.loadPit.mockResolvedValue({ runtime: "forecast" });
    mocks.loadAuthorities.mockResolvedValue({ forecastId: "forecast" });
    const result = await createHistoricalSimulationProductionCyclePortV2(tx).loadNextExact({ organizationId: "org",
      accountId: "account", runId: "run", partition: "DEVELOPMENT", symbol: "BTCUSDT", expectedRecordIndex: 0 });
    expect(call).toBe(4);
    expect(result.membership.cycleId).toBe("cycle");
  });
});
