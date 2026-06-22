import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { auditLogs, traderMiHypothesisLifecycle } from "@/db/schema";
import {
  MiHypothesisLifecycleAuthorizationError,
  MiHypothesisLifecycleError,
  MiHypothesisNotFoundError,
} from "@/lib/trader/mi/errors";
import { createSqliteMiHypothesisService } from "@/lib/trader/mi/hypothesis-service";
import {
  miHypothesisLifecycleStateValues,
  type HypothesisDefinition,
  type HypothesisMeasurementRef,
  type HypothesisPatternRef,
  type MiHypothesisLifecycleState,
} from "@/lib/trader/mi/hypothesis.types";
import { createSqliteMiMeasurementService } from "@/lib/trader/mi/measurement-service";
import { createSqliteMiPatternService } from "@/lib/trader/mi/pattern-service";
import {
  buildLifecycleContentDigest,
  HYPOTHESIS_LIFECYCLE_TRANSITIONS,
  isAllowedHypothesisTransition,
} from "@/lib/trader/mi/serialize-hypothesis";
import { traderAuditActions, traderEntityTypes } from "@/lib/trader/types";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_ID = "00000000-0000-4000-8000-00000000a286";

const ALLOWED_EDGES: Array<[MiHypothesisLifecycleState, MiHypothesisLifecycleState]> = [
  ["PROPOSED", "VALIDATING"],
  ["VALIDATING", "VALIDATED"],
  ["VALIDATING", "QUARANTINED"],
  ["VALIDATED", "DECAYING"],
  ["VALIDATED", "QUARANTINED"],
  ["DECAYING", "VALIDATED"],
  ["DECAYING", "RETIRED"],
];

