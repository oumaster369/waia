import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import type { MeasurementDefinition } from "@/lib/trader/mi/measurement.types";
import { createSqliteMiMeasurementService } from "@/lib/trader/mi/measurement-service";
import { computeMeasurementKey } from "@/lib/trader/mi/serialize-measurement";
import { OrgScopeError, requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "00000000-0000-4000-8000-00000000a282a";
const USER_B = "00000000-0000-4000-8000-00000000b282b";

const DEFINITION: MeasurementDefinition = {
  inputs: { observationKinds: ["msv_envelope"] },
  outputType: "decimal",
  params: { window: 20 },
};

describe("trader mi measurement tenant isolation (DEE-282 / ADR-0007)", () => {
  let orgA: string;
  let orgB: string;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-mi-meas-iso-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "mi-measurement-isolation.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "mi-meas-iso-a@waia.invalid",
      password: "password123",
      identityLabel: "MI Meas Org A",
    });
    insertEmailPasswordUser(db, {
      id: USER_B,
      email: "mi-meas-iso-b@waia.invalid",
      password: "password123",
      identityLabel: "MI Meas Org B",
    });

    orgA = ensureUserCoreSeedSqlite(db, { userId: USER_A, displayName: "MI Meas Org A" });
    orgB = ensureUserCoreSeedSqlite(db, { userId: USER_B, displayName: "MI Meas Org B" });
  });

  it("org B cannot read org A measurements via service", async () => {
    const db = getDb();
    const serviceA = createSqliteMiMeasurementService(db).measurement;
    const serviceB = createSqliteMiMeasurementService(db).measurement;

    await serviceA.registerMeasurement(
      { organizationId: orgA },
      {
        measurementKind: "feature_transform",
        name: "sma20",
        definition: DEFINITION,
        authoredBy: USER_A,
      },
    );

    const measurementKey = computeMeasurementKey({
      organizationId: orgA,
      measurementKind: "feature_transform",
      name: "sma20",
    });

    const crossRead = await serviceB.getLatestMeasurement({ organizationId: orgB }, measurementKey);
    expect(crossRead).toBeNull();

    const orgBList = await serviceB.listMeasurements({ organizationId: orgB });
    expect(orgBList).toHaveLength(0);
  });

  it("measurement_key derivation is org-scoped (different org → different key)", () => {
    const keyA = computeMeasurementKey({
      organizationId: orgA,
      measurementKind: "feature_transform",
      name: "sma20",
    });
    const keyB = computeMeasurementKey({
      organizationId: orgB,
      measurementKind: "feature_transform",
      name: "sma20",
    });
    expect(keyA).not.toBe(keyB);
  });

  it("empty organization id throws OrgScopeError", () => {
    expect(() => requireOrgContext("")).toThrow(OrgScopeError);
  });
});
