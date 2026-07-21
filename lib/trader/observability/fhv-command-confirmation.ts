import type { FhvOperatorAction } from "@/lib/trader/observability/fhv-observability.constants";
import { mapFhvActionToConfirmationPhraseClass } from "@/lib/trader/observability/fhv-campaign-control-executor";

export type FhvConfirmationPhraseClass = ReturnType<typeof mapFhvActionToConfirmationPhraseClass>;

export function buildRequiredConfirmationPhrase(
  campaignRunId: string,
  action: FhvOperatorAction,
): string {
  switch (action) {
    case "PAUSE_AT_CHECKPOINT":
      return `PAUSE ${campaignRunId}`;
    case "RESUME_FROM_CHECKPOINT":
      return `RESUME ${campaignRunId}`;
    case "GRACEFUL_STOP":
      return `STOP ${campaignRunId}`;
    case "EMERGENCY_STOP":
      return `EMERGENCY STOP ${campaignRunId}`;
    case "CREATE_DIAGNOSTIC_BUNDLE":
      return `DIAGNOSTIC ${campaignRunId}`;
    default:
      throw new Error("FHV_COMMAND_ACTION_UNKNOWN");
  }
}

export function validateConfirmationPhrase(input: {
  campaignRunId: string;
  action: FhvOperatorAction;
  confirmationPhrase: string;
}): FhvConfirmationPhraseClass {
  const expectedClass = mapFhvActionToConfirmationPhraseClass(input.action);
  if (expectedClass === "NONE") {
    throw new Error("FHV_COMMAND_ACTION_UNKNOWN");
  }
  const expectedPhrase = buildRequiredConfirmationPhrase(input.campaignRunId, input.action);
  if (input.confirmationPhrase.trim() !== expectedPhrase) {
    throw new Error("FHV_COMMAND_CONFIRMATION_INVALID");
  }
  return expectedClass;
}
