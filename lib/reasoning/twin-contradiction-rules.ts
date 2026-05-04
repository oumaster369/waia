/**
 * DEE-29: Deterministic contradiction detection rules — no LLM, no RNG, no DB.
 *
 * Pure evaluator over pattern summary, scenario text, retrieved memory hits,
 * and prediction verifications (DEE-34). Same inputs always yield the same output.
 */

import type { TwinPatternSummaryApiResponse } from "@/lib/dashboard/twin-pattern-summary-api.types";
import type { TwinPredictionVerificationKind } from "@/lib/dashboard/twin-prediction-verification-api.types";
import type { TwinMemorySearchHit } from "@/lib/twin-persistence/twin-memory-retrieval";

export const TWIN_CONTRADICTION_RULES_SCHEMA_VERSION = "twin-contradiction-rules-v1" as const;

export type TwinContradictionSeverity = "low" | "medium" | "high";

export type TwinContradictionEvidenceSource =
  | "pattern_summary"
  | "scenario"
  | "memory"
  | "verification";

export type TwinContradictionPatternSummarySlice = Pick<
  TwinPatternSummaryApiResponse,
  "repeatedBehaviors" | "emotionalPatterns" | "decisionTendencies" | "contradictions" | "dominantThemes"
>;

export type TwinContradictionVerificationInput = {
  verification: TwinPredictionVerificationKind;
  scenario: string;
  correction: string | null;
};

/** Bundle passed in by callers (already user-scoped). */
export type TwinContradictionRuleEvalInput = {
  scenarioText: string;
  patternSummary: TwinContradictionPatternSummarySlice;
  memoryHits: TwinMemorySearchHit[];
  verifications: TwinContradictionVerificationInput[];
};

export type TwinContradictionFinding = {
  type: string;
  description: string;
  evidence: string[];
  severity: TwinContradictionSeverity;
};

export type TwinContradictionRulesResult = {
  contradictions: TwinContradictionFinding[];
};

export type TwinContradictionRuleDescriptor = {
  /** Stable id for downstream systems (DEE-30). */
  name: string;
  /** Output `type` slug — one of five categories. */
  categoryType: string;
  /** Human-readable predicate description. */
  conditionSummary: string;
  evidenceSources: readonly TwinContradictionEvidenceSource[];
  severity: TwinContradictionSeverity;
  /** Short finding description when the rule fires. */
  description: string;
};

function normalizeText(raw: string): string {
  return raw.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function tokenize(normText: string): string[] {
  const parts = normText.split(/\P{L}+/u).filter(Boolean);
  const out: string[] = [];
  for (const raw of parts) {
    const t = raw.toLowerCase();
    if (t.length < 3) {
      continue;
    }
    out.push(t);
  }
  return out;
}

function sortDedupeStrings(lines: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of [...lines].sort((a, b) => a.localeCompare(b))) {
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

function severityRank(s: TwinContradictionSeverity): number {
  if (s === "high") {
    return 0;
  }
  if (s === "medium") {
    return 1;
  }
  return 2;
}

function sortHitsStable(hits: TwinMemorySearchHit[]): TwinMemorySearchHit[] {
  return [...hits].sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    const ka = `${a.source}\0${a.id}`;
    const kb = `${b.source}\0${b.id}`;
    return ka.localeCompare(kb);
  });
}

function sortVerificationsStable(
  rows: TwinContradictionVerificationInput[],
): TwinContradictionVerificationInput[] {
  return [...rows].sort((a, b) => {
    const sa = normalizeText(a.scenario);
    const sb = normalizeText(b.scenario);
    const c = sa.localeCompare(sb);
    if (c !== 0) {
      return c;
    }
    const ca = normalizeText(a.correction ?? "");
    const cb = normalizeText(b.correction ?? "");
    return ca.localeCompare(cb);
  });
}

/** Intent / commitment needles (sorted). */
const INTENT_MARKERS = [
  "always",
  "going to ",
  "never ",
  "never again",
  "quit ",
  " quit",
  "stop ",
  "stopped ",
  "will never",
  "will not",
].sort((a, b) => b.length - a.length || a.localeCompare(b));

