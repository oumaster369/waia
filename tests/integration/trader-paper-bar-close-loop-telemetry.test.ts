import fs from "node:fs";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { beforeAll, describe, expect, it, vi } from "vitest";

import { getDb } from "@/db/client";
import { MockExchangeConnector } from "@/lib/trader/connectors/mock-exchange-connector";
import type { HtxKlineResponse, HtxMarketMergedResponse } from "@/lib/trader/connectors/htx/types";
import {
  createOrderExecutionServiceFromDeps,
  createSqliteOrderRepository,
  createSqliteReconciliationService,
} from "@/lib/trader/execution";
import { HtxBarPollSource } from "@/lib/trader/market-data/htx-bar-poll-source";
import { deriveAccountRiskStateFromMockOrders } from "@/lib/trader/paper/account-risk-state-from-orders";
import { runPaperBarCloseLoop } from "@/lib/trader/paper/paper-bar-close-loop";
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
import { htxPollSourceOptions } from "@/tests/helpers/htx-gateway-mock-fetch";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "00000000-0000-4000-8000-0000000266";
const NOW = 1_735_689_600_000;

const EMPTY_STATE: AccountRiskState = {
  positions: [],
  openOrderCount: 0,
  dailyPnl: "0",
  drawdown: "0",
  quoteExposureByCurrency: {},
};

const TIGHT_LIMITS = {
  ...DEFAULT_ORG_RISK_LIMITS,
  maxPositionPerSymbol: "0.015",
};

type HtxKlineFixture = {
  kline: HtxKlineResponse;
  merged: HtxMarketMergedResponse;
};

function loadHtxFixture(): HtxKlineFixture {
  const filePath = path.join(process.cwd(), "tests/fixtures/trader/htx-kline-btcusdt-1m.json");
  return JSON.parse(readFileSync(filePath, "utf8")) as HtxKlineFixture;
}

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
    newDecisionId: () => crypto.randomUUID(),
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

function parsePaperLoopCycleComplete(lines: string[]): Record<string, unknown>[] {
  return lines
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((event) => event.kind === "paper_loop" && event.outcome === "cycle_complete");
}

describe("trader paper bar-close loop telemetry (AT-E9 S7)", () => {
  let orgA: string;
  let connector: MockExchangeConnector;
  let writeAudit: ReturnType<typeof vi.fn<(input: TraderAuditInput) => string>>;

  beforeAll(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-bar-close-266-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "bar-close-266.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "bar-close-266@waia.invalid",
      password: "password123",
      identityLabel: "Bar Close Telemetry Org A",
    });

    orgA = ensureUserCoreSeedSqlite(db, {
      userId: USER_A,
      displayName: "Bar Close Telemetry Org A",
    });

    const limits = createSqliteRiskLimitsService(db);
    await limits.upsertLimitsForOrg(requireOrgContext(orgA), TIGHT_LIMITS);

    connector = new MockExchangeConnector();
    await connector.validateCredentials({ apiKey: "mock", apiSecret: "mock" });
    writeAudit = vi.fn((input: TraderAuditInput) => input.entityId ?? "audit-bar-close-266");
  });

  it("emits two cycle_complete events with refresh metadata on a 2-cycle run", async () => {
    const context = requireOrgContext(orgA);
    const db = getDb();
    const orderRepository = createSqliteOrderRepository(db);
    const deps = buildPaperCycleDeps(db, connector, writeAudit);
    const fixture = loadHtxFixture();
    const poll = new HtxBarPollSource(
      htxPollSourceOptions(fixture, { cycleIdPrefix: "test-telemetry" }),
    );
    const lines: string[] = [];
    const telemetrySink = (line: string) => lines.push(line);

    const result = await runPaperBarCloseLoop({
      deps,
      poll,
      context,
      accountKey: "acct-paper-loop",
      defaultQuantity: "0.01",
      accountState: EMPTY_STATE,
      orderRepository,
      refreshAccountState: ({ context: refreshContext, orderRepository: repo }) =>
        deriveAccountRiskStateFromMockOrders({
          context: refreshContext,
          orderRepository: repo,
          executionMode: "mock",
        }),
      maxCycles: 2,
      sleep: async () => {},
      nowMs: () => 0,
      newId: () => crypto.randomUUID(),
      telemetrySink,
    });

    expect(result).toEqual({ cyclesRun: 2, aborted: false });

    const cycleCompleteEvents = parsePaperLoopCycleComplete(lines);
    expect(cycleCompleteEvents).toHaveLength(2);

    expect(cycleCompleteEvents[0]).toMatchObject({
      kind: "paper_loop",
      outcome: "cycle_complete",
      cycle_id: "test-telemetry-0",
      cycles_run: 1,
      state_refreshed: true,
      skip_reason: "information_sufficiency_blocked",
      execution_status: null,
    });
    expect(cycleCompleteEvents[0]?.position_symbol_count).toBe(0);

    expect(cycleCompleteEvents[1]).toMatchObject({
      kind: "paper_loop",
      outcome: "cycle_complete",
      cycle_id: "test-telemetry-1",
      cycles_run: 2,
      state_refreshed: true,
      skip_reason: "information_sufficiency_blocked",
      execution_status: null,
    });
    expect(cycleCompleteEvents[1]?.position_symbol_count).toBe(0);
  });
});
