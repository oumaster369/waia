import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { canDispatch } from "@/lib/trader/execution/execution-service";
import type { OrderRow } from "@/lib/trader/execution/order-repository.types";

const baseOrder: OrderRow = {
  id: "00000000-0000-4000-8000-000000024901",
  organizationId: "00000000-0000-4000-8000-000000024902",
  credentialId: null,
  venue: "mock",
  executionMode: "mock",
  symbol: "BTC/USDT",
  side: "buy",
  type: "market",
  price: null,
  quantity: "0.001",
  filledQuantity: "0",
  avgFillPrice: null,
  state: "CREATED",
  stateVersion: 1,
  exchangeOrderId: null,
  clientOrderId: "legacy-c-boundary",
  idempotencyKey: "legacy-c-boundary",
  riskDecisionId: "risk-decision-c-boundary",
  riskAllowanceId: null,
  riskAllowanceBindingDigest: null,
  strategySignalId: null,
  allocationDecisionId: null,
  createdAt: new Date("2026-08-21T00:00:00.000Z"),
  updatedAt: new Date("2026-08-21T00:00:00.000Z"),
};

describe("legacy order execution recovery boundary (DEE-669 / E651-C)", () => {
  it("permits dispatch only from the explicit RISK_APPROVED state", () => {
    expect(canDispatch({ ...baseOrder, state: "RISK_APPROVED" })).toBe(true);
    for (const state of [
      "CREATED",
      "SENT_TO_EXCHANGE",
      "ACCEPTED",
      "PARTIALLY_FILLED",
      "FILLED",
      "RECONCILIATION_REQUIRED",
      "CANCEL_REQUESTED",
      "CANCELLED",
      "REJECTED",
      "FAILED",
    ] as const) {
      expect(canDispatch({ ...baseOrder, state })).toBe(false);
    }
  });

  it("never converts connector status into a fabricated trade or fill", () => {
    const source = readFileSync(
      resolve(process.cwd(), "lib/trader/execution/execution-service.ts"),
      "utf8",
    );
    expect(source).toContain("connector_status_without_exact_trade_evidence");
    expect(source).toContain('"RECONCILIATION_REQUIRED"');
    expect(source).toContain("if (!trade)");
    expect(source).not.toMatch(/synthetic(?:Trade|Fill)|fabricated(?:Trade|Fill)/);
  });

  it("requires an exact venue trade before any legacy fill write", () => {
    const source = readFileSync(
      resolve(process.cwd(), "lib/trader/execution/execution-service.ts"),
      "utf8",
    );
    const exactTradeGuard = source.indexOf("if (!trade)");
    const fillWrite = source.indexOf("orderRepository.recordFill", exactTradeGuard);
    expect(exactTradeGuard).toBeGreaterThan(-1);
    expect(fillWrite).toBeGreaterThan(exactTradeGuard);
    expect(source.slice(exactTradeGuard, fillWrite)).toContain("connector_uncertain");
  });
});
