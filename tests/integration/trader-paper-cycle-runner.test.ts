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
import { runFixturePaperCycles } from "@/lib/trader/paper/paper-cycle-runner";
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

const USER_A = "00000000-0000-4000-8000-0000000260";
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
    newDecisionId: () => "risk-decision-paper-cycle-260",
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

function parseCounter(line: string): Record<string, unknown> {
  return JSON.parse(line) as Record<string, unknown>;
}

function isIntelligenceCounter(line: string): boolean {
  const parsed = parseCounter(line);
  return (
    parsed.event === "waia_trader_event" &&
    parsed.kind === "counter" &&
    (parsed.domain === "decision" || parsed.domain === "strategy")
  );
}

describe("trader paper cycle runner integration (DEE-260)", () => {
  let orgA: string;
  let connector: MockExchangeConnector;
  let writeAudit: ReturnType<typeof vi.fn<(input: TraderAuditInput) => string>>;

  beforeAll(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-paper-cycle-260-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "paper-cycle-260.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "paper-cycle-260@waia.invalid",
      password: "password123",
      identityLabel: "Paper Cycle Org A",
    });

    orgA = ensureUserCoreSeedSqlite(db, { userId: USER_A, displayName: "Paper Cycle Org A" });

    const limits = createSqliteRiskLimitsService(db);
    await limits.upsertLimitsForOrg(requireOrgContext(orgA), { ...DEFAULT_ORG_RISK_LIMITS });

    connector = new MockExchangeConnector();
    await connector.validateCredentials({ apiKey: "mock", apiSecret: "mock" });
    writeAudit = vi.fn((input: TraderAuditInput) => input.entityId ?? "audit-paper-cycle-260");
  });

  it("runs 3 fixture cycles with unique idempotency keys and 12 intelligence telemetry lines", async () => {
    const context = requireOrgContext(orgA);
    const db = getDb();
    const deps = buildPaperCycleDeps(db, connector, writeAudit);
    const replay = new FixtureBarReplaySource({ mode: "full", cycleIdPrefix: "dee-260" });
    const lines: string[] = [];
    const telemetrySink = (line: string) => lines.push(line);

    const { results } = await runFixturePaperCycles({
      deps,
      context,
      n: 3,
      replay,
      accountKey: "acct-paper-cycle-260",
      defaultQuantity: "0.01",
      executionMode: "mock",
      accountState: EMPTY_STATE,
      telemetrySink,
      newId: () => crypto.randomUUID(),
    });

    expect(results).toHaveLength(3);

    const idempotencyKeys = new Set<string>();
    for (const result of results) {
      expect(result.evaluation.signal.outcome).toBe("SIGNAL");
      expect(result.submitBlocked).toBe(false);
      expect(result.execution?.status).toBe("submitted");
      if (result.execution?.status !== "submitted") {
        continue;
      }
      expect(result.execution.order.state).toBe("FILLED");
      expect(result.reconciliation?.outcomes[0]?.classification).toBe("IN_SYNC");
      idempotencyKeys.add(result.execution.order.clientOrderId);
    }

    expect(idempotencyKeys.size).toBe(3);
    expect(idempotencyKeys.has("client-paper-cycle-dee-260-0")).toBe(true);
    expect(idempotencyKeys.has("client-paper-cycle-dee-260-1")).toBe(true);
    expect(idempotencyKeys.has("client-paper-cycle-dee-260-2")).toBe(true);

    const intelligenceLines = lines.filter(isIntelligenceCounter);
    expect(intelligenceLines).toHaveLength(12);

    for (let cycle = 0; cycle < 3; cycle += 1) {
      const offset = cycle * 4;
      expect(parseCounter(intelligenceLines[offset]!).domain).toBe("decision");
      expect(parseCounter(intelligenceLines[offset + 1]!).domain).toBe("decision");
      expect(parseCounter(intelligenceLines[offset + 2]!).domain).toBe("strategy");
      expect(parseCounter(intelligenceLines[offset + 3]!).domain).toBe("strategy");
    }
  });
});
