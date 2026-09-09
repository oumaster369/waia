import { describe, expect, it } from "vitest";
import { planLegacyModelQuarantine } from "@/lib/ai-twin/model/legacy-quarantine";

const scope = { organizationId: "synthetic-org", subjectId: "synthetic-human" };
const now = "2026-09-09T09:00:00.000Z";
const old = "2020-01-01T00:00:00.000Z";
const item = (kind = "dialogue") => ({
  ...scope,
  kind,
  id: "source-1",
  revision: 1,
  createdAt: old,
});
const plan = (items: unknown = [item()], at = now) => planLegacyModelQuarantine(items, scope, at);

describe("AI-TWIN legacy quarantine planning — no import authority", () => {
  it.each([
    ["dialogue", "SOURCE_REVIEW_REQUIRED"],
    ["diary", "SOURCE_REVIEW_REQUIRED"],
    ["readiness", "LEGACY_PROGRESS_NOT_EVIDENCE"],
    ["prediction", "LEGACY_REASONING_REVIEW_REQUIRED"],
    ["verification", "LEGACY_REASONING_REVIEW_REQUIRED"],
    ["embedding", "INDEX_NOT_EVIDENCE"],
  ])("keeps %s out of the new model", (kind, reason) => {
    const result = plan([item(kind)]);
    expect(result.status).toBe("plan_only");
    expect(result.items[0]).toEqual({ source: item(kind), disposition: "quarantined", reason });
    expect(result.authority).toEqual({
      import: false,
      modelUse: false,
      formationCredit: false,
      archive: false,
      disclosure: false,
    });
    expect(result.appliedToStorage).toBe(false);
  });
  it("preserves original/unknown time and does not restart retention at inventory time", () => {
    const result = plan([item(), { ...item("diary"), createdAt: null }]);
    expect(result.items.map((x) => x.source.createdAt)).toEqual([old, null]);
    expect(plan([item()], "2027-09-09T09:00:00.000Z").items).toEqual(plan().items);
    expect(result).not.toHaveProperty("expiresAt");
    expect(result).not.toHaveProperty("consent");
  });
  it("does not translate old progress, consent flags or private text into authority", () => {
    for (const extra of [
      { percent: 100 },
      { consent: true },
      { socializationCompleted: true },
      { text: "private" },
      { embedding: [1, 2] },
      { granted: true },
    ]) {
      expect(() => plan([{ ...item(), ...extra }])).toThrow();
    }
  });
  it.each(["organizationId", "subjectId"])(
    "rejects the entire inventory on foreign %s",
    (field) => {
      expect(() => plan([item(), { ...item("diary"), [field]: "other" }])).toThrow(
        "SCOPE_MISMATCH",
      );
    },
  );
  it("rejects duplicate exact identities but distinguishes kind, revision and delimiter-like ids", () => {
    expect(() => plan([item(), item()])).toThrow("DUPLICATE_SOURCE");
    expect(
      plan([item(), item("diary"), { ...item(), revision: 2 }, { ...item(), id: 'source-1\",2]' }])
        .items,
    ).toHaveLength(4);
  });
  it("rejects malformed kinds, clocks and revisions", () => {
    for (const bad of [
      { kind: "action_capability" },
      { createdAt: "yesterday" },
      { createdAt: "2030-01-01T00:00:00.000Z" },
      { createdAt: "2020-01-01" },
      { revision: 0 },
      { revision: 1.5 },
      { id: " " },
    ]) {
      expect(() => plan([{ ...item(), ...bad }])).toThrow();
    }
    expect(() => plan([], "invalid")).toThrow();
    expect(() => planLegacyModelQuarantine([], { ...scope, subjectId: "" }, now)).toThrow();
  });
  it("rejects getters before invocation, sparse arrays, cycles and non-JSON values", () => {
    let invoked = false;
    const accessor = item();
    Object.defineProperty(accessor, "id", {
      enumerable: true,
      get() {
        invoked = true;
        return "bad";
      },
    });
    expect(() => plan([accessor])).toThrow();
    expect(invoked).toBe(false);
    const cycle: unknown[] = [];
    cycle.push(cycle);
    for (const invalid of [
      new Array(1),
      cycle,
      [new Date()],
      [{ ...item(), extra: undefined }],
      { items: [] },
    ]) {
      expect(() => plan(invalid)).toThrow();
    }
  });
  it("is deterministic, immutable and independent of the input", () => {
    const input = [item()];
    const result = plan(input);
    expect(result).toEqual(plan(input));
    input[0].id = "changed";
    expect(result.items[0].source.id).toBe("source-1");
    expect(Object.isFrozen(result.items[0].source)).toBe(true);
    expect(Object.isFrozen(result.authority)).toBe(true);
    expect(plan([]).items).toEqual([]);
  });
});
