/**
 * DEE-46: Build user-facing TwinProfile from TwinState + personality model — deterministic; no LLM, no clock.
 */

import type { TwinPersonalityModelApiResponse } from "@/lib/dashboard/twin-personality-model-api.types";
import type { TwinProfile } from "@/lib/dashboard/twin-profile-api.types";
import { TWIN_PROFILE_SCHEMA_VERSION } from "@/lib/dashboard/twin-profile-api.types";
import type { TwinState } from "@/lib/dashboard/twin-state-api.types";

const PROFILE_ARRAY_CAP = 8;
const SORT_LOCALE = "en";
const MAX_TITLE_CHARS = 56;

/** Fallbacks when scalars would otherwise be empty (privacy-first external copy). */
const FALLBACK_TITLE = "AI Twin profile";
const FALLBACK_TONE = "balanced";
const FALLBACK_SHORT_DESCRIPTION =
  "Profile forming: add more dialogue to deepen this twin.";

export type BuildTwinProfileFromStateInput = {
  state: TwinState;
  personality: TwinPersonalityModelApiResponse;
};

/** Ordered (keyword → tone); first keyword match in combined emotional text wins. */
const TONE_RULES: readonly { keyword: string; tone: string }[] = [
  { keyword: "anxious", tone: "steady" },
  { keyword: "nervous", tone: "steady" },
  { keyword: "overwhelmed", tone: "steady" },
  { keyword: "stressed", tone: "steady" },
  { keyword: "angry", tone: "direct" },
  { keyword: "frustrated", tone: "direct" },
  { keyword: "sad", tone: "empathetic" },
  { keyword: "hurt", tone: "empathetic" },
  { keyword: "disappointed", tone: "empathetic" },
  { keyword: "happy", tone: "warm" },
  { keyword: "grateful", tone: "warm" },
  { keyword: "hopeful", tone: "warm" },
  { keyword: "excited", tone: "warm" },
  { keyword: "calm", tone: "calm" },
  { keyword: "peaceful", tone: "calm" },
  { keyword: "content", tone: "calm" },
];

function normalizeLabel(raw: string): string {
  return raw.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function uniqSortCap(strings: readonly string[], cap: number): string[] {
  const byKey = new Map<string, string>();
  for (const raw of strings) {
    const key = normalizeLabel(raw);
    if (key.length === 0) {
      continue;
    }
    if (!byKey.has(key)) {
      byKey.set(key, key);
    }
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, SORT_LOCALE)).slice(0, cap);
}

function capitalizeWord(word: string): string {
  if (word.length === 0) {
    return "";
  }
  return word[0]!.toUpperCase() + word.slice(1).toLowerCase();
}

function titleCaseLabel(normalizedLowerPhrase: string): string {
  return normalizedLowerPhrase
    .split(" ")
    .filter((w) => w.length > 0)
    .map(capitalizeWord)
    .join(" ");
}

function deriveToneFromEmotionalPatterns(patterns: string[]): string {
  const combined = patterns.join(" ");
  if (combined.length === 0) {
    return FALLBACK_TONE;
  }
  for (const { keyword, tone } of TONE_RULES) {
    if (combined.includes(keyword)) {
      return tone;
    }
  }
  return FALLBACK_TONE;
}

function deriveTitle(dominantTraits: string[]): string {
  if (dominantTraits.length === 0) {
    return FALLBACK_TITLE;
  }
  const parts: string[] = [];
  for (const t of dominantTraits) {
    const labeled = titleCaseLabel(t);
    if (labeled.length === 0) {
      continue;
    }
    if (parts.length === 0) {
      parts.push(labeled);
    } else if (parts.length === 1) {
      parts.push(labeled);
    } else {
      break;
    }
  }
  if (parts.length === 0) {
    return FALLBACK_TITLE;
  }
  let built = parts.join(" · ");
  if (built.length > MAX_TITLE_CHARS) {
    built = titleCaseLabel(dominantTraits[0] ?? "");
    if (built.length === 0) {
      return FALLBACK_TITLE;
    }
    if (built.length > MAX_TITLE_CHARS) {
      built = `${built.slice(0, MAX_TITLE_CHARS - 1).trimEnd()}…`;
    }
  }
  return built;
}

function deriveShortDescription(
  level: TwinProfile["readiness"]["level"],
  dominantCount: number,
  emotionalCount: number,
  tone: string,
): string {
  if (dominantCount === 0 && emotionalCount === 0) {
    return FALLBACK_SHORT_DESCRIPTION;
  }
  return `Twin profile (${level} readiness, ${dominantCount} traits, ${emotionalCount} emotional patterns, ${tone} tone).`;
}

export function buildTwinProfileFromState(input: BuildTwinProfileFromStateInput): TwinProfile {
  const { state, personality } = input;

  const dominantTraits = uniqSortCap(personality.model.dominantTraits, PROFILE_ARRAY_CAP);
  const emotionalPatterns = uniqSortCap(state.identity.emotionalPatterns, PROFILE_ARRAY_CAP);
  const decisionStyle = uniqSortCap(
    [...personality.model.decisionStyle, ...state.identity.decisionStyle],
    PROFILE_ARRAY_CAP,
  );
  const communicationStyle = uniqSortCap(
    personality.model.behavioralPatterns,
    PROFILE_ARRAY_CAP,
  );
  const relationshipStyle = uniqSortCap(
    personality.model.relationshipStyle,
    PROFILE_ARRAY_CAP,
  );
  const contradictions = uniqSortCap(state.identity.contradictions, PROFILE_ARRAY_CAP);

  const tone = deriveToneFromEmotionalPatterns(emotionalPatterns);

  let title = deriveTitle(dominantTraits);
  if (normalizeLabel(title).length === 0 || title.trim().length === 0) {
    title = FALLBACK_TITLE;
  } else {
    title = title.trim();
  }

  const shortDescription = deriveShortDescription(
    state.readiness.level,
    dominantTraits.length,
    emotionalPatterns.length,
    tone,
  );

  return {
    schemaVersion: TWIN_PROFILE_SCHEMA_VERSION,
    identity: {
      title,
      shortDescription,
      dominantTraits,
    },
    expression: {
      tone: tone.length === 0 ? FALLBACK_TONE : tone,
      communicationStyle,
    },
    behavior: {
      decisionStyle,
      relationshipStyle,
    },
    emotionalProfile: {
      emotionalPatterns,
    },
    contradictions: {
      contradictions,
    },
    readiness: {
      level: state.readiness.level,
    },
    visibility: {
      isPublic: false,
    },
  };
}
