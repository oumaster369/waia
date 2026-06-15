import { beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { auditLogs, traderKillSwitches } from "@/db/schema";
import {
  dedupeTriggerSignals,
  mapOutcomeToTriggerSignals,
  processReconciliationEscalation,
  type OrderReconciliationOutcome,
  type ReconciliationReport,
} from "@/lib/trader/execution";
import {
  createSqliteAutomaticTriggerDispatcher,
  triggerSignalToSwitchPlan,
} from "@/lib/trader/risk/kill-switch";
import { traderAuditActions } from "@/lib/trader/types";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "00000000-0000-4000-8000-0000000251a";
const NOW = Date.UTC(2026, 5, 15, 12, 0, 0);

function baseOutcome(
  classification: OrderReconciliationOutcome["classification"],
  overrides: Partial<OrderReconciliationOutcome> = {},
): OrderReconciliationOutcome {
  return {
    clientOrderId: "client-1",
    classification,
    recordedFills: [],
    markedReconciliationRequired: false,
    ...overrides,
  };
}

function emptyReport(
  organizationId: string,
  outcomes: OrderReconciliationOutcome[],
): ReconciliationReport {
  const counts = {
    IN_SYNC: 0,
    VENUE_ACKED: 0,
    FILL_PROGRESS: 0,
    VENUE_TERMINALIZED: 0,
    NOT_FOUND_AT_VENUE: 0,
    UNKNOWN_POSITION: 0,
    AMBIGUOUS_STALE: 0,
    TERMINAL_DRIFT: 0,
    SKIPPED_CONFLICT: 0,
  };
  for (const outcome of outcomes) {
    counts[outcome.classification] += 1;
  }
  return {
    organizationId,
    runStartedAt: new Date(NOW),
    outcomes,
    counts,
  };
}

describe("trader order reconciliation escalation (DEE-251)", () => {
  let orgA: string;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-order-recon-escalation-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "order-recon-escalation.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "order-recon-escalation-a@waia.invalid",
      password: "password123",
      identityLabel: "Order Recon Escalation Org A",
    });

    orgA = ensureUserCoreSeedSqlite(db, {
      userId: USER_A,
      displayName: "Order Recon Escalation Org A",
    });
  });

  describe("mapOutcomeToTriggerSignals", () => {
    it("returns no signals for benign classifications", () => {
      const benign: OrderReconciliationOutcome["classification"][] = [
        "IN_SYNC",
        "VENUE_ACKED",
        "FILL_PROGRESS",
        "VENUE_TERMINALIZED",
        "SKIPPED_CONFLICT",
      ];

      for (const classification of benign) {
        expect(mapOutcomeToTriggerSignals(baseOutcome(classification), orgA)).toEqual([]);
      }
    });

    it("maps NOT_FOUND_AT_VENUE to RECON_MISMATCH mismatch signal", () => {
      const signals = mapOutcomeToTriggerSignals(baseOutcome("NOT_FOUND_AT_VENUE"), orgA);
      expect(signals).toHaveLength(1);
      expect(triggerSignalToSwitchPlan(signals[0]!).switchType).toBe("RECON_MISMATCH");
      expect(signals[0]).toMatchObject({ category: "mismatch" });
    });

    it("maps UNKNOWN_POSITION to UNKNOWN_POSITION anomaly signal", () => {
      const signals = mapOutcomeToTriggerSignals(baseOutcome("UNKNOWN_POSITION"), orgA);
      expect(triggerSignalToSwitchPlan(signals[0]!).switchType).toBe("UNKNOWN_POSITION");
      expect(signals[0]).toMatchObject({
        category: "anomaly",
        anomalyType: "UNKNOWN_POSITION",
      });
    });

    it("maps AMBIGUOUS_STALE to STALE_STATE anomaly signal", () => {
      const signals = mapOutcomeToTriggerSignals(baseOutcome("AMBIGUOUS_STALE"), orgA);
      expect(triggerSignalToSwitchPlan(signals[0]!).switchType).toBe("STALE_STATE");
      expect(signals[0]).toMatchObject({
        category: "anomaly",
        anomalyType: "STALE_STATE",
      });
    });

    it("maps TERMINAL_DRIFT + phantom_open to UNKNOWN_POSITION", () => {
      const signals = mapOutcomeToTriggerSignals(
        baseOutcome("TERMINAL_DRIFT", { escalationKind: "phantom_open" }),
        orgA,
      );
      expect(triggerSignalToSwitchPlan(signals[0]!).switchType).toBe("UNKNOWN_POSITION");
    });

    it("maps TERMINAL_DRIFT + terminal_fact_drift to RECON_MISMATCH", () => {
      const signals = mapOutcomeToTriggerSignals(
        baseOutcome("TERMINAL_DRIFT", { escalationKind: "terminal_fact_drift" }),
        orgA,
      );
      expect(triggerSignalToSwitchPlan(signals[0]!).switchType).toBe("RECON_MISMATCH");
    });

    it("fail-closes TERMINAL_DRIFT without escalationKind to RECON_MISMATCH", () => {
      const signals = mapOutcomeToTriggerSignals(baseOutcome("TERMINAL_DRIFT"), orgA);
      expect(triggerSignalToSwitchPlan(signals[0]!).switchType).toBe("RECON_MISMATCH");
    });
  });

  describe("dedupeTriggerSignals", () => {
    it("dedupes identical switch types for the same org", () => {
      const target = { scopeType: "organization" as const, organizationId: orgA };
      const signals = dedupeTriggerSignals([
        { category: "mismatch", target },
        { category: "mismatch", target },
        { category: "anomaly", anomalyType: "UNKNOWN_POSITION", target },
      ]);
      expect(signals).toHaveLength(2);
    });
  });

  describe("processReconciliationEscalation", () => {
    it("activates kill switches via trigger port with origin automatic", async () => {
      const db = getDb();
      const dispatcher = createSqliteAutomaticTriggerDispatcher(db);
      const activateSpy = vi.spyOn(dispatcher, "activate");

      const report = emptyReport(orgA, [
        baseOutcome("NOT_FOUND_AT_VENUE", { clientOrderId: "missing-1" }),
        baseOutcome("NOT_FOUND_AT_VENUE", { clientOrderId: "missing-2" }),
      ]);

      const escalation = await processReconciliationEscalation(
        requireOrgContext(orgA),
        report,
        dispatcher,
      );

      expect(escalation.escalationsAttempted).toBe(1);
      expect(activateSpy).toHaveBeenCalledTimes(1);
      expect(escalation.outcomes[0]?.status).toBe("tripped");
      expect(escalation.outcomes[0]?.switchType).toBe("RECON_MISMATCH");

      const tripped = escalation.outcomes[0];
      if (tripped?.status !== "tripped") {
        return;
      }

      const row = db
        .select()
        .from(traderKillSwitches)
        .where(
          and(
            eq(traderKillSwitches.organizationId, orgA),
            eq(traderKillSwitches.switchType, "RECON_MISMATCH"),
          ),
        )
        .all()[0];

      expect(row?.state).toBe("ACTIVE");
      expect(row?.origin).toBe("automatic");

      const audit = db.select().from(auditLogs).where(eq(auditLogs.id, tripped.auditId)).all()[0];
      expect(audit?.action).toBe(traderAuditActions.killSwitchTripped);
    });

    it("returns already_active without duplicate trip audit on second escalation", async () => {
      const db = getDb();
      const dispatcher = createSqliteAutomaticTriggerDispatcher(db);
      const report = emptyReport(orgA, [baseOutcome("AMBIGUOUS_STALE")]);

      const first = await processReconciliationEscalation(
        requireOrgContext(orgA),
        report,
        dispatcher,
      );
      expect(first.outcomes[0]?.status).toBe("tripped");
      expect(first.outcomes[0]?.switchType).toBe("STALE_STATE");

      const auditsAfterFirst = db.select().from(auditLogs).all().length;

      const second = await processReconciliationEscalation(
        requireOrgContext(orgA),
        report,
        dispatcher,
      );
      expect(second.outcomes[0]?.status).toBe("already_active");
      expect(db.select().from(auditLogs).all().length).toBe(auditsAfterFirst);
    });

    it("does not activate for benign-only report", async () => {
      const dispatcher = createSqliteAutomaticTriggerDispatcher(getDb());
      const activateSpy = vi.spyOn(dispatcher, "activate");

      const escalation = await processReconciliationEscalation(
        requireOrgContext(orgA),
        emptyReport(orgA, [baseOutcome("IN_SYNC"), baseOutcome("SKIPPED_CONFLICT")]),
        dispatcher,
      );

      expect(escalation.escalationsAttempted).toBe(0);
      expect(activateSpy).not.toHaveBeenCalled();
    });

    it("rejects org context mismatch with report organizationId", async () => {
      const dispatcher = createSqliteAutomaticTriggerDispatcher(getDb());
      const otherOrg = "00000000-0000-4000-8000-0000000999";

      await expect(
        processReconciliationEscalation(
          requireOrgContext(otherOrg),
          emptyReport(orgA, [baseOutcome("NOT_FOUND_AT_VENUE")]),
          dispatcher,
        ),
      ).rejects.toThrow(/org mismatch/i);
    });
  });

  it("S5 escalation mapper does not reference connector status string literals", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "lib/trader/execution/reconciliation-escalation.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/"open"/);
    expect(source).not.toMatch(/"partially_filled"/);
    expect(source).not.toMatch(/connectorStatus/);
  });
});
