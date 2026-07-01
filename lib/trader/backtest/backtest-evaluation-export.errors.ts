export class BacktestEvaluationExportError extends Error {
  readonly code = "BACKTEST_EVALUATION_EXPORT";

  constructor(message: string) {
    super(`[trader/backtest/evaluation-export] ${message}`);
    this.name = "BacktestEvaluationExportError";
  }
}
