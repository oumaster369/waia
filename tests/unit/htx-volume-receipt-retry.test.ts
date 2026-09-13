import { describe, expect, it, vi } from "vitest";
import type postgres from "postgres";
import { qualifyHtxKlineVolumeAuthority } from
  "@/lib/trader/market-data/volume-qualification/htx-volume-qualification";
import { persistHtxVolumeQualificationReceipt } from
  "@/lib/trader/market-data/volume-qualification/htx-volume-qualification-receipt-service";

// This suite isolates payload equality. Real SQL scoping has a separate PG probe.
vi.mock("@/lib/waia-core/scope/org-context", () => ({
  orgScopedPostgresPredicate: (_sql: unknown, organizationId: string) => organizationId,
}));

const org = "00000000-0000-4000-8000-000000000953";
function fixture() {
  return qualifyHtxKlineVolumeAuthority({ symbol: "BTCUSDT",
    qualifiedAtUtc: "2026-09-06T00:00:00.000Z",
    rows: [{ id: 1, open: 100, high: 101, low: 99, close: 100,
      amount: 10, vol: 1000, count: 1 }] });
}
function harness(receipt: ReturnType<typeof fixture>) {
  const stored = Object.fromEntries(Object.entries(JSON.parse(JSON.stringify(receipt))).reverse());
  const sql = vi.fn().mockResolvedValue([{ id: "original", organization_id: org,
    symbol: receipt.symbol, interval: receipt.interval, verdict: receipt.verdict,
    authority_field: receipt.authorityField, sample_count: receipt.sampleCount,
    divergence_count: receipt.divergenceCount,
    qualification_receipt_digest: receipt.qualificationReceiptDigest,
    qualified_at: receipt.qualifiedAtUtc, receipt_json: stored }]);
  return { sql, stored };
}

describe("DEE-953 HTX volume persisted JSON equality", () => {
  it("reuses the identical receipt despite JSONB object key reordering", async () => {
    const receipt = fixture();
    const { sql, stored } = harness(receipt);
    expect(JSON.stringify(stored)).not.toBe(JSON.stringify(receipt));
    const result = await persistHtxVolumeQualificationReceipt(sql as unknown as postgres.Sql,
      { organizationId: org, receipt });
    expect(result).toMatchObject({ inserted: false, record: { id: "original", receiptJson: receipt } });
    expect(sql).toHaveBeenCalledTimes(1);
  });

  it("still refuses a different stored value under the identical digest key", async () => {
    const receipt = fixture();
    const { sql, stored } = harness(receipt);
    stored.sampleCount = receipt.sampleCount + 1;
    await expect(persistHtxVolumeQualificationReceipt(sql as unknown as postgres.Sql,
      { organizationId: org, receipt })).rejects.toMatchObject({ code: "HTX_VOLUME_QUALIFICATION_CONFLICT" });
  });

  it("rejects an invalid incoming digest before database access", async () => {
    const receipt = fixture();
    const { sql } = harness(receipt);
    await expect(persistHtxVolumeQualificationReceipt(sql as unknown as postgres.Sql,
      { organizationId: org, receipt: { ...receipt, qualificationReceiptDigest: "0".repeat(64) } },
    )).rejects.toMatchObject({ code: "QUALIFICATION_RECEIPT_DIGEST_MISMATCH" });
    expect(sql).not.toHaveBeenCalled();
  });
});
