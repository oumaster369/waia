export type AccountModeInput = {
  kind: "exchange" | "paper";
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
  tradePermission: "entries" | "close_only" | "halted";
  tradePermissionReason: string | null;
};

export function accountMode(input: AccountModeInput): AccountModeView {
  if (input.kind === "paper") {
    return {
      portfolio: "paper",
      activity: "none",
      deployment: "not_deployed",
      tradePermission: "entries",
      tradePermissionReason: null,
    };
  }
  let tradePermission: AccountModeView["tradePermission"] = "entries";
  let tradePermissionReason: string | null = null;
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
      input.liveEnable === "ENABLED"
        ? "live"
        : input.liveEnable === null
          ? "undetermined"
          : "not_deployed",
    tradePermission,
    tradePermissionReason,
  };
}
