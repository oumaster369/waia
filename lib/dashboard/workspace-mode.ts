/** Dashboard workspace tab identifiers (DEE-48). Stable visual order left-to-right. */
export const WORKSPACE_TAB_ORDER = [
  "twin",
  "diary",
  "predictions",
  "personality_insights",
  "society",
] as const;

export type WorkspaceModeId = (typeof WORKSPACE_TAB_ORDER)[number];
