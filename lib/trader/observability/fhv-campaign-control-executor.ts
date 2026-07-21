import type { FhvOperatorAction } from "@/lib/trader/observability/fhv-observability.constants";

export type FhvCampaignControlExecutionOutcome = "executed" | "failed";

export type FhvCampaignControlExecutionResult = Readonly<{
  outcome: FhvCampaignControlExecutionOutcome;
  message: string;
  enforcementApplied: boolean;
}>;

export type FhvCampaignControlExecutor = Readonly<{
  execute(input: {
    action: FhvOperatorAction;
    runId: string;
    organizationId: string;
    operatorId: string;
    reason: string;
  }): Promise<FhvCampaignControlExecutionResult>;
}>;

export const UNCONFIGURED_FHV_CAMPAIGN_CONTROL_EXECUTOR: FhvCampaignControlExecutor = {
  async execute() {
    return {
      outcome: "failed",
      message: "SUPERVISOR_NOT_CONFIGURED",
      enforcementApplied: false,
    };
  },
};

export function createSuccessfulFhvCampaignControlExecutor(): FhvCampaignControlExecutor {
  return {
    async execute(input) {
      return {
        outcome: "executed",
        message: `Executed ${input.action}`,
        enforcementApplied: true,
      };
    },
  };
}

export function createRecordingFhvCampaignControlExecutor(
  sink: FhvCampaignControlExecutor,
): FhvCampaignControlExecutor & {
  records: Array<Parameters<FhvCampaignControlExecutor["execute"]>[0]>;
} {
  const records: Array<Parameters<FhvCampaignControlExecutor["execute"]>[0]> = [];
  return {
    records,
    async execute(input) {
      records.push(input);
      return sink.execute(input);
    },
  };
}

export function mapFhvActionToConfirmationPhraseClass(
  action: FhvOperatorAction,
): "NONE" | "PAUSE" | "RESUME" | "STOP" | "EMERGENCY" | "DIAGNOSTIC" {
  switch (action) {
    case "PAUSE_AT_CHECKPOINT":
      return "PAUSE";
    case "RESUME_FROM_CHECKPOINT":
      return "RESUME";
    case "GRACEFUL_STOP":
      return "STOP";
    case "EMERGENCY_STOP":
      return "EMERGENCY";
    case "CREATE_DIAGNOSTIC_BUNDLE":
      return "DIAGNOSTIC";
    default:
      throw new Error(`Unknown FHV operator action: ${String(action satisfies never)}`);
  }
}
