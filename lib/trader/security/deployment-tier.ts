export type WaiaDeploymentTier = "local" | "preview" | "staging" | "production";

/** Resolve deployment tier without relying on NODE_ENV alone (DEE-220 §7). */
export function getDeploymentTier(): WaiaDeploymentTier {
  const chartered = process.env.WAIA_DEPLOYMENT_TIER?.trim().toLowerCase();
  if (chartered === "production") return "production";
  if (chartered === "preview") return "preview";
  if (chartered === "staging") return "staging";
  if (chartered === "local") return "local";

  const cf = process.env.CF_ENVIRONMENT?.trim().toLowerCase();
  if (cf === "production") return "production";
  if (cf === "preview") return "preview";

  return "local";
}

export function isProductionDeployment(): boolean {
  return getDeploymentTier() === "production";
}

export function isPreviewOrStagingDeployment(): boolean {
  const tier = getDeploymentTier();
  return tier === "preview" || tier === "staging";
}

export function isDevMasterKeyModeEnabled(): boolean {
  return process.env.AI_TRADER_MASTER_KEY_MODE?.trim().toLowerCase() === "dev";
}
