import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2", async (load) => {
  const actual = await load<typeof import("@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2")>();
  return { ...actual, requireForecastRuntimeAuthorizedOutcomeV2: vi.fn((value) => value) };
});

import type { ExchangeConnector } from "@/lib/trader/connectors/exchange-connector";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import {
  assertExecutionV2LiveAuthorized,
  createOrgScopedExecutionV2OrderPath,
} from "@/lib/trader/execution/v2/org-order-path";
import type { BindExecutionAuthorityV2Input } from "@/lib/trader/execution/v2/authority-postgres";
import { runDecisionCapitalAuthorityV2 } from "@/lib/trader/runtime-v2/decision-capital-authority-v2";
import type { ForecastRuntimeOutcomeV2 } from "@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

const ORG = "00000000-0000-4000-8000-000000115101";

function liveRequest(): BindExecutionAuthorityV2Input {
  return {
    plan: { timeInForce: "GTC" },
    executionMode: "live",
  } as BindExecutionAuthorityV2Input;
}

function connector(): ExchangeConnector & { placeOrder: ReturnType<typeof vi.fn> } {
  const placeOrder = vi.fn();
  return {
    venueId: "htx",
    marketType: "spot",
    validateCredentials: vi.fn(),
    getAccountInfo: vi.fn(),
    getBalances: vi.fn(),
    getPositions: vi.fn(),
    getOpenOrders: vi.fn(),
    getOrder: vi.fn(),
    placeOrder,
    cancelOrder: vi.fn(),
    getTradeHistory: vi.fn(),
    streamMarketData: vi.fn(),
    streamUserData: vi.fn(),
    getFuturesBalances: vi.fn(),
    getFuturesPositions: vi.fn(),
    placeFuturesOrder: vi.fn(),
  } as unknown as ExchangeConnector & { placeOrder: ReturnType<typeof vi.fn> };
}

describe("Execution V2 org order path (DEE-1151 P0-1)", () => {
  it("paper worker and live CLI construct the Execution V2 path", () => {
    const paper = readFileSync(
      resolve(process.cwd(), "lib/trader/paper/build-worker-deps.ts"),
      "utf8",
    );
    const live = readFileSync(
      resolve(process.cwd(), "lib/trader/live/build-live-cli-deps.ts"),
      "utf8",
    );
    expect(paper).toContain("createOrgScopedExecutionV2OrderPath");
    expect(paper).toContain("buildPreQualificationPaperEnvelope");
    expect(paper).toContain("executionV2: orderPath.service");
    expect(paper).not.toContain("assertExecutionV2LiveAuthorized");
    expect(live).toContain("createOrgScopedExecutionV2OrderPath");
    expect(live).toContain("assertExecutionV2LiveAuthorized");
    expect(live).toContain("executionV2: orderPath.service");
    expect(live).not.toContain("canonicalOrdinaryCapitalEnvelopeV2:");
  });

  it("refuses live submit when the authorization hook is missing, before the connector", async () => {
    const exchange = connector();
    const connectorFor = vi.fn(() => exchange);
    const path = createOrgScopedExecutionV2OrderPath({
      db: {} as WaiaPostgresDb,
      connectorFor,
    });
    await expect(
      path.service.submit(requireOrgContext(ORG), liveRequest()),
    ).rejects.toThrow("Execution V2 live path is not authorized");
    expect(connectorFor).not.toHaveBeenCalled();
    expect(exchange.placeOrder).not.toHaveBeenCalled();
  });

  it("refuses live submit when gates are absent, before the connector", async () => {
    const exchange = connector();
    const connectorFor = vi.fn(() => exchange);
    const path = createOrgScopedExecutionV2OrderPath({
      db: {} as WaiaPostgresDb,
      connectorFor,
      assertLiveAuthorized: assertExecutionV2LiveAuthorized,
    });
    await expect(
      path.service.submit(requireOrgContext(ORG), liveRequest()),
    ).rejects.toThrow("EXECUTION_V2_LIVE_GATES_ABSENT");
    expect(connectorFor).not.toHaveBeenCalled();
    expect(exchange.placeOrder).not.toHaveBeenCalled();
  });

  it("does not place an order when the default decision is unqualified", async () => {
    const exchange = connector();
    const path = createOrgScopedExecutionV2OrderPath({
      db: {} as WaiaPostgresDb,
      connectorFor: () => exchange,
    });
    const forecast = {
      status: "FORECAST_AUTHORIZED",
      authority: { organizationId: ORG, contentDigestHex: "a".repeat(64) },
      issuance: { package: { family: { symbol: "BTCUSDT" } } },
    } as unknown as ForecastRuntimeOutcomeV2;
    const result = await runDecisionCapitalAuthorityV2(path.decisionCapitalAuthorityV2, {
      organizationId: ORG,
      accountId: "account-1",
      cycleId: "cycle-1",
      symbol: "BTCUSDT",
      referencePrice: "50000",
      executionMode: "paper",
      forecastOutcome: forecast,
      proposal: { action: "ENTER_LONG", quantity: "0.01", strategySignalId: null },
    });
    expect(result).toMatchObject({
      status: "NO_TRADE",
      stage: "DECISION",
      reasonCodes: ["EXECUTION_V2_DECISION_NOT_QUALIFIED"],
    });
    expect(exchange.placeOrder).not.toHaveBeenCalled();
    await expect(path.decisionCapitalAuthorityV2.execute({} as never)).rejects.toThrow(
      "EXECUTION_V2_ADMISSION_INPUTS_INCOMPLETE",
    );
    await expect(path.decisionCapitalAuthorityV2.assessRisk({} as never)).rejects.toThrow(
      "EXECUTION_V2_RISK_STAGE_UNREACHABLE",
    );
  });
});
