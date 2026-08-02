import { beforeAll, describe, expect, it } from "vitest";

import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { EXPAND_MIN_BARS } from "@/lib/trader/market-data/fixture-bar-replay-source";
import { FhvOfficialDatasetReader } from "@/lib/trader/market-data/fhv-official-dataset-reader";
import { buildFhvOfficialV2ScaleDataset } from "@/tests/helpers/fhv-official-path-test-fixtures";

describe("FHV cursor restore (Phase 8)", () => {
  let v2DatasetRoot = "";

  beforeAll(() => {
    v2DatasetRoot = mkdtempSync(join(tmpdir(), "fhv-cursor-restore-v2-"));
    buildFhvOfficialV2ScaleDataset(v2DatasetRoot);
  }, 600_000);

  it("FHV_CURSOR_RESTORE_ROLLING_WINDOW_PASS: restoreCursor rebuilds rollingWindow from checkpoint", () => {
    const reader = new FhvOfficialDatasetReader({
      datasetRoot: v2DatasetRoot,
      accessPurpose: "CONTROL_REPLAY_STRATEGY",
      includeHoldoutPartitions: false,
      cycleIdPrefix: "fhv-cursor-restore",
    });

    const advance = (count: number): void => {
      for (let index = 0; index < count; index += 1) {
        const result = reader.next();
        if (result.done) {
          break;
        }
      }
    };

    advance(EXPAND_MIN_BARS + 10);
    const checkpoint = reader.captureCursor();
    expect(checkpoint.btc.rollingWindow.length).toBeGreaterThan(0);
    expect(checkpoint.eth.rollingWindow.length).toBeGreaterThan(0);

    advance(20);
    reader.restoreCursor(checkpoint);
    const restored = reader.captureCursor();

    expect(restored.btc.rollingWindow).toEqual(checkpoint.btc.rollingWindow);
    expect(restored.eth.rollingWindow).toEqual(checkpoint.eth.rollingWindow);
    expect(restored.globalEventSequence).toBe(checkpoint.globalEventSequence);
    expect(restored.cycleIndex).toBe(checkpoint.cycleIndex);

    reader.close();
  }, 120_000);
});
