export const PIT_CHRONOLOGY_V1_SCHEMA_VERSION = "pit-chronology-v1" as const;

export type PitChronologyV1 = {
  schemaVersion: typeof PIT_CHRONOLOGY_V1_SCHEMA_VERSION;
  eventTime: Date | null;
  availableAt: Date | null;
  ingestTime: Date | null;
};

export type PitChronologyUnknownReasonV1 =
  | "INVALID_CHRONOLOGY_SCHEMA_VERSION"
  | "INVALID_ANCHOR_TIME"
  | "MISSING_EVENT_TIME"
  | "MISSING_AVAILABLE_AT"
  | "MISSING_INGEST_TIME"
  | "INVALID_EVENT_TIME"
  | "INVALID_AVAILABLE_AT"
  | "INVALID_INGEST_TIME"
  | "EVENT_TIME_AFTER_ANCHOR"
  | "AVAILABLE_AT_AFTER_ANCHOR"
  | "INGEST_TIME_AFTER_ANCHOR";

export type PitChronologyEvaluationV1 =
  | { status: "UNKNOWN"; reason: PitChronologyUnknownReasonV1 }
  | {
      status: "VISIBLE";
      chronology: {
        eventTimeUtc: string;
        availableAtUtc: string;
        ingestTimeUtc: string;
      };
    };

export const pitChronologyV1 = (
  input: Omit<PitChronologyV1, "schemaVersion">,
): PitChronologyV1 => ({ schemaVersion: PIT_CHRONOLOGY_V1_SCHEMA_VERSION, ...input });

const checks = [
  ["eventTime", "MISSING_EVENT_TIME", "INVALID_EVENT_TIME", "EVENT_TIME_AFTER_ANCHOR"],
  ["availableAt", "MISSING_AVAILABLE_AT", "INVALID_AVAILABLE_AT", "AVAILABLE_AT_AFTER_ANCHOR"],
  ["ingestTime", "MISSING_INGEST_TIME", "INVALID_INGEST_TIME", "INGEST_TIME_AFTER_ANCHOR"],
] as const;

/** Each instant must be explicit/valid/visible; no universal ordering among the three is assumed. */
export function evaluatePitChronologyV1(
  chronology: PitChronologyV1,
  anchorTime: Date,
): PitChronologyEvaluationV1 {
  const anchorMs = anchorTime instanceof Date ? anchorTime.getTime() : Number.NaN;
  if (!Number.isFinite(anchorMs)) return { status: "UNKNOWN", reason: "INVALID_ANCHOR_TIME" };
  if (chronology.schemaVersion !== PIT_CHRONOLOGY_V1_SCHEMA_VERSION) {
    return { status: "UNKNOWN", reason: "INVALID_CHRONOLOGY_SCHEMA_VERSION" };
  }

  for (const [field, missing, invalid, future] of checks) {
    const value = chronology[field];
    if (value === null) return { status: "UNKNOWN", reason: missing };
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      return { status: "UNKNOWN", reason: invalid };
    }
    if (value.getTime() > anchorMs) return { status: "UNKNOWN", reason: future };
  }

  return {
    status: "VISIBLE",
    chronology: {
      eventTimeUtc: chronology.eventTime!.toISOString(),
      availableAtUtc: chronology.availableAt!.toISOString(),
      ingestTimeUtc: chronology.ingestTime!.toISOString(),
    },
  };
}
