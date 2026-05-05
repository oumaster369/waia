/** POST /api/dashboard/twin-dialogue/turn JSON success body */
export type TwinDialogueSubmittedTurnDto = {
  id: string;
  sequence: number;
  role: "user";
  content: string;
  /** ISO 8601 */
  createdAt: string;
};

/** Persisted paired assistant stub (absent row on idempotent user replay — DEE-26). */
export type TwinDialogueAssistantSubmittedTurnDto = {
  id: string;
  sequence: number;
  role: "assistant";
  content: string;
  /** ISO 8601 */
  createdAt: string;
};

export type TwinDialogueTurnSubmitApiResponse = {
  userTurn: TwinDialogueSubmittedTurnDto;
  /** Non-null only when the user turn was freshly inserted this request. */
  assistantTurn: TwinDialogueAssistantSubmittedTurnDto | null;
  twinSignals: {
    hasMeaningfulExchange: boolean;
  };
  assistantPlaceholder: string;
};
