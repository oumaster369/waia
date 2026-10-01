import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { FHV_DATASET_PARTITIONS_V1 } from "@/lib/trader/market-data/dataset/fhv-dataset-manifest";
import { consumeDee540BlindTailAuthorization } from "@/lib/trader/research/dee-540-authorization-store";
import {
  DEE540_OFFICIAL_HOLDOUT_STATUS,
  assertDee540BlindTailAuthorized,
  resolveResearchPipelineCliBlindTail,
} from "@/lib/trader/research/dee-540-blind-tail-gate";
import {
  buildM9BlindAuthorizationScope,
  computeM9BlindAuthorizationDigest,
} from "@/lib/trader/research/m9-operator-authorization";
import { ResearchOrchestratorError } from "@/lib/trader/research/errors";

function authorizedScope() {
  const scope = buildM9BlindAuthorizationScope({
    campaignScope: {
      organizationId: "org-540",
      strategyId: "mean_reversion_v0",
      strategyVersion: "0.1.0",
      symbol: "BTC/USDT",
      interval: "1m",
      vaultDir: "vault",
      metricsSchemaVersion: "2.0.0",
    },
    datasetName: "research-tail",
    blindDigest: "ab".repeat(32),
    sidecarContentDigest: null,
  });
  return {
    scope,
    digest: computeM9BlindAuthorizationDigest(scope),
  };
}

function expectGateCode(run: () => unknown, code: string): void {
  try {
    run();
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(ResearchOrchestratorError);
    expect((error as ResearchOrchestratorError).code).toBe(code);
  }
}

