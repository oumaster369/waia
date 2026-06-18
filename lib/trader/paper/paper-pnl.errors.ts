export class PaperPnLReconciliationError extends Error {
  readonly code = "PAPER_PNL_RECONCILIATION";

  constructor(message: string) {
    super(`[trader/paper/pnl] ${message}`);
    this.name = "PaperPnLReconciliationError";
  }
}

export class PaperPnLScopeError extends Error {
  readonly code = "PAPER_PNL_SCOPE";

  constructor(message: string) {
    super(`[trader/paper/pnl] ${message}`);
    this.name = "PaperPnLScopeError";
  }
}

export class PaperPnLWindowError extends Error {
  readonly code = "PAPER_PNL_WINDOW";

  constructor(message: string) {
    super(`[trader/paper/pnl] ${message}`);
    this.name = "PaperPnLWindowError";
  }
}
