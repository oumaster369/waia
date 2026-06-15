import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { PlaceOrderInput } from "@/lib/trader/connectors/types";
import { getDb } from "@/db/client";
import type { AccountRiskState } from "@/lib/trader/risk/capital-limits.types";
import { DEFAULT_ORG_RISK_LIMITS } from "@/lib/trader/risk/limits/defaults";
import { createSqliteRiskLimitsService } from "@/lib/trader/risk/limits/limits-service";
import { engineReasonCodes } from "@/lib/trader/risk/reason-codes";
import { createSqliteRiskEngineService } from "@/lib/trader/risk/risk-engine-service";
import { OrgScopeError, requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "00000000-0000-4000-8000-00000000a241";
const USER_B = "00000000-0000-4000-8000-00000000b241";

const EMPTY_STATE: AccountRiskState = {
  positions: [],
  openOrderCount: 0,
  dailyPnl: "0",
  drawdown: "0",
  quoteExposureByCurrency: {},
};

function order(overrides: Partial<PlaceOrderInput> = {}): PlaceOrderInput {
  return {
    clientOrderId: "coid-iso",
    symbol: "BTC/USDT",
    side: "buy",
    type: "limit",
    price: "100",
    quantity: "0.5",
    ...overrides,
  };
}

describe("risk engine tenant isolation (DEE-241 / ADR-0007)", () => {
  let orgA: string;
  let orgB: string;

  beforeAll(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-risk-engine-iso-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "risk-engine-isolation.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "risk-engine-iso-a@waia.invalid",
      password: "password123",
      identityLabel: "Risk Engine Org A",
    });
    insertEmailPasswordUser(db, {
      id: USER_B,
      email: "risk-engine-iso-b@waia.invalid",
      password: "password123",
      identityLabel: "Risk Engine Org B",
    });

    orgA = ensureUserCoreSeedSqlite(db, { userId: USER_A, displayName: "Risk Engine Org A" });
    orgB = ensureUserCoreSeedSqlite(db, { userId: USER_B, displayName: "Risk Engine Org B" });

    // Only org A is configured; org B intentionally left without limits.
    const limits = createSqliteRiskLimitsService(db);
    await limits.upsertLimitsForOrg(requireOrgContext(orgA), {
      ...DEFAULT_ORG_RISK_LIMITS,
      maxNotional: "10",
    });
  });

  it("org B (no limits) fails closed and cannot borrow org A config", async () => {
    const db = getDb();
    const engine = createSqliteRiskEngineService(db);

    const result = await engine.evaluateOrderRequest({
      context: requireOrgContext(orgB),
      order: order(),
      referencePrice: "100",
      accountKey: "acct-b",
      accountState: EMPTY_STATE,
    });

    expect(result.decision.outcome).toBe("REJECT");
    expect(result.decision.reasonCodes).toEqual([engineReasonCodes.limitsNotConfigured]);
    expect(result.configVersion).toBeNull();
  });

  it("each org evaluates against its own limit profile", async () => {
    const db = getDb();
    const engine = createSqliteRiskEngineService(db);

    // Configure org B with a generous notional cap distinct from org A.
    const limits = createSqliteRiskLimitsService(db);
    await limits.upsertLimitsForOrg(requireOrgContext(orgB), {
      ...DEFAULT_ORG_RISK_LIMITS,
      maxNotional: "100000",
    });

    // Order notional = 100 * 0.5 = 50.
    const orgAResult = await engine.evaluateOrderRequest({
      context: requireOrgContext(orgA),
      order: order(),
      referencePrice: "100",
      accountKey: "acct-a",
      accountState: EMPTY_STATE,
    });
    const orgBResult = await engine.evaluateOrderRequest({
      context: requireOrgContext(orgB),
      order: order(),
      referencePrice: "100",
      accountKey: "acct-b2",
      accountState: EMPTY_STATE,
    });

    // Org A (maxNotional 10) trims the order; org B (maxNotional 100000) approves it.
    expect(orgAResult.decision.outcome).toBe("RESIZE");
    expect(orgBResult.decision.outcome).toBe("APPROVE");
  });

  it("empty organization id throws OrgScopeError", () => {
    expect(() => requireOrgContext("")).toThrow(OrgScopeError);
  });

  it("counter telemetry lines are scoped to the evaluated organization only", async () => {
    const db = getDb();
    const telemetryLines: string[] = [];
    const engine = createSqliteRiskEngineService(db, {
      riskTelemetrySink: (line) => telemetryLines.push(line),
    });

    await engine.evaluateOrderRequest({
      context: requireOrgContext(orgA),
      order: order({ symbol: "DOGE/USDT" }),
      referencePrice: "100",
      accountKey: "acct-a-telemetry",
      accountState: EMPTY_STATE,
    });

    const counters = telemetryLines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((parsed) => parsed.kind === "counter");

    expect(counters).toHaveLength(1);
    for (const counter of counters) {
      expect(counter.organization_id).toBe(orgA);
      expect(JSON.stringify(counter)).not.toContain(orgB);
    }
  });
});
