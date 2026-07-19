import { describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION } from "@/lib/trader/research/strategy-candidate.types";
import {
  compareWp21ZeroFillStructuralSemantics,
  createWp21ZeroFillStructuralSession,
  exportWp21ZeroFillStructuralCandidate,
  normalizeParentZeroFillSemantic,
} from "@/lib/trader/research/wp21-g2-zero-fill-structural-comparison";
import { generateWp21G2ParentSeal } from "@/lib/trader/research/wp21-g2-parent-seal-orchestrator";
import { createSqliteRiskLimitsService } from "@/lib/trader/risk/limits/limits-service";
import { DEFAULT_ORG_RISK_LIMITS } from "@/lib/trader/risk/limits/defaults";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_ID = "00000000-0000-4000-8021-0000000000p2";

describe("trader wp21 measured flag-off parity", () => {
  it("measures V1 research-path structural parity between parent and candidate worktrees", async () => {
    const parentSeal = generateWp21G2ParentSeal({ metricsSchemaVersion: "1.0.0" });
    const session = await createWp21ZeroFillStructuralSession();
    try {
      const db = getDb();
      insertEmailPasswordUser(db, {
        id: USER_ID,
        email: "wp21-measured-parity@waia.invalid",
        password: "password123",
        identityLabel: "WP21 Measured Parity",
      });
      const orgId = ensureUserCoreSeedSqlite(db, {
        userId: USER_ID,
        displayName: "WP21 Measured Parity",
      });
      const context = requireOrgContext(orgId);
      await createSqliteRiskLimitsService(db).upsertLimitsForOrg(context, {
        ...DEFAULT_ORG_RISK_LIMITS,
      });
      const candidate = await exportWp21ZeroFillStructuralCandidate({
        context,
        metricsSchemaVersion: "1.0.0",
        session,
      });
      const comparison = compareWp21ZeroFillStructuralSemantics({
        parent: {
          semanticResultDigest: parentSeal.zeroFillSemantic.semanticResultDigest,
          cycleCount: parentSeal.zeroFillSemantic.cycleCount,
          submittedOrders: parentSeal.zeroFillSemantic.submittedOrders,
          acceptedOrders: parentSeal.zeroFillSemantic.acceptedOrders,
          filledOrders: parentSeal.zeroFillSemantic.filledOrders,
          cycles: normalizeParentZeroFillSemantic({
            cycles: parentSeal.zeroFillSemantic.cycles as never[],
            metricsSchemaVersion: "1.0.0",
          }),
        },
        candidate,
      });
      expect(comparison.cycleCountMatch).toBe(true);
      expect(comparison.unexpectedSubmittedOrders).toBe(0);
      expect(comparison.unexpectedFills).toBe(0);
    } finally {
      session.cleanup();
    }
  }, 240_000);

  it("measures V2 portfolio-context structural parity between parent and candidate worktrees", async () => {
    const parentSeal = generateWp21G2ParentSeal({ metricsSchemaVersion: "2.0.0" });
    const session = await createWp21ZeroFillStructuralSession();
    try {
      const db = getDb();
      insertEmailPasswordUser(db, {
        id: `${USER_ID.slice(0, -1)}3`,
        email: "wp21-measured-parity-v2@waia.invalid",
        password: "password123",
        identityLabel: "WP21 Measured Parity V2",
      });
      const orgId = ensureUserCoreSeedSqlite(db, {
        userId: `${USER_ID.slice(0, -1)}3`,
        displayName: "WP21 Measured Parity V2",
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
      const comparison = compareWp21ZeroFillStructuralSemantics({
        parent: {
          semanticResultDigest: parentSeal.zeroFillSemantic.semanticResultDigest,
          cycleCount: parentSeal.zeroFillSemantic.cycleCount,
          submittedOrders: parentSeal.zeroFillSemantic.submittedOrders,
          acceptedOrders: parentSeal.zeroFillSemantic.acceptedOrders,
          filledOrders: parentSeal.zeroFillSemantic.filledOrders,
          cycles: normalizeParentZeroFillSemantic({
            cycles: parentSeal.zeroFillSemantic.cycles as never[],
            metricsSchemaVersion: RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION,
          }),
        },
        candidate,
      });
      expect(comparison.signalDecisionParity).toBe(true);
      expect(comparison.capitalParity).toBe(true);
      expect(comparison.allowedMetadataDifference).toBe("costAuthorityOnly");
    } finally {
      session.cleanup();
    }
  }, 240_000);
});
