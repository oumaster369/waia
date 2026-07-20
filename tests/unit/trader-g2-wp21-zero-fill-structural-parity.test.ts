import { describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION } from "@/lib/trader/research/strategy-candidate.types";
import {
  compareWp21ZeroFillStructuralSemantics,
  createWp21ZeroFillStructuralSession,
  exportWp21ZeroFillStructuralCandidate,
  normalizeParentZeroFillSemantic,
} from "@/lib/trader/research/wp21-g2-zero-fill-structural-comparison";
import {
  generateWp21G2ParentSeal,
  WP21_ZERO_FILL_CYCLE_COUNT,
} from "@/lib/trader/research/wp21-g2-parent-seal-orchestrator";
import { createSqliteRiskLimitsService } from "@/lib/trader/risk/limits/limits-service";
import { DEFAULT_ORG_RISK_LIMITS } from "@/lib/trader/risk/limits/defaults";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_ID = "00000000-0000-4000-8021-0000000000zf";

async function loadLaneAComparison() {
  const parentSeal = generateWp21G2ParentSeal();
  const session = await createWp21ZeroFillStructuralSession();
  try {
    const db = getDb();
    insertEmailPasswordUser(db, {
      id: USER_ID,
      email: "wp21-zero-fill@waia.invalid",
      password: "password123",
      identityLabel: "WP21 Zero Fill",
    });
    const orgId = ensureUserCoreSeedSqlite(db, {
      userId: USER_ID,
      displayName: "WP21 Zero Fill",
    });
    const context = requireOrgContext(orgId);
    await createSqliteRiskLimitsService(db).upsertLimitsForOrg(context, {
      ...DEFAULT_ORG_RISK_LIMITS,
    });
    const candidate = await exportWp21ZeroFillStructuralCandidate({
      context,
      metricsSchemaVersion: RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION,
      session,
    });
    const parentCycles = normalizeParentZeroFillSemantic({
      cycles: parentSeal.zeroFillSemantic.cycles as Array<{
        cycleIndex: number;
        timestamp: string;
        cycleId: string;
        strategyId: string;
        signalIdentity: string | null;
        strategyDecision: {
          decisionChainDigest: string;
          signalCount: number;
          primarySignalId: string | null;
        };
        tradingPermission: string;
        riskOutcome: string;
        orderIntentPresent: boolean;
        positionState: { openPositionCount: number; symbols: string[] };
        accountGrossState: { equity: string; equityHwm: string; cash: string | null };
        guardianDecision: string | null;
        guardianReason: string | null;
        noFillCapitalState: {
          startingBalanceUsdt: string;
          endingBalanceUsdt: string;
          realizedPnl: string;
          unrealizedPnl: string;
        };
      }>,
      metricsSchemaVersion: parentSeal.zeroFillSemantic.metricsSchemaVersion,
    });
    return compareWp21ZeroFillStructuralSemantics({
      parent: {
        semanticResultDigest: parentSeal.zeroFillSemantic.semanticResultDigest,
        cycleCount: parentSeal.zeroFillSemantic.cycleCount,
        submittedOrders: parentSeal.zeroFillSemantic.submittedOrders,
        acceptedOrders: parentSeal.zeroFillSemantic.acceptedOrders,
        filledOrders: parentSeal.zeroFillSemantic.filledOrders,
        cycles: parentCycles,
      },
      candidate,
    });
  } finally {
    session.cleanup();
  }
}

describe("trader g2 wp21 zero-fill structural parity", () => {
  it("matches parent and candidate cycle count exactly", async () => {
    const parentSeal = generateWp21G2ParentSeal();
    expect(parentSeal.zeroFillSemantic.cycleCount).toBe(WP21_ZERO_FILL_CYCLE_COUNT);
  }, 240_000);

  it("matches signal and decision projection parity", async () => {
    const comparison = await loadLaneAComparison();
    expect(comparison.signalDecisionParity).toBe(true);
  }, 480_000);

  it("matches trading permission parity", async () => {
    const comparison = await loadLaneAComparison();
    expect(comparison.permissionParity).toBe(true);
  }, 480_000);

  it("matches risk outcome parity", async () => {
    const comparison = await loadLaneAComparison();
    expect(comparison.riskOutcomeParity).toBe(true);
  }, 480_000);

  it("requires zero submitted orders on both lanes", async () => {
    const comparison = await loadLaneAComparison();
    expect(comparison.unexpectedSubmittedOrders).toBe(0);
  }, 480_000);

  it("requires zero fills on both lanes", async () => {
    const comparison = await loadLaneAComparison();
    expect(comparison.unexpectedFills).toBe(0);
  }, 480_000);

  it("matches no-fill capital state parity", async () => {
    const comparison = await loadLaneAComparison();
    expect(comparison.capitalParity).toBe(true);
  }, 480_000);

  it("permits cost-authority metadata difference only", async () => {
    const comparison = await loadLaneAComparison();
    expect(comparison.allowedMetadataDifference).toBe("costAuthorityOnly");
    expect(comparison.cycleCountMatch).toBe(true);
  }, 480_000);
});
