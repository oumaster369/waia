import {
  FHV_EXECUTION_PURPOSE_FULL_HISTORICAL,
  type FhvExecutionPurpose,
} from "@/lib/trader/observability/fhv-execution-purpose";

/**
 * Launch classification for the WP-3B target-host gate (ADR-0025 AD-6a).
 *
 * The gate answers one question: is this the genuine official, unbounded Full Historical
 * Validation campaign, the only run whose checkpoints actually reach the 1-GiB qualification depth
 * that the ≤ 400 ms contract governs?
 *
 * That must be derived from the validated launch configuration, never from the environment. An
 * earlier revision gated on `FHV_OFFICIAL_LAUNCH === "1"`, which meant an operator who simply
 * forgot the variable would silently bypass the host qualification — the safety property depended
 * on remembering to ask for it. Configuration is authority; environment is at most a redundant
 * assertion.
 */

export type FhvLaunchClassification =
  /** The real campaign: official corpus, no cycle bound. Requires target-host qualification. */
  | "OFFICIAL_UNBOUNDED_FULL_HISTORICAL"
  /** Official dataset but explicitly cycle-bounded: probes, process parity, segments. */
  | "BOUNDED_SYNTHETIC_QUALIFICATION"
  /** Bounded fixture end-to-end and schema-integration ceremonies. */
  | "BOUNDED_FIXTURE"
  /** Any non-full-historical purpose, such as control replay. */
  | "NON_FULL_HISTORICAL";

export type FhvLaunchClassificationInput = Readonly<{
  boundedFixture?: boolean;
  /** Absent or null means unbounded — the load-bearing distinction. */
  maxCycles?: number | null;
  executionPurpose?: FhvExecutionPurpose;
  qualificationMode: string;
}>;

/**
 * Classify a launch from validated configuration facts.
 *
 * Order matters: a bounded fixture is bounded regardless of purpose, and an explicit `maxCycles`
 * makes a run bounded even against the official corpus.
 */
export function classifyFhvLaunch(input: FhvLaunchClassificationInput): FhvLaunchClassification {
  if (input.boundedFixture === true) {
    return "BOUNDED_FIXTURE";
  }
  // Default matches the launch path, which treats an absent purpose as full historical.
  const purpose = input.executionPurpose ?? FHV_EXECUTION_PURPOSE_FULL_HISTORICAL;
  if (purpose !== FHV_EXECUTION_PURPOSE_FULL_HISTORICAL) {
    return "NON_FULL_HISTORICAL";
  }
  if (input.qualificationMode !== "OFFICIAL_MULTI_YEAR") {
    return "BOUNDED_SYNTHETIC_QUALIFICATION";
  }
  /*
   * An unbounded official run may still carry a synthetic scale authority to bind targetCycleCount
   * or observational metadata, so authority presence proves nothing about boundedness. Only an
   * explicit cycle cap does.
   */
  if (input.maxCycles != null) {
    return "BOUNDED_SYNTHETIC_QUALIFICATION";
  }
  return "OFFICIAL_UNBOUNDED_FULL_HISTORICAL";
}

/**
 * Whether this launch must present a qualifying Execution Server WP-3B receipt.
 *
 * True only for the genuine official unbounded campaign. Bounded runs never reach the depth the
 * receipt qualifies, so requiring it there would block software qualification — including the
 * PRE_AUTH bootstrap, which cannot produce a full-scale receipt in the first place.
 */
export function requiresWp3bTargetHostQualification(input: FhvLaunchClassificationInput): boolean {
  return classifyFhvLaunch(input) === "OFFICIAL_UNBOUNDED_FULL_HISTORICAL";
}
