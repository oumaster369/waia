import "server-only";

/** When true, entitlement/permission denials block access. Default off in M1. */
export function isWaiaCoreEnforcementEnabled(): boolean {
  return process.env.WAIA_CORE_ENFORCEMENT === "1";
}

/**
 * Shadow mode logs entitlement/permission mismatches without blocking.
 * Defaults to on unless explicitly disabled.
 */
export function isWaiaCoreShadowMode(): boolean {
  return process.env.WAIA_CORE_SHADOW !== "0";
}
