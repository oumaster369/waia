import "server-only";

/**
 * DEE-23 Twin psychological contract — pure enforcement for user-facing Twin wording.
 *
 * Tone boundaries (contract intent):
 * - Respectful; non-clinical; non-diagnostic; grounded in user-provided memory only;
 *   no manipulation; no certainty claims about identity.
 *
 * Allowed response modes: mirror, clarification, gentle_challenge, prediction_reflection,
 * contradiction_reflection, support (see TWIN_PSYCHOLOGICAL_CONTRACT_MODES).
 *
 * Forbidden categories: medical/diagnostic framing, coercive advice, shame language,
 * absolute identity claims, unsupported grounding (treated as fabricated), therapist impersonation.
 *
 * No DB, no LLM, no randomness — deterministic transforms only.
 */

import type {
  BuildPsychologicalContractInput,
  TwinPsychologicalContractApiResponse,
  TwinPsychologicalContractMode,
  ValidatePsychologicalContractResult,
} from "@/lib/dashboard/twin-psychological-contract-api.types";
import {
  TWIN_PSYCHOLOGICAL_CONTRACT_MODES,
  TWIN_PSYCHOLOGICAL_CONTRACT_SCHEMA_VERSION,
} from "@/lib/dashboard/twin-psychological-contract-api.types";

const FILTER_TOKEN = "[filtered]";

export const MAX_PSYCHOLOGICAL_MESSAGE_CHARS = 4096;
export const MAX_GROUNDING_ITEMS = 24;
export const MAX_GROUNDING_LINE_CHARS = 512;

/** Export for auditing: contract tone intent (single string, grep-friendly). */
export const TWIN_PSYCHOLOGICAL_TONE_BOUNDARIES =
  "respectful|non_clinical|non_diagnostic|memory_grounded|no_manipulation|no_identity_certainty";

/** Lowercase needles; clinical / diagnostic (subset aligned with DEE-35 spirit, extended for user-facing copy). */
export const PSYCHOLOGICAL_FORBIDDEN_CLINICAL: readonly string[] = [
  "clinical assessment",
  "clinical diagnosis",
  "clinical diagnosis of",
  "dsm",
  "dsm-5",
  "mental illness",
  "psychiatric diagnosis",
  "psychiatric evaluation",
  "psychiatric",
  "schizophrenia",
  "syndrome diagnosis",
  "your diagnosis",
  "you are bipolar",
  "you have adhd",
  "you have depression",
  "you have ocd",
].sort((a, b) => a.localeCompare(b));

export const PSYCHOLOGICAL_FORBIDDEN_COERCIVE: readonly string[] = [
  "just do it",
  "you must",
  "you need to",
  "you should not feel",
  "you have no choice",
  "or else",
].sort((a, b) => a.localeCompare(b));

export const PSYCHOLOGICAL_FORBIDDEN_SHAME: readonly string[] = [
  "pathetic",
  "worthless",
  "pathetic failure",
  "how could you",
  "you are a failure",
].sort((a, b) => a.localeCompare(b));

export const PSYCHOLOGICAL_FORBIDDEN_IDENTITY: readonly string[] = [
  "you are always",
  "you are never",
  "you will never",
  "you can never",
  "this is who you are forever",
].sort((a, b) => a.localeCompare(b));

export const PSYCHOLOGICAL_FORBIDDEN_THERAPIST: readonly string[] = [
  "as your therapist",
  "as a therapist",
  "diagnostic session",
  "in this session we will diagnose",
  "therapy session diagnosis",
].sort((a, b) => a.localeCompare(b));

const FABRICATION_HINTS: readonly string[] = [
  "you said that you did not say",
  "you told me you remember but",
].sort((a, b) => a.localeCompare(b));

const ALL_NEEDLES: { needles: readonly string[]; note: string }[] = [
  { needles: PSYCHOLOGICAL_FORBIDDEN_CLINICAL, note: "Filtered clinical or diagnostic phrasing." },
  { needles: PSYCHOLOGICAL_FORBIDDEN_COERCIVE, note: "Filtered coercive or high-pressure phrasing." },
  { needles: PSYCHOLOGICAL_FORBIDDEN_SHAME, note: "Filtered shaming phrasing." },
  { needles: PSYCHOLOGICAL_FORBIDDEN_IDENTITY, note: "Filtered absolute identity wording." },
  { needles: PSYCHOLOGICAL_FORBIDDEN_THERAPIST, note: "Filtered therapist-impersonation or diagnostic session framing." },
  { needles: FABRICATION_HINTS, note: "Filtered unsupported memory framing." },
];

