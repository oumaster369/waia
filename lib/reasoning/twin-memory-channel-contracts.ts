/**
 * DEE-47: Frozen product contracts for Twin Chat vs Diary plus deterministic heuristic input classification.
 *
 * Classification precedence (first match wins after normalization), then channel tweaks at question step:
 * 1. Empty → reflection
 * 2. contradiction_hint — tension / mismatch language
 * 3. avoidance_hint
 * 4. desire
 * 5. decision — bounded phrases (avoid broad future tense)
 * 6. question — interrogative cues; diary may prefer event or skip weak cues (see classifyQuestionStep)
 * 7. emotional_state
 * 8. event — time / narrative anchors
 * 9. reflection — metacognition lexicon
 * 10. default → reflection
 *
 * No LLM, no randomness, no clinical labels in output.
 */

import type {
  TwinMemoryChannelContract,
  TwinMemoryChannelsContractBundle,
  TwinMemoryChannelId,
  TwinMemoryInputClassification,
  TwinMemoryInputKind,
} from "@/lib/dashboard/twin-memory-channel-api.types";
import {
  TWIN_MEMORY_CHANNEL_CONTRACTS_SCHEMA_VERSION,
  TWIN_MEMORY_CHANNEL_IDS,
} from "@/lib/dashboard/twin-memory-channel-api.types";

const DOWNSTREAM_PREFIXES = [
  "pattern_summary",
  "prediction",
  "contradictions",
  "repeatability",
  "personality_model",
  "readiness",
] as const;

function downstreamLines(
  defs: Record<(typeof DOWNSTREAM_PREFIXES)[number], string>,
): readonly string[] {
  return DOWNSTREAM_PREFIXES.map((k) => `${k}: ${defs[k]}`);
}

export const TWIN_MEMORY_CHANNEL_CONTRACTS_BUNDLE = {
  schemaVersion: TWIN_MEMORY_CHANNEL_CONTRACTS_SCHEMA_VERSION,
  channels: {
    diary: {
      purpose:
        "Diary is the reflective lane where the human stores lived-experience narrative: what happened, what it meant, and what they want remembered over time.",
      userIntent:
        "Anchor real days, moods, choices, regrets, wins, pauses — material the Twin later treats as slow-moving behavioral memory.",
      expectedInputStyle:
        "Past- or present-tense paragraphs, vignettes, and emotional color; journaling tone rather than interrogative pacing.",
      inputRole:
        "Non-interactive authoring: the speaker writes for later recall, not for an immediate conversational partner.",
      memoryRole:
        "Forms durable behavioral-memory threads (tone, arcs, motifs) consumed by longitudinal Twin surfaces.",
      downstreamSignals: downstreamLines({
        pattern_summary:
          "Diary excerpts feed repeatable motif discovery with longer horizons than dialogue snippets.",
        prediction:
          "Ground-truth anecdotes give scenario predictors anchored lived context when cited later.",
        contradictions:
          "Diary-vs-dialogue divergence can highlight narrative tension worth surfacing softly.",
        repeatability:
          "Serial diary themes strengthen repeatability checks on stable user language.",
        personality_model:
          "Diary reinforces emotional baseline + relationship cadence narratives over time.",
        readiness:
          "Diary completeness signals stewardship of personal data that unlocks guarded Twin surfaces.",
      }),
    },
    twin_chat: {
      purpose:
        "Twin Chat is the interactive conversational home where dialogue turns build cadence, values, clarifications, and quick course-corrections with the Twin.",
      userIntent:
        "Practice voice, probe unknowns in the moment, co-develop answers, reflect aloud with back-and-forth rhythm.",
      expectedInputStyle:
        "Mixed-length turns, interrogatives for help, confirmations, riffing replies — speech-like conversational flow.",
      inputRole:
        "Interactive exchange: utterances anticipate immediate uptake and reciprocal Twin turns.",
      memoryRole:
        "Creates dialogue-memory sequences that capture preferences, pacing, latent goals, live adjustments.",
      downstreamSignals: downstreamLines({
        pattern_summary:
          "Dialogue turns supply high-frequency lexical and cadence motifs for motif summaries.",
        prediction:
          "Short-horizon user asks become scenario seeds for conversational prediction probes.",
        contradictions:
          "Back-to-back conversational claims surface tension candidates for contradiction review.",
        repeatability:
          "Turn-taking patterns quantify consistency of answers across revisits.",
        personality_model:
          "Live conversational emphasis shapes traits summaries (energy, openness, skepticism cues).",
        readiness:
          "Meaningful exchange demonstrates baseline Twin formation before Diary and advanced labs open.",
      }),
    },
  },
} satisfies TwinMemoryChannelsContractBundle;

