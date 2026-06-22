import { beforeAll, describe, expect, it } from "vitest";
import { eq, getTableColumns } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { auditLogs, traderMiPattern, traderMiPatternLifecycle } from "@/db/schema";
import {
  MiPatternDuplicateError,
  MiPatternFirewallError,
  MiPatternLifecycleError,
  MiPatternMeasurementRefError,
  MiPatternNotFoundError,
  MiPatternStructuralDuplicateError,
} from "@/lib/trader/mi/errors";
import {
  MI_PATTERN_SCHEMA_VERSION,
  type PatternDefinition,
  type PatternMeasurementRef,
} from "@/lib/trader/mi/pattern.types";
import { createSqliteMiMeasurementService } from "@/lib/trader/mi/measurement-service";
import { createSqliteMiPatternService } from "@/lib/trader/mi/pattern-service";
import {
  buildPatternDefinitionDigest,
  buildPatternStructuralSignature,
  computePatternKey,
  parsePatternDefinitionJson,
} from "@/lib/trader/mi/serialize-pattern";
import { traderAuditActions, traderEntityTypes } from "@/lib/trader/types";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_ID = "00000000-0000-4000-8000-00000000a283";

describe("trader mi pattern (DEE-283 / LD-4)", () => {
  let organizationId: string;
  let measurementRef: PatternMeasurementRef;

  beforeAll(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-mi-pattern-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "mi-pattern.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_ID,
      email: "mi-pattern@waia.invalid",
      password: "password123",
      identityLabel: "MI Pattern User",
    });
    organizationId = ensureUserCoreSeedSqlite(db, {
      userId: USER_ID,
      displayName: "MI Pattern User",
    });

    const measurement = createSqliteMiMeasurementService(db).measurement;
    const registered = await measurement.registerMeasurement(
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
      measurementKey: registered.measurementKey,
      measurementDefinitionDigest: registered.definitionDigest,
    };
  });

  function buildDefinition(overrides?: Partial<PatternDefinition>): PatternDefinition {
    return {
      measurements: [measurementRef],
      recurrence: { description: "higher-highs cluster", params: { window: 20 } },
      scope: { asset: "BTC-USD", timeframe: "1h" },
      ...overrides,
    };
  }

  function createService() {
    const db = getDb();
    return createSqliteMiPatternService(db, { actorType: "user", actorId: USER_ID }).pattern;
  }

  it("schema exposes recurring-structure fields only — no claim/value/regime/hypothesis columns", () => {
    const columns = Object.keys(getTableColumns(traderMiPattern));
    expect(columns.sort()).toEqual(
      [
        "id",
        "organizationId",
        "patternKind",
        "patternKey",
        "name",
        "schemaVersion",
        "definitionJson",
        "definitionDigest",
        "structuralSignature",
        "trialBudgetMax",
        "versionSeq",
        "revisionOf",
        "authoredBy",
        "createdAt",
      ].sort(),
    );
    for (const forbidden of [
      "value",
      "result",
      "output",
      "edge",
      "expectancy",
      "profit",
      "pnl",
      "direction",
      "side",
      "sizing",
      "regime",
      "regimeModel",
      "hypothesis",
      "prior",
      "evidence",
      "trialsUsed",
      "trialsRemaining",
      "trialRef",
    ]) {
      expect(columns).not.toContain(forbidden);
    }
  });

  it("does not expose trial-consumption mechanics on the service", () => {
    const service = createService();
    const keys = Object.keys(service);
    for (const forbidden of ["recordPatternTrial", "consumeTrial", "trial", "trials"]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("pattern_key is deterministic and independent of the definition body (P1)", () => {
    const keyA = computePatternKey({
      organizationId,
      patternKind: "recurring_structure",
      name: "p1",
    });
    const keyB = computePatternKey({
      organizationId,
      patternKind: "recurring_structure",
      name: "p1",
    });
    expect(keyA).toBe(keyB);
    expect(
      computePatternKey({ organizationId, patternKind: "recurring_structure", name: "p2" }),
    ).not.toBe(keyA);
  });

  it("definition_digest is reproducible and changes on definitional change (P6)", () => {
    const patternKey = computePatternKey({
      organizationId,
      patternKind: "recurring_structure",
      name: "p1",
    });
    const base = buildPatternDefinitionDigest({
      organizationId,
      patternKey,
      patternKind: "recurring_structure",
      name: "p1",
      definition: buildDefinition(),
    });
    expect(
      buildPatternDefinitionDigest({
        organizationId,
        patternKey,
        patternKind: "recurring_structure",
        name: "p1",
        definition: buildDefinition(),
      }),
    ).toBe(base);
    expect(
      buildPatternDefinitionDigest({
        organizationId,
        patternKey,
        patternKind: "recurring_structure",
        name: "p1",
        definition: buildDefinition({
          recurrence: { description: "higher-highs cluster", params: { window: 50 } },
        }),
      }),
    ).not.toBe(base);
  });

  it("structural_signature excludes name/key/org and detects identical structure (P1/RC-3)", () => {
    const sigA = buildPatternStructuralSignature({
      patternKind: "recurring_structure",
      definition: buildDefinition(),
    });
    const sigB = buildPatternStructuralSignature({
      patternKind: "recurring_structure",
      definition: buildDefinition(),
    });
    expect(sigA).toBe(sigB);

    // Different name → different pattern_key + definition_digest, but SAME structural_signature.
    const keyA = computePatternKey({
      organizationId,
      patternKind: "recurring_structure",
      name: "alpha",
    });
    const keyB = computePatternKey({
      organizationId,
      patternKind: "recurring_structure",
      name: "beta",
    });
    expect(keyA).not.toBe(keyB);
    const digestA = buildPatternDefinitionDigest({
      organizationId,
      patternKey: keyA,
      patternKind: "recurring_structure",
      name: "alpha",
      definition: buildDefinition(),
    });
    const digestB = buildPatternDefinitionDigest({
      organizationId,
      patternKey: keyB,
      patternKind: "recurring_structure",
      name: "beta",
      definition: buildDefinition(),
    });
    expect(digestA).not.toBe(digestB);
    expect(sigA).toBe(
      buildPatternStructuralSignature({
        patternKind: "recurring_structure",
        definition: buildDefinition(),
      }),
    );
  });

  it("registers version 1, derives ACTIVE lifecycle, and round-trips the definition", async () => {
    const pattern = createService();
    const registered = await pattern.registerPattern(
      { organizationId },
      {
        patternKind: "recurring_structure",
        name: "register_probe",
        definition: buildDefinition(),
        trialBudgetMax: 10,
        authoredBy: USER_ID,
      },
    );

    expect(registered.versionSeq).toBe(1);
    expect(registered.revisionOf).toBeNull();
    expect(registered.schemaVersion).toBe(MI_PATTERN_SCHEMA_VERSION);
    expect(registered.trialBudgetMax).toBe(10);
    expect(parsePatternDefinitionJson(registered.definitionJson)).toEqual(buildDefinition());

    const state = await pattern.getCurrentLifecycleState({ organizationId }, registered.patternKey);
    expect(state).toBe("ACTIVE");
  });

  it("appends a new version, preserves trial_budget_max, and tracks the chain", async () => {
    const pattern = createService();
    const first = await pattern.registerPattern(
      { organizationId },
      {
        patternKind: "recurring_structure",
        name: "append_probe",
        definition: buildDefinition({ recurrence: { description: "d", params: { window: 20 } } }),
        trialBudgetMax: 25,
        authoredBy: USER_ID,
      },
    );

    const second = await pattern.appendPatternVersion(
      { organizationId },
      {
        patternKey: first.patternKey,
        patternKind: "recurring_structure",
        name: "append_probe",
        definition: buildDefinition({ recurrence: { description: "d", params: { window: 50 } } }),
        authoredBy: USER_ID,
      },
    );

    expect(second.patternKey).toBe(first.patternKey);
    expect(second.versionSeq).toBe(2);
    expect(second.revisionOf).toBe(first.id);
    // RC-1: trial_budget_max is immutable advisory metadata; it is inherited, never re-supplied.
    expect(second.trialBudgetMax).toBe(25);

    const history = await pattern.getPatternHistory({ organizationId }, first.patternKey);
    expect(history.map((p) => p.versionSeq)).toEqual([1, 2]);
  });

  it("rejects re-registering an existing family", async () => {
    const pattern = createService();
    await pattern.registerPattern(
      { organizationId },
      {
        patternKind: "recurring_structure",
        name: "dup_family",
        definition: buildDefinition({
          recurrence: { description: "dup-family-structure", params: { window: 33 } },
        }),
        trialBudgetMax: 5,
        authoredBy: USER_ID,
      },
    );
    await expect(
      pattern.registerPattern(
        { organizationId },
        {
          patternKind: "recurring_structure",
          name: "dup_family",
          definition: buildDefinition({
            recurrence: { description: "dup-family-structure-v2", params: { window: 44 } },
          }),
          trialBudgetMax: 5,
          authoredBy: USER_ID,
        },
      ),
    ).rejects.toThrow(MiPatternDuplicateError);
  });

  it("rejects a structural duplicate among ACTIVE patterns, but ARCHIVED does not block re-registration", async () => {
    const pattern = createService();
    const definition = buildDefinition({
      recurrence: { description: "unique-structure-x", params: { window: 7 } },
    });

    const original = await pattern.registerPattern(
      { organizationId },
      {
        patternKind: "recurring_structure",
        name: "structure_owner",
        definition,
        trialBudgetMax: 3,
        authoredBy: USER_ID,
      },
    );

    // Same structure, different name → rejected while the original family is ACTIVE.
    await expect(
      pattern.registerPattern(
        { organizationId },
        {
          patternKind: "recurring_structure",
          name: "structure_clone",
          definition,
          trialBudgetMax: 3,
          authoredBy: USER_ID,
        },
      ),
    ).rejects.toThrow(MiPatternStructuralDuplicateError);

    // Archive the owner; re-registration of the same structure now succeeds.
    await pattern.archivePattern(
      { organizationId },
      { patternKey: original.patternKey, rationale: "superseded", recordedBy: USER_ID },
    );
    const clone = await pattern.registerPattern(
      { organizationId },
      {
        patternKind: "recurring_structure",
        name: "structure_clone",
        definition,
        trialBudgetMax: 3,
        authoredBy: USER_ID,
      },
    );
    expect(clone.structuralSignature).toBe(original.structuralSignature);
  });

  it("derives ACTIVE/ARCHIVED lifecycle from the append-only ledger (P2)", async () => {
    const pattern = createService();
    const registered = await pattern.registerPattern(
      { organizationId },
      {
        patternKind: "recurring_structure",
        name: "lifecycle_probe",
        definition: buildDefinition({ recurrence: { description: "lc", params: { window: 11 } } }),
        trialBudgetMax: 1,
        authoredBy: USER_ID,
      },
    );
    const key = registered.patternKey;

    expect(await pattern.getCurrentLifecycleState({ organizationId }, key)).toBe("ACTIVE");

    await pattern.archivePattern(
      { organizationId },
      { patternKey: key, rationale: "stale", recordedBy: USER_ID },
    );
    expect(await pattern.getCurrentLifecycleState({ organizationId }, key)).toBe("ARCHIVED");

    await pattern.reactivatePattern(
      { organizationId },
      { patternKey: key, rationale: "revisit", recordedBy: USER_ID },
    );
    expect(await pattern.getCurrentLifecycleState({ organizationId }, key)).toBe("ACTIVE");

    const events = await pattern.listLifecycleEvents({ organizationId }, key);
    expect(events.map((e) => `${e.seq}:${e.lifecycleState}`)).toEqual([
      "1:ACTIVE",
      "2:ARCHIVED",
      "3:ACTIVE",
    ]);
  });

  it("rejects archiving an already-archived pattern and reactivating an active one (P2)", async () => {
    const pattern = createService();
    const registered = await pattern.registerPattern(
      { organizationId },
      {
        patternKind: "recurring_structure",
        name: "lifecycle_guard",
        definition: buildDefinition({ recurrence: { description: "g", params: { window: 12 } } }),
        trialBudgetMax: 1,
        authoredBy: USER_ID,
      },
    );
    const key = registered.patternKey;

    await expect(
      pattern.reactivatePattern(
        { organizationId },
        { patternKey: key, rationale: "noop", recordedBy: USER_ID },
      ),
    ).rejects.toThrow(MiPatternLifecycleError);

    await pattern.archivePattern(
      { organizationId },
      { patternKey: key, rationale: "x", recordedBy: USER_ID },
    );
    await expect(
      pattern.archivePattern(
        { organizationId },
        { patternKey: key, rationale: "again", recordedBy: USER_ID },
      ),
    ).rejects.toThrow(MiPatternLifecycleError);
  });

  it("rejects a pinned measurement ref whose digest does not exist", async () => {
    const pattern = createService();
    await expect(
      pattern.registerPattern(
        { organizationId },
        {
          patternKind: "recurring_structure",
          name: "bad_pin",
          definition: buildDefinition({
            measurements: [
              {
                measurementKey: measurementRef.measurementKey,
                measurementDefinitionDigest: "deadbeef",
              },
            ],
          }),
          trialBudgetMax: 1,
          authoredBy: USER_ID,
        },
      ),
    ).rejects.toThrow(MiPatternMeasurementRefError);
  });

  it("rejects an empty pinned-measurement set", async () => {
    const pattern = createService();
    await expect(
      pattern.registerPattern(
        { organizationId },
        {
          patternKind: "recurring_structure",
          name: "no_pins",
          definition: buildDefinition({ measurements: [] }),
          trialBudgetMax: 1,
          authoredBy: USER_ID,
        },
      ),
    ).rejects.toThrow(MiPatternMeasurementRefError);
  });

  it("rejects definitions that smuggle Hypothesis/Regime-Knowledge claims (P5 firewall)", async () => {
    const pattern = createService();
    for (const forbidden of [
      { expectancy: 0.6 },
      { edge: "positive" },
      { direction: "long" },
      { regimeModel: "trend" },
      { prior: 0.1 },
    ]) {
      await expect(
        pattern.registerPattern(
          { organizationId },
          {
            patternKind: "recurring_structure",
            name: `firewall_${Object.keys(forbidden)[0]}`,
            definition: buildDefinition({
              recurrence: {
                description: "f",
                params: forbidden as unknown as Record<string, number | string | boolean>,
              },
            }),
            trialBudgetMax: 1,
            authoredBy: USER_ID,
          },
        ),
      ).rejects.toThrow(MiPatternFirewallError);
    }
  });

  it("rejects appending an identical definition and appending to a missing family", async () => {
    const pattern = createService();
    const first = await pattern.registerPattern(
      { organizationId },
      {
        patternKind: "recurring_structure",
        name: "append_guard",
        definition: buildDefinition({ recurrence: { description: "ag", params: { window: 9 } } }),
        trialBudgetMax: 1,
        authoredBy: USER_ID,
      },
    );

    await expect(
      pattern.appendPatternVersion(
        { organizationId },
        {
          patternKey: first.patternKey,
          patternKind: "recurring_structure",
          name: "append_guard",
          definition: buildDefinition({ recurrence: { description: "ag", params: { window: 9 } } }),
          authoredBy: USER_ID,
        },
      ),
    ).rejects.toThrow(MiPatternDuplicateError);

    const missingKey = computePatternKey({
      organizationId,
      patternKind: "recurring_structure",
      name: "missing_family",
    });
    await expect(
      pattern.appendPatternVersion(
        { organizationId },
        {
          patternKey: missingKey,
          patternKind: "recurring_structure",
          name: "missing_family",
          definition: buildDefinition(),
          authoredBy: USER_ID,
        },
      ),
    ).rejects.toThrow(MiPatternNotFoundError);
  });

  it("patterns and lifecycle ledger are append-only at the DB level", async () => {
    const pattern = createService();
    const registered = await pattern.registerPattern(
      { organizationId },
      {
        patternKind: "recurring_structure",
        name: "append_only_probe",
        definition: buildDefinition({ recurrence: { description: "ao", params: { window: 8 } } }),
        trialBudgetMax: 1,
        authoredBy: USER_ID,
      },
    );

    const db = getDb();
    expect(() =>
      db
        .update(traderMiPattern)
        .set({ definitionJson: "tampered" })
        .where(eq(traderMiPattern.id, registered.id))
        .run(),
    ).toThrow(/append-only/i);
    expect(() =>
      db.delete(traderMiPattern).where(eq(traderMiPattern.id, registered.id)).run(),
    ).toThrow(/append-only/i);
    expect(() =>
      db
        .update(traderMiPatternLifecycle)
        .set({ rationale: "tampered" })
        .where(eq(traderMiPatternLifecycle.patternKey, registered.patternKey))
        .run(),
    ).toThrow(/append-only/i);
  });

  it("writes audit rows for register, revise, archive and reactivate", async () => {
    const db = getDb();
    const pattern = createService();
    const beforeCount = db.select({ id: auditLogs.id }).from(auditLogs).all().length;

    const first = await pattern.registerPattern(
      { organizationId },
      {
        patternKind: "recurring_structure",
        name: "audit_probe",
        definition: buildDefinition({ recurrence: { description: "ap", params: { window: 6 } } }),
        trialBudgetMax: 1,
        authoredBy: USER_ID,
      },
    );
    await pattern.appendPatternVersion(
      { organizationId },
      {
        patternKey: first.patternKey,
        patternKind: "recurring_structure",
        name: "audit_probe",
        definition: buildDefinition({ recurrence: { description: "ap", params: { window: 16 } } }),
        authoredBy: USER_ID,
      },
    );
    await pattern.archivePattern(
      { organizationId },
      { patternKey: first.patternKey, rationale: "x", recordedBy: USER_ID },
    );
    await pattern.reactivatePattern(
      { organizationId },
      { patternKey: first.patternKey, rationale: "y", recordedBy: USER_ID },
    );

    const rows = db
      .select({ action: auditLogs.action, entityType: auditLogs.entityType })
      .from(auditLogs)
      .all()
      .slice(beforeCount);

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: traderAuditActions.miPatternRegistered,
          entityType: traderEntityTypes.miPattern,
        }),
        expect.objectContaining({
          action: traderAuditActions.miPatternRevised,
          entityType: traderEntityTypes.miPattern,
        }),
        expect.objectContaining({
          action: traderAuditActions.miPatternArchived,
          entityType: traderEntityTypes.miPatternLifecycle,
        }),
        expect.objectContaining({
          action: traderAuditActions.miPatternReactivated,
          entityType: traderEntityTypes.miPatternLifecycle,
        }),
      ]),
    );
  });
});
