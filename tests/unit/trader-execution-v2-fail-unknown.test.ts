import { describe, expect, it } from "vitest";

import {
  createExecutionReportV2,
  deterministicExecutionUuidV2,
} from "@/lib/trader/execution/v2/contracts";

const digest = (value: string) => value.repeat(64).slice(0, 64);

describe("Execution V2 fail-unknown report contract (DEE-669 / E651-C)", () => {
  it("seals the connector observation verbatim without invented execution facts", () => {
    const rawObservation = { timeout: true, responseBody: null, statusCode: null };
    const report = createExecutionReportV2({
      executionReportId: deterministicExecutionUuidV2("report", rawObservation),
      organizationId: "org-a",
      accountId: "account-a",
      executionAttemptId: "00000000-0000-4000-8000-000000066901",
      executionAttemptContentDigestHex: digest("a"),
      reportSequence: "1",
      reportType: "CONNECTOR_UNCERTAIN",
      source: "CONNECTOR",
      rawObservation,
      venueOrderId: null,
      observedAtUtc: "2026-08-21T00:00:00.000Z",
      previousReportDigestHex: null,
    });
    expect(report.rawObservation).toEqual(rawObservation);
    expect(report.rawObservation).not.toHaveProperty("tradeId");
    expect(report.rawObservation).not.toHaveProperty("price");
    expect(report.rawObservation).not.toHaveProperty("fill");
    expect(report.rawObservation).not.toHaveProperty("fee");
  });

  it("requires uncertainty to remain linked to the immutable attempt seal", () => {
    expect(() => createExecutionReportV2({
      executionReportId: "00000000-0000-4000-8000-000000066902",
      organizationId: "org-a",
      accountId: "account-a",
      executionAttemptId: "00000000-0000-4000-8000-000000066901",
      executionAttemptContentDigestHex: "not-a-digest",
      reportSequence: "1",
      reportType: "RECONCILIATION_REQUIRED",
      source: "EXECUTION",
      rawObservation: { cause: "NETWORK_RESULT_UNKNOWN" },
      venueOrderId: null,
      observedAtUtc: "2026-08-21T00:00:00.000Z",
      previousReportDigestHex: null,
    })).toThrow(/executionAttemptContentDigestHex/);
  });
});
