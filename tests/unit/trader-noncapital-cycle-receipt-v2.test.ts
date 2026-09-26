import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildNoncapitalCycleReceiptV2, normalizeRecordedNoncapitalInputV2,
  recordedNoncapitalInputDigestV2, serializeNoncapitalCycleReceiptV2,
  type RecordedNoncapitalInputV2 } from "@/lib/trader/runtime-v2/noncapital-cycle-receipt-v2";
import { runCanonicalOrdinaryCapitalCycleV2 } from "@/lib/trader/runtime-v2/canonical-recurring-cycle-v2";
import { SHADOW_PRE_QUALIFICATION_UNAVAILABLE_SOURCES } from "@/lib/trader/runtime-v2/shadow-canonical-runner-v2";

const input: RecordedNoncapitalInputV2 = { organizationId: "synthetic-org", accountId: "inert-account",
  releaseSha: "e".repeat(40), bar: { symbol: "BTCUSDT", interval: "1m", open: "100", high: "102",
    low: "99", close: "101", volume: "1", barOpenTime: "2026-01-01T00:00:00.000Z",
    barCloseTime: "2026-01-01T00:01:00.000Z" } };
const holder = { organizationId: input.organizationId, runtimeInstanceId: "owner", leaseEpoch: 1,
  leaseContentDigest: "a".repeat(64) };
const result = () => runCanonicalOrdinaryCapitalCycleV2({ epistemic: { kind: "CONTEXT_UNAVAILABLE",
  sources: SHADOW_PRE_QUALIFICATION_UNAVAILABLE_SOURCES, predictiveAdmissionVerdict: "NOT_ADMITTED" },
capitalRequest: { executionMode: "paper" } });

describe("recorded noncapital receipt integrity", () => {
  it("records actual canonical unavailable NO_TRADE, separate operational time and immutable input", async () => {
    const value = buildNoncapitalCycleReceiptV2(input, holder, "2026-09-26T07:00:00.000Z", await result());
    expect(value.result).toMatchObject({ status: "NO_TRADE", stage: "EPISTEMIC" });
    expect(value.result.reasonCodes).toContain("UNAVAILABLE:qualificationTuple");
    expect(value.result.reasonCodes).toContain("PREDICTIVE_ADMISSION_NOT_ADMITTED");
    expect(value.recordedAtUtc).not.toBe(value.input.bar.barCloseTime);
    expect(serializeNoncapitalCycleReceiptV2(JSON.parse(serializeNoncapitalCycleReceiptV2(value)))).toBe(serializeNoncapitalCycleReceiptV2(value));
    expect(Object.isFrozen(value.input.bar)).toBe(true);
  });
  it.each(["open", "high", "low", "close", "volume"] as const)("binds full bar field %s", key => {
    const changed = { ...input, bar: { ...input.bar, [key]: key === "low" ? "98" : key === "high" ? "103" : key === "volume" ? "2" : "100.5" } };
    expect(recordedNoncapitalInputDigestV2(changed)).not.toBe(recordedNoncapitalInputDigestV2(input));
  });
  it.each(["organizationId", "accountId", "releaseSha"] as const)("binds input %s", key => {
    const changed = { ...input, [key]: key === "releaseSha" ? "f".repeat(40) : "other" };
    expect(recordedNoncapitalInputDigestV2(changed)).not.toBe(recordedNoncapitalInputDigestV2(input));
  });
  it("binds interval even when close time matches", () => {
    expect(recordedNoncapitalInputDigestV2({ ...input, bar: { ...input.bar, interval: "15m" } }))
      .not.toBe(recordedNoncapitalInputDigestV2(input));
  });
  it.each(["", "NaN", "Infinity", "-1", "1e3"])("rejects invalid price %s", close => {
    expect(() => normalizeRecordedNoncapitalInputV2({ ...input, bar: { ...input.bar, close } })).toThrow();
  });
  it("rejects foreign tenant and forged result/hash", async () => {
    const validResult = await result();
    expect(() => buildNoncapitalCycleReceiptV2(input, { ...holder, organizationId: "other" }, input.bar.barCloseTime, validResult)).toThrow("TENANT_MISMATCH");
    expect(() => buildNoncapitalCycleReceiptV2(input, holder, input.bar.barCloseTime, { status: "NO_TRADE", stage: "EPISTEMIC", reasonCodes: ["READY"] })).toThrow("RESULT_FORBIDDEN");
    const receipt = buildNoncapitalCycleReceiptV2(input, holder, input.bar.barCloseTime, validResult);
    expect(() => serializeNoncapitalCycleReceiptV2({ ...receipt, contentDigest: "0".repeat(64) })).toThrow("RECEIPT_CORRUPT");
  });
  it("owner has no injected source, capital dependency, venue, credentials, or live mode", () => {
    const source = readFileSync("lib/trader/runtime-v2/noncapital-cycle-owner-postgres-v2.ts", "utf8");
    expect(source).toContain('kind: "CONTEXT_UNAVAILABLE"');
    expect(source).toContain('executionMode: "paper"');
    expect(source).not.toMatch(/capitalDeps|admissionTemplate|fetch\(|executeOrder|credential|process\.env/);
  });
});
