import { describe, expect, it } from "vitest";

import {
  PERSONALITY_MODEL_MAX_ITEMS_PER_FIELD,
  TWIN_PERSONALITY_MODEL_SCHEMA_VERSION,
} from "@/lib/dashboard/twin-personality-model-api.types";
import type { TwinPersonalityModelSignalInput } from "@/lib/dashboard/twin-personality-model-api.types";
import {
  buildEmptyTwinPersonalityModel,
  buildTwinPersonalityModelFromSignals,
  clampPersonalityConfidence,
  normalizePersonalityModelLabel,
  PERSONALITY_MODEL_CLINICAL_BLOCKLIST,
  passesClinicalBlocklist,
} from "@/lib/reasoning/twin-personality-model-contract";

describe("twin-personality-model-contract (DEE-35)", () => {
  it("buildEmptyTwinPersonalityModel returns stable empty shape", () => {
    const a = buildEmptyTwinPersonalityModel();
    const b = buildEmptyTwinPersonalityModel();
    expect(a).toEqual(b);
    expect(a.schemaVersion).toBe(TWIN_PERSONALITY_MODEL_SCHEMA_VERSION);
    expect(a.model.confidence).toBe(0);
    expect(a.model.dominantTraits).toEqual([]);
    expect(a.model.behavioralPatterns).toEqual([]);
    expect(a.model.emotionalBaseline).toEqual([]);
    expect(a.model.decisionStyle).toEqual([]);
    expect(a.model.relationshipStyle).toEqual([]);
    expect(a.model.contradictionProfile).toEqual([]);
    expect(a.model.growthEdges).toEqual([]);
    expect(a.sourceSignals).toEqual({
      memoryItemsConsidered: 0,
      patternSummaryUsed: false,
      contradictionItemsConsidered: 0,
      verificationItemsConsidered: 0,
    });
  });

  it("normalizePersonalityModelLabel collapses whitespace and lowercases", () => {
    expect(normalizePersonalityModelLabel("  Alpha \n\t Beta  ")).toBe("alpha beta");
  });

  it("clampPersonalityConfidence clamps and rounds to four decimals", () => {
    expect(clampPersonalityConfidence(-1)).toBe(0);
    expect(clampPersonalityConfidence(2)).toBe(1);
    expect(clampPersonalityConfidence(0.123456789)).toBe(0.1235);
    expect(clampPersonalityConfidence(Number.NaN)).toBe(0);
  });

  it("same signals produce identical output deterministically", () => {
    const input: TwinPersonalityModelSignalInput = {
      patternSummary: {
        dominantThemes: ["Theme (mentions=2): steady planning"],
        repeatedBehaviors: ["Repeated focus (2 items): focus"],
        emotionalPatterns: ["Emotional pattern: calm or steadiness"],
        decisionTendencies: ["Decision tendency: explicit choice language"],
        contradictions: [],
      },
      contradictions: [],
      verifications: [{ verification: "accurate", correction: null }],
    };
    const x = buildTwinPersonalityModelFromSignals(input);
    const y = buildTwinPersonalityModelFromSignals(input);
    expect(x).toEqual(y);
  });

  it("caps each model array at PERSONALITY_MODEL_MAX_ITEMS_PER_FIELD", () => {
    const themes = Array.from({ length: 12 }, (_, i) => `Theme token ${String(i).padStart(2, "0")} mentions text`);
    const repeated = Array.from({ length: 12 }, (_, i) => `Repeated focus (${i}): habit${i}`);
    const input: TwinPersonalityModelSignalInput = {
      patternSummary: {
        dominantThemes: themes,
        repeatedBehaviors: repeated,
        emotionalPatterns: Array.from({ length: 12 }, (_, i) => `Emotional pattern: affect${i}`),
        decisionTendencies: Array.from({ length: 12 }, (_, i) => `Decision tendency: cue${i}`),
        contradictions: Array.from({ length: 12 }, (_, i) => `Contrast line ${i}`),
      },
      contradictions: Array.from({ length: 12 }, (_, i) => ({
        type: `type_${i}`,
        description: `Description line ${i}`,
        evidence: [],
        severity: "low" as const,
      })),
      verifications: Array.from({ length: 24 }, (_, i) => ({
        verification: "inaccurate" as const,
        correction: `c${i}`,
      })),
    };
    const r = buildTwinPersonalityModelFromSignals(input);
    expect(r.model.dominantTraits.length).toBeLessThanOrEqual(PERSONALITY_MODEL_MAX_ITEMS_PER_FIELD);
    expect(r.model.behavioralPatterns.length).toBeLessThanOrEqual(PERSONALITY_MODEL_MAX_ITEMS_PER_FIELD);
    expect(r.model.emotionalBaseline.length).toBeLessThanOrEqual(PERSONALITY_MODEL_MAX_ITEMS_PER_FIELD);
    expect(r.model.decisionStyle.length).toBeLessThanOrEqual(PERSONALITY_MODEL_MAX_ITEMS_PER_FIELD);
    expect(r.model.relationshipStyle.length).toBeLessThanOrEqual(PERSONALITY_MODEL_MAX_ITEMS_PER_FIELD);
    expect(r.model.contradictionProfile.length).toBeLessThanOrEqual(PERSONALITY_MODEL_MAX_ITEMS_PER_FIELD);
    expect(r.model.growthEdges.length).toBeLessThanOrEqual(PERSONALITY_MODEL_MAX_ITEMS_PER_FIELD);
  });

  it("maps pattern summary lanes into dominantTraits, behavioralPatterns, and decisionStyle", () => {
    const input: TwinPersonalityModelSignalInput = {
      patternSummary: {
        dominantThemes: ["Theme (mentions=3): stamina"],
        repeatedBehaviors: ["Repeated focus (2 items): morning routine"],
        emotionalPatterns: ["Emotional pattern: gratitude"],
        decisionTendencies: ["Decision tendency: prioritization"],
        contradictions: ["Contrast between memories: always vs never"],
      },
      contradictions: [],
      verifications: [],
    };
    const r = buildTwinPersonalityModelFromSignals(input);
    expect(r.sourceSignals.patternSummaryUsed).toBe(true);
    expect(
      r.model.dominantTraits.some(
        (t) => t.includes("theme (mentions=3): stamina") || t.includes("stamina"),
      ),
    ).toBe(true);
    expect(
      r.model.behavioralPatterns.some((t) => t.includes("repeated focus") || t.includes("routine")),
    ).toBe(true);
    expect(
      r.model.decisionStyle.some((t) =>
        t.includes("decision tendency") || t.includes("prioritization"),
      ),
    ).toBe(true);
    expect(r.model.behavioralPatterns.some((t) => t.includes("pattern tension note"))).toBe(true);
  });

  it("maps detector contradictions into contradictionProfile without evidence text", () => {
    const input: TwinPersonalityModelSignalInput = {
      patternSummary: {
        dominantThemes: [],
        repeatedBehaviors: [],
        emotionalPatterns: [],
        decisionTendencies: [],
        contradictions: [],
      },
      contradictions: [
        {
          type: "emotional_inconsistency",
          description: "Conflicting emotional signals across memories.",
          evidence: ["[pattern_summary] secret user quote that must not leak verbatim"],
          severity: "high",
        },
      ],
      verifications: [],
    };
    const r = buildTwinPersonalityModelFromSignals(input);
    const line = r.model.contradictionProfile.find((l) =>
      l.includes("contradiction signal (emotional_inconsistency)"),
    );
    expect(line).toBeDefined();
    expect(r.model.contradictionProfile.join(" ").includes("secret user quote")).toBe(false);
  });

  it("maps verification kinds into growthEdges calibration notes", () => {
    const input: TwinPersonalityModelSignalInput = {
      patternSummary: {
        dominantThemes: [],
        repeatedBehaviors: [],
        emotionalPatterns: [],
        decisionTendencies: [],
        contradictions: [],
      },
      contradictions: [],
      verifications: [
        { verification: "inaccurate", correction: "x" },
        { verification: "partially_accurate", correction: null },
      ],
    };
    const r = buildTwinPersonalityModelFromSignals(input);
    expect(
      r.model.growthEdges.some((g) => g.includes("inaccurate prediction feedback")),
    ).toBe(true);
    expect(
      r.model.growthEdges.some((g) => g.includes("partially aligned prediction feedback")),
    ).toBe(true);
  });

  it("drops labels that match the clinical blocklist", () => {
    const input: TwinPersonalityModelSignalInput = {
      patternSummary: {
        dominantThemes: [
          "Theme: productivity",
          "Theme aligned with DSM-5 checklist for reviewers only",
        ],
        repeatedBehaviors: ["Repeated focus: diagnosis-seeking language in notes"],
        emotionalPatterns: [],
        decisionTendencies: [],
        contradictions: [],
      },
      contradictions: [],
      verifications: [],
    };
    const r = buildTwinPersonalityModelFromSignals(input);
    const blob = JSON.stringify(r.model).toLowerCase();
    expect(blob.includes("dsm-5")).toBe(false);
    expect(blob.includes("diagnosis")).toBe(false);
  });

  it("relationshipStyle picks themes with relationship keywords only", () => {
    const input: TwinPersonalityModelSignalInput = {
      patternSummary: {
        dominantThemes: ["Theme (mentions=1): friendship circles"],
        repeatedBehaviors: ["Repeated focus (2): social dinners on Fridays"],
        emotionalPatterns: [],
        decisionTendencies: [],
        contradictions: [],
      },
      contradictions: [],
      verifications: [],
    };
    const r = buildTwinPersonalityModelFromSignals(input);
    expect(r.model.relationshipStyle.length).toBeGreaterThan(0);
    expect(r.model.relationshipStyle.some((l) => l.includes("friendship") || l.includes("social"))).toBe(
      true,
    );
  });

  it("clinical blocklist stays sorted for auditability", () => {
    const sorted = [...PERSONALITY_MODEL_CLINICAL_BLOCKLIST].sort((a, b) => a.localeCompare(b));
    expect(PERSONALITY_MODEL_CLINICAL_BLOCKLIST).toEqual(sorted);
  });

  it("passesClinicalBlocklist rejects diagnostic needles", () => {
    expect(passesClinicalBlocklist(normalizePersonalityModelLabel("ok steady planning"))).toBe(true);
    expect(passesClinicalBlocklist(normalizePersonalityModelLabel("dsm-5 criteria reference"))).toBe(false);
  });
});
