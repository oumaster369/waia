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
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "00000000-0000-4000-8000-0000000264";
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
    newDecisionId: () => "risk-decision-bar-close-264",
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

describe("trader paper bar-close loop integration (AT-E9 S5)", () => {
  let orgA: string;
  let connector: MockExchangeConnector;
  let writeAudit: ReturnType<typeof vi.fn<(input: TraderAuditInput) => string>>;

  beforeAll(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-bar-close-264-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "bar-close-264.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "bar-close-264@waia.invalid",
      password: "password123",
      identityLabel: "Bar Close Loop Org A",
    });

    orgA = ensureUserCoreSeedSqlite(db, { userId: USER_A, displayName: "Bar Close Loop Org A" });

    const limits = createSqliteRiskLimitsService(db);
    await limits.upsertLimitsForOrg(requireOrgContext(orgA), { ...DEFAULT_ORG_RISK_LIMITS });

    connector = new MockExchangeConnector();
    await connector.validateCredentials({ apiKey: "mock", apiSecret: "mock" });
    writeAudit = vi.fn((input: TraderAuditInput) => input.entityId ?? "audit-bar-close-264");
  });

  it("runs one mocked HTX bar-close cycle via runPaperBarCloseLoop → SIGNAL → FILLED → IN_SYNC", async () => {
    const context = requireOrgContext(orgA);
    const db = getDb();
    const deps = buildPaperCycleDeps(db, connector, writeAudit);
    const submitSpy = vi.spyOn(deps.execution, "submitOrder");
    const reconcileSpy = vi.spyOn(deps.reconciliation, "reconcile");
    const fixture = loadHtxFixture();
    const poll = new HtxBarPollSource({
      fetchImpl: createMockFetch(fixture),
      cycleIdPrefix: "test-paper-loop",
    });

    const result = await runPaperBarCloseLoop({
      deps,
      poll,
      context,
      accountKey: "acct-paper-loop",
      defaultQuantity: "0.01",
      accountState: EMPTY_STATE,
      maxCycles: 1,
      sleep: async () => {},
      nowMs: () => 0,
      newId: () => crypto.randomUUID(),
    });

    expect(result).toEqual({ cyclesRun: 1, aborted: false });
    expect(submitSpy).toHaveBeenCalledTimes(1);
    expect(reconcileSpy).toHaveBeenCalledTimes(1);

    const submitResult = await submitSpy.mock.results[0]?.value;
    expect(submitResult?.status).toBe("submitted");
    if (submitResult?.status !== "submitted") {
      return;
    }

    expect(submitResult.order.clientOrderId).toBe(
      "client-paper-cycle-test-paper-loop-0-mean_reversion_v0",
    );
    expect(submitResult.order.state).toBe("FILLED");

    const reconcileResult = await reconcileSpy.mock.results[0]?.value;
    expect(reconcileResult?.outcomes[0]?.classification).toBe("IN_SYNC");
  });
});
