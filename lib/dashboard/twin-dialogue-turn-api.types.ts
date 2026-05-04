/** POST /api/dashboard/twin-dialogue/turn JSON success body */
export type TwinDialogueSubmittedTurnDto = {
  id: string;
  sequence: number;
  role: "user";
  content: string;
  /** ISO 8601 */
  createdAt: string;
};

export type TwinDialogueTurnSubmitApiResponse = {
  userTurn: TwinDialogueSubmittedTurnDto;
  twinSignals: {
    hasMeaningfulExchange: boolean;
  };
  assistantPlaceholder: string;
};
