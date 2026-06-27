/** Simulated execution modes supported by the derived Paper Book (not live). */
export type PaperBookExecutionMode = "mock" | "paper";

/** One open spot holding in the org-scoped Paper Book. */
export type PaperPosition = {
  symbol: string;
  quantity: string;
};

/** Derived holdings read model keyed by organization + execution mode. */
export type PaperBook = {
  organizationId: string;
  executionMode: PaperBookExecutionMode;
  positions: PaperPosition[];
  derivedAt: Date;
};
