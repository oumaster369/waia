import type { WorkspaceModeId } from "@/lib/dashboard/workspace-mode";
import { WORKSPACE_TAB_ORDER } from "@/lib/dashboard/workspace-mode";

/** Keys in readiness-model order §7 / dashboard shell §7.2 (+ DEE-48 growth tabs). */
export type ModeId = WorkspaceModeId;

export const TAB_ORDER: readonly WorkspaceModeId[] = WORKSPACE_TAB_ORDER;

export const INDICATOR_KEYS = [
  "Values",
  "Behavior",
  "Thinking",
  "Emotions",
  "Interests",
  "Goals",
] as const;
