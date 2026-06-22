import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { MiTrialNotFoundError } from "@/lib/trader/mi/errors";
import { createSqliteMiHypothesisService } from "@/lib/trader/mi/hypothesis-service";
import type {
  HypothesisMeasurementRef,
  HypothesisPatternRef,
} from "@/lib/trader/mi/hypothesis.types";
import { createSqliteMiMeasurementService } from "@/lib/trader/mi/measurement-service";
import { createSqliteMiPatternService } from "@/lib/trader/mi/pattern-service";
import { createSqliteMiTrialIntegrityService } from "@/lib/trader/mi/trial-integrity-service";
import { createSqliteMiTrialService } from "@/lib/trader/mi/trial-service";
import { OrgScopeError, requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "00000000-0000-4000-8000-00000000a291a";
const USER_B = "00000000-0000-4000-8000-00000000b291b";

describe("trader mi trial integrity tenant isolation (DEE-291 / ADR-0007)", () => {
  let orgA: string;
  let orgB: string;
  let trialIdA: string;

  beforeAll(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-mi-trial-integrity-iso-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "mi-trial-integrity-isolation.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "mi-trial-integrity-a@waia.invalid",
      password: "password123",
      identityLabel: "MI Trial Integrity Org A",
    });
    insertEmailPasswordUser(db, {
      id: USER_B,
      email: "mi-trial-integrity-b@waia.invalid",
      password: "password123",
      identityLabel: "MI Trial Integrity Org B",
    });

    orgA = ensureUserCoreSeedSqlite(db, {
      userId: USER_A,
      displayName: "MI Trial Integrity Org A",
    });
    orgB = ensureUserCoreSeedSqlite(db, {
      userId: USER_B,
      displayName: "MI Trial Integrity Org B",
    });

    const measurementRef = await seedHypothesisFixture(orgA, USER_A);
    const trial = createSqliteMiTrialService(db).trial;
    const recorded = await trial.registerTrial(
      { organizationId: orgA },
      {
        hypothesisId: measurementRef.hypothesisId,
        hypothesisDefinitionDigest: measurementRef.hypothesisDefinitionDigest,
        eventTime: new Date("2026-06-22T11:00:00.000Z"),
        ingestTime: new Date("2026-06-22T11:00:01.000Z"),
        registeredBy: USER_A,
      },
    );
    trialIdA = recorded.id;
  });

  async function seedHypothesisFixture(
    organizationId: string,
    userId: string,
  ): Promise<{
    hypothesisId: string;
    hypothesisDefinitionDigest: string;
  }> {
    const db = getDb();
    const measurement = createSqliteMiMeasurementService(db).measurement;
    const m = await measurement.registerMeasurement(
      { organizationId },
      {
        measurementKind: "feature_transform",
        name: "sma20",
        definition: {
          inputs: { observationKinds: ["msv_envelope"] },
          outputType: "decimal",
          params: { window: 20 },
        },
        authoredBy: userId,
      },
    );
    const measurementRef: HypothesisMeasurementRef = {
      measurementKey: m.measurementKey,
      measurementDefinitionDigest: m.definitionDigest,
    };

    const pattern = createSqliteMiPatternService(db).pattern;
    const p = await pattern.registerPattern(
      { organizationId },
      {
        patternKind: "recurring_structure",
        name: "iso_integrity_pattern",
        definition: {
          measurements: [measurementRef],
          recurrence: { description: "iso", params: { window: 20 } },
        },
        trialBudgetMax: 1,
        authoredBy: userId,
      },
    );
    const patternRef: HypothesisPatternRef = {
      patternKey: p.patternKey,
      patternDefinitionDigest: p.definitionDigest,
    };

    const hypothesis = createSqliteMiHypothesisService(db).hypothesis;
    const registered = await hypothesis.registerHypothesis(
      { organizationId },
      {
        hypothesisKind: "market_claim",
        name: "iso_integrity_hypothesis",
        definition: {
          claimShape: {
            relationshipType: "predictive",
            isDirectional: true,
            isTrendEdge: false,
            isTimingEdge: false,
          },
          prior: { ordinal: "moderate", band: "wide" },
          falsificationConditions: ["null wins"],
          requiredNulls: ["always-flat-cash", "buy-and-hold"],
          patternRefs: [patternRef],
          measurementRefs: [measurementRef],
          regimeScope: { description: "iso" },
        },
        authoredBy: userId,
      },
    );

    return {
      hypothesisId: registered.id,
      hypothesisDefinitionDigest: registered.definitionDigest,
    };
  }

  it("does not expose org A trial integrity to org B", async () => {
    const integrity = createSqliteMiTrialIntegrityService(getDb()).trialIntegrity;
    expect(await integrity.getTrialIntegrity({ organizationId: orgB }, trialIdA)).toBeNull();
  });

  it("rejects invalidation against a trial in another org", async () => {
    const integrity = createSqliteMiTrialIntegrityService(getDb()).trialIntegrity;
    await expect(
      integrity.invalidateTrial(
        { organizationId: orgB },
        {
          trialId: trialIdA,
          reasonCode: "provenance_gap",
          rationale: "cross-org invalidation",
          eventTime: new Date("2026-06-22T12:00:00.000Z"),
          ingestTime: new Date("2026-06-22T12:00:01.000Z"),
          recordedBy: USER_B,
        },
      ),
    ).rejects.toThrow(MiTrialNotFoundError);
  });

  it("rejects listing events for a trial in another org", async () => {
    const integrity = createSqliteMiTrialIntegrityService(getDb()).trialIntegrity;
    await expect(
      integrity.listTrialIntegrityEvents({ organizationId: orgB }, trialIdA),
    ).rejects.toThrow(MiTrialNotFoundError);
  });

  it("requires explicit org context", () => {
    expect(() => requireOrgContext("")).toThrow(OrgScopeError);
  });
});
