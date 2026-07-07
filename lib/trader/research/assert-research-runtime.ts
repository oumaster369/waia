/**
 * Research-only guard — replay fused context, sidecar capture/load must not run in production paths.
 */
export function assertResearchRuntime(caller: string): void {
  if (process.env.WAIA_TRADER_CLI === "1") {
    return;
  }
  if (process.env.VITEST === "true") {
    return;
  }
  throw new Error(
    `[research] ${caller} is research-only; set WAIA_TRADER_CLI=1 for CLI/replay operations`,
  );
}
