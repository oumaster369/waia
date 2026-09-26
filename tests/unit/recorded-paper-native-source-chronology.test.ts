import { afterEach, describe, expect, it, vi } from "vitest";
import { HtxBarPollSource } from "@/lib/trader/market-data/htx-bar-poll-source";
import { captureSession, digest } from "@/lib/trader/paper/durable-noncapital/recorded-analysis-v1";
import { captureMandatoryBundle, normalizeMandatory } from "@/lib/trader/paper/durable-noncapital/normalize-mandatory-packet-v1";
import { recordedPublicTransport } from "../helpers/recorded-paper-public-transport";

const acquiredAt = Date.parse("2026-09-26T17:35:59.376Z");
const session = captureSession({ organizationId: "11111111-1111-4111-8111-111111111111", accountId: "internal-paper",
  symbol: "BTC/USDT", sessionId: "native-source-chronology", releaseSha: "a".repeat(40), maxPacketBytes: 2_000_000,
  maxBarsPerInterval: 30, maxCycles: 2, leaseDurationMs: 70_000 });
async function capture(closedBarsOnly = false) {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(acquiredAt);
  const pending = new HtxBarPollSource({ internalSymbol: session.symbol, disableOptionalProviders: true,
    fetchImpl: recordedPublicTransport(() => acquiredAt, undefined, { closedBarsOnly }) }).fetchMandatoryEvaluationBundle();
  return captureMandatoryBundle(await pending, session);
}
afterEach(() => vi.useRealTimers());

describe("native synthetic source chronology across analysis PIT boundaries", () => {
  it("keeps the default open-bar fixture and the actual minute-crossing refusal", async () => {
    const captured = await capture(); const before = digest(captured);
    const accepted = normalizeMandatory(captured, session, "2026-09-26T17:35:59.999Z");
    expect(accepted.bars["1m"]).toHaveLength(24); expect(accepted.excludedOpenBars).toHaveLength(5);
    expect(captured.bars["1m"]!.at(-1)!.barCloseTime).toBe("2026-09-26T17:36:00.000Z");
    expect(captured.observations[0]!.provenance.ingestTimeUtc).toBe("2026-09-26T17:35:59.376Z");
    expect(() => normalizeMandatory(captured, session, "2026-09-26T17:36:00.000Z"))
      .toThrow("SOURCE_CHRONOLOGY_REFUSED");
    expect(digest(captured)).toBe(before);
  });
  it.each(["2026-09-26T17:35:59.999Z", "2026-09-26T17:36:00.000Z", "2026-09-26T18:00:00.000Z"])(
    "native closed-source mode admits exact captured bars at later PIT %s without rewriting provenance", async pit => {
      const captured = await capture(true); const before = digest(captured);
      for (const bar of Object.values(captured.bars).flat()) expect(Date.parse(bar.barCloseTime)).toBeLessThanOrEqual(acquiredAt);
      const accepted = normalizeMandatory(captured, session, pit);
      expect(accepted.bars).toEqual(captured.bars); expect(accepted.bars["1m"]).toHaveLength(25);
      expect(accepted.excludedOpenBars).toEqual([]); expect(accepted.scheduledBarCloseTime).toBe("2026-09-26T17:35:00.000Z");
      expect(captured.observations.every(o => o.provenance.ingestTimeUtc === "2026-09-26T17:35:59.376Z")).toBe(true);
      expect(digest(captured)).toBe(before);
    });
  it("derives each closed bar range from that response's observed source time", async () => {
    const times = [acquiredAt, Date.parse("2026-09-26T17:36:00.001Z")];
    const transport = recordedPublicTransport(() => times.shift()!, undefined, { closedBarsOnly: true });
    const url = "https://fixture.invalid/market/history/kline?symbol=btcusdt&period=1min";
    const first = await (await transport(url)).json(); const second = await (await transport(url)).json();
    expect(first.data[0].id * 1000 + 60_000).toBe(Date.parse("2026-09-26T17:35:00.000Z"));
    expect(second.data[0].id * 1000 + 60_000).toBe(Date.parse("2026-09-26T17:36:00.000Z"));
    expect(first.ts).toBe(acquiredAt); expect(second.ts).toBe(Date.parse("2026-09-26T17:36:00.001Z"));
  });
});
