/** Human-only authorization for official multi-year Full Historical Validation launch. */
export const FHV_FULL_HISTORICAL_VALIDATION_AUTHORIZATION =
  "AUTHORIZE-FULL-HISTORICAL-VALIDATION" as const;

export type FhvFullHistoricalAuthorizationLiteral =
  typeof FHV_FULL_HISTORICAL_VALIDATION_AUTHORIZATION;

export class FhvFullHistoricalAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvFullHistoricalAuthError";
  }
}

export function assertFhvFullHistoricalValidationAuthorization(
  authorization: string | undefined,
): void {
  const normalized = authorization?.trim();
  if (!normalized) {
    throw new FhvFullHistoricalAuthError(
      "AUTHORIZATION_MISSING",
      "AUTHORIZE-FULL-HISTORICAL-VALIDATION is required for Full Historical Validation launch.",
    );
  }
  if (normalized !== FHV_FULL_HISTORICAL_VALIDATION_AUTHORIZATION) {
    throw new FhvFullHistoricalAuthError(
      "AUTHORIZATION_MISMATCH",
      "Authorization literal must be AUTHORIZE-FULL-HISTORICAL-VALIDATION (not interchangeable with AUTHORIZE-FHV-OPS-DEPLOY).",
    );
  }
}
