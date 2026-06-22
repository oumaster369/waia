import { beforeAll, describe, expect, it } from "vitest";
import { eq, getTableColumns } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { auditLogs, traderMiMeasurement } from "@/db/schema";
import {
  MiMeasurementDuplicateError,
  MiMeasurementInputValidationError,
  MiMeasurementNotFoundError,
} from "@/lib/trader/mi/errors";
import {
  MI_MEASUREMENT_SCHEMA_VERSION,
  type MeasurementDefinition,
} from "@/lib/trader/mi/measurement.types";
import { createSqliteMiMeasurementService } from "@/lib/trader/mi/measurement-service";
import {
  buildMeasurementDigestFromDefinition,
  computeMeasurementKey,
  parseMeasurementDefinitionJson,
} from "@/lib/trader/mi/serialize-measurement";
import { traderAuditActions, traderEntityTypes } from "@/lib/trader/types";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_ID = "00000000-0000-4000-8000-00000000a282";

function buildDefinition(overrides?: Partial<MeasurementDefinition>): MeasurementDefinition {
  return {
    inputs: { observationKinds: ["msv_envelope"] },
    outputType: "decimal",
    params: { window: 20, source: "close" },
    description: "Simple moving average over close",
    ...overrides,
  };
}

describe("trader mi measurement (DEE-282 / LD-3)", () => {
  let organizationId: string;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-mi-meas-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "mi-measurement.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_ID,
      email: "mi-meas@waia.invalid",
      password: "password123",
      identityLabel: "MI Measurement User",
    });
    organizationId = ensureUserCoreSeedSqlite(db, {
      userId: USER_ID,
      displayName: "MI Measurement User",
    });
  });

  function createService() {
    const db = getDb();
    return createSqliteMiMeasurementService(db, { actorType: "user", actorId: USER_ID })
      .measurement;
  }

  it("schema exposes definition-registry fields only — no value/PIT/source columns (M1, M4)", () => {
    const columns = Object.keys(getTableColumns(traderMiMeasurement));
    expect(columns.sort()).toEqual(
      [
        "id",
        "organizationId",
        "measurementKind",
        "measurementKey",
        "name",
        "schemaVersion",
        "definitionJson",
        "definitionDigest",
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
      "computedValue",
      "eventTime",
      "ingestTime",
      "sourceId",
    ]) {
      expect(columns).not.toContain(forbidden);
    }
  });

  it("measurement_key is deterministic and independent of the definition body (M2)", () => {
    const keyA = computeMeasurementKey({
      organizationId,
      measurementKind: "feature_transform",
      name: "sma20",
    });
    const keyB = computeMeasurementKey({
      organizationId,
      measurementKind: "feature_transform",
      name: "sma20",
    });
    expect(keyA).toBe(keyB);

    const differentName = computeMeasurementKey({
      organizationId,
      measurementKind: "feature_transform",
      name: "sma50",
    });
    expect(differentName).not.toBe(keyA);
  });

  it("same family inputs with different definitions: same key, different digest (M2)", () => {
    const keyArgs = {
      organizationId,
      measurementKind: "feature_transform" as const,
      name: "family_identity_probe",
    };
    const keyA = computeMeasurementKey(keyArgs);
    const keyB = computeMeasurementKey(keyArgs);
    expect(keyA).toBe(keyB);

    const digestA = buildMeasurementDigestFromDefinition({
      ...keyArgs,
      measurementKey: keyA,
      definition: buildDefinition({ params: { window: 20 } }),
    });
    const digestB = buildMeasurementDigestFromDefinition({
      ...keyArgs,
      measurementKey: keyB,
      definition: buildDefinition({ params: { window: 50 } }),
    });
    expect(digestA).not.toBe(digestB);
  });

  it("definition_digest is reproducible and changes on definitional change (M3)", () => {
    const measurementKey = computeMeasurementKey({
      organizationId,
      measurementKind: "feature_transform",
      name: "sma20",
    });
    const base = buildMeasurementDigestFromDefinition({
      organizationId,
      measurementKey,
      measurementKind: "feature_transform",
      name: "sma20",
      definition: buildDefinition(),
    });
    const same = buildMeasurementDigestFromDefinition({
      organizationId,
      measurementKey,
      measurementKind: "feature_transform",
      name: "sma20",
      definition: buildDefinition(),
    });
    expect(same).toBe(base);

    const changed = buildMeasurementDigestFromDefinition({
      organizationId,
      measurementKey,
      measurementKind: "feature_transform",
      name: "sma20",
      definition: buildDefinition({ params: { window: 50, source: "close" } }),
    });
    expect(changed).not.toBe(base);
  });

  it("normalizes numeric params so equivalent numbers produce the same digest (M3)", () => {
    const measurementKey = computeMeasurementKey({
      organizationId,
      measurementKind: "feature_transform",
      name: "sma20",
    });
    const intDigest = buildMeasurementDigestFromDefinition({
      organizationId,
      measurementKey,
      measurementKind: "feature_transform",
      name: "sma20",
      definition: buildDefinition({ params: { window: 20 } }),
    });
    const floatDigest = buildMeasurementDigestFromDefinition({
      organizationId,
      measurementKey,
      measurementKind: "feature_transform",
      name: "sma20",
      definition: buildDefinition({ params: { window: 20.0 } }),
    });
    expect(floatDigest).toBe(intDigest);
  });

  it("definition_digest excludes id, created_at, version_seq, revision_of (M3)", async () => {
    const measurement = createService();
    const first = await measurement.registerMeasurement(
      { organizationId },
      {
        measurementKind: "feature_transform",
        name: "digest_exclusion_probe",
        definition: buildDefinition({ params: { window: 14 } }),
        authoredBy: USER_ID,
      },
    );
    const second = await measurement.appendMeasurementVersion(
      { organizationId },
      {
        measurementKey: first.measurementKey,
        measurementKind: "feature_transform",
        name: "digest_exclusion_probe",
        definition: buildDefinition({ params: { window: 28 } }),
        authoredBy: USER_ID,
      },
    );

    // Two persisted rows differ in id / created_at / version_seq / revision_of,
    // yet a digest re-derived from the SAME definitional inputs is identical —
    // proving none of those row/wall-clock fields contaminate the digest.
    expect(second.versionSeq).not.toBe(first.versionSeq);
    expect(second.id).not.toBe(first.id);
    expect(second.revisionOf).toBe(first.id);

    const reDerivedFromFirst = buildMeasurementDigestFromDefinition({
      organizationId,
      measurementKey: first.measurementKey,
      measurementKind: "feature_transform",
      name: "digest_exclusion_probe",
      definition: buildDefinition({ params: { window: 14 } }),
    });
    const reDerivedFromSecond = buildMeasurementDigestFromDefinition({
      organizationId,
      measurementKey: second.measurementKey,
      measurementKind: "feature_transform",
      name: "digest_exclusion_probe",
      definition: buildDefinition({ params: { window: 14 } }),
    });
    expect(reDerivedFromFirst).toBe(first.definitionDigest);
    expect(reDerivedFromSecond).toBe(first.definitionDigest);
    expect(reDerivedFromSecond).not.toBe(second.definitionDigest);
  });

  it("registers version 1 and round-trips the definition", async () => {
    const measurement = createService();
    const registered = await measurement.registerMeasurement(
      { organizationId },
      {
        measurementKind: "feature_transform",
        name: "sma20",
        definition: buildDefinition(),
        authoredBy: USER_ID,
      },
    );

    expect(registered.versionSeq).toBe(1);
    expect(registered.revisionOf).toBeNull();
    expect(registered.schemaVersion).toBe(MI_MEASUREMENT_SCHEMA_VERSION);
    expect(parseMeasurementDefinitionJson(registered.definitionJson)).toEqual(buildDefinition());
  });

  it("appends a new version on the same measurement_key and tracks the chain (M5)", async () => {
    const measurement = createService();
    const first = await measurement.registerMeasurement(
      { organizationId },
      {
        measurementKind: "feature_transform",
        name: "zscore",
        definition: buildDefinition({ params: { window: 20 } }),
        authoredBy: USER_ID,
      },
    );

    const second = await measurement.appendMeasurementVersion(
      { organizationId },
      {
        measurementKey: first.measurementKey,
        measurementKind: "feature_transform",
        name: "zscore",
        definition: buildDefinition({ params: { window: 50 } }),
        authoredBy: USER_ID,
      },
    );

    expect(second.measurementKey).toBe(first.measurementKey);
    expect(second.versionSeq).toBe(2);
    expect(second.revisionOf).toBe(first.id);

    const current = await measurement.getLatestMeasurement(
      { organizationId },
      first.measurementKey,
    );
    expect(current?.id).toBe(second.id);

    const history = await measurement.getMeasurementHistory(
      { organizationId },
      first.measurementKey,
    );
    expect(history.map((m) => m.versionSeq)).toEqual([1, 2]);
  });

  it("rejects re-registering an existing family (M5)", async () => {
    const measurement = createService();
    await measurement.registerMeasurement(
      { organizationId },
      {
        measurementKind: "feature_transform",
        name: "realized_vol",
        definition: buildDefinition(),
        authoredBy: USER_ID,
      },
    );

    await expect(
      measurement.registerMeasurement(
        { organizationId },
        {
          measurementKind: "feature_transform",
          name: "realized_vol",
          definition: buildDefinition({ params: { window: 99 } }),
          authoredBy: USER_ID,
        },
      ),
    ).rejects.toThrow(MiMeasurementDuplicateError);
  });

  it("rejects an identical definition on append (duplicate digest detection, M5)", async () => {
    const measurement = createService();
    const first = await measurement.registerMeasurement(
      { organizationId },
      {
        measurementKind: "feature_transform",
        name: "spread_bps",
        definition: buildDefinition(),
        authoredBy: USER_ID,
      },
    );

    await expect(
      measurement.appendMeasurementVersion(
        { organizationId },
        {
          measurementKey: first.measurementKey,
          measurementKind: "feature_transform",
          name: "spread_bps",
          definition: buildDefinition(),
          authoredBy: USER_ID,
        },
      ),
    ).rejects.toThrow(MiMeasurementDuplicateError);
  });

  it("rejects appending to a non-existent family", async () => {
    const measurement = createService();
    const measurementKey = computeMeasurementKey({
      organizationId,
      measurementKind: "feature_transform",
      name: "does_not_exist",
    });

    await expect(
      measurement.appendMeasurementVersion(
        { organizationId },
        {
          measurementKey,
          measurementKind: "feature_transform",
          name: "does_not_exist",
          definition: buildDefinition(),
          authoredBy: USER_ID,
        },
      ),
    ).rejects.toThrow(MiMeasurementNotFoundError);
  });

  it("rejects an empty declared input set (M6)", async () => {
    const measurement = createService();
    await expect(
      measurement.registerMeasurement(
        { organizationId },
        {
          measurementKind: "feature_transform",
          name: "no_inputs",
          definition: buildDefinition({ inputs: { observationKinds: [] } }),
          authoredBy: USER_ID,
        },
      ),
    ).rejects.toThrow(MiMeasurementInputValidationError);
  });

  it("rejects an unknown declared observation kind (M6)", async () => {
    const measurement = createService();
    await expect(
      measurement.registerMeasurement(
        { organizationId },
        {
          measurementKind: "feature_transform",
          name: "bad_input",
          definition: buildDefinition({
            inputs: { observationKinds: ["not_a_real_kind" as never] },
          }),
          authoredBy: USER_ID,
        },
      ),
    ).rejects.toThrow(MiMeasurementInputValidationError);
  });

  it("measurements are append-only at the DB level", async () => {
    const measurement = createService();
    const registered = await measurement.registerMeasurement(
      { organizationId },
      {
        measurementKind: "feature_transform",
        name: "append_only_probe",
        definition: buildDefinition(),
        authoredBy: USER_ID,
      },
    );

    const db = getDb();
    expect(() =>
      db
        .update(traderMiMeasurement)
        .set({ definitionJson: "tampered" })
        .where(eq(traderMiMeasurement.id, registered.id))
        .run(),
    ).toThrow(/append-only/i);

    expect(() =>
      db.delete(traderMiMeasurement).where(eq(traderMiMeasurement.id, registered.id)).run(),
    ).toThrow(/append-only/i);
  });

  it("writes audit rows for register and revise", async () => {
    const db = getDb();
    const measurement = createService();

    const beforeCount = db.select({ id: auditLogs.id }).from(auditLogs).all().length;

    const first = await measurement.registerMeasurement(
      { organizationId },
      {
        measurementKind: "feature_transform",
        name: "audit_probe",
        definition: buildDefinition({ params: { window: 10 } }),
        authoredBy: USER_ID,
      },
    );
    await measurement.appendMeasurementVersion(
      { organizationId },
      {
        measurementKey: first.measurementKey,
        measurementKind: "feature_transform",
        name: "audit_probe",
        definition: buildDefinition({ params: { window: 30 } }),
        authoredBy: USER_ID,
      },
    );

    const rows = db
      .select({
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        organizationId: auditLogs.organizationId,
      })
      .from(auditLogs)
      .all()
      .slice(beforeCount);

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: traderAuditActions.miMeasurementRegistered,
          entityType: traderEntityTypes.miMeasurement,
          organizationId,
        }),
        expect.objectContaining({
          action: traderAuditActions.miMeasurementRevised,
          entityType: traderEntityTypes.miMeasurement,
          organizationId,
        }),
      ]),
    );
  });
});