/** Decision / framing needles (sorted). */
const DECISION_NEEDLES = [
  "because",
  "choose",
  "chose",
  "decide",
  "decided",
  "prefer",
  "preference",
  "prioritize",
  "therefore",
  "tradeoff",
].sort();

const EMOTION_CONFLICT_PAIRS: [string, string][] = [
  ["anxious", "calm"],
  ["angry", "grateful"],
  ["happy", "sad"],
  ["hopeful", "pessimistic"],
  ["stressed", "calm"],
  ["worried", "hopeful"],
]
  .map(([a, b]): [string, string] => (a < b ? [a, b] : [b, a]))
  .sort((x, y) => (x[0] === y[0] ? x[1].localeCompare(y[1]) : x[0].localeCompare(y[0])));

const VALUE_OPPOSITION_PAIRS: [string[], string[]][] = [
  [["freedom", "autonomy"], ["security", "safety"]],
  [["ambition", "achievement"], ["rest", "recovery", "relax"]],
  [["honesty", "transparent"], ["expediency", "shortcut", "pragmatic"]],
];
VALUE_OPPOSITION_PAIRS.sort((a, b) => a[0][0]!.localeCompare(b[0][0]!));

function hasWord(normScenario: string, word: string): boolean {
  return new RegExp(`\\b${word}\\b`).test(normScenario);
}

function scenarioHasIntentMarker(normScenario: string): boolean {
  if (INTENT_MARKERS.some((m) => normScenario.includes(m.trim().toLowerCase()))) {
    return true;
  }
  return (
    hasWord(normScenario, "never") ||
    hasWord(normScenario, "always") ||
    hasWord(normScenario, "quit") ||
    hasWord(normScenario, "stopped")
  );
}

function scenarioTokensOverlapCorpus(normScenario: string, corpus: string): boolean {
  const st = new Set(tokenize(normScenario));
  if (st.size === 0) {
    return false;
  }
  const ctoks = tokenize(corpus);
  for (const t of ctoks) {
    if (st.has(t)) {
      return true;
    }
  }
  return false;
}

type EvalCtx = {
  normScenario: string;
  summary: TwinContradictionPatternSummarySlice;
  normMemoryBlob: string;
  normSummaryBlob: string;
  sortedHits: TwinMemorySearchHit[];
  sortedVerifs: TwinContradictionVerificationInput[];
};

/** Stated intention vs past behavior — requires intent markers plus overlap with recurring memory/summary signals. */
function evalStatedIntentionVsPast(ctx: EvalCtx): TwinContradictionFinding | null {
  if (!scenarioHasIntentMarker(ctx.normScenario)) {
    return null;
  }

  const rep = ctx.summary.repeatedBehaviors.filter(Boolean);
  const hasRepeated = rep.length > 0;
  const corpusPast = `${ctx.normMemoryBlob}\n${rep.join("\n")}`;
  const overlap = scenarioTokensOverlapCorpus(ctx.normScenario, corpusPast);

  if (!hasRepeated && !overlap) {
    return null;
  }

  const evidenceRaw: string[] = [
    `[scenario] commitment or reversal language (${ctx.normScenario.slice(0, 120)})`,
  ];
  if (hasRepeated) {
    evidenceRaw.push(
      `[pattern_summary] repeated behaviors: ${rep.slice(0, 3).join(" | ")}`,
    );
  }
  if (overlap) {
    evidenceRaw.push(
      `[memory] tokens overlap scenario and longitudinal memory previews (possible stated change vs persisted pattern)`,
    );
  }

  return {
    type: "stated_intention_vs_past_behavior",
    description:
      "Stated intention or reversal language appears alongside recurring behaviors or overlapping memory cues.",
    evidence: sortDedupeStrings(evidenceRaw),
    severity: "medium",
  };
}

