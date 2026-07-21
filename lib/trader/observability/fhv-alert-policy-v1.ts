import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";

import {
  FHV_ALERT_POLICY_SCHEMA_VERSION,
  GIB,
  type FhvCampaignKind,
} from "@/lib/trader/observability/fhv-observability.constants";

export type FhvAlertPolicyV1 = Readonly<{
  schemaVersion: typeof FHV_ALERT_POLICY_SCHEMA_VERSION;
  policyId: string;
  campaignKind: FhvCampaignKind;
  expectedHeartbeatIntervalSec: number;
  heartbeatWarningAgeSec: number;
  heartbeatCriticalAgeSec: number;
  progressStallWarningSec: number;
  progressStallCriticalSec: number;
  checkpointMaxAgeSec: number;
  diskSoftThresholdRule: "freeBytes < max(20GiB, 10% total capacity)";
  diskHardThresholdRule: "freeBytes < max(5GiB, 3% total capacity)";
  inodeSoftThresholdPct: number;
  inodeHardThresholdPct: number;
  artifactGrowthAnomalyWindowSec: number;
  artifactGrowthAnomalyMultiplier: number;
  postgresFailureGraceSec: number;
  processRestartEscalationCount: number;
  processRestartEscalationWindowSec: number;
  persistentZeroDecisionWindowSec: number;
  persistentVetoOnlyWindowSec: number;
  escalationWindowSec: number;
  telegramRetryBackoffSec: readonly number[];
  alertRetentionDays: number;
}>;

export const FHV_ALERT_POLICY_BASELINE_FHV_V1: FhvAlertPolicyV1 = {
  schemaVersion: FHV_ALERT_POLICY_SCHEMA_VERSION,
  policyId: "fhv-alert-policy-baseline-fhv-v1",
  campaignKind: "CERTIFIED_BASELINE_FHV",
  expectedHeartbeatIntervalSec: 30,
  heartbeatWarningAgeSec: 60,
  heartbeatCriticalAgeSec: 120,
  progressStallWarningSec: 900,
  progressStallCriticalSec: 3600,
  checkpointMaxAgeSec: 1800,
  diskSoftThresholdRule: "freeBytes < max(20GiB, 10% total capacity)",
  diskHardThresholdRule: "freeBytes < max(5GiB, 3% total capacity)",
  inodeSoftThresholdPct: 85,
  inodeHardThresholdPct: 95,
  artifactGrowthAnomalyWindowSec: 3600,
  artifactGrowthAnomalyMultiplier: 3,
  postgresFailureGraceSec: 30,
  processRestartEscalationCount: 3,
  processRestartEscalationWindowSec: 3600,
  persistentZeroDecisionWindowSec: 3600,
  persistentVetoOnlyWindowSec: 3600,
  escalationWindowSec: 900,
  telegramRetryBackoffSec: [1, 5, 30, 120],
  alertRetentionDays: 30,
};

export function computeFhvAlertPolicyDigest(
  policy: FhvAlertPolicyV1 = FHV_ALERT_POLICY_BASELINE_FHV_V1,
): string {
  return computeSemanticSha256Hex(policy);
}

/** Evaluate disk thresholds at runtime (observer-only). */
export function evaluateDiskThresholds(input: { freeBytes: number; totalBytes: number }): {
  softBreached: boolean;
  hardBreached: boolean;
} {
  const softFloor = Math.max(20 * GIB, Math.floor(input.totalBytes * 0.1));
  const hardFloor = Math.max(5 * GIB, Math.floor(input.totalBytes * 0.03));
  return {
    softBreached: input.freeBytes < softFloor,
    hardBreached: input.freeBytes < hardFloor,
  };
}
