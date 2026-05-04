/**
 * DEE-45: Diary entry classification + keyword signals — deterministic; no LLM.
 * Consumers merge `{ schemaVersion, classification, signals, impact }` onto `DiaryMemoryEntryDto`,
 * or use {@link enrichTwinDiaryEntry}.
 */

import type { DiaryMemoryEntryDto } from "@/lib/dashboard/diary-memory-api.types";
import type {
  TwinDiaryClassificationType,
  TwinDiaryEntryExtended,
  TwinDiaryImpactTarget,
} from "@/lib/dashboard/twin-diary-schema.types";
import { TWIN_DIARY_SCHEMA_VERSION } from "@/lib/dashboard/twin-diary-schema.types";

const SORT_LOCALE = "en";
const SIGNAL_CAP = 8;

/** Fixed lexicons (alphabetical) so iteration and tests stay stable. */
const EMOTION_LEXICON = [
  "angry",
  "anxious",
  "ashamed",
  "calm",
  "confused",
  "content",
  "depressed",
  "disappointed",
  "excited",
  "fearful",
  "frustrated",
  "grateful",
  "guilty",
  "happy",
  "hopeful",
  "hurt",
  "lonely",
  "loved",
  "nervous",
  "overwhelmed",
  "peaceful",
  "proud",
  "relieved",
  "sad",
  "stressed",
  "tired",
  "worried",
].sort((a, b) => a.localeCompare(b, SORT_LOCALE));

const DECISION_LEXICON = [
  "choose",
  "chose",
  "decide",
  "decided",
  "deciding",
  "i will",
  "i won't",
  "i wont",
  "need to",
  "ought to",
  "plan to",
  "should",
  "will not",
  "won't",
  "wont",
].sort((a, b) => a.localeCompare(b, SORT_LOCALE));

const THEME_LEXICON = [
  "career",
  "children",
  "community",
  "education",
  "exercise",
  "family",
  "friends",
  "health",
  "home",
  "money",
  "parents",
  "relationship",
  "schedule",
  "sleep",
  "stress",
  "travel",
  "vacation",
  "work",
].sort((a, b) => a.localeCompare(b, SORT_LOCALE));

const EVENT_RE =
  /\b(was|were|had|did|went|said|felt|got|made|met|spent|today|yesterday|last\s+week)\b/;

const REFLECTION_RES: readonly RegExp[] = [
  /\bi think\b/,
  /\bbecause\b/,
  /\btherefore\b/,
  /\breflection\b/,
  /\bi feel that\b/,
  /\bin my view\b/,
  /\bmy conclusion\b/,
];

export type TwinDiaryDerivedFields = {
  schemaVersion: typeof TWIN_DIARY_SCHEMA_VERSION;
  classification: { type: TwinDiaryClassificationType };
  signals: {
    emotions: string[];
    decisions: string[];
    themes: string[];
  };
  impact: { contributesTo: TwinDiaryImpactTarget[] };
};

function normalizeBody(raw: string): string {
  return raw.normalize("NFKC").trim().toLowerCase();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Word-ish match: phrase with spaces or single token with boundaries. */
function matchesLexeme(text: string, phrase: string): boolean {
  if (phrase.includes(" ")) {
    const escaped = phrase.split(/\s+/).map(escapeRegExp).join("\\s+");
    return new RegExp(`(?:^|[\\s,.;:!?'"]+)${escaped}(?:$|[\\s,.;:!?'"]+)`, "i").test(text);
  }
  return new RegExp(`\\b${escapeRegExp(phrase)}\\b`, "i").test(text);
}

function collectLexiconHits(text: string, lexicon: readonly string[]): string[] {
  const found = new Set<string>();
  for (const term of lexicon) {
    if (matchesLexeme(text, term)) {
      found.add(term);
    }
  }
  return [...found].sort((a, b) => a.localeCompare(b, SORT_LOCALE)).slice(0, SIGNAL_CAP);
}

function classifyType(text: string): TwinDiaryClassificationType {
  const isReflection = REFLECTION_RES.some((re) => re.test(text));
  const isEvent = EVENT_RE.test(text);
  const isEmotion = EMOTION_LEXICON.some((w) => matchesLexeme(text, w));

  if (isReflection) {
    return "reflection";
  }
  if (isEmotion) {
    return "emotion";
  }
  if (isEvent) {
    return "event";
  }
  return "reflection";
}

function buildImpact(
  text: string,
  signals: TwinDiaryDerivedFields["signals"],
): TwinDiaryImpactTarget[] {
  const out = new Set<TwinDiaryImpactTarget>();
  if (text.length > 0) {
    out.add("memory");
  }
  if (signals.themes.length > 0) {
    out.add("patterns");
  }
  if (signals.emotions.length > 0) {
    out.add("personality");
  }
  if (signals.decisions.length > 0) {
    out.add("readiness");
  }
  return [...out].sort((a, b) => a.localeCompare(b, SORT_LOCALE));
}

/**
 * Returns schema extension fields for a diary body. Does not assign `id` / `createdAt`.
 */
export function classifyDiaryEntry(body: string): TwinDiaryDerivedFields {
  const text = normalizeBody(body);
  const emotions = collectLexiconHits(text, EMOTION_LEXICON);
  const decisions = collectLexiconHits(text, DECISION_LEXICON);
  const themes = collectLexiconHits(text, THEME_LEXICON);
  const signals = { emotions, decisions, themes };
  return {
    schemaVersion: TWIN_DIARY_SCHEMA_VERSION,
    classification: { type: classifyType(text) },
    signals,
    impact: { contributesTo: buildImpact(text, signals) },
  };
}

export function enrichTwinDiaryEntry(entry: DiaryMemoryEntryDto): TwinDiaryEntryExtended {
  const derived = classifyDiaryEntry(entry.body);
  return {
    ...entry,
    ...derived,
  };
}