const MODE_ALIAS = new Map<string, TwinPsychologicalContractMode>([
  ["mirror", "mirror"],
  ["clarification", "clarification"],
  ["gentle_challenge", "gentle_challenge"],
  ["gentle-challenge", "gentle_challenge"],
  ["gentle challenge", "gentle_challenge"],
  ["prediction_reflection", "prediction_reflection"],
  ["prediction-reflection", "prediction_reflection"],
  ["prediction reflection", "prediction_reflection"],
  ["contradiction_reflection", "contradiction_reflection"],
  ["contradiction-reflection", "contradiction_reflection"],
  ["contradiction reflection", "contradiction_reflection"],
  ["support", "support"],
]);

function uniqSortedStrings(xs: string[]): string[] {
  return [...new Set(xs)].sort((a, b) => a.localeCompare(b));
}

/** NFKC, trim, collapse whitespace, lowercase, bounded length. */
export function normalizePsychologicalLine(raw: string, maxChars: number): string {
  const s = raw
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
  if (s.length === 0) {
    return "";
  }
  return s.length <= maxChars ? s : s.slice(0, maxChars);
}

function replaceCaseInsensitive(haystack: string, needle: string, replacement: string): string {
  if (needle.length === 0) {
    return haystack;
  }
  const lowerH = haystack.toLowerCase();
  const lowerN = needle.toLowerCase();
  let out = "";
  let i = 0;
  while (i < haystack.length) {
    const idx = lowerH.indexOf(lowerN, i);
    if (idx === -1) {
      out += haystack.slice(i);
      break;
    }
    out += haystack.slice(i, idx) + replacement;
    i = idx + needle.length;
  }
  return out;
}

/**
 * Removes forbidden substrings (case-insensitive) by substituting FILTER_TOKEN; accumulates one note per category max.
 */
export function applyPsychologicalSafetyFilters(
  text: string,
  maxLen: number = MAX_PSYCHOLOGICAL_MESSAGE_CHARS,
): { text: string; notes: string[] } {
  let working = text;
  const notes: string[] = [];
  for (const group of ALL_NEEDLES) {
    let groupHit = false;
    const sortedNeedles = [...group.needles].sort((a, b) => b.length - a.length);
    for (const needle of sortedNeedles) {
      const before = working;
      working = replaceCaseInsensitive(working, needle, FILTER_TOKEN);
      if (working !== before) {
        groupHit = true;
      }
    }
    if (groupHit) {
      notes.push(group.note);
    }
  }
  let outNotes = uniqSortedStrings(notes);
  if (working.length > maxLen) {
    working = working.slice(0, maxLen);
    outNotes = uniqSortedStrings([...outNotes, "Truncated text to max length."]);
  }
  return { text: working, notes: outNotes };
}

function normalizeSnippets(snippets: string[]): string[] {
  return uniqSortedStrings(
    snippets.map((s) => normalizePsychologicalLine(s, MAX_PSYCHOLOGICAL_MESSAGE_CHARS)).filter((s) => s.length > 0),
  );
}

/** Grounding line is kept iff it is non-empty and is a substring of at least one normalized memory snippet. */
export function groundingLineSupportedByMemory(line: string, normalizedSnippets: string[]): boolean {
  const n = normalizePsychologicalLine(line, MAX_GROUNDING_LINE_CHARS);
  if (n.length === 0) {
    return false;
  }
  for (const snip of normalizedSnippets) {
    if (snip.includes(n)) {
      return true;
    }
  }
  return false;
}

/**
 * Maps aliases and whitespace to canonical mode; unknown values become `clarification`.
 */
