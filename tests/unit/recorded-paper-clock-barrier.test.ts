import { describe, expect, it, vi } from "vitest";
import type { GatewayPollResult } from "@/lib/trader/market-data/market-data-gateway";
import { awaitRecordedBundleDatabaseClock } from "../helpers/recorded-paper-clock-barrier";

const fixture = () => ({ canonicalPitCandidates: [
  { provenance: { ingestTimeUtc: "2026-09-26T15:00:00.001Z" } },
  { provenance: { ingestTimeUtc: "2026-09-26T15:00:00.003Z" } },
] }) as unknown as GatewayPollResult;

describe("recorded paper fixture observed-clock barrier", () => {
  it("waits for the latest immutable ingestion and accepts exact equality", async () => {
    const bundle = fixture(); const original = JSON.stringify(bundle);
    const read = vi.fn().mockResolvedValueOnce("2026-09-26T15:00:00.000Z")
      .mockResolvedValueOnce("2026-09-26T15:00:00.002Z").mockResolvedValueOnce("2026-09-26T15:00:00.003Z");
    const result = await awaitRecordedBundleDatabaseClock(bundle, read);
    expect(result.samples).toBe(3); expect(result.maxIngestTimeUtc).toBe(result.observedDatabaseTimeUtc);
    expect(JSON.stringify(bundle)).toBe(original); expect(read).toHaveBeenCalledTimes(3);
  });
  it("accepts an already advanced observed clock without changing source values", async () => {
    const bundle = fixture(); const original = JSON.stringify(bundle);
    const result = await awaitRecordedBundleDatabaseClock(bundle, async () => "2026-09-26T15:00:00.004Z");
    expect(result.samples).toBe(1); expect(JSON.stringify(bundle)).toBe(original);
  });
  it("refuses mutation across the await instead of resealing it", async () => {
    const bundle = fixture();
    await expect(awaitRecordedBundleDatabaseClock(bundle, async () => {
      bundle.canonicalPitCandidates[0]!.provenance.ingestTimeUtc = "2026-09-26T15:00:00.000Z";
      return "2026-09-26T15:00:00.004Z";
    })).rejects.toThrow("FIXTURE_BUNDLE_MUTATED");
  });
  it("times out even if the observed clock read never completes", async () => {
    await expect(awaitRecordedBundleDatabaseClock(fixture(), () => new Promise(() => {}), 5))
      .rejects.toThrow("FIXTURE_DATABASE_CLOCK_TIMEOUT");
  });
  it("times out when completed clock reads never reach the fixed ingestion", async () => {
    await expect(awaitRecordedBundleDatabaseClock(fixture(), async () => "2026-09-26T15:00:00.000Z", 5))
      .rejects.toThrow("FIXTURE_DATABASE_CLOCK_TIMEOUT");
  });
  it("refuses an invalid DB observation", async () => {
    await expect(awaitRecordedBundleDatabaseClock(fixture(), async () => "not-a-time"))
      .rejects.toThrow("FIXTURE_DATABASE_CLOCK_INVALID");
  });
  it("refuses invalid actual ingestion before reading the DB clock", async () => {
    const bundle = fixture(); bundle.canonicalPitCandidates[0]!.provenance.ingestTimeUtc = "not-a-time";
    const read = vi.fn(); await expect(awaitRecordedBundleDatabaseClock(bundle, read)).rejects.toThrow("FIXTURE_INGEST_TIME_INVALID");
    expect(read).not.toHaveBeenCalled();
  });
});
