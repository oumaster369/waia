/**
 * DEE-436 — shared T4A operator errors (no heavy imports).
 */

export class FhvT4aOperatorError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvT4aOperatorError";
  }
}