/** Emotional inconsistency from summary contrasts or conflicting affect markers. */
function evalEmotionalInconsistency(ctx: EvalCtx): TwinContradictionFinding | null {
  if (ctx.summary.contradictions.length > 0) {
    const sample = ctx.summary.contradictions.slice(0, 5).join(" | ");
    return {
      type: "emotional_inconsistency",
      description:
        "Conflicting emotional signals appear across memories or between scenario and corpus (summary or retrieval).",
      evidence: sortDedupeStrings([`[pattern_summary] contradictions: ${sample}`]),
      severity: "high",
    };
  }

  for (const [lo, hi] of EMOTION_CONFLICT_PAIRS) {
    const sHasLo = ctx.normScenario.includes(lo);
    const sHasHi = ctx.normScenario.includes(hi);
    const memorySummaryBlob = `${ctx.normSummaryBlob}\n${ctx.normMemoryBlob}`;
    const corpHasLo = memorySummaryBlob.includes(lo);
    const corpHasHi = memorySummaryBlob.includes(hi);

    if ((sHasLo && corpHasHi) || (sHasHi && corpHasLo)) {
      const scenarioCue = sHasLo ? lo : hi;
      const memoryCue = sHasLo && corpHasHi ? hi : lo;
      const evidenceRaw = [
        `[scenario] includes affect marker ${scenarioCue}`,
        `[memory] includes opposite marker ${memoryCue} versus scenario`,
      ];
      return {
        type: "emotional_inconsistency",
        description:
          "Conflicting emotional signals appear across memories or between scenario and corpus (summary or retrieval).",
        evidence: sortDedupeStrings(evidenceRaw),
        severity: "medium",
      };
    }
  }

  return null;
}

/** Decision framing conflict — scenario uses absolutes/decision verbs against opposing tendency text. */
function evalDecisionInconsistency(ctx: EvalCtx): TwinContradictionFinding | null {
  const scenarioHasDecision = DECISION_NEEDLES.some((n) => ctx.normScenario.includes(n));
  const scenarioAlways = /\balways\b/.test(ctx.normScenario);
  const scenarioNever = /\bnever\b/.test(ctx.normScenario);
  const memoryBlob = ctx.normMemoryBlob;

  let conflict =
    (scenarioAlways && /\bnever\b/.test(memoryBlob)) || (scenarioNever && /\balways\b/.test(memoryBlob));

  if (scenarioHasDecision && !conflict) {
    const tendencies = ctx.summary.decisionTendencies.join(" ").toLowerCase();
    conflict =
      (scenarioAlways && /\bnever\b/.test(tendencies)) || (scenarioNever && /\balways\b/.test(tendencies));
  }

  if (!conflict) {
    return null;
  }

  const evidenceRaw: string[] = [
    "[scenario] uses always or never framing that opposes contradictory absolutes elsewhere",
  ];
  if (scenarioHasDecision) {
    evidenceRaw.push(`[scenario] decision vocabulary present (${DECISION_NEEDLES.filter((n) => ctx.normScenario.includes(n))[0] ?? "markers"})`);
  }
  if (/\b(always|never)\b/.test(ctx.summary.decisionTendencies.join(" "))) {
    evidenceRaw.push(
      `[pattern_summary] decision tendencies text includes opposing absolute compared with scenario`,
    );
  }
  if (/\b(always|never)\b/.test(memoryBlob)) {
    evidenceRaw.push(`[memory] memory previews contain the opposing absolute relative to scenario`);
  }

  return {
    type: "decision_inconsistency",
    description: "Absolute decision language conflicts with contradictory absolutes in memory or decision tendencies.",
    evidence: sortDedupeStrings(evidenceRaw),
    severity: "medium",
  };
}

