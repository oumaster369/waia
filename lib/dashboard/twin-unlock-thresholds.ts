/**
 * Shared numeric unlock thresholds (DEE-44 / DEE-48).
 * Kept out of `server-only` modules so client tab UI can reference the same limits.
 */

export const TWIN_UNLOCK_RULES = {
  globalMinBaseModel: 0.2,
  diaryMinBaseModel: 0.3,
  twinChatMinMemory: 0.2,
  predictionsMinOverall: 0.4,
  predictionsMinFeedback: 0.2,
  personalityMinPatterns: 0.3,
  personalityMinContradictions: 0.2,
  societyMinOverall: 0.6,
  societyMinConsistency: 0.5,
  societyMinFeedback: 0.4,
  memorySpikeThreshold: 0.55,
  baseCeilingWhenMemorySpike: 0.35,
} as const;
