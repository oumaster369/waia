import { describe, expect, it } from "vitest";

import type { TwinReadinessDimension } from "@/lib/dashboard/twin-readiness-event-api.types";
import { TWIN_READINESS_EVENT_TYPES } from "@/lib/dashboard/twin-readiness-event-api.types";
import {
  getTwinReadinessEventByType,
  listTwinReadinessEventsForDimension,
  summarizeTwinReadinessEventCatalog,
  TWIN_READINESS_EVENT_CATALOG,
  TWIN_READINESS_EVENTS_SCHEMA_VERSION,
} from "@/lib/reasoning/twin-readiness-events";

const ALL_READINESS_DIMENSIONS: TwinReadinessDimension[] = [
  "baseModel",
  "memory",
  "patterns",
  "contradictions",
  "consistency",
  "feedback",
];

describe("twin readiness events (DEE-43)", () => {
  it("catalog is stable: eight events, lexicographic type order", () => {
    expect(TWIN_READINESS_EVENT_CATALOG.length).toBe(8);
    const types = TWIN_READINESS_EVENT_CATALOG.map((e) => e.type);
    const sorted = [...types].sort((a, b) => a.localeCompare(b));
    expect(types).toEqual(sorted);
    expect(types).toEqual([...TWIN_READINESS_EVENT_TYPES]);
  });

  it("all events map to valid readiness dimensions", () => {
    const allowed = new Set<string>(ALL_READINESS_DIMENSIONS);
    for (const e of TWIN_READINESS_EVENT_CATALOG) {
      expect(allowed.has(e.readinessDimension)).toBe(true);
    }
  });

  it("weights are in [0, 1] and finite", () => {
    for (const e of TWIN_READINESS_EVENT_CATALOG) {
      expect(Number.isFinite(e.weight)).toBe(true);
      expect(e.weight).toBeGreaterThanOrEqual(0);
      expect(e.weight).toBeLessThanOrEqual(1);
    }
  });

  it("no duplicate event types", () => {
    const types = TWIN_READINESS_EVENT_CATALOG.map((e) => e.type);
    expect(new Set(types).size).toBe(8);
  });

  it("every readiness dimension has at least one event", () => {
    const covered = new Set<TwinReadinessDimension>();
    for (const e of TWIN_READINESS_EVENT_CATALOG) {
      covered.add(e.readinessDimension);
    }
    for (const d of ALL_READINESS_DIMENSIONS) {
      expect(covered.has(d)).toBe(true);
    }
  });

  it("summarizeTwinReadinessEventCatalog is deterministic", () => {
    const a = summarizeTwinReadinessEventCatalog();
    const b = summarizeTwinReadinessEventCatalog();
    expect(a).toEqual(b);
    expect(a.schemaVersion).toBe(TWIN_READINESS_EVENTS_SCHEMA_VERSION);
    expect(a.eventCount).toBe(8);
    expect(a.types).toEqual([...TWIN_READINESS_EVENT_TYPES]);
    expect(Object.keys(a.byDimension).sort()).toEqual([...ALL_READINESS_DIMENSIONS].sort());
  });

  it("getTwinReadinessEventByType returns catalog row or undefined", () => {
    expect(getTwinReadinessEventByType("prediction_verified")?.type).toBe("prediction_verified");
    expect(getTwinReadinessEventByType("not_a_real_event")).toBeUndefined();
  });

  it("listTwinReadinessEventsForDimension filters and sorts by type", () => {
    const mem = listTwinReadinessEventsForDimension("memory");
    expect(mem.every((e) => e.readinessDimension === "memory")).toBe(true);
    expect(mem.map((e) => e.type)).toEqual([
      "dialogue_turn_created",
      "diary_entry_created",
      "scenario_answer_created",
    ]);
  });
});
