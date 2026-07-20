export type GuardianRunConfig = {
  enabled: boolean;
  /** When > 0, exit full position after this many bar closes since open. */
  maxHoldBars?: number;
  /** Bar interval in ms for barsHeld computation (default 60_000 = 1m). */
  barIntervalMs?: number;
};

export const DEFAULT_GUARDIAN_RUN_CONFIG: GuardianRunConfig = {
  enabled: true,
  maxHoldBars: 0,
  barIntervalMs: 60_000,
};