function normalizeForClassification(raw: string): string {
  return raw
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function isTwinMemoryChannelId(value: string): value is TwinMemoryChannelId {
  return value === "diary" || value === "twin_chat";
}

export function getTwinMemoryChannelContract(channel: string): TwinMemoryChannelContract | null {
  if (!isTwinMemoryChannelId(channel)) {
    return null;
  }
  return TWIN_MEMORY_CHANNEL_CONTRACTS_BUNDLE.channels[channel];
}

export function listTwinMemoryChannelContracts(): ReadonlyArray<{
  channel: TwinMemoryChannelId;
  contract: TwinMemoryChannelContract;
}> {
  return TWIN_MEMORY_CHANNEL_IDS.map((channel) => ({
    channel,
    contract: TWIN_MEMORY_CHANNEL_CONTRACTS_BUNDLE.channels[channel],
  }));
}

function matchesContradictionHint(n: string): boolean {
  return (
    /\bbut\s+actually\b/.test(n) ||
    /\bon\s+the\s+other\s+hand\b/.test(n) ||
    /\bthat\s+contradicts\b/.test(n) ||
    /\bcontradicts\s+what\b/.test(n) ||
    /\bsaid\s+one\s+thing\s+but\b/.test(n) ||
    /\bi\s+said\b.*\bbut\b/.test(n)
  );
}

function matchesAvoidanceHint(n: string): boolean {
  return (
    /\bavoided\b/.test(n) ||
    /\bdid\s+not\s+want\s+to\b/.test(n) ||
    /\bdidn't\s+want\s+to\b/.test(n) ||
    /\bpretended\b/.test(n) ||
    /\bsteered\s+clear\b/.test(n)
  );
}

function matchesDesire(n: string): boolean {
  return (
    /\bi\s+want\b/.test(n) ||
    /\bi\s+wish\b/.test(n) ||
    /\bi'd\s+like\b/.test(n) ||
    /\bhoping\s+to\b/.test(n)
  );
}

function matchesDecision(n: string): boolean {
  return (
    /\bi\s+decided\b/.test(n) ||
    /\bi\s+chose\b/.test(n) ||
    /\bchoosing\s+to\b/.test(n) ||
    /\bi\s+will\b/.test(n) ||
    /\bwe\s+decided\b/.test(n)
  );
}

/** Strong conversational question cue — used differently per channel in classifyQuestionStep. */
function matchesQuestionCue(n: string): boolean {
  if (n.endsWith("?")) {
    return true;
  }
  if (
    /^(what|why|how|who|when|where|which|whose)\b/.test(n) ||
    /^(did|does|do|is|are|am|was|were|have|has|had|can|could|should|would|will)\b/.test(n)
  ) {
    return true;
  }
  if (/^should\s+i\b|^could\s+i\b|^can\s+i\b|^would\s+i\b|^do\s+i\b/.test(n)) {
    return true;
  }
  return false;
}

function hasStrongEventAnchors(n: string): boolean {
  return (
    /\btoday\b/.test(n) ||
    /\byesterday\b/.test(n) ||
    /\bthis\s+morning\b/.test(n) ||
    /\blast\s+night\b/.test(n) ||
    /\bwhen\s+i\b/.test(n) ||
    /\bafter\s+i\b/.test(n) ||
    /\bbefore\s+i\b/.test(n) ||
    /\bi\s+went\b/.test(n)
  );
}

function matchesEmotionalState(n: string): boolean {
  return (
    /\bi\s+feel\b/.test(n) ||
    /\bi\s+felt\b/.test(n) ||
    /\bfelt\b/.test(n) ||
    /\bfeeling\b/.test(n) ||
    /\banxious\b/.test(n) ||
    /\bcalm\b/.test(n) ||
    /\boverwhelmed\b/.test(n) ||
    /\bworried\b/.test(n) ||
    /\bstressed\b/.test(n) ||
    /\bhopeful\b/.test(n) ||
    /\bdrained\b/.test(n) ||
    /\btired\b/.test(n) ||
    /\bpeaceful\b/.test(n)
  );
}

function matchesEvent(n: string): boolean {
  return hasStrongEventAnchors(n);
}

function matchesReflectionToken(n: string): boolean {
  return (
    /\bi\s+think\b/.test(n) ||
    /\bi\s+realize\b/.test(n) ||
    /\bi\s+notice\b/.test(n) ||
    /\breflecting\b/.test(n) ||
    /\blearned\s+that\b/.test(n) ||
    /\bit\s+seems\b/.test(n)
  );
}

function cls(
  channel: TwinMemoryChannelId,
  kind: TwinMemoryInputKind,
  reason: string,
): TwinMemoryInputClassification {
  return { channel, kind, reason };
}

/**
 * Diary: if narration + question both appear, prioritize lived-event capture; weak interrogatives without `?`
 * defer to downstream emotional/event/reflection heuristics.
 */
function classifyQuestionStep(
  channel: TwinMemoryChannelId,
  n: string,
): TwinMemoryInputClassification | null {
  const q = matchesQuestionCue(n);
  if (!q) {
    return null;
  }
  if (channel === "twin_chat") {
    return cls(channel, "question", "conversational-question-markers");
  }
  const narrative = hasStrongEventAnchors(n);
  const strongQuestion = n.endsWith("?");
  if (strongQuestion && narrative) {
    return cls(channel, "event", "diary-event-over-question-co-occurrence");
  }
  if (strongQuestion && !narrative) {
    return cls(channel, "question", "diary-direct-question");
  }
  return null;
}

export function classifyTwinMemoryInput(params: {
  channel: TwinMemoryChannelId;
  text: string;
}): TwinMemoryInputClassification {
  const { channel, text } = params;
  const n = normalizeForClassification(text);
  if (n.length === 0) {
    return cls(channel, "reflection", "empty-input-neutral");
  }

  if (matchesContradictionHint(n)) {
    return cls(channel, "contradiction_hint", "misaligned-claims-lang");
  }
  if (matchesAvoidanceHint(n)) {
    return cls(channel, "avoidance_hint", "withdrawal-lang");
  }
  if (matchesDesire(n)) {
    return cls(channel, "desire", "stated-want-lang");
  }
  if (matchesDecision(n)) {
    return cls(channel, "decision", "committed-choice-lang");
  }

  const questionHit = classifyQuestionStep(channel, n);
  if (questionHit) {
    return questionHit;
  }

  if (matchesEmotionalState(n)) {
    return cls(channel, "emotional_state", "affective-or-body-state-lang");
  }
  if (matchesEvent(n)) {
    return cls(channel, "event", "temporal-or-narrative-anchor");
  }
  if (matchesReflectionToken(n)) {
    return cls(channel, "reflection", "sense-making-lang");
  }

  return cls(channel, "reflection", "general-default-safe");
}
