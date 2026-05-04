/**
 * DEE-35: Deterministic personality model v1 builder — no DB, no LLM, no randomness.
 * Analytic labels only; avoids diagnostic/clinical framing via a substring blocklist.
 */

import type {
  TwinPersonalityModelApiResponse,
  TwinPersonalityModelSignalInput,
} from "@/lib/dashboard/twin-personality-model-api.types";
import {
  MAX_PERSONALITY_LABEL_CHARS,
  PERSONALITY_MODEL_MAX_ITEMS_PER_FIELD,
  TWIN_PERSONALITY_MODEL_SCHEMA_VERSION,
} from "@/lib/dashboard/twin-personality-model-api.types";

const CONFIDENCE_SCALE = 10 ** 4;

/** Lowercased needles; candidate labels are rejected if they include any substring. */
export const PERSONALITY_MODEL_CLINICAL_BLOCKLIST: readonly string[] = [
  "clinical assessment",
  "clinical diagnosis",
  "diagnosis",
  "dsm",
  "dsm-5",
  "mental illness",
  "nihilistic depression",
  "personality disorder",
  "psychiatric diagnosis",
  "psychiatric evaluation",
  "psychiatric",
  "schizophrenia",
  "syndrome diagnosis",
].sort((a, b) => a.localeCompare(b));

const RELATIONSHIP_KEYWORDS = ["family", "friend", "partner", "relationship", "social", "team"].sort(
  (a, b) => a.localeCompare(b),
);

function clamp01Ratio(n: number, denom: number): number {
  if (denom <= 0 || !Number.isFinite(n)) {
    return 0;
  }
  return Math.min(1, Math.max(0, n / denom));
}

function uniqSorted(strings: string[]): string[] {
  return [...new Set(strings)].sort((a, b) => a.localeCompare(b));
}

function capField(items: string[]): string[] {
  return items.slice(0, PERSONALITY_MODEL_MAX_ITEMS_PER_FIELD);
}

/** NFKC, trim, collapsed whitespace, lowercase, bounded length. */
export function normalizePersonalityModelLabel(raw: string): string {
  const s = raw
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
  if (s.length === 0) {
    return "";
  }
  return s.length <= MAX_PERSONALITY_LABEL_CHARS ? s : s.slice(0, MAX_PERSONALITY_LABEL_CHARS);
}

export function passesClinicalBlocklist(normalizedLabel: string): boolean {
  if (normalizedLabel.length === 0) {
    return false;
  }
  for (const needle of PERSONALITY_MODEL_CLINICAL_BLOCKLIST) {
    if (normalizedLabel.includes(needle)) {
      return false;
    }
  }
  return true;
}

function safeLabel(raw: string): string | null {
  const n = normalizePersonalityModelLabel(raw);
  if (n.length === 0 || !passesClinicalBlocklist(n)) {
    return null;
  }
  return n;
}

/** Confidence in approximately [0, 1], rounded to four decimal places (deterministic). */
export function clampPersonalityConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const y = Math.max(0, Math.min(1, value));
  return Math.round(y * CONFIDENCE_SCALE) / CONFIDENCE_SCALE;
}

function patternLanesWithData(
  ps: TwinPersonalityModelSignalInput["patternSummary"],
): number {
  let n = 0;
  if (ps.repeatedBehaviors.length > 0) {
    n++;
  }
  if (ps.emotionalPatterns.length > 0) {
    n++;
  }
  if (ps.decisionTendencies.length > 0) {
    n++;
  }
  if (ps.contradictions.length > 0) {
    n++;
  }
  if (ps.dominantThemes.length > 0) {
    n++;
  }
  return n;
}

function patternSummaryUsedHeuristic(
  ps: TwinPersonalityModelSignalInput["patternSummary"],
): boolean {
  return patternLanesWithData(ps) > 0;
}

function collectSafeLabels(rows: string[]): string[] {
  const out: string[] = [];
  for (const r of rows) {
    const s = safeLabel(r);
    if (s !== null) {
      out.push(s);
    }
  }
  return uniqSorted(out);
}

function lineMentionsRelationshipKeyword(normalizedLine: string): boolean {
  for (const kw of RELATIONSHIP_KEYWORDS) {
    if (normalizedLine.includes(kw)) {
      return true;
    }
  }
  return false;
}

function buildRelationshipStyleLines(ps: TwinPersonalityModelSignalInput["patternSummary"]): string[] {
  const candidates: string[] = [];
  for (const r of [...ps.dominantThemes, ...ps.repeatedBehaviors]) {
    const s = safeLabel(r);
    if (s !== null && lineMentionsRelationshipKeyword(s)) {
      candidates.push(s);
    }
  }
  return capField(uniqSorted(candidates));
}

