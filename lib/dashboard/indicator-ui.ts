import {
  INDICATOR_KEYS_ORDER,
  type IndicatorKey,
  type IndicatorPercent,
  type IndicatorVector,
} from "@/lib/readiness/types";

/** UI band aligned with readiness stages: Empty→low, Initiated/Established→medium, Confirmed→high. */
export type IndicatorThresholdBand = "low" | "medium" | "high";

export const INDICATOR_DISPLAY_LABEL: Record<IndicatorKey, string> = {
  values: "Values",
  behavior: "Behavior",
  thinking: "Thinking",
  emotions: "Emotions",
  interests: "Interests",
  goals: "Goals",
};

export function getIndicatorThresholdBand(percent: IndicatorPercent): IndicatorThresholdBand {
  switch (percent) {
    case 0:
      return "low";
    case 33:
    case 67:
      return "medium";
    case 100:
      return "high";
    default: {
      const _x: never = percent;
      return _x;
    }
  }
}

const HINTS: Record<IndicatorKey, Record<IndicatorPercent, string>> = {
  values: {
    0: "Share a guiding principle—we have no recorded values signal yet.",
    33: "Offer a distinct second angle on what you value (no repetition of your first reply).",
    67: "Anchor with a concrete moment your values visibly steered your choice.",
    100: "Values milestone reached; deepen or refine anytime in Twin chat.",
  },
  behavior: {
    0: "Describe habitual actions—what you actually do repeats in daily life.",
    33: "Add another independent behavioral statement that fits the pattern you started.",
    67: "Give one situational story where someone could watch you act that way.",
    100: "Behavior corridor confirmed; optional extra examples still help the twin.",
  },
  thinking: {
    0: "Explain how you reason through decisions—not outcomes, mental moves.",
    33: "Corroborate with a separate thought-pattern line that does not recycle the opener.",
    67: "Narrate a real decision fork where your thinking style clearly showed.",
    100: "Thinking profile stage complete—keep sharpening with new scenarios.",
  },
  emotions: {
    0: "Say how emotions show up and what you typically do once you notice them.",
    33: "Layer a second emotion-focused statement disjoint from your first wording.",
    67: "Offer a vivid episode where emotions and your response were unmistakable.",
    100: "Emotions dimension anchored for current readiness—you can revisit later.",
  },
  interests: {
    0: "Name pulls on your attention—activities, crafts, curiosity, immersion.",
    33: "Add corroborating interest detail that stands apart from opening note.",
    67: "Show where that interest visibly shaped your time across a realistic stretch.",
    100: "Interests corridor confirmed—more texture still strengthens the twin.",
  },
  goals: {
    0: "State something you are deliberately moving toward, even modestly scoped.",
    33: "Clarify with a complementary goal-angle that avoids overlap.",
    67: "Connect with lived steps: hurdles, pacing, context around pursuing it.",
    100: "Goals milestone documented; refinement continues naturally in Twin mode.",
  },
};

export function getIndicatorHint(indicatorKey: IndicatorKey, percent: IndicatorPercent): string {
  return HINTS[indicatorKey][percent];
}

export type IndicatorPresentationRow = {
  key: IndicatorKey;
  label: string;
  percent: IndicatorPercent;
  band: IndicatorThresholdBand;
  hint: string;
};

export function buildIndicatorPresentation(
  indicators: IndicatorVector,
): readonly IndicatorPresentationRow[] {
  return INDICATOR_KEYS_ORDER.map((key, idx) => {
    const percent = indicators[idx]!;
    return {
      key,
      label: INDICATOR_DISPLAY_LABEL[key],
      percent,
      band: getIndicatorThresholdBand(percent),
      hint: getIndicatorHint(key, percent),
    };
  });
}
