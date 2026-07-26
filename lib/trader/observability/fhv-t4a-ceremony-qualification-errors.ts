/**
 * DEE-436 — ceremony qualification verification errors (no closure-verifier import cycle).
 */

export class FhvT4CeremonyQualificationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvT4CeremonyQualificationError";
  }
}