export function buildEmptyTwinPersonalityModel(): TwinPersonalityModelApiResponse {
  return {
    schemaVersion: TWIN_PERSONALITY_MODEL_SCHEMA_VERSION,
    model: {
      dominantTraits: [],
      behavioralPatterns: [],
      emotionalBaseline: [],
      decisionStyle: [],
      relationshipStyle: [],
      contradictionProfile: [],
      growthEdges: [],
      confidence: clampPersonalityConfidence(0),
    },
    sourceSignals: {
      memoryItemsConsidered: 0,
      patternSummaryUsed: false,
      contradictionItemsConsidered: 0,
      verificationItemsConsidered: 0,
    },
  };
}

function buildGrowthEdges(
  contradictionCount: number,
  verifications: TwinPersonalityModelSignalInput["verifications"],
): string[] {
  let inaccurate = 0;
  let partial = 0;
  for (const v of verifications) {
    if (v.verification === "inaccurate") {
      inaccurate++;
    }
    if (v.verification === "partially_accurate") {
      partial++;
    }
  }
  const lines: string[] = [];
  if (inaccurate > 0) {
    lines.push("Calibration note: inaccurate prediction feedback observed");
  }
  if (partial > 0) {
    lines.push("Calibration note: partially aligned prediction feedback observed");
  }
  if (contradictionCount > 0) {
    lines.push("Calibration note: inconsistency indicators present");
  }
  return capField(uniqSorted(lines));
}

function buildContradictionProfile(
  findings: TwinPersonalityModelSignalInput["contradictions"],
): string[] {
  const sorted = [...findings].sort((a, b) => {
    const ct = a.type.localeCompare(b.type);
    if (ct !== 0) {
      return ct;
    }
    return a.description.localeCompare(b.description);
  });
  const lines: string[] = [];
  for (const f of sorted) {
    const desc = safeLabel(f.description);
    if (desc === null) {
      continue;
    }
    const line = normalizePersonalityModelLabel(`Contradiction signal (${f.type}): ${desc}`);
    if (line.length > 0 && passesClinicalBlocklist(line)) {
      lines.push(line);
    }
  }
  return capField(uniqSorted(lines));
}

function buildBehavioralPatterns(ps: TwinPersonalityModelSignalInput["patternSummary"]): string[] {
  const primary = collectSafeLabels(ps.repeatedBehaviors);
  const merged: string[] = [...primary];
  if (merged.length < PERSONALITY_MODEL_MAX_ITEMS_PER_FIELD) {
    for (const c of ps.contradictions) {
      const base = safeLabel(c);
      if (base === null) {
        continue;
      }
      const note = normalizePersonalityModelLabel(`Pattern tension note: ${base}`);
      if (note.length > 0 && passesClinicalBlocklist(note)) {
        merged.push(note);
      }
      if (merged.length >= PERSONALITY_MODEL_MAX_ITEMS_PER_FIELD) {
        break;
      }
    }
  }
  return capField(uniqSorted(merged));
}

function buildDominantTraits(ps: TwinPersonalityModelSignalInput["patternSummary"]): string[] {
  const themes = collectSafeLabels(ps.dominantThemes);
  const repeated = collectSafeLabels(ps.repeatedBehaviors);
  return capField(uniqSorted([...themes, ...repeated]));
}

/**
 * Deterministic v1 personality envelope from pattern summary slice, contradiction findings,
 * and verification kinds. Same input yields the same output.
 */
export function buildTwinPersonalityModelFromSignals(
  input: TwinPersonalityModelSignalInput,
): TwinPersonalityModelApiResponse {
  const memory = Math.max(0, Math.floor(input.memoryItemsConsidered ?? 0));
  const memPart = 0.25 * clamp01Ratio(memory, 40);
  const lanes = patternLanesWithData(input.patternSummary);
  const patternPart = 0.25 * clamp01Ratio(lanes, 5);
  const contraPart = 0.25 * clamp01Ratio(input.contradictions.length, 8);
  const verifPart = 0.25 * clamp01Ratio(input.verifications.length, 20);
  const confidence = clampPersonalityConfidence(memPart + patternPart + contraPart + verifPart);

  const dominantTraits = buildDominantTraits(input.patternSummary);
  const behavioralPatterns = buildBehavioralPatterns(input.patternSummary);
  const emotionalBaseline = capField(collectSafeLabels(input.patternSummary.emotionalPatterns));
  const decisionStyle = capField(collectSafeLabels(input.patternSummary.decisionTendencies));
  const relationshipStyle = buildRelationshipStyleLines(input.patternSummary);
  const contradictionProfile = buildContradictionProfile(input.contradictions);
  const growthEdges = buildGrowthEdges(input.contradictions.length, input.verifications);

  return {
    schemaVersion: TWIN_PERSONALITY_MODEL_SCHEMA_VERSION,
    model: {
      dominantTraits,
      behavioralPatterns,
      emotionalBaseline,
      decisionStyle,
      relationshipStyle,
      contradictionProfile,
      growthEdges,
      confidence,
    },
    sourceSignals: {
      memoryItemsConsidered: memory,
      patternSummaryUsed: patternSummaryUsedHeuristic(input.patternSummary),
      contradictionItemsConsidered: input.contradictions.length,
      verificationItemsConsidered: input.verifications.length,
    },
  };
}
