import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { assembleDiscoveryLoopRuns } from "@/lib/trader/discovery/discovery-loop-view";
import { computeDee540BarContentToken } from "@/lib/trader/research/dee-540-authorization-store";
import { isPostgresUniqueViolation } from "@/lib/trader/research/postgres-unique-violation";
import {
  buildM9BlindAuthorizationScope,
  computeM9BlindAuthorizationDigest,
} from "@/lib/trader/research/m9-operator-authorization";

const BLIND = "cd".repeat(32);

function scope(datasetName: string, vaultDir: string) {
  return buildM9BlindAuthorizationScope({
    campaignScope: {
      organizationId: "org-540",
      strategyId: "mean_reversion_v0",
      strategyVersion: "0.1.0",
      symbol: "BTC/USDT",
      interval: "1m",
      vaultDir,
      metricsSchemaVersion: "2.0.0",
    },
    datasetName,
    blindDigest: BLIND,
    sidecarContentDigest: null,
  });
}

describe("discovery loop postgres step 2", () => {
  it("hashes DEE-540 consumption from bar content, not dataset or vault labels", () => {
    const renamed = scope("other-name", "other-vault");
    const original = scope("research-tail", "vault");
    expect(computeM9BlindAuthorizationDigest(renamed)).not.toBe(
      computeM9BlindAuthorizationDigest(original),
    );
    expect(computeDee540BarContentToken(renamed.blindDigest)).toBe(
      computeDee540BarContentToken(original.blindDigest),
    );
    expect(computeDee540BarContentToken(BLIND)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("recognizes a unique violation nested on error.cause", () => {
    expect(isPostgresUniqueViolation({ cause: { code: "23505" } })).toBe(true);
    expect(isPostgresUniqueViolation(new Error("missing"))).toBe(false);
  });

  it("assembles a read-only view and drops an unknown partition", () => {
    const [run] = assembleDiscoveryLoopRuns({
      runs: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          organizationId: "22222222-2222-4222-8222-222222222222",
          campaignId: "camp-1025",
          skipped: false,
          status: "HUMAN_PROPOSAL_PENDING",
          reason: null,
          capitalAuthority: "NONE",
          createdAt: new Date("2026-09-29T00:00:00.000Z"),
        },
      ],
      trials: [
        {
          runId: "11111111-1111-4111-8111-111111111111",
          trialIndex: 1,
          hypothesisId: "b",
          rawPValue: "0.2",
          adjustedPValue: "0.4",
        },
        {
          runId: "11111111-1111-4111-8111-111111111111",
          trialIndex: 0,
          hypothesisId: "a",
          rawPValue: "0.1",
          adjustedPValue: "0.2",
        },
      ],
      verdicts: [
        {
          runId: "11111111-1111-4111-8111-111111111111",
          partition: "DEVELOPMENT",
          verdict: "QUALIFIED",
          admissionVerdict: "passed_is",
          scored: true,
          reasons: [],
        },
        {
          runId: "11111111-1111-4111-8111-111111111111",
          partition: "BLIND_HOLDOUT",
          verdict: "QUALIFIED",
          admissionVerdict: "passed_validation",
          scored: true,
          reasons: [],
        },
      ],
    });
    expect(run?.trials.map((trial) => trial.trialIndex)).toEqual([0, 1]);
    expect(run?.verdicts).toHaveLength(1);
    expect(JSON.stringify(run)).not.toMatch(/orderId|fillId|liveEnable/);
  });

  it("pins one-shot primary keys and removes path overrides", () => {
    const sql = readFileSync(
      resolve(process.cwd(), "db/migrations_postgres/0227_trader_discovery_loop_postgres_v1.sql"),
      "utf8",
    );
    expect(sql).toContain("PRIMARY KEY (spec_sha256, hypothesis_id, split)");
    expect(sql).toContain("bar_content_token text PRIMARY KEY");
    expect(sql).not.toMatch(/CREATE TABLE public\.trader_orders/);
    const store = readFileSync(
      resolve(process.cwd(), "lib/trader/research/dee-540-authorization-store.ts"),
      "utf8",
    );
    const journal = readFileSync(
      resolve(process.cwd(), "lib/trader/research/strategy-admission-v1.ts"),
      "utf8",
    );
    const orchestrator = readFileSync(
      resolve(process.cwd(), "lib/trader/discovery/evolution-orchestrator.ts"),
      "utf8",
    );
    for (const source of [store, journal, orchestrator]) {
      expect(source).not.toContain("WAIA_DEE540_CONSUMPTION_PATH");
      expect(source).not.toContain("WAIA_STRATEGY_ADMISSION_JOURNAL_PATH");
      expect(source).not.toContain("var/waia/dee540");
      expect(source).not.toContain("var/waia/strategy-admission");
    }
  });
});
