import { describe, expect, it, vi } from "vitest";

import {
  createCanonicalDecisionVerificationReceiptServiceV2,
  CANONICAL_DECISION_VERIFICATION_RECEIPT_V2,
} from "@/lib/trader/historical-simulation-v2/canonical-verification-receipt-postgres-v2";

const ORG = "00000000-0000-4000-8000-000000000001";
const DIGEST = "a".repeat(64);

describe("canonical decision verification receipt V2", () => {
  it("issues a receipt only from the exact persisted Forecast authorization", async () => {
    let inserted: { verificationReceiptDigestHex: string } | undefined;
    const sql = Object.assign(vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.join(" ");
      if (query.includes("FROM trader_forecast_v2")) return [{
        bundle_id: "bundle-1",
        bundle_content_digest_hex: "b".repeat(64),
        anchor_closed_bar_epoch_ms: 1_725_000_000_000,
        authorized_outcome_json: {
          status: "FORECAST_AUTHORIZED",
          authority: { contentDigestHex: DIGEST },
        },
        target_role_id: "EXECUTION_OPPORTUNITY",
      }];
      const candidate = values.find((value) =>
        typeof value === "object" && value !== null &&
        (value as { schemaVersion?: string }).schemaVersion === CANONICAL_DECISION_VERIFICATION_RECEIPT_V2,
      ) as typeof inserted;
      if (candidate) inserted = candidate;
      if (query.includes("SELECT verification_receipt_digest_hex")) {
        return [{ verification_receipt_digest_hex: inserted?.verificationReceiptDigestHex }];
      }
      return [];
    }), { json: (value: unknown) => value });

    const receipt = await createCanonicalDecisionVerificationReceiptServiceV2(sql as never)
      .issueForecast({ organizationId: ORG, forecastId: "forecast-1", subjectContentDigestHex: DIGEST });
    expect(receipt).toMatchObject({
      verified: true,
      purpose: "FORECAST_RUNTIME_AUTHORIZED",
      sourceRecordKind: "FORECAST_BUNDLE_V2",
      subjectContentDigestHex: DIGEST,
    });
    expect(receipt.verificationReceiptDigestHex).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses a subject digest not present in the persisted authorized outcome", async () => {
    const sql = vi.fn(async () => [{
      bundle_id: "bundle-1", bundle_content_digest_hex: "b".repeat(64),
      anchor_closed_bar_epoch_ms: 1_725_000_000_000,
      authorized_outcome_json: { status: "FORECAST_AUTHORIZED", authority: { contentDigestHex: DIGEST } },
      target_role_id: "EXECUTION_OPPORTUNITY",
    }]);
    await expect(createCanonicalDecisionVerificationReceiptServiceV2(sql as never).issueForecast({
      organizationId: ORG, forecastId: "forecast-1", subjectContentDigestHex: "c".repeat(64),
    })).rejects.toThrow("FORECAST_SOURCE");
  });
});
