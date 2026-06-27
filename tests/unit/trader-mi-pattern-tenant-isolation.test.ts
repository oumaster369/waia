import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { createSqliteMiMeasurementService } from "@/lib/trader/mi/measurement-service";
import { createSqliteMiPatternService } from "@/lib/trader/mi/pattern-service";
import type { PatternMeasurementRef } from "@/lib/trader/mi/pattern.types";
import { computePatternKey } from "@/lib/trader/mi/serialize-pattern";
import { OrgScopeError, requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "00000000-0000-4000-8000-00000000a283a";
const USER_B = "00000000-0000-4000-8000-00000000b283b";

describe("trader mi pattern tenant isolation (DEE-283 / ADR-0007)", () => {
  let orgA: string;
  let orgB: string;
  let refA: PatternMeasurementRef;

  beforeAll(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-mi-pattern-iso-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "mi-pattern-isolation.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "mi-pattern-iso-a@waia.invalid",
      password: "password123",
      identityLabel: "MI Pattern Org A",
    });
    insertEmailPasswordUser(db, {
      id: USER_B,
      email: "mi-pattern-iso-b@waia.invalid",
      password: "password123",
      identityLabel: "MI Pattern Org B",
    });

    orgA = ensureUserCoreSeedSqlite(db, { userId: USER_A, displayName: "MI Pattern Org A" });
    orgB = ensureUserCoreSeedSqlite(db, { userId: USER_B, displayName: "MI Pattern Org B" });

    const measurement = createSqliteMiMeasurementService(db).measurement;
    const m = await measurement.registerMeasurement(
      { organizationId: orgA },
      {
        measurementKind: "feature_transform",
        name: "sma20",
        definition: {
          inputs: { observationKinds: ["msv_envelope"] },
          outputType: "decimal",
          params: { window: 20 },
        },
        authoredBy: USER_A,
      },
    );
    refA = { measurementKey: m.measurementKey, measurementDefinitionDigest: m.definitionDigest };
  });

  it("org B cannot read org A patterns via service", async () => {
    const db = getDb();
    const serviceA = createSqliteMiPatternService(db).pattern;
    const serviceB = createSqliteMiPatternService(db).pattern;

    await serviceA.registerPattern(
      { organizationId: orgA },
      {
        patternKind: "recurring_structure",
        name: "iso_probe",
        definition: {
          measurements: [refA],
          recurrence: { description: "iso", params: { window: 20 } },
        },
        trialBudgetMax: 1,
        authoredBy: USER_A,
      },
    );

    const patternKey = computePatternKey({
      organizationId: orgA,
      patternKind: "recurring_structure",
      name: "iso_probe",
    });

    const crossRead = await serviceB.getLatestPattern({ organizationId: orgB }, patternKey);
    expect(crossRead).toBeNull();

    const orgBList = await serviceB.listPatterns({ organizationId: orgB });
    expect(orgBList).toHaveLength(0);
  });

  it("pattern_key derivation is org-scoped (different org → different key)", () => {
    const keyA = computePatternKey({
      organizationId: orgA,
      patternKind: "recurring_structure",
      name: "iso_probe",
    });
    const keyB = computePatternKey({
      organizationId: orgB,
      patternKind: "recurring_structure",
      name: "iso_probe",
    });
    expect(keyA).not.toBe(keyB);
  });

  it("empty organization id throws OrgScopeError", () => {
    expect(() => requireOrgContext("")).toThrow(OrgScopeError);
  });
});
