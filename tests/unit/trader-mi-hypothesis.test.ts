import { beforeAll, describe, expect, it } from "vitest";
import { eq, getTableColumns } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { auditLogs, traderMiHypothesis, traderMiHypothesisLifecycle } from "@/db/schema";
import {
  MiHypothesisDuplicateError,
  MiHypothesisFirewallError,
  MiHypothesisInputValidationError,
  MiHypothesisNotFoundError,
  MiHypothesisRefError,
  MiHypothesisSupersedesError,
} from "@/lib/trader/mi/errors";
import { createSqliteMiHypothesisService } from "@/lib/trader/mi/hypothesis-service";
import {
  MI_HYPOTHESIS_SCHEMA_VERSION,
  type HypothesisDefinition,
  type HypothesisMeasurementRef,
  type HypothesisPatternRef,
} from "@/lib/trader/mi/hypothesis.types";
import { createSqliteMiMeasurementService } from "@/lib/trader/mi/measurement-service";
import { createSqliteMiPatternService } from "@/lib/trader/mi/pattern-service";
import {
  buildHypothesisDefinitionDigest,
  computeHypothesisKey,
  deriveMandatoryNullFloor,
  parseHypothesisDefinitionJson,
} from "@/lib/trader/mi/serialize-hypothesis";
import { traderAuditActions, traderEntityTypes } from "@/lib/trader/types";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_ID = "00000000-0000-4000-8000-00000000a285";

