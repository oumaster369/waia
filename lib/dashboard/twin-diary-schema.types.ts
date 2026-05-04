/** Structured diary meaning layer (DEE-45) — extends persisted diary DTO; no DB migration. */

import type { DiaryMemoryEntryDto } from "@/lib/dashboard/diary-memory-api.types";

export const TWIN_DIARY_SCHEMA_VERSION = "twin-diary-v1" as const;

export type TwinDiarySchemaVersion = typeof TWIN_DIARY_SCHEMA_VERSION;

export type TwinDiaryClassificationType = "event" | "emotion" | "reflection";

export type TwinDiaryImpactTarget = "memory" | "patterns" | "personality" | "readiness";

export type TwinDiaryEntryExtended = DiaryMemoryEntryDto & {
  schemaVersion: TwinDiarySchemaVersion;
  classification: { type: TwinDiaryClassificationType };
  signals: {
    emotions: string[];
    decisions: string[];
    themes: string[];
  };
  impact: { contributesTo: TwinDiaryImpactTarget[] };
};
