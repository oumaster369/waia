import { describe, expect, it } from "vitest";

import {
  assertFhvT4aCeremonyClassificationsExact,
  buildFhvT4aCeremonyPassFields,
  FHV_T4A_CEREMONY_REQUIRED_KEYS,
  FHV_T4A_CEREMONY_REQUIRED_RESULTS,
  FhvT4aCeremonyResultsError,
  parseFhvT4aCeremonyTaggedLines,
  validateFhvT4aCeremonyStdout,
} from "@/lib/trader/observability/fhv-t4a-ceremony-results";

function validClassifications(): Record<string, string> {
  return { ...FHV_T4A_CEREMONY_REQUIRED_RESULTS };
}

function validStdout(): string {
  const lines = ["classification=FHV_T4_CEREMONY_VERIFICATION_PASS"];
  for (const key of FHV_T4A_CEREMONY_REQUIRED_KEYS) {
    lines.push(`${key}=${FHV_T4A_CEREMONY_REQUIRED_RESULTS[key]}`);
  }
  lines.push("units=waia-fhv-campaign.service,waia-fhv-observer.service");
  return `${lines.join("\n")}\n`;
}

describe("fhv-t4 ceremony exact results (DEE-436 Q-02)", () => {
  it("accepts the canonical exact ceremony map", () => {
    expect(() => assertFhvT4aCeremonyClassificationsExact(validClassifications())).not.toThrow();
    expect(validateFhvT4aCeremonyStdout(validStdout())).toEqual(validClassifications());
    expect(buildFhvT4aCeremonyPassFields()).toEqual(FHV_T4A_CEREMONY_REQUIRED_RESULTS);
  });

  it("rejects forbidden aggregate PASS fields", () => {
    for (const forbidden of ["T4_RESULT", "T4_AGGREGATE_RESULT", "DASHBOARD_RESULT"] as const) {
      try {
        assertFhvT4aCeremonyClassificationsExact({
          ...validClassifications(),
          [forbidden]: "PASS",
        });
        expect.unreachable(`forbidden field ${forbidden} should fail`);
      } catch (error) {
        expect(error).toBeInstanceOf(FhvT4aCeremonyResultsError);
        expect((error as FhvT4aCeremonyResultsError).code).toBe(
          "FHV_T4A_CEREMONY_FORBIDDEN_AGGREGATE_FIELD",
        );
      }
    }
  });

  it("rejects missing, empty, unexpected, and duplicate fields", () => {
    try {
      const incomplete = validClassifications();
      delete incomplete.T4A_RESULT;
      assertFhvT4aCeremonyClassificationsExact(incomplete);
      expect.unreachable("missing field should fail");
    } catch (error) {
      expect((error as FhvT4aCeremonyResultsError).code).toBe("CEREMONY_REQUIRED_FIELD_MISSING");
    }

    try {
      assertFhvT4aCeremonyClassificationsExact({ ...validClassifications(), RESUME_RESULT: "  " });
      expect.unreachable("empty field should fail");
    } catch (error) {
      expect((error as FhvT4aCeremonyResultsError).code).toBe("CEREMONY_REQUIRED_FIELD_MISSING");
    }

    try {
      assertFhvT4aCeremonyClassificationsExact({
        ...validClassifications(),
        EXTRA_FIELD: "PASS",
      });
      expect.unreachable("unexpected field should fail");
    } catch (error) {
      expect((error as FhvT4aCeremonyResultsError).code).toBe("FHV_T4A_CEREMONY_UNEXPECTED_FIELD");
    }

    const duplicateStdout = `${validStdout()}T4A_RESULT=FAIL\n`;
    try {
      parseFhvT4aCeremonyTaggedLines(duplicateStdout);
      expect.unreachable("contradictory duplicate should fail");
    } catch (error) {
      expect((error as FhvT4aCeremonyResultsError).code).toBe(
        "FHV_T4A_CEREMONY_CONTRADICTORY_DUPLICATE",
      );
    }

    const sameDuplicateStdout = `${validStdout()}T4A_RESULT=PASS\n`;
    try {
      parseFhvT4aCeremonyTaggedLines(sameDuplicateStdout);
      expect.unreachable("duplicate field should fail");
    } catch (error) {
      expect((error as FhvT4aCeremonyResultsError).code).toBe("FHV_T4A_CEREMONY_DUPLICATE_FIELD");
    }
  });

  it("rejects each required field when changed one at a time", () => {
    for (const key of FHV_T4A_CEREMONY_REQUIRED_KEYS) {
      const mutated = validClassifications();
      mutated[key] = key === "FULL_HISTORY_RESCAN_DELTA" ? "1" : "FAIL";
      try {
        assertFhvT4aCeremonyClassificationsExact(mutated);
        expect.unreachable(`mutated ${key} should fail`);
      } catch (error) {
        expect((error as FhvT4aCeremonyResultsError).code).toBe(
          "CEREMONY_EXACT_VALUE_NOT_ENFORCED",
        );
      }
    }
  });

  it("strips bracketed closure-cli prefixes before parsing ceremony stdout", () => {
    const stdout = [
      "[fhv-t4-closure] classification=FHV_T4_CEREMONY_VERIFICATION_PASS",
      ...FHV_T4A_CEREMONY_REQUIRED_KEYS.map(
        (key) => `[fhv-t4-closure] ${key}=${FHV_T4A_CEREMONY_REQUIRED_RESULTS[key]}`,
      ),
      "[fhv-t4-closure] units=waia-fhv-campaign.service,waia-fhv-observer.service",
    ].join("\n");
    expect(validateFhvT4aCeremonyStdout(`${stdout}\n`)).toEqual(validClassifications());
  });
});
