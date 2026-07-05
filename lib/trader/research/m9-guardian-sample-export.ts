import type { GuardianReasonRecord } from "@/lib/trader/guardian/guardian-reason-record.types";
import { GUARDIAN_REASON_RECORD_SCHEMA_VERSION } from "@/lib/trader/guardian/guardian-reason-record.types";
import type { PaperCycleResult } from "@/lib/trader/paper/paper-cycle.types";

export const M9_GUARDIAN_REASON_SAMPLE_SCHEMA_VERSION = "m9_guardian_reason_sample_v1";

export type M9GuardianReasonSampleExport = {
  schemaVersion: typeof M9_GUARDIAN_REASON_SAMPLE_SCHEMA_VERSION;
  generatedAt: string;
  organizationId: string;
  strategyId: string;
  strategyVersion: string;
  guardianReasonRecordSchemaVersion: typeof GUARDIAN_REASON_RECORD_SCHEMA_VERSION;
  sampleCount: number;
  maxSamples: number;
  reasonRecords: readonly GuardianReasonRecord[];
  cyclesWithGuardian: number;
  cyclesWithSlTpLevels: number;
};

const DEFAULT_MAX_SAMPLES = 25;

export function buildM9GuardianReasonSampleExport(input: {
  organizationId: string;
  strategyId: string;
  strategyVersion: string;
  cycleResults: readonly PaperCycleResult[];
  maxSamples?: number;
  generatedAt?: string;
}): M9GuardianReasonSampleExport {
  const maxSamples = input.maxSamples ?? DEFAULT_MAX_SAMPLES;
  const reasonRecords: GuardianReasonRecord[] = [];
  let cyclesWithGuardian = 0;
  let cyclesWithSlTpLevels = 0;

  for (const cycle of input.cycleResults) {
    const guardian = cycle.guardian;
    if (!guardian) {
      continue;
    }
    cyclesWithGuardian += 1;
    for (const evaluation of guardian.evaluations) {
      if (evaluation.reason.slTpLevels) {
        cyclesWithSlTpLevels += 1;
      }
      if (reasonRecords.length >= maxSamples) {
        continue;
      }
      reasonRecords.push(evaluation.reason);
    }
  }

  return {
    schemaVersion: M9_GUARDIAN_REASON_SAMPLE_SCHEMA_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    organizationId: input.organizationId,
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    guardianReasonRecordSchemaVersion: GUARDIAN_REASON_RECORD_SCHEMA_VERSION,
    sampleCount: reasonRecords.length,
    maxSamples,
    reasonRecords,
    cyclesWithGuardian,
    cyclesWithSlTpLevels,
  };
}
