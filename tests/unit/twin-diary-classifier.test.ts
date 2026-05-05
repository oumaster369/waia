import { describe, expect, it } from "vitest";

import { TWIN_DIARY_SCHEMA_VERSION } from "@/lib/dashboard/twin-diary-schema.types";
import { classifyDiaryEntry, enrichTwinDiaryEntry } from "@/lib/reasoning/twin-diary-classifier";

describe("twin-diary-classifier (DEE-45)", () => {
  it("empty body → reflection, no signals, impact without memory", () => {
    const d = classifyDiaryEntry("");
    expect(d.schemaVersion).toBe(TWIN_DIARY_SCHEMA_VERSION);
    expect(d.classification.type).toBe("reflection");
    expect(d.signals.emotions).toEqual([]);
    expect(d.signals.decisions).toEqual([]);
    expect(d.signals.themes).toEqual([]);
    expect(d.impact.contributesTo).toEqual([]);
  });

  it("past-tense narrative → event when no stronger labels", () => {
    const d = classifyDiaryEntry("Yesterday I went to work and felt busy.");
    expect(d.classification.type).toBe("event");
  });

  it("clear emotion word → emotion when not reflection", () => {
    const d = classifyDiaryEntry("I feel happy today.");
    expect(d.classification.type).toBe("emotion");
    expect(d.signals.emotions).toContain("happy");
  });

  it("reasoning markers take precedence over emotion and event", () => {
    const d = classifyDiaryEntry(
      "I think yesterday I was sad because work was hard and I felt overwhelmed.",
    );
    expect(d.classification.type).toBe("reflection");
  });

  it("reflection vs emotion: because alone elevates to reflection", () => {
    expect(classifyDiaryEntry("I felt sad because.").classification.type).toBe("reflection");
  });

  it("extracts themes and decisions with sorted unique outputs", () => {
    const d = classifyDiaryEntry(
      "family, work, Family — I decided to plan to rest. money work",
    );
    expect(d.signals.themes).toEqual(["family", "money", "work"]);
    expect(d.signals.decisions.sort()).toEqual(d.signals.decisions);
    expect(d.signals.decisions.length).toBeGreaterThan(0);
    expect(d.impact.contributesTo).toEqual(["memory", "patterns", "readiness"]);
  });

  it("caps signal lists at eight", () => {
    const words =
      "happy sad angry anxious grateful hopeful proud tired worried calm excited confused hurt guilty";
    const d = classifyDiaryEntry(words);
    expect(d.signals.emotions.length).toBeLessThanOrEqual(8);
  });

  it("impact is sorted and deduped; adds personality when emotions present", () => {
    const d = classifyDiaryEntry("I felt sad about money and should save.");
    expect(d.impact.contributesTo).toEqual(["memory", "patterns", "personality", "readiness"]);
    expect(d.impact.contributesTo).toEqual([...new Set(d.impact.contributesTo)].sort());
  });

  it("is deterministic for repeated classification", () => {
    const body = "Stress at work; I need to decide on health and family.";
    const a = JSON.stringify(classifyDiaryEntry(body));
    const b = JSON.stringify(classifyDiaryEntry(body));
    expect(a).toBe(b);
  });

  it("enrichTwinDiaryEntry merges base DTO with derived fields", () => {
    const ext = enrichTwinDiaryEntry({
      id: "e1",
      body: "grateful for calm time",
      createdAt: "2026-05-03T00:00:00.000Z",
    });
    expect(ext.id).toBe("e1");
    expect(ext.schemaVersion).toBe(TWIN_DIARY_SCHEMA_VERSION);
    expect(ext.signals.emotions.length).toBeGreaterThan(0);
    expect(ext.impact.contributesTo).toContain("memory");
  });
});
