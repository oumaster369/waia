import type { ObservationConfig } from "./types";

/** Only ordinary account observation may be inherited by Connect-enrolled accounts.
 * Fixed consent, derivatives, financial history and venue UID stay assignment-bound. */
export function findSelfServiceObservationTemplate<T extends Readonly<{ config: ObservationConfig }>>(
  assignments: readonly T[],
  configurationRevision?: string,
): T | undefined {
  return assignments.find(({ config }) =>
    !config.existingKeyReadConsentId &&
    !config.htxDerivativesFamilies?.length &&
    !config.htxV5?.expectedHtxUid &&
    !config.htxV5?.financialHistory &&
    (configurationRevision === undefined || config.revision === configurationRevision),
  );
}
