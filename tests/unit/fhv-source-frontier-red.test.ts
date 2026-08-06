import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { runBacktest } from "@/lib/trader/backtest/backtest-runner";
import { createCostModelV1 } from "@/lib/trader/execution/cost-model";
import { FhvOfficialDatasetReader } from "@/lib/trader/market-data/fhv-official-dataset-reader";
import { MEAN_REVERSION_V0 } from "@/lib/trader/intelligence/types";
import { createInMemoryResearchBacktestSession } from "@/lib/trader/research/create-in-memory-research-backtest-session";
import { createHtrInitialAccountRiskState } from "@/lib/trader/research/htr-initial-portfolio-contract";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { getDb } from "@/db/client";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";
import {
  buildFhvOfficialV2ScaleDataset,
  FHV_OFFICIAL_V2_SCALE_RELEASE_SHA,
} from "@/tests/helpers/fhv-official-path-test-fixtures";
import {
  acquireFhvManagedDatasetRoot,
  releaseFhvManagedDatasetRoot,
} from "@/tests/helpers/fhv-temp-root-registry";

const USER_ID = "00000000-0000-4000-8000-0000000437";

async function seedContext() {
  const session = await createInMemoryResearchBacktestSession();
  const db = getDb();
  insertEmailPasswordUser(db, {
    id: USER_ID,
    email: "fhv-source-frontier@waia.invalid",
    password: "password123",
    identityLabel: "FHV Source Frontier",
  });
  const orgId = ensureUserCoreSeedSqlite(db, {
    userId: USER_ID,
    displayName: "FHV Source Frontier",
  });
  return { session, context: requireOrgContext(orgId) };
}

describe("FHV source frontier (Phase 8)", () => {
  let v2DatasetRoot = "";
  let runRoot = "";

  beforeAll(() => {
    v2DatasetRoot = acquireFhvManagedDatasetRoot({
      prefix: "fhv-source-frontier-v2-",
      build: (root) => {
        buildFhvOfficialV2ScaleDataset(root);
      },
      releaseSha: FHV_OFFICIAL_V2_SCALE_RELEASE_SHA,
    }).datasetRoot;
  }, 600_000);

  afterEach(() => {
    if (runRoot) {
      rmSync(runRoot, { recursive: true, force: true });
      runRoot = "";
    }
  });

  afterAll(() => {
    if (v2DatasetRoot) {
      releaseFhvManagedDatasetRoot(v2DatasetRoot, "PASS");
      v2DatasetRoot = "";
    }
  });

  it("FHV_SOURCE_FRONTIER_PASS: RunBacktestResult includes official reader frontier", async () => {
    const { session, context } = await seedContext();
    runRoot = mkdtempSync(join(tmpdir(), "fhv-source-frontier-"));
    const reader = new FhvOfficialDatasetReader({
      datasetRoot: v2DatasetRoot,
      accessPurpose: "CONTROL_REPLAY_STRATEGY",
      includeHoldoutPartitions: false,
      cycleIdPrefix: "fhv-src-frontier",
    });

    const result = await runBacktest({
      context,
      barSource: reader,
      deps: session.deps,
      orderRepository: session.orderRepository,
      accountKey: "fhv-src-account",
      defaultQuantity: "0.01",
      costModel: createCostModelV1("0", "0"),
      strategySignalIds: [MEAN_REVERSION_V0],
      strategyId: MEAN_REVERSION_V0,
      strategyVersion: "0.1.0",
      regimeLabel: "AGGREGATE",
      datasetId: "fhv-src-dataset",
      runId: "fhv-src-run",
      split: "validation",
      window: {
        start: new Date("2020-01-01T00:00:00.000Z"),
        end: new Date("2026-01-01T00:00:00.000Z"),
      },
      accountState: createHtrInitialAccountRiskState(),
      exportedAt: new Date("2026-01-01T00:00:00.000Z"),
      maxCycles: 5,
      enableReplayFusedContext: false,
      retentionMode: "STREAM_ONLY",
      checkpointRunRoot: runRoot,
      historicalExecutionProfile: session.historicalExecutionProfile,
    });

    reader.close();

    expect(result.sourceFrontier).toBeDefined();
    expect(result.sourceFrontier!.emittedCycleCount).toBe(5);
    expect(result.sourceFrontier!.globalEventSequence).toBeGreaterThan(0);
    expect(result.sourceFrontier!.terminalCursorDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(result.sourceFrontier!.sourceExhausted).toBe(false);
    expect(result.sourceFrontier!.lastBarCloseTime.length).toBeGreaterThan(0);
  }, 120_000);
});