/** Values — opposing poles across scenario + summaries + previews (split across scenario vs rest). */
function evalValueConflict(ctx: EvalCtx): TwinContradictionFinding | null {
  const restCorpus = `${ctx.normSummaryBlob}\n${ctx.normMemoryBlob}`;

  for (const [poleA, poleB] of VALUE_OPPOSITION_PAIRS) {
    const scenHasA = poleA.some((p) => ctx.normScenario.includes(p));
    const scenHasB = poleB.some((p) => ctx.normScenario.includes(p));
    const restHasA = poleA.some((p) => restCorpus.includes(p));
    const restHasB = poleB.some((p) => restCorpus.includes(p));
    const bothPolesSomewhere =
      (scenHasA || restHasA) &&
      (scenHasB || restHasB) &&
      poleA.some((p) => (ctx.normScenario + restCorpus).includes(p)) &&
      poleB.some((p) => (ctx.normScenario + restCorpus).includes(p));
    const bridge =
      bothPolesSomewhere && ((scenHasA && restHasB) || (scenHasB && restHasA));
    if (!bridge) {
      continue;
    }
    const hitsA = poleA.filter((p) => (ctx.normScenario + restCorpus).includes(p));
    const hitsB = poleB.filter((p) => (ctx.normScenario + restCorpus).includes(p));
    const scenTouches = [
      ...poleA.filter((p) => ctx.normScenario.includes(p)),
      ...poleB.filter((p) => ctx.normScenario.includes(p)),
    ];
    return {
      type: "value_conflict",
      description: "Opposing value poles co-occur between the scenario text and longitudinal memory summaries.",
      evidence: sortDedupeStrings([
        `[scenario] value language: ${scenTouches.slice(0, 3).sort((x, y) => x.localeCompare(y)).join(", ")}`,
        `[pattern_summary] pole set A (${hitsA
          .slice(0, 3)
          .sort((x, y) => x.localeCompare(y))
          .join(", ")}) versus pole set B (${hitsB
          .slice(0, 3)
          .sort((x, y) => x.localeCompare(y))
          .join(", ")})`,
        `[memory] opposing anchors distributed across previews and summaries`,
      ]),
      severity: "low",
    };
  }

  return null;
}

/** Verification loop shows repeated disagreement with predictions. */
function evalRepeatedFailures(ctx: EvalCtx): TwinContradictionFinding | null {
  const rows = ctx.sortedVerifs;
  let inaccurateCount = 0;
  for (const r of rows) {
    if (r.verification === "inaccurate") {
      inaccurateCount++;
    }
  }

  let prefixMatchBoost = false;
  if (rows.length >= 2) {
    const byScenario = new Map<string, TwinContradictionVerificationInput[]>();
    for (const r of rows) {
      const key = normalizeText(r.scenario).slice(0, 48);
      const list = byScenario.get(key) ?? [];
      list.push(r);
      byScenario.set(key, list);
    }
    for (const group of [...byScenario.values()].sort((a, b) => {
      const ka = normalizeText(a[0]!.scenario).slice(0, 48);
      const kb = normalizeText(b[0]!.scenario).slice(0, 48);
      return ka.localeCompare(kb);
    })) {
      if (group.length < 2) {
        continue;
      }
      const inaccWithCorr = group.find(
        (g) => g.verification === "inaccurate" && Boolean((g.correction ?? "").trim()),
      );
      if (inaccWithCorr === undefined) {
        continue;
      }
      let extra = false;
      for (const g of group) {
        if (g === inaccWithCorr) {
          continue;
        }
        if (g.verification === "partially_accurate" || g.verification === "inaccurate") {
          extra = true;
          break;
        }
      }
      if (extra) {
        prefixMatchBoost = true;
        break;
      }
    }
  }

  if (inaccurateCount < 2 && !prefixMatchBoost) {
    return null;
  }

  const evidenceRaw: string[] = [];
  if (inaccurateCount >= 2) {
    evidenceRaw.push(`inaccurate verification count=${inaccurateCount}`);
  }
  if (prefixMatchBoost) {
    evidenceRaw.push("same scenario prefix has inaccurate row with correction plus another partial/inaccurate signal");
  }

  const evidenceTagged = evidenceRaw.map((line) => `[verification] ${line}`);

  return {
    type: "repeated_failure_patterns",
    description: "Multiple prediction verifications disagree, indicating unstable modeling of the user response surface.",
    evidence: sortDedupeStrings(evidenceTagged),
    severity: inaccurateCount >= 3 ? "high" : "medium",
  };
}

