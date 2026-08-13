import { TreasuryValidationError } from "@/lib/waia-core/treasury/errors";
import type { TreasuryObservationRecord, TreasuryProvenance } from "@/lib/waia-core/treasury/types";

export function observationSatisfiesVerifiedPrecondition(
  observation: TreasuryObservationRecord,
): boolean {
  return (
    observation.observationStatus === "CONFIRMED" &&
    observation.confirmationsObserved >= observation.confirmationsRequired
  );
}

/**
 * For provenance=WATCHER, VERIFIED requires every linked observation CONFIRMED
 * with confirmations_observed >= confirmations_required.
 * Zero linked observations fail closed. Caller-provided "confirmed=true" is ignored.
 */
export function assertWatcherVerifiedPrecondition(input: {
  provenance: TreasuryProvenance;
  linkedObservations: readonly TreasuryObservationRecord[];
}): void {
  if (input.provenance !== "WATCHER") {
    return;
  }
  if (input.linkedObservations.length === 0) {
    throw new TreasuryValidationError(
      "WATCHER_VERIFY_NO_LINKS",
      "WATCHER verify fails closed when no linked observations exist",
    );
  }
  for (const observation of input.linkedObservations) {
    if (observation.observationStatus !== "CONFIRMED") {
      throw new TreasuryValidationError(
        "WATCHER_VERIFY_UNCONFIRMED",
        `WATCHER verify rejected: observation ${observation.id} status ${observation.observationStatus}`,
      );
    }
    if (observation.confirmationsObserved < observation.confirmationsRequired) {
      throw new TreasuryValidationError(
        "WATCHER_VERIFY_INSUFFICIENT_CONFIRMATIONS",
        `WATCHER verify rejected: observation ${observation.id} confirmations ${observation.confirmationsObserved} < ${observation.confirmationsRequired}`,
      );
    }
  }
}
