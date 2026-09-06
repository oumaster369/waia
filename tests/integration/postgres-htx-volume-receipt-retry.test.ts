import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { qualifyHtxKlineVolumeAuthority } from
  "@/lib/trader/market-data/volume-qualification/htx-volume-qualification";
import { persistHtxVolumeQualificationReceipt, readHtxVolumeQualificationReceiptByDigest } from
  "@/lib/trader/market-data/volume-qualification/htx-volume-qualification-receipt-service";

const url = process.env.DATABASE_URL_POSTGRES;
const enabled = process.env.WAIA_PG_INTEGRATION === "1" && Boolean(url);
if (enabled) {
  const parsed = new URL(url!);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) ||
      !/^\/(waia946_test|waia_validate|waia_it|waia_hsv2_it(?:_[a-z0-9]+)*)$/.test(parsed.pathname))
    throw new Error("DEE953_LOCAL_DISPOSABLE_DB_REQUIRED");
}

describe.skipIf(!enabled)("DEE-953 actual PostgreSQL JSONB receipt retry", () => {
  const sql = enabled ? postgres(url!, { max: 1 }) : null;
  afterAll(async () => { await sql?.end({ timeout: 5 }); });

  it("reuses unchanged durable values, refuses changed values and isolates tenants", async () => {
    const rollback = new Error("DEE953_ROLLBACK_ONLY");
    try {
      await sql!.begin(async (tx) => {
        const user = randomUUID();
        const orgA = randomUUID();
        const orgB = randomUUID();
        await tx`INSERT INTO auth.users (id) VALUES (${user}::uuid)`;
        await tx`INSERT INTO users (id,identity_label,email)
          VALUES (${user}::uuid,'DEE953 local fixture',${`${user}@invalid.local`})`;
        for (const organizationId of [orgA, orgB])
          await tx`INSERT INTO organizations (id,owner_user_id,kind,name)
            VALUES (${organizationId}::uuid,${user}::uuid,'personal','DEE953 local fixture')`;
        const receipt = qualifyHtxKlineVolumeAuthority({ symbol: "BTCUSDT",
          qualifiedAtUtc: "2026-09-06T00:00:00.000Z",
          rows: [{ id: 1, open: 100, high: 101, low: 99, close: 100,
            amount: 10, vol: 1000, count: 1 }] });
        const client = tx as unknown as postgres.Sql;
        const first = await persistHtxVolumeQualificationReceipt(client,
          { organizationId: orgA, receipt });
        const rows = await tx`SELECT receipt_json FROM trader_htx_volume_qualification_receipt_v1
          WHERE id=${first.record.id}::uuid AND organization_id=${orgA}::uuid`;
        expect(JSON.stringify(rows[0]!.receipt_json)).not.toBe(JSON.stringify(receipt));
        expect(rows[0]!.receipt_json).toEqual(receipt);
        const retry = await persistHtxVolumeQualificationReceipt(client,
          { organizationId: orgA, receipt });
        expect(first.inserted).toBe(true);
        expect(retry).toMatchObject({ inserted: false, record: { id: first.record.id, receiptJson: receipt } });
        expect(await readHtxVolumeQualificationReceiptByDigest(client,
          { organizationId: orgB, qualificationReceiptDigest: receipt.qualificationReceiptDigest })).toBeNull();
        const other = await persistHtxVolumeQualificationReceipt(client,
          { organizationId: orgB, receipt });
        expect(other.inserted).toBe(true);
        expect(other.record.id).not.toBe(first.record.id);
        // Extra actual JSON data must not be silently discarded on retry, even
        // though the legacy digest's fixed field list does not cover extensions.
        await expect(persistHtxVolumeQualificationReceipt(client, { organizationId: orgA,
          receipt: { ...receipt, unexpectedExtension: "changed" } as typeof receipt,
        })).rejects.toMatchObject({ code: "HTX_VOLUME_QUALIFICATION_CONFLICT" });
        await expect(persistHtxVolumeQualificationReceipt(client, { organizationId: orgA,
          receipt: { ...receipt, sampleCount: receipt.sampleCount + 1 },
        })).rejects.toMatchObject({ code: "QUALIFICATION_RECEIPT_DIGEST_MISMATCH" });
        const count = await tx`SELECT count(*)::int AS n FROM trader_htx_volume_qualification_receipt_v1
          WHERE organization_id IN (${orgA}::uuid,${orgB}::uuid)`;
        expect(count[0]!.n).toBe(2);
        throw rollback;
      });
      throw new Error("rollback sentinel was swallowed");
    } catch (error) { if (error !== rollback) throw error; }
  }, 30_000);
});