export const TWIN_CONTRADICTION_RULES: readonly TwinContradictionRuleDescriptor[] = [
  {
    name: "stated_intention_vs_past_behavior_v1",
    categoryType: "stated_intention_vs_past_behavior",
    conditionSummary:
      "Scenario includes commitment or reversal markers AND (repeated behaviors exist OR scenario tokens overlap memory/repeated summaries).",
    evidenceSources: ["scenario", "pattern_summary", "memory"],
    severity: "medium",
    description:
      "Stated intention or reversal language appears alongside recurring behaviors or overlapping memory cues.",
  },
  {
    name: "emotional_inconsistency_from_summary_or_affect_v1",
    categoryType: "emotional_inconsistency",
    conditionSummary:
      "Pattern summary contradictions non-empty OR scenario vs corpus split opposite emotion markers from the bounded conflict list.",
    evidenceSources: ["pattern_summary", "scenario", "memory"],
    severity: "high",
    description:
      "Conflicting emotional signals appear across memories or between scenario and corpus (summary or retrieval).",
  },
  {
    name: "decision_inconsistency_absolutes_v1",
    categoryType: "decision_inconsistency",
    conditionSummary:
      "Scenario uses always/never or decision needles while memory or decision tendencies contain the opposing absolute.",
    evidenceSources: ["scenario", "pattern_summary", "memory"],
    severity: "medium",
    description:
      "Absolute decision language conflicts with contradictory absolutes in memory or decision tendencies.",
  },
  {
    name: "value_conflict_opposing_poles_v1",
    categoryType: "value_conflict",
    conditionSummary:
      "Opposing value keywords from the fixed opposition table co-occur with at least one pole stated in the scenario.",
    evidenceSources: ["scenario", "pattern_summary", "memory"],
    severity: "low",
    description:
      "Opposing value poles co-occur between the scenario text and longitudinal memory summaries.",
  },
  {
    name: "repeated_failure_prediction_verifications_v1",
    categoryType: "repeated_failure_patterns",
    conditionSummary:
      "Two or more inaccurate verifications OR inaccurate+correction grouped with another partial/inaccurate on the same scenario prefix.",
    evidenceSources: ["verification"],
    severity: "medium",
    description:
      "Multiple prediction verifications disagree, indicating unstable modeling of the user response surface.",
  },
] as const;

const RULE_EVALUATORS: ReadonlyArray<(ctx: EvalCtx) => TwinContradictionFinding | null> = [
  evalStatedIntentionVsPast,
  evalEmotionalInconsistency,
  evalDecisionInconsistency,
  evalValueConflict,
  evalRepeatedFailures,
];

function buildSummaryBlob(s: TwinContradictionPatternSummarySlice): string {
  return [
    ...s.repeatedBehaviors,
    ...s.emotionalPatterns,
    ...s.decisionTendencies,
    ...s.contradictions,
    ...s.dominantThemes,
  ]
    .map((x) => normalizeText(x))
    .filter(Boolean)
    .join("\n");
}

function buildMemoryBlob(hits: TwinMemorySearchHit[]): string {
  return hits
    .map((h) => normalizeText(h.previewText))
    .join("\n");
}

/**
 * Deterministic evaluation: same input structure and values → identical `contradictions` array
 * (sorted by severity, type, description, evidence join).
 */
export function evaluateTwinContradictionRules(
  input: TwinContradictionRuleEvalInput,
): TwinContradictionRulesResult {
  const normScenario = normalizeText(input.scenarioText);
  const sortedHits = sortHitsStable(input.memoryHits);
  const sortedVerifs = sortVerificationsStable(input.verifications);
  const normMemoryBlob = buildMemoryBlob(sortedHits);
  const normSummaryBlob = buildSummaryBlob(input.patternSummary);

  const ctx: EvalCtx = {
    normScenario,
    summary: input.patternSummary,
    normMemoryBlob,
    normSummaryBlob,
    sortedHits,
    sortedVerifs,
  };

  const findings: TwinContradictionFinding[] = [];

  for (let i = 0; i < RULE_EVALUATORS.length; i++) {
    const f = RULE_EVALUATORS[i]!(ctx);
    if (f === null) {
      continue;
    }
    const descriptor = TWIN_CONTRADICTION_RULES[i]!;
    findings.push({
      ...f,
      description: descriptor.description,
      severity: f.severity,
    });
  }

  findings.sort((a, b) => {
    const rs = severityRank(a.severity) - severityRank(b.severity);
    if (rs !== 0) {
      return rs;
    }
    const tt = a.type.localeCompare(b.type);
    if (tt !== 0) {
      return tt;
    }
    const dd = a.description.localeCompare(b.description);
    if (dd !== 0) {
      return dd;
    }
    return a.evidence.join("\0").localeCompare(b.evidence.join("\0"));
  });

  return { contradictions: findings };
}
