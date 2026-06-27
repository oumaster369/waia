import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { beforeAll, describe, expect, it, vi } from "vitest";

import { getDb } from "@/db/client";
import { MockExchangeConnector } from "@/lib/trader/connectors/mock-exchange-connector";
import {
  createOrderExecutionServiceFromDeps,
  createSqliteOrderRepository,
  createSqliteReconciliationService,
} from "@/lib/trader/execution";
import { FixtureBarReplaySource } from "@/lib/trader/market-data/fixture-bar-replay-source";
import { derivePaperBook } from "@/lib/trader/paper/derive-paper-book";
import { derivePaperStrategyEvaluations } from "@/lib/trader/paper/derive-paper-strategy-eval";
import { runPaperCycleOnce } from "@/lib/trader/paper/paper-cycle-runner";
import type { PaperCycleDeps } from "@/lib/trader/paper/paper-cycle.types";
import { LIQUIDITY_SWEEP_REVERSAL_V0, MEAN_REVERSION_V0 } from "@/lib/trader/intelligence/types";
import type { AccountRiskState } from "@/lib/trader/risk/capital-limits.types";
import { DEFAULT_ORG_RISK_LIMITS } from "@/lib/trader/risk/limits/defaults";
import { createSqliteRiskLimitsService } from "@/lib/trader/risk/limits/limits-service";
import {
  createKillSwitchResolver,
  createSqliteKillSwitchRepository,
} from "@/lib/trader/risk/kill-switch";
import { createRiskEngineService } from "@/lib/trader/risk/risk-engine-service";
import { createInMemoryOrderRateStore } from "@/lib/trader/risk/order-rate-store";
import type { TraderAuditInput } from "@/lib/trader/types";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "00000000-0000-4000-8000-0000000334";
const NOW = 1_735_689_600_000;

const EMPTY_STATE: AccountRiskState = {
  positions: [],
  openOrderCount: 0,
  dailyPnl: "0",
  drawdown: "0",
  quoteExposureByCurrency: {},
};

function buildPaperCycleDeps(
  db: ReturnType<typeof getDb>,
  connector: MockExchangeConnector,
  writeAudit: (input: TraderAuditInput) => string,
): PaperCycleDeps {
  const repo = createSqliteOrderRepository(db);
  const killSwitchResolver = createKillSwitchResolver({
    repository: createSqliteKillSwitchRepository(db),
    nowMs: () => NOW,
  });
  const riskEngine = createRiskEngineService({
    limitsService: createSqliteRiskLimitsService(db),
    killSwitchResolver,
    rateStore: createInMemoryOrderRateStore(),
    writeAudit,
    nowMs: () => NOW,
    newDecisionId: () => "risk-decision-p5-334",
  });

  const execution = createOrderExecutionServiceFromDeps({
    riskEngine,
    orderRepository: repo,
    killSwitchResolver,
    connectorForMode: () => connector,
    writeAudit,
    nowMs: () => NOW,
  });

  const reconciliation = createSqliteReconciliationService(db, {
    connectorForMode: () => connector,
    nowMs: () => NOW,
    writeAudit,
  });

  return { execution, reconciliation };
}

function fixtureSnapshot(fixturePath: string, cycleId: string) {
  const replay = new FixtureBarReplaySource({ fixturePath, mode: "full", cycleIdPrefix: cycleId });
  const next = replay.next();
  if (next.done) {
    throw new Error(`[test] fixture exhausted: ${fixturePath}`);
  }
  return next.snapshot;
}

describe("P5 multi-strategy paper pipeline integration (DEE-334)", () => {
  let orgA: string;
  let deps: PaperCycleDeps;
  let orderRepository: ReturnType<typeof createSqliteOrderRepository>;

  beforeAll(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-paper-p5-334-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "paper-p5-334.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "paper-p5-334@waia.invalid",
      password: "password123",
      identityLabel: "Paper P5 Org A",
    });

    orgA = ensureUserCoreSeedSqlite(db, { userId: USER_A, displayName: "Paper P5 Org A" });

    const limits = createSqliteRiskLimitsService(db);
    await limits.upsertLimitsForOrg(requireOrgContext(orgA), { ...DEFAULT_ORG_RISK_LIMITS });

    const connector = new MockExchangeConnector();
    await connector.validateCredentials({ apiKey: "mock", apiSecret: "mock" });
    const writeAudit = vi.fn((input: TraderAuditInput) => input.entityId ?? "audit-p5-334");
    orderRepository = createSqliteOrderRepository(db);
    deps = buildPaperCycleDeps(db, connector, writeAudit);
  });

  it("produces round-trip closed trades for both registered strategies", async () => {
    const context = requireOrgContext(orgA);
    const fixtureRuns = [
      {
        fixture: path.join(process.cwd(), "tests/fixtures/trader/btcusdt-1m-mean-reversion.json"),
        cycleId: "p5-mr-entry",
      },
      {
        fixture: path.join(
          process.cwd(),
          "tests/fixtures/trader/btcusdt-1m-mean-reversion-exit.json",
        ),
        cycleId: "p5-mr-exit",
      },
      {
        fixture: path.join(
          process.cwd(),
          "tests/fixtures/trader/btcusdt-1m-liquidity-sweep-entry.json",
        ),
        cycleId: "p5-ls-entry",
      },
      {
        fixture: path.join(
          process.cwd(),
          "tests/fixtures/trader/btcusdt-1m-liquidity-sweep-exit.json",
        ),
        cycleId: "p5-ls-exit",
      },
    ] as const;

    const strategySignalIds: string[] = [];

    for (const run of fixtureRuns) {
      const snapshot = fixtureSnapshot(run.fixture, run.cycleId);
      const result = await runPaperCycleOnce(deps, {
        context,
        snapshot,
        accountKey: "acct-p5-334",
        defaultQuantity: "0.01",
        accountState: EMPTY_STATE,
        executionMode: "mock",
        orderRepository,
        refreshAccountStateBetweenStrategies: true,
        newId: () => crypto.randomUUID(),
      });

      expect(result.submitBlocked).toBe(false);
      const submitted = result.strategyExecutions.filter(
        (entry) => entry.execution?.status === "submitted",
      );
      expect(submitted.length).toBeGreaterThan(0);
      for (const entry of submitted) {
        strategySignalIds.push(entry.signal.strategySignalId);
      }
    }

    const orders = await orderRepository.listOrders(context, { executionMode: "mock" });
    const filled = orders.filter((order) => order.state === "FILLED");
    expect(filled.length).toBeGreaterThanOrEqual(4);

    const book = await derivePaperBook({ context, orderRepository, executionMode: "mock" });
    expect(book.positions).toHaveLength(0);

    const evaluations = await derivePaperStrategyEvaluations({
      context,
      orderRepository,
      strategySignalIds: [...new Set(strategySignalIds)],
      window: {
        start: new Date(NOW - 86_400_000),
        end: new Date(NOW + 86_400_000),
      },
      executionMode: "mock",
    });

    expect(evaluations.length).toBeGreaterThanOrEqual(2);

    const submittedStrategies = new Set(
      filled.map((order) => order.strategySignalId).filter((id): id is string => Boolean(id)),
    );
    expect(submittedStrategies.size).toBeGreaterThanOrEqual(2);
    expect(MEAN_REVERSION_V0).toBe("mean_reversion_v0");
    expect(LIQUIDITY_SWEEP_REVERSAL_V0).toBe("liquidity_sweep_reversal_v0");
  });
});