describe("trader mi hypothesis (DEE-285 / LD-5a.1a)", () => {
  let organizationId: string;
  let measurementRef: HypothesisMeasurementRef;
  let patternRef: HypothesisPatternRef;

  beforeAll(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-mi-hypothesis-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "mi-hypothesis.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_ID,
      email: "mi-hypothesis@waia.invalid",
      password: "password123",
      identityLabel: "MI Hypothesis User",
    });
    organizationId = ensureUserCoreSeedSqlite(db, {
      userId: USER_ID,
      displayName: "MI Hypothesis User",
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
    return createSqliteMiHypothesisService(db, { actorType: "user", actorId: USER_ID }).hypothesis;
  }

  it("schema exposes hypothesis claim fields only — no structural_signature or trial_budget_max", () => {
    const columns = Object.keys(getTableColumns(traderMiHypothesis));
    expect(columns.sort()).toEqual(
      [
        "id",
        "organizationId",
        "hypothesisKind",
        "hypothesisKey",
        "name",
        "schemaVersion",
        "definitionJson",
        "definitionDigest",
        "supersedesJson",
        "versionSeq",
        "revisionOf",
        "authoredBy",
        "createdAt",
      ].sort(),
    );
    for (const forbidden of [
      "structuralSignature",
      "trialBudgetMax",
      "confidence",
      "evidence",
      "trial",
    ]) {
      expect(columns).not.toContain(forbidden);
    }
  });

  it("does not expose evidence/confidence/trial methods on the service", () => {
    const service = createService();
    const keys = Object.keys(service);
    for (const forbidden of [
      "recordEvidence",
      "recordTrial",
      "recordConfidence",
      "confidence",
      "evidence",
      "trial",
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("hypothesis_key is deterministic and independent of the definition body", () => {
    const keyA = computeHypothesisKey({
      organizationId,
      hypothesisKind: "market_claim",
      name: "h1",
    });
    const keyB = computeHypothesisKey({
      organizationId,
      hypothesisKind: "market_claim",
      name: "h1",
    });
    expect(keyA).toBe(keyB);
    expect(
      computeHypothesisKey({ organizationId, hypothesisKind: "market_claim", name: "h2" }),
    ).not.toBe(keyA);
  });

  it("definition_digest is reproducible, seals claim shape, and excludes supersedes", () => {
    const hypothesisKey = computeHypothesisKey({
      organizationId,
      hypothesisKind: "market_claim",
      name: "digest_probe",
    });
    const base = buildHypothesisDefinitionDigest({
      organizationId,
      hypothesisKey,
      hypothesisKind: "market_claim",
      name: "digest_probe",
      definition: buildDefinition(),
    });
    expect(
      buildHypothesisDefinitionDigest({
        organizationId,
        hypothesisKey,
        hypothesisKind: "market_claim",
        name: "digest_probe",
        definition: buildDefinition(),
      }),
    ).toBe(base);
    expect(
      buildHypothesisDefinitionDigest({
        organizationId,
        hypothesisKey,
        hypothesisKind: "market_claim",
        name: "digest_probe",
        definition: buildDefinition({
          claimShape: {
            relationshipType: "correlational",
            isDirectional: false,
            isTrendEdge: false,
            isTimingEdge: false,
          },
          requiredNulls: ["always-flat-cash"],
        }),
      }),
    ).not.toBe(base);
  });

  it("registers version 1, appends initial PROPOSED lifecycle, and round-trips the definition", async () => {
    const hypothesis = createService();
    const registered = await hypothesis.registerHypothesis(
      { organizationId },
      {
        hypothesisKind: "market_claim",
        name: "register_probe",
        definition: buildDefinition(),
        authoredBy: USER_ID,
      },
    );

    expect(registered.versionSeq).toBe(1);
    expect(registered.revisionOf).toBeNull();
    expect(registered.schemaVersion).toBe(MI_HYPOTHESIS_SCHEMA_VERSION);
    expect(registered.supersedesJson).toBeNull();
    expect(parseHypothesisDefinitionJson(registered.definitionJson)).toEqual(buildDefinition());

    const state = await hypothesis.getCurrentLifecycleState(
      { organizationId },
      registered.hypothesisKey,
    );
    expect(state).toBe("PROPOSED");
  });

  it("appends a new version and tracks the chain", async () => {
    const hypothesis = createService();
    const first = await hypothesis.registerHypothesis(
      { organizationId },
      {
        hypothesisKind: "market_claim",
        name: "append_probe",
        definition: buildDefinition({
          prior: { ordinal: "low", band: "narrow" },
        }),
        authoredBy: USER_ID,
      },
    );

    const second = await hypothesis.appendHypothesisVersion(
      { organizationId },
      {
        hypothesisKey: first.hypothesisKey,
        hypothesisKind: "market_claim",
        name: "append_probe",
        definition: buildDefinition({
          prior: { ordinal: "high", band: "narrow" },
        }),
        authoredBy: USER_ID,
      },
    );

    expect(second.hypothesisKey).toBe(first.hypothesisKey);
    expect(second.versionSeq).toBe(2);
    expect(second.revisionOf).toBe(first.id);
    expect(second.supersedesJson).toBe(first.supersedesJson);

    const history = await hypothesis.getHypothesisHistory({ organizationId }, first.hypothesisKey);
    expect(history.map((h) => h.versionSeq)).toEqual([1, 2]);
  });

  it("rejects re-registering an existing family", async () => {
    const hypothesis = createService();
    await hypothesis.registerHypothesis(
      { organizationId },
      {
        hypothesisKind: "market_claim",
        name: "dup_family",
        definition: buildDefinition({
          prior: { ordinal: "a", band: "b" },
        }),
        authoredBy: USER_ID,
      },
    );
    await expect(
      hypothesis.registerHypothesis(
        { organizationId },
        {
          hypothesisKind: "market_claim",
          name: "dup_family",
          definition: buildDefinition({
            prior: { ordinal: "c", band: "d" },
          }),
          authoredBy: USER_ID,
        },
      ),
    ).rejects.toThrow(MiHypothesisDuplicateError);
  });

  it("rejects missing prior, falsification, and under-declared requiredNulls", async () => {
    const hypothesis = createService();
    await expect(
      hypothesis.registerHypothesis(
        { organizationId },
        {
          hypothesisKind: "market_claim",
          name: "missing_prior",
          definition: buildDefinition({
            prior: { ordinal: "", band: "wide" },
          }),
          authoredBy: USER_ID,
        },
      ),
    ).rejects.toThrow(MiHypothesisInputValidationError);

    await expect(
      hypothesis.registerHypothesis(
        { organizationId },
        {
          hypothesisKind: "market_claim",
          name: "missing_falsification",
          definition: buildDefinition({ falsificationConditions: [] }),
          authoredBy: USER_ID,
        },
      ),
    ).rejects.toThrow(MiHypothesisInputValidationError);

    await expect(
      hypothesis.registerHypothesis(
        { organizationId },
        {
          hypothesisKind: "market_claim",
          name: "under_null_floor",
          definition: buildDefinition({
            requiredNulls: ["always-flat-cash"],
          }),
          authoredBy: USER_ID,
        },
      ),
    ).rejects.toThrow(MiHypothesisInputValidationError);

    await expect(
      hypothesis.registerHypothesis(
        { organizationId },
        {
          hypothesisKind: "market_claim",
          name: "bad_null_kind",
          definition: buildDefinition({
            requiredNulls: ["always-flat-cash", "buy-and-hold", "not-a-null" as never],
          }),
          authoredBy: USER_ID,
        },
      ),
    ).rejects.toThrow(MiHypothesisInputValidationError);
  });

  it("accepts requiredNulls superset of the mandatory floor", async () => {
    const hypothesis = createService();
    const floor = deriveMandatoryNullFloor({
      relationshipType: "predictive",
      isDirectional: true,
      isTrendEdge: true,
      isTimingEdge: true,
    });
    const registered = await hypothesis.registerHypothesis(
      { organizationId },
      {
        hypothesisKind: "market_claim",
        name: "null_superset",
        definition: buildDefinition({
          claimShape: {
            relationshipType: "predictive",
            isDirectional: true,
            isTrendEdge: true,
            isTimingEdge: true,
          },
          requiredNulls: floor,
        }),
        authoredBy: USER_ID,
      },
    );
    expect(registered.versionSeq).toBe(1);
  });

  it("rejects a pinned measurement ref whose digest does not exist", async () => {
    const hypothesis = createService();
    await expect(
      hypothesis.registerHypothesis(
        { organizationId },
        {
          hypothesisKind: "market_claim",
          name: "bad_measurement_pin",
          definition: buildDefinition({
            measurementRefs: [
              {
                measurementKey: measurementRef.measurementKey,
                measurementDefinitionDigest: "deadbeef",
              },
            ],
          }),
          authoredBy: USER_ID,
        },
      ),
    ).rejects.toThrow(MiHypothesisRefError);
  });

  it("rejects a pinned pattern ref whose digest does not exist", async () => {
    const hypothesis = createService();
    await expect(
      hypothesis.registerHypothesis(
        { organizationId },
        {
          hypothesisKind: "market_claim",
          name: "bad_pattern_pin",
          definition: buildDefinition({
            patternRefs: [
              {
                patternKey: patternRef.patternKey,
                patternDefinitionDigest: "deadbeef",
              },
            ],
          }),
          authoredBy: USER_ID,
        },
      ),
    ).rejects.toThrow(MiHypothesisRefError);
  });

  it("rejects definitions that smuggle forecast/edge/decision claims via the inverse firewall", async () => {
    const hypothesis = createService();
    for (const forbidden of [
      { forecast: "up" },
      { edge: "positive" },
      { confidence: 0.9 },
      { evidence: "strong" },
      { trial: 1 },
      { strategy: "mr" },
    ]) {
      await expect(
        hypothesis.registerHypothesis(
          { organizationId },
          {
            hypothesisKind: "market_claim",
            name: `firewall_${Object.keys(forbidden)[0]}`,
            definition: buildDefinition({
              regimeScope: {
                description: "scope",
                notes: JSON.stringify(forbidden),
              },
              ...(forbidden as unknown as Partial<HypothesisDefinition>),
            }),
            authoredBy: USER_ID,
          },
        ),
      ).rejects.toThrow(MiHypothesisFirewallError);
    }
  });

  it("allows prior/null/falsification keys that the pattern firewall forbids", async () => {
    const hypothesis = createService();
    const registered = await hypothesis.registerHypothesis(
      { organizationId },
      {
        hypothesisKind: "market_claim",
        name: "allowed_hypothesis_keys",
        definition: buildDefinition({
          prior: { ordinal: "strong", band: "tight" },
          falsificationConditions: ["null beats claim"],
          requiredNulls: ["always-flat-cash", "buy-and-hold"],
        }),
        authoredBy: USER_ID,
      },
    );
    expect(registered.id).toBeTruthy();
  });

  it("resolves supersedes backward-only and stores it outside the digest", async () => {
    const hypothesis = createService();
    const original = await hypothesis.registerHypothesis(
      { organizationId },
      {
        hypothesisKind: "market_claim",
        name: "supersedes_owner",
        definition: buildDefinition({ prior: { ordinal: "old", band: "wide" } }),
        authoredBy: USER_ID,
      },
    );

    const successor = await hypothesis.registerHypothesis(
      { organizationId },
      {
        hypothesisKind: "market_claim",
        name: "supersedes_successor",
        definition: buildDefinition({ prior: { ordinal: "new", band: "wide" } }),
        supersedes: [original.id],
        authoredBy: USER_ID,
      },
    );

    expect(successor.supersedesJson).toBe(JSON.stringify([original.id]));
    expect(successor.definitionDigest).not.toBe(original.definitionDigest);

    await expect(
      hypothesis.registerHypothesis(
        { organizationId },
        {
          hypothesisKind: "market_claim",
          name: "supersedes_missing",
          definition: buildDefinition({ prior: { ordinal: "x", band: "y" } }),
          supersedes: ["00000000-0000-4000-8000-00000000dead"],
          authoredBy: USER_ID,
        },
      ),
    ).rejects.toThrow(MiHypothesisSupersedesError);

    const lifecycleBefore = await hypothesis.getCurrentLifecycleState(
      { organizationId },
      original.hypothesisKey,
    );
    expect(lifecycleBefore).toBe("PROPOSED");
  });

  it("rejects appending an identical definition and appending to a missing family", async () => {
    const hypothesis = createService();
    const first = await hypothesis.registerHypothesis(
      { organizationId },
      {
        hypothesisKind: "market_claim",
        name: "append_guard",
        definition: buildDefinition({ prior: { ordinal: "a", band: "b" } }),
        authoredBy: USER_ID,
      },
    );

    await expect(
      hypothesis.appendHypothesisVersion(
        { organizationId },
        {
          hypothesisKey: first.hypothesisKey,
          hypothesisKind: "market_claim",
          name: "append_guard",
          definition: buildDefinition({ prior: { ordinal: "a", band: "b" } }),
          authoredBy: USER_ID,
        },
      ),
    ).rejects.toThrow(MiHypothesisDuplicateError);

    const missingKey = computeHypothesisKey({
      organizationId,
      hypothesisKind: "market_claim",
      name: "missing_family",
    });
    await expect(
      hypothesis.appendHypothesisVersion(
        { organizationId },
        {
          hypothesisKey: missingKey,
          hypothesisKind: "market_claim",
          name: "missing_family",
          definition: buildDefinition(),
          authoredBy: USER_ID,
        },
      ),
    ).rejects.toThrow(MiHypothesisNotFoundError);
  });

  it("hypotheses and lifecycle ledger are append-only at the DB level", async () => {
    const hypothesis = createService();
    const registered = await hypothesis.registerHypothesis(
      { organizationId },
      {
        hypothesisKind: "market_claim",
        name: "append_only_probe",
        definition: buildDefinition({ prior: { ordinal: "a", band: "b" } }),
        authoredBy: USER_ID,
      },
    );

    const db = getDb();
    expect(() =>
      db
        .update(traderMiHypothesis)
        .set({ definitionJson: "tampered" })
        .where(eq(traderMiHypothesis.id, registered.id))
        .run(),
    ).toThrow(/append-only/i);
    expect(() =>
      db.delete(traderMiHypothesis).where(eq(traderMiHypothesis.id, registered.id)).run(),
    ).toThrow(/append-only/i);
    expect(() =>
      db
        .update(traderMiHypothesisLifecycle)
        .set({ rationale: "tampered" })
        .where(eq(traderMiHypothesisLifecycle.hypothesisKey, registered.hypothesisKey))
        .run(),
    ).toThrow(/append-only/i);
  });

  it("writes audit rows for register and revise", async () => {
    const db = getDb();
    const hypothesis = createService();
    const beforeCount = db.select({ id: auditLogs.id }).from(auditLogs).all().length;

    const first = await hypothesis.registerHypothesis(
      { organizationId },
      {
        hypothesisKind: "market_claim",
        name: "audit_probe",
        definition: buildDefinition({ prior: { ordinal: "a", band: "b" } }),
        authoredBy: USER_ID,
      },
    );
    await hypothesis.appendHypothesisVersion(
      { organizationId },
      {
        hypothesisKey: first.hypothesisKey,
        hypothesisKind: "market_claim",
        name: "audit_probe",
        definition: buildDefinition({ prior: { ordinal: "c", band: "d" } }),
        authoredBy: USER_ID,
      },
    );

    const rows = db
      .select({ action: auditLogs.action, entityType: auditLogs.entityType })
      .from(auditLogs)
      .all()
      .slice(beforeCount);

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: traderAuditActions.miHypothesisRegistered,
          entityType: traderEntityTypes.miHypothesis,
        }),
        expect.objectContaining({
          action: traderAuditActions.miHypothesisRevised,
          entityType: traderEntityTypes.miHypothesis,
        }),
      ]),
    );
  });
});
