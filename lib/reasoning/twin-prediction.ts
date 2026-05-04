import "server-only";

/**
 * DEE-33: Deterministic Twin prediction over a user scenario — no LLM, no RNG.
 *
 * Combines embedding retrieval keyed on the scenario, pattern summary (DEE-31),
 * SHA-256 template selection, and fixed keyword overlays.
 */

import { createHash } from "node:crypto";

import type { TwinPredictionApiResponse } from "@/lib/dashboard/twin-prediction-api.types";
import type { TwinPatternSummaryApiResponse } from "@/lib/dashboard/twin-pattern-summary-api.types";
import type { TwinMemorySearchHit } from "@/lib/twin-persistence/twin-memory-retrieval";
import {
  searchTwinMemoriesByText,
} from "@/lib/twin-persistence/twin-memory-retrieval";
import type { WaiaSqliteDb } from "@/lib/twin-persistence/loader";
import { getTwinPatternSummaryForUser } from "@/lib/reasoning/twin-pattern-summary";

export const MAX_SCENARIO_CHARS = 16_384;
const TOP_N_SCENARIO = 16;
const CONFIDENCE_SCALE = 10_000;
const MAX_REASONING_LINES = 14;

const OUTCOME_BASE_TEMPLATES = [
  "Baseline trajectory favors patient adjustment with modest drift toward continuity.",
  "Modeled path suggests prioritizing clarification before commitment under uncertainty.",
  "Likely equilibrium trends toward stabilization after an initial turbulence window.",
  "Expect incremental progress if constraints stay bounded and feedback loops stay short.",
  "Trajectory skews cautious: consolidate wins before scaling scope.",
  "Forward view favors exploratory moves that remain reversible early on.",
  "Outlook points to momentum if social support signals stay positive.",
  "Modeled arc implies tradeoffs tighten; sequencing choices will matter.",
] as const;

const DEADLINE_MARKERS = ["deadline", "overdue", "sprint", "timeline"].sort();

function digestFirstUint32(normalizedScenario: string): number {
  return createHash("sha256").update(normalizedScenario, "utf8").digest().readUInt32BE(0);
}

/** NFKC trim, lowercase, single-space collapse — matches prediction contract inputs. */
export function normalizeTwinPredictionScenario(raw: string): string {
  return raw.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function clamp01Round(x: number): number {
  const y = Math.max(0, Math.min(1, x));
  return Math.round(y * CONFIDENCE_SCALE) / CONFIDENCE_SCALE;
}

function meanTopScores01(hits: TwinMemorySearchHit[], k: number): number {
  if (hits.length === 0) {
    return 0;
  }
  const n = Math.min(k, hits.length);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const s = hits[i]!.score;
    sum += (s + 1) / 2;
  }
  return sum / n;
}

function deadlinePressure(norm: string): boolean {
  return DEADLINE_MARKERS.some((m) => norm.includes(m));
}

function summaryHasStress(summary: TwinPatternSummaryApiResponse): boolean {
  const blob = [...summary.emotionalPatterns, ...summary.dominantThemes].join("\n").toLowerCase();
  return (
    blob.includes("stress") ||
    blob.includes("anxiety") ||
    blob.includes("worry") ||
    blob.includes("tension") ||
    blob.includes("angry") ||
    blob.includes("sadness")
  );
}

function summaryRichness01(summary: TwinPatternSummaryApiResponse): number {
  const r =
    summary.dominantThemes.length +
    summary.repeatedBehaviors.length * 0.55 +
    summary.emotionalPatterns.length * 1.05 +
    summary.decisionTendencies.length * 1.05 +
    summary.contradictions.length * 1.35;
  return Math.min(1, r / 22);
}

function sourceMixLine(hits: TwinMemorySearchHit[]): string {
  const counts: Record<string, number> = { dialogue: 0, diary: 0, scenario: 0 };
  for (const h of hits) {
    counts[h.source] = (counts[h.source] ?? 0) + 1;
  }
  const parts = ["dialogue", "diary", "scenario"]
    .filter((k) => (counts[k] ?? 0) > 0)
    .sort()
    .map((k) => `${k}:${counts[k]}`);
  return parts.length ? parts.join(", ") : "none";
}

/**
 * Pure prediction from normalized scenario + summaries + fused retrieval hits (tests).
 */
