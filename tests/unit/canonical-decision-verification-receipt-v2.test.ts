import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createCanonicalDecisionVerificationReceiptServiceV2,
  CANONICAL_DECISION_VERIFICATION_RECEIPT_V2,
} from "@/lib/trader/historical-simulation-v2/canonical-verification-receipt-postgres-v2";

const ORG = "00000000-0000-4000-8000-000000000001";
const DIGEST = "a".repeat(64);

describe("canonical decision verification receipt V2", () => {
  beforeEach(() => { process.env.WAIA_RELEASE_SHA = "1".repeat(40); });
  it("fails closed without an exact immutable release SHA", () => {
    delete process.env.WAIA_RELEASE_SHA;
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    expect(() => createCanonicalDecisionVerificationReceiptServiceV2(vi.fn() as never))
      .toThrow("CANONICAL_DECISION_VERIFIER_RELEASE_SHA_MISSING");
  });

  it("fails closed when independent deployment SHA authorities disagree", () => {
    process.env.WAIA_RELEASE_SHA = "1".repeat(40);
    process.env.VERCEL_GIT_COMMIT_SHA = "2".repeat(40);
    expect(() => createCanonicalDecisionVerificationReceiptServiceV2(vi.fn() as never))
      .toThrow("CANONICAL_DECISION_VERIFIER_RELEASE_SHA_CONFLICT");
    delete process.env.VERCEL_GIT_COMMIT_SHA;
  });

  it("refuses to start a run from a preregistration with the wrong account, run, or dataset", async () => {
    const sql = vi.fn(async () => []);
    await expect(createCanonicalDecisionVerificationReceiptServiceV2(sql as never).startRun({
      organizationId: ORG, accountId: "account-B", runId: "run-B",
      preregistrationId: ORG, datasetSealDigestHex: DIGEST,
    })).rejects.toThrow("HISTORICAL_SIMULATION_RUN_START_PREREGISTRATION_MISMATCH");
    expect(sql).toHaveBeenCalledOnce();
  });
  it("refuses a digest-shaped Forecast row that fails canonical replay validation", async () => {
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

    await expect(createCanonicalDecisionVerificationReceiptServiceV2(sql as never)
      .issueForecast({ organizationId: ORG, forecastId: "forecast-1", subjectContentDigestHex: DIGEST }))
      .rejects.toThrow("FORECAST_RUNTIME_AUTHORITY_INVALID");
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
    })).rejects.toThrow("FORECAST_RUNTIME_AUTHORITY_INVALID");
  });

  it("cannot bypass the transaction and refuses an unknown durable dataset authority", async () => {
    const sql = Object.assign(vi.fn(async () => []), {
      begin: vi.fn(async (_level: string, callback: (tx: unknown) => Promise<unknown>) => callback(sql)),
    });
    await expect(createCanonicalDecisionVerificationReceiptServiceV2(sql as never)
      .preregisterExecution({
        organizationId: ORG, accountId: "account", runId: "run", forecastId: ORG,
        datasetAuthorityId: ORG, cycleId: "cycle-1", policyConfig: {},
        defaultQuantity: "1", initialAccountingFrontierId: ORG,
      } as never)).rejects.toThrow("CANONICAL_DECISION_PREREGISTRATION_REFUSED:DATASET_AUTHORITY");
    expect(sql.begin).toHaveBeenCalledOnce();
  });
});
