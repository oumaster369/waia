import { readFileSync } from "node:fs";

import { buildMarketSnapshot } from "@/lib/trader/market-data/market-snapshot";
import type {
  BarPollSource,
  MarketSnapshot,
  TraderFixtureFile,
} from "@/lib/trader/market-data/types";

export type ScenarioSequenceBarPollOptions = {
  scenarioPaths: readonly string[];
  /** Registry strategy id per scenario fixture (same length as scenarioPaths). */
  scenarioStrategyIds: readonly string[];
  cycleIdPrefix?: string;
};

function loadFixtureFile(fixturePath: string): TraderFixtureFile {
  return JSON.parse(readFileSync(fixturePath, "utf8")) as TraderFixtureFile;
}

/**
 * Rotates through isolated golden scenario fixtures (full window each cycle).
 * Matches `tests/integration/trader-paper-p5-multi-strategy.test.ts` cadence for closed-trade proof.
 */
export class ScenarioSequenceBarPollAdapter implements BarPollSource {
  private readonly fixtures: TraderFixtureFile[];
  private readonly scenarioStrategyIds: readonly string[];
  private readonly cycleIdPrefix: string;
  private cycleIndex = 0;

  constructor(options: ScenarioSequenceBarPollOptions) {
    if (options.scenarioPaths.length === 0) {
      throw new Error(
        "[market-data] scenario-sequence requires at least one scenario fixture path",
      );
    }
    if (options.scenarioStrategyIds.length !== options.scenarioPaths.length) {
      throw new Error(
        "[market-data] scenario-sequence scenarioStrategyIds length must match scenarioPaths",
      );
    }
    this.fixtures = options.scenarioPaths.map(loadFixtureFile);
    this.scenarioStrategyIds = options.scenarioStrategyIds;
    this.cycleIdPrefix = options.cycleIdPrefix ?? "scenario-seq";
  }

  reset(): void {
    this.cycleIndex = 0;
  }

  async fetchSnapshot(): Promise<MarketSnapshot> {
    const scenarioIndex = this.cycleIndex % this.fixtures.length;
    const fixture = this.fixtures[scenarioIndex]!;
    const snapshot = buildMarketSnapshot(
      fixture.bars,
      fixture.latestQuote,
      this.cycleIndex,
      this.cycleIdPrefix,
    );
    this.cycleIndex += 1;
    return {
      ...snapshot,
      activeStrategyIds: [this.scenarioStrategyIds[scenarioIndex]!],
    };
  }
}
