/** Thrown when HTX connector input fails spot-only MVP constraints. */
export class HtxConnectorValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`[trader] HTX connector validation (${code}): ${message}`);
    this.name = "HtxConnectorValidationError";
    this.code = code;
  }
}
