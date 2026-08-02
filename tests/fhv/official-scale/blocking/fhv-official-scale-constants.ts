/** Checkpoint interval for official-scale synthetic authority proofs. */
export const CHECKPOINT_EVERY_CYCLES = 3997;
/** Last cycle index included in the final checkpoint before resume tail. */
export const LAST_COMMITTED_CYCLE_INDEX = CHECKPOINT_EVERY_CYCLES - 1;
/** Total target cycle count for throughput probe segment. */
export const TARGET_CYCLE_COUNT = 4509;
/** Zero-based index of the final target cycle. */
export const LAST_TARGET_CYCLE_INDEX = TARGET_CYCLE_COUNT - 1;
/** Cycle count executed in the resumed tail after process crash/pause. */
export const RESUMED_TAIL_CYCLE_COUNT = 512;
