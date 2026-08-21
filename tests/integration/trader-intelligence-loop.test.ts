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
import { runPaperCycleOnce } from "@/lib/trader/paper/paper-cycle-runner";
import type { PaperCycleDeps } from "@/lib/trader/paper/paper-cycle.types";
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

const USER_A = "00000000-0000-4000-8000-0000000257c";
const NOW = 1_735_689_600_000; // 2026-01-01T00:00:00.000Z

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
    newDecisionId: () => "risk-decision-intel-loop-257",
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

describe("trader intelligence loop integration (DEE-257)", () => {
  let orgA: string;
  let connector: MockExchangeConnector;
  let writeAudit: ReturnType<typeof vi.fn<(input: TraderAuditInput) => string>>;

  beforeAll(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-intel-loop-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "intel-loop.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "intel-loop-a@waia.invalid",
      password: "password123",
      identityLabel: "Intel Loop Org A",
    });

    orgA = ensureUserCoreSeedSqlite(db, { userId: USER_A, displayName: "Intel Loop Org A" });

    const limits = createSqliteRiskLimitsService(db);
    await limits.upsertLimitsForOrg(requireOrgContext(orgA), { ...DEFAULT_ORG_RISK_LIMITS });

    connector = new MockExchangeConnector();
    await connector.validateCredentials({ apiKey: "mock", apiSecret: "mock" });
    writeAudit = vi.fn((input: TraderAuditInput) => input.entityId ?? "audit-intel-loop");
  });

  it("fails the legacy intelligence loop closed before Risk V2 or reconciliation", async () => {
    const context = requireOrgContext(orgA);
    const db = getDb();
    const deps = buildPaperCycleDeps(db, connector, writeAudit);
    const replay = new FixtureBarReplaySource({ mode: "full", cycleIdPrefix: "dee-257" });
    const next = replay.next();
    expect(next.done).toBe(false);
    if (next.done) {
      return;
    }

    const result = await runPaperCycleOnce(deps, {
      context,
      snapshot: next.snapshot,
      accountKey: "acct-intel-loop",
      defaultQuantity: "0.01",
      executionMode: "mock",
      accountState: EMPTY_STATE,
      newId: () => crypto.randomUUID(),
    });

    expect(result.evaluation.signal.outcome).toBe("SIGNAL");
    expect(result.submitBlocked).toBe(true);
    expect(result.execution?.status).toBe("execution_v2_required");
    expect(result.reconciliation).toBeNull();
  });
});