describe("DEE-540 blind tail gate", () => {
  it("keeps the official 2025 holdout sealed and unread", () => {
    expect(DEE540_OFFICIAL_HOLDOUT_STATUS).toBe("SEALED_NOT_ACCESSED");
    expect(FHV_DATASET_PARTITIONS_V1.blindHoldout.status).toBe("SEALED_NOT_ACCESSED");
    expect(FHV_DATASET_PARTITIONS_V1.blindHoldout.startUtc).toBe("2025-01-01T00:00:00.000Z");
    expect(FHV_DATASET_PARTITIONS_V1.blindHoldout.endUtc).toBe("2026-01-01T00:00:00.000Z");
    const gate = readFileSync(
      resolve(process.cwd(), "lib/trader/research/dee-540-blind-tail-gate.ts"),
      "utf8",
    );
    expect(gate).not.toMatch(/readFile|holdout\.json|listMarketBars/);
  });

  it("refuses to open the blind tail or the official holdout without authorization", () => {
    expectGateCode(
      () => resolveResearchPipelineCliBlindTail(new Map()),
      "DEE540_BLIND_TAIL_AUTHORIZATION_REQUIRED",
    );
    expectGateCode(
      () => resolveResearchPipelineCliBlindTail(new Map([["official-holdout", "true"]])),
      "DEE540_OFFICIAL_HOLDOUT_SEALED",
    );
    expectGateCode(
      () => resolveResearchPipelineCliBlindTail(new Map([["official-holdout", "1"]])),
      "DEE540_OFFICIAL_HOLDOUT_SEALED",
    );
    expectGateCode(
      () => resolveResearchPipelineCliBlindTail(new Map([["official-holdout", "yes"]])),
      "DEE540_OFFICIAL_HOLDOUT_SEALED",
    );
    expectGateCode(
      () => resolveResearchPipelineCliBlindTail(new Map([["partition", "blind-holdout"]])),
      "DEE540_OFFICIAL_HOLDOUT_SEALED",
    );
    expectGateCode(
      () => assertDee540BlindTailAuthorized({ officialHoldoutAccessRequested: true }),
      "DEE540_OFFICIAL_HOLDOUT_SEALED",
    );

    const { scope, digest } = authorizedScope();
    expectGateCode(
      () =>
        assertDee540BlindTailAuthorized({
          operatorBlindAuthorization: "0".repeat(64),
          blindAuthorizationScope: scope,
        }),
      "DEE540_BLIND_TAIL_AUTHORIZATION_REQUIRED",
    );
    expectGateCode(
      () =>
        assertDee540BlindTailAuthorized({
          operatorBlindAuthorization: digest,
          blindAuthorizationScope: scope,
          officialHoldoutAccessRequested: true,
        }),
      "DEE540_OFFICIAL_HOLDOUT_SEALED",
    );
  });

  it("accepts a content-bound grant and still reports the official holdout as sealed", async () => {
    const { scope, digest } = authorizedScope();
    const grant = resolveResearchPipelineCliBlindTail(
      new Map([
        ["operator-blind-authorization", digest],
        ["blind-authorization-scope", JSON.stringify(scope)],
      ]),
    );
    expect(grant.officialHoldoutStatus).toBe("SEALED_NOT_ACCESSED");
    expect(grant.blindAuthorizationScope.blindDigest).toBe(scope.blindDigest);
    const seen = new Set<string>();
    const ex = {
      insert() {
        return {
          values(row: { barContentToken: string }) {
            if (seen.has(row.barContentToken)) {
              throw Object.assign(new Error("duplicate"), { code: "23505" });
            }
            seen.add(row.barContentToken);
            return Promise.resolve();
          },
        };
      },
    };
    await consumeDee540BlindTailAuthorization(ex as never, {
      blindDigest: grant.blindAuthorizationScope.blindDigest,
    });
    await expect(
      consumeDee540BlindTailAuthorization(ex as never, {
        blindDigest: grant.blindAuthorizationScope.blindDigest,
      }),
    ).rejects.toMatchObject({ code: "DEE540_AUTHORIZATION_ALREADY_CONSUMED" });
  });

  it("checks the gate before listing bars or running the blind backtest", () => {
    const cli = readFileSync(
      resolve(process.cwd(), "scripts/trader/research-pipeline-cli.ts"),
      "utf8",
    );
    const orchestrator = readFileSync(
      resolve(process.cwd(), "lib/trader/research/research-orchestrator.ts"),
      "utf8",
    );
    expect(cli.indexOf("resolveResearchPipelineCliBlindTail(flags)")).toBeGreaterThan(-1);
    expect(cli.indexOf("resolveResearchPipelineCliBlindTail(flags)")).toBeLessThan(
      cli.indexOf("computeM9DatasetSealPreviewPostgres("),
    );
    expect(cli).not.toContain("listMarketBarsPostgres(");
    expect(orchestrator).not.toContain("listMarketBarsPostgres(");
    expect(orchestrator.indexOf("assertDee540BlindTailAuthorized(")).toBeLessThan(
      orchestrator.indexOf("commitDee540BlindHoldout("),
    );
    expect(orchestrator.indexOf("assertDee540BlindTailAuthorized(")).toBeLessThan(
      orchestrator.indexOf("resolveM9ResearchDatasetPostgres("),
    );
    expect(orchestrator).not.toContain("runBlindHoldoutValidation");
    const blindCommit = readFileSync(
      resolve(process.cwd(), "lib/trader/research/dee-540-blind-tail-commit.ts"),
      "utf8",
    );
    expect(orchestrator.indexOf("assertResearchPipelineRegimeCoverage(")).toBeLessThan(
      orchestrator.indexOf("commitDee540BlindHoldout("),
    );
    expect(orchestrator).not.toContain("consumeDee540BlindTailAuthorization(");
    expect(blindCommit.indexOf("consumeDee540BlindTailAuthorization(")).toBeLessThan(
      blindCommit.indexOf("runBacktest("),
    );
    expect(blindCommit).toContain("executor: scope");
    expect(blindCommit).not.toContain("WAIA_DEE540_CONSUMPTION_PATH");
    expect(blindCommit).not.toContain("replay");
    expect(orchestrator).not.toContain("walk_forward_validated");
    expect(orchestrator).not.toContain("blindUsed: false");
    expect(orchestrator.indexOf("getStrategyCandidateByIdPostgres(")).toBeGreaterThan(-1);
    expect(orchestrator.indexOf("getStrategyCandidateByIdPostgres(")).toBeLessThan(
      orchestrator.indexOf("commitDee540BlindHoldout("),
    );
    const blindWindow = orchestrator.slice(orchestrator.indexOf("commitDee540BlindHoldout("));
    expect(blindWindow).toContain("createPostgresOrderRepositoryFromExecutor(executor)");
    expect(blindWindow).toContain("bindBlindWindowToExecutor(input, executor)");
    expect(blindWindow).toContain("runIsolatedResearchBacktest(");
    expect(blindWindow).not.toMatch(/runIsolatedResearchBacktest\(\s*ex\s*,/);
    expect(blindWindow).not.toContain("resolveOrderRepository");
    expect(blindWindow).not.toContain("deps: input.deps");
    const binder = orchestrator.slice(
      orchestrator.indexOf("function bindBlindWindowToExecutor"),
      orchestrator.indexOf("function buildIsolatedBacktestInput"),
    );
    expect(binder).toContain("createPostgresOrderExecutionServiceFromExecutor(executor)");
    expect(binder).toContain("createPostgresReconciliationServiceFromExecutor(executor)");
    expect(binder).toContain("createIntelligenceCycleBundleRepositoryPostgres(executor)");
    expect(binder).toContain("createForecastDecisionBundleRepositoryPostgres(executor)");
    expect(binder).toContain("createWp21RuntimeDepsPostgres(executor)");
    const campaign = readFileSync(
      resolve(process.cwd(), "scripts/trader/ri-evidence-campaign.ts"),
      "utf8",
    );
    expect(campaign).toContain("skipBlindTail: true");
    expect(orchestrator).toContain('RESEARCH_PIPELINE_BLIND_TAIL_NOT_RUN = "not-produced"');
    expect(orchestrator).not.toContain("blind-tail-skipped");
  });
});
