import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { MiHypothesisNotFoundError } from "@/lib/trader/mi/errors";
import { createSqliteMiTrialService } from "@/lib/trader/mi/trial-service";
import { createSqliteMiHypothesisService } from "@/lib/trader/mi/hypothesis-service";
import type {
  HypothesisMeasurementRef,
  HypothesisPatternRef,
} from "@/lib/trader/mi/hypothesis.types";
import { createSqliteMiMeasurementService } from "@/lib/trader/mi/measurement-service";
import { createSqliteMiPatternService } from "@/lib/trader/mi/pattern-service";
import { OrgScopeError, requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "00000000-0000-4000-8000-00000000a290a";
const USER_B = "00000000-0000-4000-8000-00000000b290b";

describe("trader mi trial tenant isolation (DEE-289 / ADR-0007)", () => {
  let orgA: string;
  let orgB: string;
  let measurementRef: HypothesisMeasurementRef;
  let patternRef: HypothesisPatternRef;
  let hypothesisId: string;
  let hypothesisKey: string;
  let hypothesisDefinitionDigest: string;

  beforeAll(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-mi-trial-iso-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "mi-trial-isolation.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "mi-trial-iso-a@waia.invalid",
      password: "password123",
      identityLabel: "MI Trial Org A",
    });
    insertEmailPasswordUser(db, {
      id: USER_B,
      email: "mi-trial-iso-b@waia.invalid",
      password: "password123",
      identityLabel: "MI Trial Org B",
    });

    orgA = ensureUserCoreSeedSqlite(db, { userId: USER_A, displayName: "MI Trial Org A" });
    orgB = ensureUserCoreSeedSqlite(db, { userId: USER_B, displayName: "MI Trial Org B" });

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
        name: "iso_trial_pattern",
        definition: {
          measurements: [measurementRef],
          recurrence: { description: "iso", params: { window: 20 } },
        },
        trialBudgetMax: 1,
        authoredBy: USER_A,
      },
    );
    patternRef = { patternKey: p.patternKey, patternDefinitionDigest: p.definitionDigest };

    const hypothesis = createSqliteMiHypothesisService(db).hypothesis;
    const registered = await hypothesis.registerHypothesis(
      { organizationId: orgA },
      {
        hypothesisKind: "market_claim",
        name: "iso_trial_hypothesis",
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
          regimeScope: { description: "iso scope" },
        },
        authoredBy: USER_A,
      },
    );
    hypothesisId = registered.id;
    hypothesisKey = registered.hypothesisKey;
    hypothesisDefinitionDigest = registered.definitionDigest;
  });

  it("org B cannot read org A trials via service", async () => {
    const db = getDb();
    const trialA = createSqliteMiTrialService(db).trial;
    const trialB = createSqliteMiTrialService(db).trial;

    await trialA.registerTrial(
      { organizationId: orgA },
      {
        hypothesisId,
        hypothesisDefinitionDigest,
        eventTime: new Date("2026-06-22T11:00:00.000Z"),
        ingestTime: new Date("2026-06-22T11:00:01.000Z"),
        registeredBy: USER_A,
      },
    );

    const crossList = await trialB.listTrials({ organizationId: orgB }, hypothesisKey);
    expect(crossList).toHaveLength(0);

    const crossCounts = await trialB.getTrialCounts(
      { organizationId: orgB },
      hypothesisKey,
      hypothesisId,
    );
    expect(crossCounts).toEqual({ byHypothesisKey: 0, byHypothesisId: 0, latestSeq: null });
  });

  it("org B cannot register a trial using org A hypothesis pin", async () => {
    const db = getDb();
    const trialB = createSqliteMiTrialService(db).trial;

    await expect(
      trialB.registerTrial(
        { organizationId: orgB },
        {
          hypothesisId,
          hypothesisDefinitionDigest,
          eventTime: new Date("2026-06-22T11:01:00.000Z"),
          ingestTime: new Date("2026-06-22T11:01:01.000Z"),
          registeredBy: USER_B,
        },
      ),
    ).rejects.toThrow(MiHypothesisNotFoundError);
  });

  it("empty organization id throws OrgScopeError", () => {
    expect(() => requireOrgContext("")).toThrow(OrgScopeError);
  });
});
