import "server-only";

/**
 * DEE-31: Deterministic Twin pattern summary — no LLM, no RNG.
 *
 * Retrieval: fixed embedding query seeds fused via searchTwinMemoriesByText (DEE-32).
 * Summaries: lexicon/token heuristics; all outputs capped and deterministically ordered.
 */

import type { TwinPatternSummaryApiResponse } from "@/lib/dashboard/twin-pattern-summary-api.types";
import { TWIN_PATTERN_SUMMARY_SCHEMA_VERSION } from "@/lib/dashboard/twin-pattern-summary-api.types";
import type { TwinMemorySearchHit } from "@/lib/twin-persistence/twin-memory-retrieval";
import { searchTwinMemoriesByText } from "@/lib/twin-persistence/twin-memory-retrieval";
import type { WaiaSqliteDb } from "@/lib/twin-persistence/loader";

export const PATTERN_SUMMARY_SEED_QUERIES = [
  "habits routines daily behavior patterns",
  "values priorities meaning purpose",
  "stress anxiety emotions feelings mood",
  "decisions tradeoffs choices planning outcomes",
  "relationships social people connection",
  "goals ambitions future direction",
  "conflict tension uncertainty doubt",
] as const;

const PER_SEED_TOP_N = 8;
const MAX_FUSED_ITEMS = 40;

const MAX_DOMINANT_THEMES = 10;
const MAX_REPEATED_BEHAVIORS = 12;
const MAX_EMOTIONAL = 12;
const MAX_DECISION = 12;
const MAX_CONTRADICTIONS = 8;

const STOPWORDS = new Set(
  [
    "about",
    "after",
    "all",
    "also",
    "an",
    "and",
    "any",
    "are",
    "as",
    "at",
    "be",
    "been",
    "before",
    "but",
    "by",
    "can",
    "could",
    "did",
    "do",
    "does",
    "down",
    "for",
    "from",
    "had",
    "has",
    "have",
    "her",
    "here",
    "him",
    "his",
    "how",
    "if",
    "in",
    "into",
    "is",
    "it",
    "its",
    "just",
    "like",
    "me",
    "more",
    "my",
    "no",
    "not",
    "now",
    "of",
    "on",
    "one",
    "only",
    "or",
    "our",
    "out",
    "over",
    "should",
    "so",
    "some",
    "such",
    "than",
    "that",
    "the",
    "their",
    "them",
    "then",
    "there",
    "these",
    "they",
    "this",
    "to",
    "too",
    "up",
    "very",
    "was",
    "we",
    "were",
    "what",
    "when",
    "where",
    "which",
    "who",
    "will",
    "with",
    "would",
    "you",
    "your",
  ].sort(),
);

/** Emotion-related tokens → stable label (emit sorted by label). */
const EMOTION_LEXICON_ROWS: [string, string][] = [
  ["angry", "anger or frustration"],
  ["anxious", "anxiety or worry"],
  ["calm", "calm or steadiness"],
  ["confident", "confidence"],
  ["excited", "excitement or energy"],
  ["exhausted", "fatigue or exhaustion"],
  ["grateful", "gratitude"],
  ["guilty", "guilt"],
  ["happy", "positive affect"],
  ["hopeful", "hope"],
  ["lonely", "loneliness"],
  ["proud", "pride"],
  ["sad", "sadness or low mood"],
  ["stressed", "stress"],
  ["worried", "worry"],
];
EMOTION_LEXICON_ROWS.sort((a, b) => a[0].localeCompare(b[0]));
const EMOTION_LEXICON = EMOTION_LEXICON_ROWS;

const EMOTION_TOKEN_SET = new Set(EMOTION_LEXICON.map(([t]) => t));

