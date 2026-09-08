import { describe, expect, it } from "vitest";

import {
  validateWorkingHypothesis,
  type WorkingHypothesis,
  type VersionedModelReference,
} from "@/lib/ai-twin/model/persistence-contracts";

const scope = { organizationId: "synthetic-org", subjectId: "synthetic-human" };
const now = "2026-09-08T12:00:00.000Z";
const source: VersionedModelReference = { ...scope, kind: "observation", id: "o1", version: 1 };
function draft(): WorkingHypothesis {
  return {
    ref: { ...scope, kind: "hypothesis", id: "h1", version: 1 },
    purpose: "private_modelling",
    createdAt: now,
    retentionPolicyId: "human-approved-2026-09-08/v1",
    context: "Synthetic weekend planning",
    domains: ["preferences"],
    alternatives: [
      {
        id: "a",
        statement: "May prefer quiet plans",
        support: [source],
        contradiction: [],
        uncertainty: "One self-report",
        falsifier: "Human reports choosing a busy event",
      },
      {
        id: "b",
        statement: "May want quiet only this week",
        support: [source],
        contradiction: [],
        uncertainty: "Temporary context remains unknown",
        falsifier: "Human describes a stable repeated preference",
      },
    ],
    validFrom: now,
    validUntil: null,
    lastSubstantialEvidenceAt: null,
    status: "proposed",
  };
}

describe("AI-TWIN persistence hypothesis contract — synthetic, not extraction", () => {
  it("does not count the same interpretation under two ids as plural", () => {
    const value = draft();
    value.alternatives[1] = {
      ...structuredClone(value.alternatives[0]),
      id: "b",
      statement: `  ${value.alternatives[0].statement}  `,
    };
    expect(() => validateWorkingHypothesis(value, scope, [source], now)).toThrow(
      "DUPLICATE_INTERPRETATION",
    );
  });
  it("preserves competing interpretations, uncertainty and versioned evidence without promotion", () => {
    const result = validateWorkingHypothesis(draft(), scope, [source], now);
    expect(result.alternatives).toHaveLength(2);
    expect(result.status).toBe("proposed");
    expect(result.alternatives[0].support[0]).toEqual(source);
    expect(result).not.toHaveProperty("confidenceScore");
  });
  it.each(["organizationId", "subjectId"] as const)(
    "rejects foreign %s at root and evidence endpoints",
    (key) => {
      const root = draft();
      root.ref = { ...root.ref, [key]: "other" };
      expect(() => validateWorkingHypothesis(root, scope, [source], now)).toThrow();
      const nested = draft();
      nested.alternatives[0].support = [{ ...source, [key]: "other" }];
      expect(() =>
        validateWorkingHypothesis(nested, scope, [{ ...source, [key]: "other" }], now),
      ).toThrow();
    },
  );
  it("requires current exact eligible source versions, not an old draft flag", () => {
    expect(() => validateWorkingHypothesis(draft(), scope, [], now)).toThrow(
      "EVIDENCE_UNAVAILABLE",
    );
    expect(() =>
      validateWorkingHypothesis(draft(), scope, [{ ...source, version: 2 }], now),
    ).toThrow("EVIDENCE_UNAVAILABLE");
  });
  it("rejects a single, duplicated or ungrounded interpretation", () => {
    for (const modify of [
      (x: WorkingHypothesis) => {
        x.alternatives.pop();
      },
      (x: WorkingHypothesis) => {
        x.alternatives[1].id = "a";
      },
      (x: WorkingHypothesis) => {
        x.alternatives.forEach((a) => {
          a.support = [];
        });
      },
    ]) {
      const value = draft();
      modify(value);
      expect(() => validateWorkingHypothesis(value, scope, [source], now)).toThrow();
    }
  });
  it("keeps support and contradiction distinct, including an untested alternative", () => {
    const value = draft();
    value.alternatives[1].support = [];
    value.alternatives[1].contradiction = [source];
    expect(
      validateWorkingHypothesis(value, scope, [source], now).alternatives[1].contradiction,
    ).toEqual([source]);
  });
  it("rejects future clocks, invalid intervals and invalid revisions", () => {
    for (const modify of [
      (x: WorkingHypothesis) => {
        x.createdAt = "2027-01-01T00:00:00.000Z";
      },
      (x: WorkingHypothesis) => {
        x.lastSubstantialEvidenceAt = "2027-01-01T00:00:00.000Z";
      },
      (x: WorkingHypothesis) => {
        x.validUntil = "2025-01-01T00:00:00.000Z";
      },
      (x: WorkingHypothesis) => {
        x.ref.version = 0;
      },
    ]) {
      const value = draft();
      modify(value);
      expect(() => validateWorkingHypothesis(value, scope, [source], now)).toThrow();
    }
  });
  it("rejects undeclared sensitive fields, sparse arrays and accessors without invoking them", () => {
    const extra = { ...draft(), rawDiary: "not allowed" };
    expect(() => validateWorkingHypothesis(extra, scope, [source], now)).toThrow();
    const sparse = draft();
    sparse.alternatives[0].support = new Array(1);
    expect(() => validateWorkingHypothesis(sparse, scope, [source], now)).toThrow();
    let read = false;
    const getter = draft();
    Object.defineProperty(getter.alternatives[0], "statement", {
      enumerable: true,
      get() {
        read = true;
        return "bad";
      },
    });
    expect(() => validateWorkingHypothesis(getter, scope, [source], now)).toThrow();
    expect(read).toBe(false);
  });
  it("returns an immutable independent record", () => {
    const value = draft();
    const result = validateWorkingHypothesis(value, scope, [source], now);
    value.alternatives[0].statement = "changed";
    expect(result.alternatives[0].statement).not.toBe("changed");
    expect(Object.isFrozen(result.alternatives[0].support[0])).toBe(true);
  });
});
