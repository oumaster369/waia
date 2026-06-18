export class PaperEvaluationExportError extends Error {
  readonly code = "PAPER_EVALUATION_EXPORT";

  constructor(message: string) {
    super(`[trader/paper/evaluation-export] ${message}`);
    this.name = "PaperEvaluationExportError";
  }
}
