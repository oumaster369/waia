import type { HistoricalExecutionProfileV1 } from "@/lib/trader/backtest/historical-execution-profile";
import { HTR_HISTORICAL_EXECUTION_PROFILE_V1 } from "@/lib/trader/backtest/historical-execution-profile";
import type { PaperCycleDeps } from "@/lib/trader/paper/paper-cycle.types";

export class HistoricalExecutionProfileConfigurationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`[htr/wp17] ${code}: ${message}`);
    this.name = "HistoricalExecutionProfileConfigurationError";
    this.code = code;
  }
}

export function isHistoricalExecutionServiceEnabled(deps: PaperCycleDeps): boolean {
  return deps.researchReplayDeterminism?.historicalExecutionSession === true;
}

export function assertHtrHistoricalExecutionSessionConfiguration(input: {
  deps: PaperCycleDeps;
  historicalExecutionProfile?: HistoricalExecutionProfileV1;
}): void {
  const serviceEnabled = isHistoricalExecutionServiceEnabled(input.deps);
  const profile = input.historicalExecutionProfile;

  if (serviceEnabled && !profile) {
    throw new HistoricalExecutionProfileConfigurationError(
      "HTR_HISTORICAL_EXECUTION_PROFILE_REQUIRED",
      "historical execution service enabled but historicalExecutionProfile is absent",
    );
  }

  if (profile && !serviceEnabled) {
    throw new HistoricalExecutionProfileConfigurationError(
      "HTR_HISTORICAL_EXECUTION_SERVICE_REQUIRED",
      "historicalExecutionProfile present but historical execution service is not enabled",
    );
  }

  if (!profile) {
    return;
  }

  if (profile.profileId !== HTR_HISTORICAL_EXECUTION_PROFILE_V1) {
    throw new HistoricalExecutionProfileConfigurationError(
      "HTR_HISTORICAL_EXECUTION_PROFILE_INVALID",
      `unsupported profileId ${String(profile.profileId)}`,
    );
  }

  if (!profile.model || !profile.exchange) {
    throw new HistoricalExecutionProfileConfigurationError(
      "HTR_HISTORICAL_EXECUTION_PROFILE_INCOMPLETE",
      "profile must include model and exchange bindings",
    );
  }
}