export function normalizePsychologicalContractMode(raw: string): TwinPsychologicalContractMode {
  const key = normalizePsychologicalLine(raw, 128);
  if (key.length === 0) {
    return "clarification";
  }
  const direct = MODE_ALIAS.get(key);
  if (direct != null) {
    return direct;
  }
  const underscored = key.replace(/\s+/g, "_").replace(/-/g, "_");
  const fromUnderscore = MODE_ALIAS.get(underscored);
  if (fromUnderscore != null) {
    return fromUnderscore;
  }
  if ((TWIN_PSYCHOLOGICAL_CONTRACT_MODES as readonly string[]).includes(key)) {
    return key as TwinPsychologicalContractMode;
  }
  return "clarification";
}

export function buildEmptyPsychologicalContractResponse(): TwinPsychologicalContractApiResponse {
  return {
    schemaVersion: TWIN_PSYCHOLOGICAL_CONTRACT_SCHEMA_VERSION,
    mode: "clarification",
    message: "",
    grounding: [],
    safetyNotes: [],
  };
}

export function buildPsychologicalContractResponse(
  input: BuildPsychologicalContractInput,
): TwinPsychologicalContractApiResponse {
  const mode = normalizePsychologicalContractMode(input.mode);
  const rawMessage = normalizePsychologicalLine(input.message, MAX_PSYCHOLOGICAL_MESSAGE_CHARS);
  const filteredMessage = applyPsychologicalSafetyFilters(rawMessage);
  const normalizedSnippets = normalizeSnippets(input.allowedMemorySnippets);

  const notePool: string[] = [...filteredMessage.notes, ...(input.safetyNotes ?? [])];
  const groundingCandidates = input.grounding ?? [];
  const kept: string[] = [];
  let dropped = 0;
  for (const line of groundingCandidates) {
    const lineNorm = normalizePsychologicalLine(line, MAX_GROUNDING_LINE_CHARS);
    if (lineNorm.length === 0) {
      continue;
    }
    if (!groundingLineSupportedByMemory(lineNorm, normalizedSnippets)) {
      dropped++;
      continue;
    }
    const fg = applyPsychologicalSafetyFilters(lineNorm, MAX_GROUNDING_LINE_CHARS);
    notePool.push(...fg.notes);
    const cleaned = fg.text.trim();
    if (cleaned.length === 0) {
      continue;
    }
    if (kept.length < MAX_GROUNDING_ITEMS) {
      kept.push(cleaned);
    }
  }

  if (dropped > 0) {
    notePool.push(`Removed ${dropped} grounding line(s) not supported by allowed memory snippets.`);
  }

  return {
    schemaVersion: TWIN_PSYCHOLOGICAL_CONTRACT_SCHEMA_VERSION,
    mode,
    message: filteredMessage.text,
    grounding: uniqSortedStrings(kept),
    safetyNotes: uniqSortedStrings(notePool),
  };
}

const MODE_SET = new Set<string>(TWIN_PSYCHOLOGICAL_CONTRACT_MODES);

export function validatePsychologicalContractResponse(
  response: TwinPsychologicalContractApiResponse,
): ValidatePsychologicalContractResult {
  const issues: string[] = [];

  if (response.schemaVersion !== TWIN_PSYCHOLOGICAL_CONTRACT_SCHEMA_VERSION) {
    issues.push("Invalid schemaVersion.");
  }
  if (typeof response.message !== "string") {
    issues.push("message must be a string.");
  } else if (response.message.length > MAX_PSYCHOLOGICAL_MESSAGE_CHARS) {
    issues.push("message exceeds max length.");
  }

  if (!MODE_SET.has(response.mode)) {
    issues.push("mode is not a canonical allowed value.");
  }

  if (!Array.isArray(response.grounding)) {
    issues.push("grounding must be an array.");
  } else {
    if (response.grounding.length > MAX_GROUNDING_ITEMS) {
      issues.push("grounding exceeds max item count.");
    }
    for (const g of response.grounding) {
      if (typeof g !== "string" || g.length > MAX_GROUNDING_LINE_CHARS) {
        issues.push("grounding line invalid or too long.");
        break;
      }
    }
  }

  if (!Array.isArray(response.safetyNotes)) {
    issues.push("safetyNotes must be an array.");
  }

  if (issues.length === 0) {
    return { ok: true };
  }
  return { ok: false, issues: uniqSortedStrings(issues) };
}
