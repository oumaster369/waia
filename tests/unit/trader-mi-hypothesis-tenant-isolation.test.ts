import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { createSqliteMiHypothesisService } from "@/lib/trader/mi/hypothesis-service";
import type {
  HypothesisMeasurementRef,
  HypothesisPatternRef,
} from "@/lib/trader/mi/hypothesis.types";
import { createSqliteMiMeasurementService } from "@/lib/trader/mi/measurement-service";
import { createSqliteMiPatternService } from "@/lib/trader/mi/pattern-service";
import { computeHypothesisKey } from "@/lib/trader/mi/serialize-hypothesis";
import { OrgScopeError, requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "00000000-0000-4000-8000-00000000a285a";
const USER_B = "00000000-0000-4000-8000-00000000b285b";

describe("trader mi hypothesis tenant isolation (DEE-285 / ADR-0007)", () => {
  let orgA: string;
  let orgB: string;
  let measurementRef: HypothesisMeasurementRef;
  let patternRef: HypothesisPatternRef;

  beforeAll(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-mi-hypothesis-iso-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "mi-hypothesis-isolation.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "mi-hypothesis-iso-a@waia.invalid",
      password: "password123",
      identityLabel: "MI Hypothesis Org A",
    });
    insertEmailPasswordUser(db, {
      id: USER_B,
      email: "mi-hypothesis-iso-b@waia.invalid",
      password: "password123",
      identityLabel: "MI Hypothesis Org B",
    });

    orgA = ensureUserCoreSeedSqlite(db, { userId: USER_A, displayName: "MI Hypothesis Org A" });
    orgB = ensureUserCoreSeedSqlite(db, { userId: USER_B, displayName: "MI Hypothesis Org B" });

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
    measurementRef = {
      measurementKey: m.measurementKey,
      measurementDefinitionDigest: m.definitionDigest,
    };

    const pattern = createSqliteMiPatternService(db).pattern;
    const p = await pattern.registerPattern(
      { organizationId: orgA },
      {
        patternKind: "recurring_structure",
        name: "iso_pattern",
        definition: {
          measurements: [measurementRef],
          recurrence: { description: "iso", params: { window: 20 } },
        },
        trialBudgetMax: 1,
        authoredBy: USER_A,
      },
    );
    patternRef = { patternKey: p.patternKey, patternDefinitionDigest: p.definitionDigest };
  });

  function buildDefinition() {
    return {
      claimShape: {
        relationshipType: "predictive" as const,
        isDirectional: true,
        isTrendEdge: false,
        isTimingEdge: false,
      },
      prior: { ordinal: "moderate", band: "wide" },
      falsificationConditions: ["null wins"],
      requiredNulls: ["always-flat-cash", "buy-and-hold"] as const,
      patternRefs: [patternRef],
      measurementRefs: [measurementRef],
      regimeScope: { description: "iso scope" },
    };
  }

  it("org B cannot read org A hypotheses via service", async () => {
    const db = getDb();
    const serviceA = createSqliteMiHypothesisService(db).hypothesis;
    const serviceB = createSqliteMiHypothesisService(db).hypothesis;

    await serviceA.registerHypothesis(
      { organizationId: orgA },
      {
        hypothesisKind: "market_claim",
        name: "iso_probe",
        definition: buildDefinition(),
        authoredBy: USER_A,
      },
    );

    const hypothesisKey = computeHypothesisKey({
      organizationId: orgA,
      hypothesisKind: "market_claim",
      name: "iso_probe",
    });

    const crossRead = await serviceB.getLatestHypothesis({ organizationId: orgB }, hypothesisKey);
    expect(crossRead).toBeNull();

    const orgBList = await serviceB.listHypotheses({ organizationId: orgB });
    expect(orgBList).toHaveLength(0);
  });

  it("hypothesis_key derivation is org-scoped (different org → different key)", () => {
    const keyA = computeHypothesisKey({
      organizationId: orgA,
      hypothesisKind: "market_claim",
      name: "iso_probe",
    });
    const keyB = computeHypothesisKey({
      organizationId: orgB,
      hypothesisKind: "market_claim",
      name: "iso_probe",
    });
    expect(keyA).not.toBe(keyB);
  });

  it("empty organization id throws OrgScopeError", () => {
    expect(() => requireOrgContext("")).toThrow(OrgScopeError);
  });
});
