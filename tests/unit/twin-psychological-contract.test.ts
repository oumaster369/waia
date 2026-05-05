import { describe, expect, it } from "vitest";

import {
  TWIN_PSYCHOLOGICAL_CONTRACT_MODES,
  TWIN_PSYCHOLOGICAL_CONTRACT_SCHEMA_VERSION,
} from "@/lib/dashboard/twin-psychological-contract-api.types";
import {
  applyPsychologicalSafetyFilters,
  buildEmptyPsychologicalContractResponse,
  buildPsychologicalContractResponse,
  groundingLineSupportedByMemory,
  normalizePsychologicalContractMode,
  normalizePsychologicalLine,
  PSYCHOLOGICAL_FORBIDDEN_CLINICAL,
  PSYCHOLOGICAL_FORBIDDEN_COERCIVE,
  validatePsychologicalContractResponse,
} from "@/lib/reasoning/twin-psychological-contract";

describe("twin psychological contract (DEE-23)", () => {
  it("buildEmptyPsychologicalContractResponse is stable and has all array fields", () => {
    const a = buildEmptyPsychologicalContractResponse();
    const b = buildEmptyPsychologicalContractResponse();
    expect(a).toEqual(b);
    expect(a.schemaVersion).toBe(TWIN_PSYCHOLOGICAL_CONTRACT_SCHEMA_VERSION);
    expect(a.mode).toBe("clarification");
    expect(a.message).toBe("");
    expect(Array.isArray(a.grounding)).toBe(true);
    expect(Array.isArray(a.safetyNotes)).toBe(true);
    expect(a.grounding).toEqual([]);
    expect(a.safetyNotes).toEqual([]);
  });

  it("forbidden clinical lists stay sorted for auditability", () => {
    const s = [...PSYCHOLOGICAL_FORBIDDEN_CLINICAL].sort((x, y) => x.localeCompare(y));
    expect(PSYCHOLOGICAL_FORBIDDEN_CLINICAL).toEqual(s);
    const c = [...PSYCHOLOGICAL_FORBIDDEN_COERCIVE].sort((x, y) => x.localeCompare(y));
    expect(PSYCHOLOGICAL_FORBIDDEN_COERCIVE).toEqual(c);
  });

  it("applyPsychologicalSafetyFilters neutralizes clinical phrasing with notes", () => {
    const r = applyPsychologicalSafetyFilters(
      "this is not a clinical diagnosis but we discuss support",
    );
    expect(r.text).toContain("[filtered]");
    expect(r.notes).toContain("Filtered clinical or diagnostic phrasing.");
  });

  it("applyPsychologicalSafetyFilters neutralizes coercion and shame needles", () => {
    const r = applyPsychologicalSafetyFilters("you must stop and you are a failure if you dont");
    expect(r.text).toContain("[filtered]");
    expect(r.notes).toContain("Filtered coercive or high-pressure phrasing.");
    expect(r.notes).toContain("Filtered shaming phrasing.");
  });

  it("deterministic: same input yields same filter output", () => {
    const x = applyPsychologicalSafetyFilters("please avoid psychiatric diagnosis framing");
    const y = applyPsychologicalSafetyFilters("please avoid psychiatric diagnosis framing");
    expect(x).toEqual(y);
  });

  it("normalizePsychologicalContractMode maps aliases and defaults unknown", () => {
    expect(normalizePsychologicalContractMode("Mirror")).toBe("mirror");
    expect(normalizePsychologicalContractMode("gentle-challenge")).toBe("gentle_challenge");
    expect(normalizePsychologicalContractMode("prediction reflection")).toBe("prediction_reflection");
    expect(normalizePsychologicalContractMode("unknown_mode_xyz")).toBe("clarification");
    expect(normalizePsychologicalContractMode("")).toBe("clarification");
  });

  it("TWIN_PSYCHOLOGICAL_CONTRACT_MODES is sorted", () => {
    const sorted = [...TWIN_PSYCHOLOGICAL_CONTRACT_MODES].sort((a, b) => a.localeCompare(b));
    expect([...TWIN_PSYCHOLOGICAL_CONTRACT_MODES]).toEqual(sorted);
  });

  it("groundingLineSupportedByMemory requires substring of snippet", () => {
    const snips = [normalizePsychologicalLine("i enjoy calm walks in the park", 4096)];
    expect(groundingLineSupportedByMemory("calm walks", snips)).toBe(true);
    expect(groundingLineSupportedByMemory("motorcycle racing", snips)).toBe(false);
  });

  it("buildPsychologicalContractResponse drops fabricated grounding", () => {
    const mem = ["my diary says i prefer morning routines"];
    const r = buildPsychologicalContractResponse({
      mode: "mirror",
      message: "reflecting back what you shared.",
      grounding: ["morning routines", "secret moon base"],
      allowedMemorySnippets: mem,
    });
    expect(r.grounding).toEqual(["morning routines"]);
    expect(r.safetyNotes.some((n) => n.includes("Removed"))).toBe(true);
  });

  it("buildPsychologicalContractResponse is deterministic for same input", () => {
    const input = {
      mode: "support",
      message: "here with you.",
      grounding: ["anchor"],
      allowedMemorySnippets: ["the anchor phrase is anchor"],
    };
    expect(buildPsychologicalContractResponse(input)).toEqual(buildPsychologicalContractResponse(input));
  });

  it("validatePsychologicalContractResponse accepts valid built response", () => {
    const r = buildPsychologicalContractResponse({
      mode: "clarification",
      message: "could you say more?",
      allowedMemorySnippets: ["user asked about goals"],
      grounding: ["goals"],
    });
    expect(validatePsychologicalContractResponse(r)).toEqual({ ok: true });
  });

  it("validatePsychologicalContractResponse rejects bad schema or mode", () => {
    const bad = {
      schemaVersion: "x" as "twin-psychological-contract-v1",
      mode: "nope",
      message: "x",
      grounding: [],
      safetyNotes: [],
    };
    const v = validatePsychologicalContractResponse(bad);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.issues.length).toBeGreaterThan(0);
      const s = [...v.issues].sort((a, b) => a.localeCompare(b));
      expect(v.issues).toEqual(s);
    }
  });

  it("normalizePsychologicalLine collapses whitespace", () => {
    expect(normalizePsychologicalLine("  A  B  ", 100)).toBe("a b");
  });
});