/** Decision / reasoning markers → cue label */
const DECISION_MARKERS_ROWS: [string, string][] = [
  ["because", "causal reasoning (because)"],
  ["choose", "explicit choice language"],
  ["chose", "past choice"],
  ["decide", "deciding"],
  ["decided", "decided outcome"],
  ["prefer", "stated preference"],
  ["preference", "preferences"],
  ["prioritize", "prioritization"],
  ["therefore", "consequent reasoning"],
  ["tradeoff", "tradeoff framing"],
  ["trade-offs", "tradeoff framing"],
  ["versus", "comparison framing"],
];
DECISION_MARKERS_ROWS.sort((a, b) => a[0].localeCompare(b[0]));
const DECISION_MARKERS = DECISION_MARKERS_ROWS;

/** Sorted contrast pairs (token a < token b lexicographically for stable output). */
const CONTRAST_PAIRS_ROWS: [string, string][] = [
  ["always", "never"],
  ["anxious", "calm"],
  ["give", "take"],
  ["happy", "sad"],
  ["hopeful", "pessimistic"],
  ["leave", "stay"],
  ["optimistic", "pessimistic"],
  ["risk", "safe"],
].map(([x, y]): [string, string] => (x < y ? [x, y] : [y, x]));

CONTRAST_PAIRS_ROWS.sort((a, b) =>
  a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0]),
);

const CONTRAST_PAIRS = CONTRAST_PAIRS_ROWS;

function hitKey(h: TwinMemorySearchHit): string {
  return `${h.source}:${h.id}`;
}

function tokenize(normText: string): string[] {
  const parts = normText.split(/\P{L}+/u).filter(Boolean);
  const out: string[] = [];
  for (const raw of parts) {
    const t = raw.toLowerCase();
    if (t.length < 3 || STOPWORDS.has(t)) {
      continue;
    }
    out.push(t);
  }
  return out;
}

function normalizedPreview(h: TwinMemorySearchHit): string {
  return h.previewText.normalize("NFKC").toLowerCase();
}

function tokensPerHitPerIndex(hits: TwinMemorySearchHit[]): Map<number, Map<string, number>> {
  const perHitCounts = new Map<number, Map<string, number>>();
  hits.forEach((h, idx) => {
    const freq = new Map<string, number>();
    for (const tok of tokenize(normalizedPreview(h))) {
      freq.set(tok, (freq.get(tok) ?? 0) + 1);
    }
    perHitCounts.set(idx, freq);
  });
  return perHitCounts;
}

export function retrieveMemoriesForPatternSummary(
  db: WaiaSqliteDb,
  userId: string,
): TwinMemorySearchHit[] {
  const merged = new Map<string, TwinMemorySearchHit>();

  for (const seed of PATTERN_SUMMARY_SEED_QUERIES) {
    const slice = searchTwinMemoriesByText(db, userId, seed, PER_SEED_TOP_N);
    for (const hit of slice) {
      const k = hitKey(hit);
      const prev = merged.get(k);
      if (prev === undefined || hit.score > prev.score) {
        merged.set(k, hit);
      }
    }
  }

  const fused = [...merged.values()].sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    const ka = `${a.source}\0${a.id}`;
    const kb = `${b.source}\0${b.id}`;
    return ka.localeCompare(kb);
  });

  return fused.slice(0, MAX_FUSED_ITEMS);
}

