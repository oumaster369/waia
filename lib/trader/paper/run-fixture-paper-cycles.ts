import { FixtureBarReplaySource } from "@/lib/trader/market-data/fixture-bar-replay-source";
import { runFixturePaperCycles } from "@/lib/trader/paper/paper-cycle-runner";

import type {
  RunFixturePaperCyclesHarnessInput,
  RunFixturePaperCyclesResult,
} from "@/lib/trader/paper/paper-cycle.types";

/**
 * Test-harness entry: runs N fixture replay cycles with a fresh {@link FixtureBarReplaySource}.
 */
export async function runFixturePaperCyclesHarness(
  input: RunFixturePaperCyclesHarnessInput,
): Promise<RunFixturePaperCyclesResult> {
  const replay = new FixtureBarReplaySource({
    fixturePath: input.fixturePath,
    mode: input.mode,
    cycleIdPrefix: input.cycleIdPrefix,
  });

  return runFixturePaperCycles({
    deps: input.deps,
    context: input.context,
    n: input.n,
    replay,
    accountKey: input.accountKey,
    defaultQuantity: input.defaultQuantity,
    executionMode: input.executionMode,
    accountState: input.accountState,
    telemetrySink: input.telemetrySink,
    newId: input.newId,
  });
}
