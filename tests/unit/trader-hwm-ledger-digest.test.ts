import { describe, expect, it } from "vitest";

import {
  buildHwmLedgerRecordPayload,
  computeHwmLedgerRecordDigest,
  HWM_LEDGER_SCHEMA_VERSION,
  HwmLedgerDigestMismatchError,
  type HwmLedgerRecordDigestInput,
  verifyHwmLedgerRecordDigest,
} from "@/lib/trader/billing";

const EFFECTIVE_AT = new Date("2026-06-01T00:00:00.000Z");

const baseDigestInput = {
  organizationId: "00000000-0000-4000-8000-0000000307",
  exchangeAccountId: "htx-paper-307",
  entryType: "BOOTSTRAP" as const,
  highWaterMark: "10000.00",
  previousHighWaterMark: null,
  sourcePeriodId: null,
  sourceInvoiceId: null,
  valuationSource: "paper_pnl_read_model.v1",
  effectiveAt: EFFECTIVE_AT,
  reason: null,
} satisfies HwmLedgerRecordDigestInput;

describe("HWM ledger record digest (DEE-307 S3)", () => {
  it("produces deterministic digest for identical immutable input", () => {
    const digestA = computeHwmLedgerRecordDigest(baseDigestInput);
    const digestB = computeHwmLedgerRecordDigest(baseDigestInput);
    expect(digestA).toMatch(/^[a-f0-9]{64}$/);
    expect(digestA).toBe(digestB);
  });

  it("changes digest when highWaterMark changes", () => {
    const digestA = computeHwmLedgerRecordDigest(baseDigestInput);
    const digestB = computeHwmLedgerRecordDigest({
      ...baseDigestInput,
      highWaterMark: "10001.00",
    });
    expect(digestA).not.toBe(digestB);
  });

  it("builds payload with matching recordContentDigest", () => {
    const payload = buildHwmLedgerRecordPayload(baseDigestInput);
    expect(payload.schemaVersion).toBe(HWM_LEDGER_SCHEMA_VERSION);
    expect(payload.recordContentDigest).toBe(computeHwmLedgerRecordDigest(baseDigestInput));
    expect(() => verifyHwmLedgerRecordDigest(payload)).not.toThrow();
  });

  it("rejects tampered recordContentDigest fail-closed", () => {
    const payload = buildHwmLedgerRecordPayload(baseDigestInput);
    expect(() =>
      verifyHwmLedgerRecordDigest({
        ...payload,
        recordContentDigest: "f".repeat(64),
      }),
    ).toThrow(HwmLedgerDigestMismatchError);
  });

  it("exports schema version constant", () => {
    expect(HWM_LEDGER_SCHEMA_VERSION).toBe("waia.trader.hwm-ledger.v1");
  });
});
