import { describe, expect, it } from "vitest";

import type { TwinUnlockEntry } from "@/lib/dashboard/twin-unlock-api.types";
import {
  DEFAULT_ALMOST_UNLOCK_EPSILON,
  FEATURE_GROWTH_CATALOG,
  resolveTwinUnlockPresentation,
  tabUiForbiddenPhraseRegex,
} from "@/lib/dashboard/twin-unlock-tab-ui";

function entry(unlocked: boolean, reason: string): TwinUnlockEntry {
  return { unlocked, reason };
}

function catalogAllStrings(): string[] {
  const out: string[] = [];
  for (const v of Object.values(FEATURE_GROWTH_CATALOG)) {
    out.push(v.journeyLine, v.nextStepHint, v.reasonGrowthWhenLocked);
  }
  return out;
}

describe("twin-unlock-tab-ui (DEE-48)", () => {
  it("static growth catalogue avoids forbidden phrasing", () => {
    const re = tabUiForbiddenPhraseRegex();
    for (const s of catalogAllStrings()) {
      expect(s).not.toMatch(re);
    }
  });

  it("returns unlocked phase when entry is unlocked without consulting scores", () => {
    const pres = resolveTwinUnlockPresentation({
      feature: "diary",
      unlockEntry: entry(true, "ok"),
      readinessScores: {
        baseModel: 0,
        memory: 0,
        patterns: 0,
        contradictions: 0,
        consistency: 0,
        feedback: 0,
      },
      overall: 0,
    });
    expect(pres.phase).toBe("unlocked");
    expect(pres.unlocked).toBe(true);
  });

  it("classifies almost_unlocked when tightest positive gap is within epsilon", () => {
    const pres = resolveTwinUnlockPresentation({
      feature: "diary",
      unlockEntry: entry(false, "still forming"),
      readinessScores: {
        baseModel: 0.25,
        memory: 0,
        patterns: 0,
        contradictions: 0,
        consistency: 0,
        feedback: 0,
      },
      overall: 0,
      almostEpsilon: DEFAULT_ALMOST_UNLOCK_EPSILON,
    });
    expect(pres.phase).toBe("almost_unlocked");
  });

  it("classifies growing when not almost but a dimension shows early signal", () => {
    const pres = resolveTwinUnlockPresentation({
      feature: "diary",
      unlockEntry: entry(false, "still forming"),
      readinessScores: {
        baseModel: 0.24,
        memory: 0.11,
        patterns: 0,
        contradictions: 0,
        consistency: 0,
        feedback: 0,
      },
      overall: 0,
      almostEpsilon: DEFAULT_ALMOST_UNLOCK_EPSILON,
    });
    expect(pres.phase).toBe("growing");
  });

  it("classifies locked when far from gates and no formation signal", () => {
    const pres = resolveTwinUnlockPresentation({
      feature: "diary",
      unlockEntry: entry(false, "still forming"),
      readinessScores: {
        baseModel: 0.08,
        memory: 0.05,
        patterns: 0,
        contradictions: 0,
        consistency: 0,
        feedback: 0,
      },
      overall: 0,
      almostEpsilon: DEFAULT_ALMOST_UNLOCK_EPSILON,
    });
    expect(pres.phase).toBe("locked");
  });

  it("never flips unlocked boolean from the entry", () => {
    const locked = resolveTwinUnlockPresentation({
      feature: "twin_chat",
      unlockEntry: entry(false, ""),
      readinessScores: {
        baseModel: 1,
        memory: 1,
        patterns: 1,
        contradictions: 1,
        consistency: 1,
        feedback: 1,
      },
      overall: 1,
    });
    expect(locked.unlocked).toBe(false);
  });
});
