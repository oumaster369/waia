/** Full-corpus representative checkpoint interval for profile runs (not parity fixture). */
export const FULL_CORPUS_CHECKPOINT_EVERY_CYCLES = 10_000;

/** Target ms/bar for ≥877 bars/s gate. */
export const TARGET_MS_PER_BAR = 1000 / 877;

export type FhvOfficialScaleProfileRunLabel =
  | "A-P0-1"
  | "A-P1"
  | "A-P0-2"
  | "A-P2"
  | "A-P0-3"
  | "A-P3"
  | "A-P0-4"
  | "A-P4"
  | "A-P0-5"
  | "A-P5"
  | "A-P0-6"
  | "B-P0-1"
  | "B-P1"
  | "B-P0-2"
  | "B-P2"
  | "B-P0-3"
  | "C-P0-1"
  | "C-P1"
  | "C-P0-2"
  | "C-P0-3";

export type FhvOfficialScaleProfileMode = "P0" | "P1" | "P2" | "P3" | "P4" | "P5";

export type FhvOfficialScaleProfileScheduleEntry = Readonly<{
  runLabel: FhvOfficialScaleProfileRunLabel;
  mode: FhvOfficialScaleProfileMode;
  targetCycleCount: number;
  tier: "A" | "B" | "C";
}>;

export const FHV_OFFICIAL_SCALE_PROFILE_SCHEDULE: readonly FhvOfficialScaleProfileScheduleEntry[] =
  [
    { runLabel: "A-P0-1", mode: "P0", targetCycleCount: 10_000, tier: "A" },
    { runLabel: "A-P1", mode: "P1", targetCycleCount: 10_000, tier: "A" },
    { runLabel: "A-P0-2", mode: "P0", targetCycleCount: 10_000, tier: "A" },
    { runLabel: "A-P2", mode: "P2", targetCycleCount: 10_000, tier: "A" },
    { runLabel: "A-P0-3", mode: "P0", targetCycleCount: 10_000, tier: "A" },
    { runLabel: "A-P3", mode: "P3", targetCycleCount: 10_000, tier: "A" },
    { runLabel: "A-P0-4", mode: "P0", targetCycleCount: 10_000, tier: "A" },
    { runLabel: "A-P4", mode: "P4", targetCycleCount: 10_000, tier: "A" },
    { runLabel: "A-P0-5", mode: "P0", targetCycleCount: 10_000, tier: "A" },
    { runLabel: "A-P5", mode: "P5", targetCycleCount: 10_000, tier: "A" },
    { runLabel: "A-P0-6", mode: "P0", targetCycleCount: 10_000, tier: "A" },
    { runLabel: "B-P0-1", mode: "P0", targetCycleCount: 50_000, tier: "B" },
    { runLabel: "B-P1", mode: "P1", targetCycleCount: 50_000, tier: "B" },
    { runLabel: "B-P0-2", mode: "P0", targetCycleCount: 50_000, tier: "B" },
    { runLabel: "B-P2", mode: "P2", targetCycleCount: 50_000, tier: "B" },
    { runLabel: "B-P0-3", mode: "P0", targetCycleCount: 50_000, tier: "B" },
    { runLabel: "C-P0-1", mode: "P0", targetCycleCount: 100_000, tier: "C" },
    { runLabel: "C-P1", mode: "P1", targetCycleCount: 100_000, tier: "C" },
    { runLabel: "C-P0-2", mode: "P0", targetCycleCount: 100_000, tier: "C" },
    { runLabel: "C-P0-3", mode: "P0", targetCycleCount: 200_000, tier: "C" },
  ] as const;

export const FHV_OFFICIAL_SCALE_PROFILE_TOTAL_CYCLES = 860_000;
export const FHV_OFFICIAL_SCALE_PROFILE_RUN_COUNT = 20;

export const STARTING_HEAD_SHA = "1336ed31883a5967f207e011f30f791a6ee048bf";
export const REMOTE_PR_HEAD_SHA = "077f76021d1c554750ba06747bdcf2b5a131204b";

export function resolveProfileRunId(runLabel: FhvOfficialScaleProfileRunLabel): string {
  return `pr452-profile-${runLabel.toLowerCase()}-1336ed3`;
}

export function resolveProfileRunRoot(
  profileRoot: string,
  runLabel: FhvOfficialScaleProfileRunLabel,
): string {
  return `${profileRoot}/runs/${runLabel}`;
}
