/**
 * DEE-436 — canonical exact T4A ceremony result map (Q-02).
 */

export const FHV_T4A_CEREMONY_REQUIRED_RESULTS = {
  T4A_RESULT: "PASS",
  GATE8_RESULT: "PASS",
  PAUSE_RESULT: "REHEARSAL_PAUSED_AT_CYCLE_40",
  RESUME_RESULT: "REHEARSAL_OK",
  FULL_HISTORY_RESCAN_DELTA: "0",
  CANONICAL_RUN_CHAIN_RESULT: "PASS",
  DEPLOYMENT_RECORD_RESULT: "PASS",
  ALERT_POLICY_RESULT: "PASS",
  LEGACY_CONTAINER_RESULT: "PASS",
  CONTINUITY_RESULT: "PASS",
  ROLLBACK_RESULT: "PASS",
  EVIDENCE_SEAL_RESULT: "PASS",
  T4B_RESULT: "NOT_EXECUTED_SEPARATE_GATE",
} as const;

export type FhvT4CeremonyPassFields = {
  readonly [K in keyof typeof FHV_T4A_CEREMONY_REQUIRED_RESULTS]: (typeof FHV_T4A_CEREMONY_REQUIRED_RESULTS)[K];
};

export const FHV_T4A_CEREMONY_REQUIRED_KEYS = Object.keys(
  FHV_T4A_CEREMONY_REQUIRED_RESULTS,
) as Array<keyof typeof FHV_T4A_CEREMONY_REQUIRED_RESULTS>;

export const FHV_T4A_CEREMONY_FORBIDDEN_KEYS = [
  "T4_RESULT",
  "T4_AGGREGATE_RESULT",
  "DASHBOARD_RESULT",
] as const;

/** Non-ceremony stdout keys allowed alongside the exact ceremony map. */
export const FHV_T4A_CEREMONY_STDOUT_AUXILIARY_KEYS = new Set([
  "classification",
  "units",
  "actualPauseCycle",
]);

export class FhvT4aCeremonyResultsError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvT4aCeremonyResultsError";
  }
}

export function buildFhvT4aCeremonyPassFields(
  overrides: Partial<FhvT4CeremonyPassFields> = {},
): FhvT4CeremonyPassFields {
  return { ...FHV_T4A_CEREMONY_REQUIRED_RESULTS, ...overrides };
}

export function assertFhvT4aCeremonyClassificationsExact(
  classifications: Readonly<Record<string, string>>,
): void {
  for (const forbidden of FHV_T4A_CEREMONY_FORBIDDEN_KEYS) {
    if (forbidden in classifications) {
      throw new FhvT4aCeremonyResultsError(
        "FHV_T4A_CEREMONY_FORBIDDEN_AGGREGATE_FIELD",
        `Forbidden aggregate ceremony field: ${forbidden}.`,
      );
    }
  }

  for (const key of FHV_T4A_CEREMONY_REQUIRED_KEYS) {
    const value = classifications[key];
    if (value === undefined || !value.trim()) {
      throw new FhvT4aCeremonyResultsError(
        "CEREMONY_REQUIRED_FIELD_MISSING",
        `Missing ceremony field: ${key}.`,
      );
    }
    const expected = FHV_T4A_CEREMONY_REQUIRED_RESULTS[key];
    if (value !== expected) {
      throw new FhvT4aCeremonyResultsError(
        "CEREMONY_EXACT_VALUE_NOT_ENFORCED",
        `Ceremony field ${key} must be exactly ${expected}, got ${value}.`,
      );
    }
  }

  for (const key of Object.keys(classifications)) {
    if (FHV_T4A_CEREMONY_STDOUT_AUXILIARY_KEYS.has(key)) {
      continue;
    }
    if (!(key in FHV_T4A_CEREMONY_REQUIRED_RESULTS)) {
      throw new FhvT4aCeremonyResultsError(
        "FHV_T4A_CEREMONY_UNEXPECTED_FIELD",
        `Unexpected ceremony field: ${key}.`,
      );
    }
  }
}

function normalizeCeremonyStdoutLine(rawLine: string): string | null {
  const line = rawLine.trim().replace(/^\[[^\]]+\]\s*/, "");
  if (!line || line.startsWith("{")) {
    return null;
  }
  return line;
}

export function parseFhvT4aCeremonyTaggedLines(stdout: string): Record<string, string> {
  const seen = new Map<string, string>();
  for (const rawLine of stdout.split(/\r?\n/)) {
    const trimmed = normalizeCeremonyStdoutLine(rawLine);
    if (!trimmed) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!key) {
      continue;
    }
    if (seen.has(key)) {
      const prior = seen.get(key);
      if (prior !== value) {
        throw new FhvT4aCeremonyResultsError(
          "FHV_T4A_CEREMONY_CONTRADICTORY_DUPLICATE",
          `Contradictory duplicate ceremony field ${key}.`,
        );
      }
      throw new FhvT4aCeremonyResultsError(
        "FHV_T4A_CEREMONY_DUPLICATE_FIELD",
        `Duplicate ceremony field ${key}.`,
      );
    }
    seen.set(key, value);
  }
  return Object.fromEntries(seen);
}

export function validateFhvT4aCeremonyStdout(stdout: string): Record<string, string> {
  const parsed = parseFhvT4aCeremonyTaggedLines(stdout);
  assertFhvT4aCeremonyClassificationsExact(parsed);
  const ceremonyOnly: Record<string, string> = {};
  for (const key of FHV_T4A_CEREMONY_REQUIRED_KEYS) {
    ceremonyOnly[key] = parsed[key]!;
  }
  return ceremonyOnly;
}

export function extractFhvT4aCeremonyClassificationsFromReceipt(
  classifications: Readonly<Record<string, string>>,
): Record<string, string> {
  assertFhvT4aCeremonyClassificationsExact(classifications);
  const ceremonyOnly: Record<string, string> = {};
  for (const key of FHV_T4A_CEREMONY_REQUIRED_KEYS) {
    ceremonyOnly[key] = classifications[key]!;
  }
  return ceremonyOnly;
}
