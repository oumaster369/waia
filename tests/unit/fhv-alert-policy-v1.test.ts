import { describe, expect, it } from "vitest";

import {
  computeFhvAlertPolicyDigest,
  evaluateDiskThresholds,
  FHV_ALERT_POLICY_BASELINE_FHV_V1,
} from "@/lib/trader/observability/fhv-alert-policy-v1";
import {
  FHV_ALERT_POLICY_SCHEMA_VERSION,
  GIB,
} from "@/lib/trader/observability/fhv-observability.constants";

describe("DEE-416 FHV alert policy v1", () => {
  it("pins baseline policy schema version and digest stability", () => {
    expect(FHV_ALERT_POLICY_BASELINE_FHV_V1.schemaVersion).toBe(FHV_ALERT_POLICY_SCHEMA_VERSION);
    const first = computeFhvAlertPolicyDigest();
    const second = computeFhvAlertPolicyDigest(FHV_ALERT_POLICY_BASELINE_FHV_V1);
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it("evaluates disk soft threshold as max(20GiB, 10% total)", () => {
    const totalBytes = 100 * GIB;
    const freeBytes = 15 * GIB;
    const result = evaluateDiskThresholds({ freeBytes, totalBytes });
    expect(result.softBreached).toBe(true);
    expect(result.hardBreached).toBe(false);
  });

  it("evaluates disk hard threshold as max(5GiB, 3% total)", () => {
    const totalBytes = 100 * GIB;
    const freeBytes = 4 * GIB;
    const result = evaluateDiskThresholds({ freeBytes, totalBytes });
    expect(result.softBreached).toBe(true);
    expect(result.hardBreached).toBe(true);
  });

  it("does not breach when free space exceeds both thresholds", () => {
    const totalBytes = 100 * GIB;
    const freeBytes = 50 * GIB;
    const result = evaluateDiskThresholds({ freeBytes, totalBytes });
    expect(result.softBreached).toBe(false);
    expect(result.hardBreached).toBe(false);
  });
});