/** Core summarizer — pure and deterministic given input order + hit contents. */
export function buildTwinPatternSummaryFromHits(
  hits: TwinMemorySearchHit[],
): Omit<TwinPatternSummaryApiResponse, "seedQueryCount"> {
  if (hits.length === 0) {
    return {
      schemaVersion: TWIN_PATTERN_SUMMARY_SCHEMA_VERSION,
      repeatedBehaviors: [],
      emotionalPatterns: [],
      decisionTendencies: [],
      contradictions: [],
      dominantThemes: [],
      memoryItemsConsidered: 0,
    };
  }

  const perHit = tokensPerHitPerIndex(hits);
  const corpusFreq = new Map<string, number>();
  const hitsPerToken = new Map<string, Set<number>>();

  for (let i = 0; i < hits.length; i++) {
    const freq = perHit.get(i);
    if (!freq) {
      continue;
    }
    for (const [tok, c] of freq) {
      corpusFreq.set(tok, (corpusFreq.get(tok) ?? 0) + c);
      let set = hitsPerToken.get(tok);
      if (set === undefined) {
        set = new Set();
        hitsPerToken.set(tok, set);
      }
      set.add(i);
    }
  }

  const dominantThemes: string[] = [];
  const themeRank = [...corpusFreq.entries()]
    .filter(([t]) => !EMOTION_TOKEN_SET.has(t))
    .sort((a, b) => {
      const [ta, ca] = a;
      const [tb, cb] = b;
      if (cb !== ca) {
        return cb - ca;
      }
      return ta.localeCompare(tb);
    })
    .slice(0, MAX_DOMINANT_THEMES);

  for (const [tok, cnt] of themeRank) {
    dominantThemes.push(`Theme (mentions=${cnt}): ${tok}`);
  }

  const repeatedBehaviors = [...hitsPerToken.entries()]
    .filter(([, idxSet]) => idxSet.size >= 2)
    .map(([tok, idxSet]): [string, number] => [tok, idxSet.size])
    .sort((a, b) => {
      if (b[1] !== a[1]) {
        return b[1] - a[1];
      }
      return a[0].localeCompare(b[0]);
    })
    .slice(0, MAX_REPEATED_BEHAVIORS)
    .map(([tok, n]) => `Repeated focus (${n} memory items): ${tok}`);

  const emotionalSignals = new Set<string>();
  for (const [tok, label] of EMOTION_LEXICON) {
    if (hitsPerToken.has(tok)) {
      emotionalSignals.add(`Emotional pattern: ${label}`);
    }
  }
  const emotionalPatterns = [...emotionalSignals].sort((a, b) => a.localeCompare(b)).slice(0, MAX_EMOTIONAL);

  const decisionSignals = new Set<string>();
  const joined = hits.map((h) => normalizedPreview(h)).join(" \n ");
  for (const [needle, label] of DECISION_MARKERS) {
    if (joined.includes(needle)) {
      decisionSignals.add(`Decision tendency: ${label}`);
    }
  }
  const decisionTendencies = [...decisionSignals].sort((a, b) => a.localeCompare(b)).slice(0, MAX_DECISION);

  const contradictions: string[] = [];
  for (const [a, b] of CONTRAST_PAIRS) {
    const hitsA = hitsPerToken.get(a);
    const hitsB = hitsPerToken.get(b);
    if (!hitsA || !hitsB) {
      continue;
    }
    let found = false;
    for (const ia of hitsA) {
      for (const ib of hitsB) {
        if (ia !== ib) {
          found = true;
          break;
        }
      }
      if (found) {
        break;
      }
    }
    if (found) {
      contradictions.push(`Contrast between memories: "${a}" vs "${b}"`);
    }
  }
  contradictions.sort((x, y) => x.localeCompare(y));
  const contradictionsCapped = contradictions.slice(0, MAX_CONTRADICTIONS);

  return {
    schemaVersion: TWIN_PATTERN_SUMMARY_SCHEMA_VERSION,
    repeatedBehaviors,
    emotionalPatterns,
    decisionTendencies,
    contradictions: contradictionsCapped,
    dominantThemes,
    memoryItemsConsidered: hits.length,
  };
}

export function getTwinPatternSummaryForUser(
  db: WaiaSqliteDb,
  userId: string,
): TwinPatternSummaryApiResponse {
  const hits = retrieveMemoriesForPatternSummary(db, userId);
  const core = buildTwinPatternSummaryFromHits(hits);
  return {
    ...core,
    seedQueryCount: PATTERN_SUMMARY_SEED_QUERIES.length,
  };
}
