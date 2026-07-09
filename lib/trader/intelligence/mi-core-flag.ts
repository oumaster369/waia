/**
 * PR-2 Market Intelligence Core feature gate.
 * Default OFF — when disabled the pipeline is byte-identical to understanding → CDE.
 */
export function isMiCoreEnabled(
  raw: string | undefined = process.env.WAIA_MI_CORE_ENABLED,
): boolean {
  if (!raw) {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}