export function buildTwinPredictionFromInputs(
  normalizedScenario: string,
  summary: TwinPatternSummaryApiResponse,
  hits: TwinMemorySearchHit[],
): TwinPredictionApiResponse {
  if (normalizedScenario.length === 0) {
    return {
      outcome:
        "Cannot simulate outcomes without a concrete scenario description in this MVP path.",
      reasoning: ["Scenario normalization produced an empty string; no forward model applied."],
      confidence: 0.105,
    };
  }

  if (hits.length === 0 && summary.memoryItemsConsidered === 0) {
    return {
      outcome:
        "Insufficient Twin memory to anchor a scenario-specific projection; stance remains provisional and conservative.",
      reasoning: [
        "Retrieval: no embedded memories surfaced for this user (empty corpus).",
        "Pattern summary: no fused memory items computed (memoryItemsConsidered=0).",
        "Confidence is intentionally low pending meaningful dialogue/diary/scenario signals.",
      ],
      confidence: 0.2,
    };
  }

  const variant = digestFirstUint32(normalizedScenario) >>> 0;
  let outcome =
    OUTCOME_BASE_TEMPLATES[variant % OUTCOME_BASE_TEMPLATES.length] ?? OUTCOME_BASE_TEMPLATES[0]!;
  const reasoning: string[] = [];

  const mix = sourceMixLine(hits);
  reasoning.push(
    hits.length === 0
      ? `Retrieval: no scenario-aligned embedded hits (top fused list empty despite profile activity). Mix (n/a)=${mix}.`
      : `Retrieval: ${hits.length} scenario-aligned items; source mix (${mix}).`,
  );

  if (hits.length > 0) {
    const p = hits[0]!.previewText;
    reasoning.push(
      p.length > 160
        ? `Strongest aligned memory preview: ${p.slice(0, 157)}…`
        : `Strongest aligned memory preview: ${p}`,
    );
  }

  reasoning.push(
    `Pattern summary index: dominantThemes=${summary.dominantThemes.length}, contradictions=${summary.contradictions.length}, emotionalSignals=${summary.emotionalPatterns.length}, decisions=${summary.decisionTendencies.length}; fused-memoryItems=${summary.memoryItemsConsidered}.`,
  );

  reasoning.push(`Scenario hash bucket=${variant % OUTCOME_BASE_TEMPLATES.length} (SHA-256 index).`);

  const rules: string[] = [];
  const dp = deadlinePressure(normalizedScenario);
  const sx = summaryHasStress(summary);

  if (dp && sx) {
    rules.push("deadline-plus-stress-patterns");
    outcome += " Time-pressure framing intersects recurring stress-pattern signals.";
  }

  const hasContrasts = summary.contradictions.length > 0;
  if (hasContrasts) {
    rules.push("pattern-contradictions-present");
    outcome += " Competing autobiographical motifs reduce single-path certainty.";
  }

  if (hits.length === 0) {
    rules.push("weak-scenario-retrieval");
    reasoning.push("Rule: retrieval empty — leaning on aggregated pattern signals only.");
  }

  if (rules.length === 0) {
    reasoning.push("Rules: baseline template only (no keyword overlays triggered).");
  } else {
    reasoning.push(`Rules applied (sorted): ${[...rules].sort().join(", ")}`);
  }

  let conf =
    0.28 +
    0.33 * meanTopScores01(hits, 5) +
    0.16 * Math.min(1, hits.length / 16) +
    0.19 * Math.min(1, summary.memoryItemsConsidered / 36) +
    0.12 * summaryRichness01(summary);

  if (hasContrasts) {
    conf -= 0.068;
    reasoning.push("Confidence tempered because pattern-summary contradictions are non-empty.");
  }
  if (dp && sx) {
    conf -= 0.022;
    reasoning.push(
      "Confidence nudged down: deadline-pressure language plus stress-aligned pattern traces increase variance.",
    );
  }
  if (hits.length === 0 && summary.memoryItemsConsidered > 0) {
    conf -= 0.06;
    reasoning.push(
      "Confidence reduced: scenario-specific retrieval yielded no fused hits despite some profile summaries.",
    );
  }

  reasoning.push(
    `Confidence composition: cosine-based retrieval (${hits.length ? "active" : "inactive"}), summary richness (${summaryRichness01(summary).toFixed(4)} scaled), contradiction penalty (${hasContrasts ? "yes" : "no"}).`,
  );

  if (reasoning.length > MAX_REASONING_LINES) {
    reasoning.length = MAX_REASONING_LINES;
  }

  return {
    outcome: outcome.trim(),
    reasoning,
    confidence: clamp01Round(conf),
  };
}

export function runTwinPredictionForUser(
  db: WaiaSqliteDb,
  userId: string,
  scenarioTrimmed: string,
): TwinPredictionApiResponse {
  const normalized = normalizeTwinPredictionScenario(scenarioTrimmed);
  const hits = searchTwinMemoriesByText(db, userId, scenarioTrimmed, TOP_N_SCENARIO);
  const summary = getTwinPatternSummaryForUser(db, userId);
  return buildTwinPredictionFromInputs(normalized, summary, hits);
}