describe("trader mi hypothesis lifecycle (DEE-286 / LD-5a.1b)", () => {
  let organizationId: string;
  let measurementRef: HypothesisMeasurementRef;
  let patternRef: HypothesisPatternRef;

  beforeAll(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-mi-hypothesis-lifecycle-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "mi-hypothesis-lifecycle.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_ID,
      email: "mi-hypothesis-lifecycle@waia.invalid",
      password: "password123",
      identityLabel: "MI Hypothesis Lifecycle User",
    });
    organizationId = ensureUserCoreSeedSqlite(db, {
      userId: USER_ID,
      displayName: "MI Hypothesis Lifecycle User",
    });

    const measurement = createSqliteMiMeasurementService(db).measurement;
    const registeredMeasurement = await measurement.registerMeasurement(
      { organizationId },
      {
        measurementKind: "feature_transform",
        name: "sma20",
        definition: {
          inputs: { observationKinds: ["msv_envelope"] },
          outputType: "decimal",
          params: { window: 20 },
        },
        authoredBy: USER_ID,
      },
    );
    measurementRef = {
      measurementKey: registeredMeasurement.measurementKey,
      measurementDefinitionDigest: registeredMeasurement.definitionDigest,
    };

    const pattern = createSqliteMiPatternService(db).pattern;
    const registeredPattern = await pattern.registerPattern(
      { organizationId },
      {
        patternKind: "recurring_structure",
        name: "hh_cluster",
        definition: {
          measurements: [
            {
              measurementKey: registeredMeasurement.measurementKey,
              measurementDefinitionDigest: registeredMeasurement.definitionDigest,
            },
          ],
          recurrence: { description: "higher-highs cluster", params: { window: 20 } },
        },
        trialBudgetMax: 5,
        authoredBy: USER_ID,
      },
    );
    patternRef = {
      patternKey: registeredPattern.patternKey,
      patternDefinitionDigest: registeredPattern.definitionDigest,
    };
  });

  function buildDefinition(overrides?: Partial<HypothesisDefinition>): HypothesisDefinition {
    return {
      claimShape: {
        relationshipType: "predictive",
        isDirectional: true,
        isTrendEdge: false,
        isTimingEdge: false,
      },
      prior: { ordinal: "moderate", band: "wide" },
      falsificationConditions: ["hit rate below buy-and-hold over evaluation window"],
      requiredNulls: ["always-flat-cash", "buy-and-hold"],
      patternRefs: [patternRef],
      measurementRefs: [measurementRef],
      regimeScope: { description: "BTC-USD 1h trending regimes" },
      ...overrides,
    };
  }

  function createService() {
    const db = getDb();
    return createSqliteMiHypothesisService(db, { actorType: "user", actorId: USER_ID });
  }

  async function registerHypothesis(name: string) {
    const { hypothesis } = createService();
    const registered = await hypothesis.registerHypothesis(
      { organizationId },
      {
        hypothesisKind: "market_claim",
        name,
        definition: buildDefinition({ prior: { ordinal: name, band: "wide" } }),
        authoredBy: USER_ID,
      },
    );
    return registered;
  }

  async function transitionTo(
    hypothesisKey: string,
    toState: MiHypothesisLifecycleState,
    rationale: string,
  ) {
    const { hypothesis } = createService();
    return hypothesis.transitionHypothesisLifecycle(
      { organizationId },
      {
        hypothesisKey,
        toState,
        rationale,
        recordedBy: USER_ID,
        actorType: "user",
        actorId: USER_ID,
      },
    );
  }

  it("lifecycle vocabulary exposes exactly six doctrine states", () => {
    expect([...miHypothesisLifecycleStateValues].sort()).toEqual(
      ["DECAYING", "PROPOSED", "QUARANTINED", "RETIRED", "VALIDATED", "VALIDATING"].sort(),
    );
  });

  it("frozen transition matrix matches doctrine §7", () => {
    expect(HYPOTHESIS_LIFECYCLE_TRANSITIONS.PROPOSED).toEqual(["VALIDATING"]);
    expect(HYPOTHESIS_LIFECYCLE_TRANSITIONS.VALIDATING).toEqual(["VALIDATED", "QUARANTINED"]);
    expect(HYPOTHESIS_LIFECYCLE_TRANSITIONS.VALIDATED).toEqual(["DECAYING", "QUARANTINED"]);
    expect(HYPOTHESIS_LIFECYCLE_TRANSITIONS.DECAYING).toEqual(["VALIDATED", "RETIRED"]);
    expect(HYPOTHESIS_LIFECYCLE_TRANSITIONS.RETIRED).toEqual([]);
    expect(HYPOTHESIS_LIFECYCLE_TRANSITIONS.QUARANTINED).toEqual([]);
    for (const [from, to] of ALLOWED_EDGES) {
      expect(isAllowedHypothesisTransition(from, to)).toBe(true);
    }
  });

  it.each(ALLOWED_EDGES)(
    "allows transition %s → %s and appends seq+1",
    async (fromState, toState) => {
      const registered = await registerHypothesis(`edge_${fromState}_${toState}`);
      const { hypothesis } = createService();

      if (fromState !== "PROPOSED") {
        await transitionTo(registered.hypothesisKey, "VALIDATING", "seal pre-registration");
      }
      if (fromState === "VALIDATED" || fromState === "DECAYING") {
        await transitionTo(registered.hypothesisKey, "VALIDATED", "human promotes");
      }
      if (fromState === "DECAYING") {
        await transitionTo(registered.hypothesisKey, "DECAYING", "staleness recorded");
      }

      const historyBefore = await hypothesis.listLifecycleEvents(
        { organizationId },
        registered.hypothesisKey,
      );
      const event = await transitionTo(
        registered.hypothesisKey,
        toState,
        `transition ${fromState} to ${toState}`,
      );

      expect(event.lifecycleState).toBe(toState);
      expect(event.seq).toBe(historyBefore.length + 1);
      expect(
        await hypothesis.getCurrentLifecycleState({ organizationId }, registered.hypothesisKey),
      ).toBe(toState);
    },
  );

  it("rejects forbidden transitions without mutating the ledger", async () => {
    const { hypothesis } = createService();

    const cases: Array<{
      name: string;
      setup: (key: string) => Promise<void>;
      to: MiHypothesisLifecycleState;
    }> = [
      {
        name: "proposed_to_validated",
        setup: async () => {},
        to: "VALIDATED",
      },
      {
        name: "proposed_to_retired",
        setup: async () => {},
        to: "RETIRED",
      },
      {
        name: "validating_to_decaying",
        setup: async (key) => {
          await transitionTo(key, "VALIDATING", "setup validating");
        },
        to: "DECAYING",
      },
      {
        name: "decaying_to_quarantined",
        setup: async (key) => {
          await transitionTo(key, "VALIDATING", "setup validating");
          await transitionTo(key, "VALIDATED", "setup validated");
          await transitionTo(key, "DECAYING", "setup decaying");
        },
        to: "QUARANTINED",
      },
    ];

    for (const testCase of cases) {
      const registered = await registerHypothesis(testCase.name);
      await testCase.setup(registered.hypothesisKey);

      const lenBefore = (
        await hypothesis.listLifecycleEvents({ organizationId }, registered.hypothesisKey)
      ).length;

      await expect(
        transitionTo(registered.hypothesisKey, testCase.to, `forbidden to ${testCase.to}`),
      ).rejects.toThrow(MiHypothesisLifecycleError);

      const lenAfter = (
        await hypothesis.listLifecycleEvents({ organizationId }, registered.hypothesisKey)
      ).length;
      expect(lenAfter).toBe(lenBefore);
    }
  });

  it("rejects transitions out of terminal states", async () => {
    const retired = await registerHypothesis("terminal_retired");
    await transitionTo(retired.hypothesisKey, "VALIDATING", "to validating");
    await transitionTo(retired.hypothesisKey, "VALIDATED", "promote");
    await transitionTo(retired.hypothesisKey, "DECAYING", "decay");
    await transitionTo(retired.hypothesisKey, "RETIRED", "retire");

    await expect(
      transitionTo(retired.hypothesisKey, "VALIDATED", "illegal from retired"),
    ).rejects.toThrow(MiHypothesisLifecycleError);

    const quarantined = await registerHypothesis("terminal_quarantined");
    await transitionTo(quarantined.hypothesisKey, "VALIDATING", "to validating");
    await transitionTo(quarantined.hypothesisKey, "QUARANTINED", "integrity break");

    await expect(
      transitionTo(quarantined.hypothesisKey, "VALIDATED", "illegal from quarantined"),
    ).rejects.toThrow(MiHypothesisLifecycleError);
  });

  it("rejects same-state no-op transitions", async () => {
    const registered = await registerHypothesis("same_state");
    await expect(transitionTo(registered.hypothesisKey, "PROPOSED", "no-op")).rejects.toThrow(
      MiHypothesisLifecycleError,
    );
  });

  it("rejects non-human actors and empty recordedBy", async () => {
    const registered = await registerHypothesis("authz_probe");
    const { hypothesis } = createService();

    for (const actorType of ["service", "system", "agent"] as const) {
      await expect(
        hypothesis.transitionHypothesisLifecycle(
          { organizationId },
          {
            hypothesisKey: registered.hypothesisKey,
            toState: "VALIDATING",
            rationale: "machine attempt",
            recordedBy: USER_ID,
            actorType,
          },
        ),
      ).rejects.toThrow(MiHypothesisLifecycleAuthorizationError);
    }

    await expect(
      hypothesis.transitionHypothesisLifecycle(
        { organizationId },
        {
          hypothesisKey: registered.hypothesisKey,
          toState: "VALIDATING",
          rationale: "missing recorder",
          recordedBy: "   ",
          actorType: "user",
        },
      ),
    ).rejects.toThrow(MiHypothesisLifecycleAuthorizationError);

    await expect(
      createSqliteMiHypothesisService(getDb()).hypothesis.transitionHypothesisLifecycle(
        { organizationId },
        {
          hypothesisKey: registered.hypothesisKey,
          toState: "VALIDATING",
          rationale: "no actor type",
          recordedBy: USER_ID,
        },
      ),
    ).rejects.toThrow(MiHypothesisLifecycleAuthorizationError);
  });

  it("accepts admin actor for human promotion to VALIDATED", async () => {
    const registered = await registerHypothesis("admin_promote");
    const { hypothesis } = createService();

    await hypothesis.transitionHypothesisLifecycle(
      { organizationId },
      {
        hypothesisKey: registered.hypothesisKey,
        toState: "VALIDATING",
        rationale: "sealed",
        recordedBy: USER_ID,
        actorType: "admin",
        actorId: USER_ID,
      },
    );

    await hypothesis.transitionHypothesisLifecycle(
      { organizationId },
      {
        hypothesisKey: registered.hypothesisKey,
        toState: "VALIDATED",
        rationale: "admin promotes",
        recordedBy: USER_ID,
        actorType: "admin",
        actorId: USER_ID,
      },
    );

    expect(
      await hypothesis.getCurrentLifecycleState({ organizationId }, registered.hypothesisKey),
    ).toBe("VALIDATED");
  });

  it("getHypothesisWithCurrentState returns hypothesis and derived current state", async () => {
    const registered = await registerHypothesis("derived_state");
    const { hypothesis } = createService();

    await transitionTo(registered.hypothesisKey, "VALIDATING", "sealed");

    const view = await hypothesis.getHypothesisWithCurrentState(
      { organizationId },
      registered.hypothesisKey,
    );
    expect(view?.hypothesis.id).toBe(registered.id);
    expect(view?.currentState).toBe("VALIDATING");

    const history = await hypothesis.listLifecycleEvents(
      { organizationId },
      registered.hypothesisKey,
    );
    expect(history.map((e) => e.seq)).toEqual([1, 2]);
    expect(history.map((e) => e.lifecycleState)).toEqual(["PROPOSED", "VALIDATING"]);
  });

  it("lifecycle ledger remains append-only at the DB level", async () => {
    const registered = await registerHypothesis("append_only_lifecycle");
    const db = getDb();

    expect(() =>
      db
        .update(traderMiHypothesisLifecycle)
        .set({ rationale: "tampered" })
        .where(eq(traderMiHypothesisLifecycle.hypothesisKey, registered.hypothesisKey))
        .run(),
    ).toThrow(/append-only/i);
    expect(() =>
      db
        .delete(traderMiHypothesisLifecycle)
        .where(eq(traderMiHypothesisLifecycle.hypothesisKey, registered.hypothesisKey))
        .run(),
    ).toThrow(/append-only/i);
  });

  it("rejects duplicate seq via unique index", async () => {
    const registered = await registerHypothesis("dup_seq");
    const { hypothesisRepository } = createService();
    const latest = await hypothesisRepository.getLatestLifecycleEvent(
      { organizationId },
      registered.hypothesisKey,
    );
    expect(latest).not.toBeNull();

    expect(() =>
      hypothesisRepository.insertLifecycleEvent(
        { organizationId },
        {
          id: crypto.randomUUID(),
          hypothesisId: registered.id,
          hypothesisKey: registered.hypothesisKey,
          lifecycleState: "VALIDATING",
          rationale: "duplicate seq",
          recordedBy: USER_ID,
          seq: latest!.seq,
          contentDigest: "deadbeef",
          createdAt: new Date(),
        },
      ),
    ).toThrow();
  });

  it("writes lifecycle_transitioned audit rows with from/to metadata", async () => {
    const db = getDb();
    const registered = await registerHypothesis("audit_lifecycle");
    const beforeCount = db.select({ id: auditLogs.id }).from(auditLogs).all().length;

    await transitionTo(registered.hypothesisKey, "VALIDATING", "audit transition");

    const rows = db
      .select({
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        metadataJson: auditLogs.metadataJson,
      })
      .from(auditLogs)
      .all()
      .slice(beforeCount);

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: traderAuditActions.miHypothesisLifecycleTransitioned,
          entityType: traderEntityTypes.miHypothesisLifecycle,
        }),
      ]),
    );
    const meta = JSON.parse(rows[0]!.metadataJson) as Record<string, unknown>;
    expect(meta.fromState).toBe("PROPOSED");
    expect(meta.toState).toBe("VALIDATING");
    expect(meta.seq).toBe(2);
  });

  it("lifecycle content digest is reproducible for identical inputs", () => {
    const digestA = buildLifecycleContentDigest({
      organizationId: "00000000-0000-4000-8000-00000000a286",
      hypothesisKey: "abc",
      lifecycleState: "VALIDATING",
      seq: 2,
      rationale: "sealed",
      recordedBy: USER_ID,
    });
    const digestB = buildLifecycleContentDigest({
      organizationId: "00000000-0000-4000-8000-00000000a286",
      hypothesisKey: "abc",
      lifecycleState: "VALIDATING",
      seq: 2,
      rationale: "sealed",
      recordedBy: USER_ID,
    });
    expect(digestA).toBe(digestB);
    expect(digestA).toHaveLength(64);
  });

  it("rejects transition for missing hypothesis family", async () => {
    const { hypothesis } = createService();
    await expect(
      hypothesis.transitionHypothesisLifecycle(
        { organizationId },
        {
          hypothesisKey: "nonexistent-key",
          toState: "VALIDATING",
          rationale: "missing",
          recordedBy: USER_ID,
          actorType: "user",
        },
      ),
    ).rejects.toThrow(MiHypothesisNotFoundError);
  });
});
