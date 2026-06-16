import fs from "node:fs";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { beforeAll, describe, expect, it, vi } from "vitest";

import { getDb } from "@/db/client";
import { MockExchangeConnector } from "@/lib/trader/connectors/mock-exchange-connector";
import { HTX_ENDPOINTS } from "@/lib/trader/connectors/htx/config";
import type { HtxKlineResponse, HtxMarketMergedResponse } from "@/lib/trader/connectors/htx/types";
import {
  createOrderExecutionServiceFromDeps,
  createSqliteOrderRepository,
  createSqliteReconciliationService,
} from "@/lib/trader/execution";
import { HtxBarPollSource } from "@/lib/trader/market-data/htx-bar-poll-source";
import { runPaperCycleOnce, runPollPaperCycles } from "@/lib/trader/paper/paper-cycle-runner";
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

const USER_A = "00000000-0000-4000-8000-0000000261";
const NOW = 1_735_689_600_000;

const EMPTY_STATE: AccountRiskState = {
  positions: [],
  openOrderCount: 0,
  dailyPnl: "0",
  drawdown: "0",
  quoteExposureByCurrency: {},
};

type HtxKlineFixture = {
  kline: HtxKlineResponse;
  merged: HtxMarketMergedResponse;
};

function loadHtxFixture(): HtxKlineFixture {
  const filePath = path.join(process.cwd(), "tests/fixtures/trader/htx-kline-btcusdt-1m.json");
  return JSON.parse(readFileSync(filePath, "utf8")) as HtxKlineFixture;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createMockFetch(fixture: HtxKlineFixture) {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    if (url.pathname.endsWith(HTX_ENDPOINTS.marketHistoryKline)) {
      return jsonResponse(fixture.kline);
    }
    if (url.pathname.endsWith(HTX_ENDPOINTS.marketDetailMerged)) {
      return jsonResponse(fixture.merged);
    }
    throw new Error(`Unexpected fetch: ${url.toString()}`);
  }) as typeof fetch;
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
    newDecisionId: () => "risk-decision-htx-poll-261",
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

describe("trader HTX bar poll cycle integration (AT-E3 S4)", () => {
  let orgA: string;
  let connector: MockExchangeConnector;
  let writeAudit: ReturnType<typeof vi.fn<(input: TraderAuditInput) => string>>;

  beforeAll(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-htx-poll-261-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "htx-poll-261.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "htx-poll-261@waia.invalid",
      password: "password123",
      identityLabel: "HTX Poll Org A",
    });

    orgA = ensureUserCoreSeedSqlite(db, { userId: USER_A, displayName: "HTX Poll Org A" });

    const limits = createSqliteRiskLimitsService(db);
    await limits.upsertLimitsForOrg(requireOrgContext(orgA), { ...DEFAULT_ORG_RISK_LIMITS });

    connector = new MockExchangeConnector();
    await connector.validateCredentials({ apiKey: "mock", apiSecret: "mock" });
    writeAudit = vi.fn((input: TraderAuditInput) => input.entityId ?? "audit-htx-poll-261");
  });

  it("runs mocked HTX poll → runPaperCycleOnce → SIGNAL → FILLED → IN_SYNC", async () => {
    const context = requireOrgContext(orgA);
    const db = getDb();
    const deps = buildPaperCycleDeps(db, connector, writeAudit);
    const fixture = loadHtxFixture();
    const poll = new HtxBarPollSource({
      fetchImpl: createMockFetch(fixture),
      cycleIdPrefix: "test-htx-poll",
    });

    const snapshot = await poll.fetchSnapshot();
    const result = await runPaperCycleOnce(deps, {
      context,
      snapshot,
      accountKey: "acct-htx-poll",
      defaultQuantity: "0.01",
      executionMode: "mock",
      accountState: EMPTY_STATE,
      newId: () => crypto.randomUUID(),
    });

    expect(result.evaluation.signal.outcome).toBe("SIGNAL");
    expect(result.submitBlocked).toBe(false);
    expect(result.execution?.status).toBe("submitted");
    if (result.execution?.status !== "submitted") {
      return;
    }

    expect(result.execution.order.clientOrderId).toBe("client-paper-cycle-test-htx-poll-0");
    expect(result.execution.order.state).toBe("FILLED");
    expect(result.reconciliation?.outcomes[0]?.classification).toBe("IN_SYNC");
  });

  it("runs 3 mocked HTX poll cycles via runPollPaperCycles with unique client order IDs", async () => {
    const context = requireOrgContext(orgA);
    const db = getDb();
    const deps = buildPaperCycleDeps(db, connector, writeAudit);
    const fixture = loadHtxFixture();
    const poll = new HtxBarPollSource({
      fetchImpl: createMockFetch(fixture),
      cycleIdPrefix: "test-htx-poll-multi",
    });

    const { results } = await runPollPaperCycles({
      deps,
      context,
      n: 3,
      poll,
      accountKey: "acct-htx-poll-multi",
      defaultQuantity: "0.01",
      executionMode: "mock",
      accountState: EMPTY_STATE,
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
    expect(idempotencyKeys.has("client-paper-cycle-test-htx-poll-multi-0")).toBe(true);
    expect(idempotencyKeys.has("client-paper-cycle-test-htx-poll-multi-1")).toBe(true);
    expect(idempotencyKeys.has("client-paper-cycle-test-htx-poll-multi-2")).toBe(true);
  });
});
