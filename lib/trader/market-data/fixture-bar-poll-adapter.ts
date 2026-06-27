import { FixtureBarReplaySource } from "@/lib/trader/market-data/fixture-bar-replay-source";
import type {
  BarPollSource,
  FixtureBarReplayOptions,
  MarketSnapshot,
} from "@/lib/trader/market-data/types";

/**
 * Adapts {@link FixtureBarReplaySource} to {@link BarPollSource} for deterministic paper loops.
 */
export class FixtureBarPollAdapter implements BarPollSource {
  private readonly replay: FixtureBarReplaySource;

  constructor(options: FixtureBarReplayOptions) {
    this.replay = new FixtureBarReplaySource(options);
  }

  reset(): void {
    this.replay.reset();
  }

  async fetchSnapshot(): Promise<MarketSnapshot> {
    const next = this.replay.next();
    if (next.done) {
      throw new Error(
        "[market-data] fixture replay exhausted (use wrap-expand mode for long runs)",
      );
    }
    return next.snapshot;
  }
}
