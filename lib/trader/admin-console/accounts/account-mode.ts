export type AccountModeInput = {
  kind: "exchange" | "paper";
  deploymentProven?: boolean;
  entryAuthorityProven?: boolean;
  liveEnable: "ENABLED" | "DISABLED" | null;
  posture: "NORMAL" | "CLOSE_ONLY" | "HALT" | "KILLED" | null;
  suspended: boolean;
  killSwitchActive: boolean;
  liveOrderCount: number;
  paperOrderCount: number;
};

export type AccountModeView = {
  portfolio: "live" | "paper";
  activity: "live" | "none";
  deployment: "live" | "not_deployed" | "undetermined";
  tradePermission: "entries" | "close_only" | "halted" | "undetermined";
  tradePermissionReason: string | null;
};

export function accountMode(input: AccountModeInput): AccountModeView {
  if (input.kind === "paper") {
    return {
      portfolio: "paper",
      activity: "none",
      deployment: "not_deployed",
      tradePermission: "undetermined",
      tradePermissionReason: "PAPER_AUTHORITY_NOT_PROVEN",
    };
  }
  let tradePermission: AccountModeView["tradePermission"] =
    input.entryAuthorityProven && input.liveEnable === "ENABLED" && input.posture === "NORMAL"
      ? "entries"
      : "undetermined";
  let tradePermissionReason: string | null =
    tradePermission === "undetermined" ? "LIVE_AUTHORITY_NOT_PROVEN" : null;
  if (input.suspended) {
    tradePermission = "halted";
    tradePermissionReason = "SUSPENDED";
  } else if (input.killSwitchActive || input.posture === "KILLED" || input.posture === "HALT") {
    tradePermission = "halted";
    tradePermissionReason = input.killSwitchActive ? "KILL_SWITCH" : input.posture;
  } else if (input.posture === "CLOSE_ONLY") {
    tradePermission = "close_only";
    tradePermissionReason = "CLOSE_ONLY";
  }
  return {
    portfolio: "live",
    activity: input.liveOrderCount > 0 ? "live" : "none",
    deployment:
      input.deploymentProven === true
        ? "live"
        : input.deploymentProven === false
          ? "not_deployed"
          : "undetermined",
    tradePermission,
    tradePermissionReason,
  };
}
