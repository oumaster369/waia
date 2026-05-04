/** GET /api/dashboard/twin-dialogue/turns — persisted Twin dialogue memory v1 raw rows (Signals/engine input boundary). */

export type TwinDialogueMemoryTurnDto = {
  id: string;
  sequence: number;
  role: "user" | "assistant" | "system";
  content: string;
  /** ISO 8601 */
  createdAt: string;
};

export type TwinDialogueTurnsMemoryApiResponse = {
  turns: TwinDialogueMemoryTurnDto[];
};
