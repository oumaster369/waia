/**
 * Fail-closed firewall: pre-holdout qualification and Control Replay must never open
 * the blind-holdout bars payload.
 */

export const FHV_BLIND_HOLDOUT_PARTITION_SEGMENT = "partitions/blind-holdout" as const;
export const FHV_BLIND_HOLDOUT_PAYLOAD_ACCESS_FORBIDDEN =
  "FHV_BLIND_HOLDOUT_PAYLOAD_ACCESS_FORBIDDEN" as const;

export class FhvBlindHoldoutFirewallError extends Error {
  constructor(
    readonly code: typeof FHV_BLIND_HOLDOUT_PAYLOAD_ACCESS_FORBIDDEN,
    message: string,
  ) {
    super(message);
    this.name = "FhvBlindHoldoutFirewallError";
  }
}

let testAccessTrap: ((path: string) => void) | null = null;

export function setFhvBlindHoldoutAccessTrapForTests(trap: ((path: string) => void) | null): void {
  testAccessTrap = trap;
}

export function normalizeDatasetPath(path: string): string {
  return path.replace(/\\/g, "/");
}

export function pathAccessesBlindHoldoutPayload(path: string): boolean {
  const normalized = normalizeDatasetPath(path);
  return (
    normalized.includes(`/${FHV_BLIND_HOLDOUT_PARTITION_SEGMENT}/`) ||
    normalized.includes(`${FHV_BLIND_HOLDOUT_PARTITION_SEGMENT}/`) ||
    /\/partitions\/blind-holdout\/[^/]+\/bars\./.test(normalized)
  );
}

export function assertPathDoesNotAccessBlindHoldoutPayload(path: string): void {
  testAccessTrap?.(path);
  if (pathAccessesBlindHoldoutPayload(path)) {
    throw new FhvBlindHoldoutFirewallError(
      FHV_BLIND_HOLDOUT_PAYLOAD_ACCESS_FORBIDDEN,
      `blind-holdout payload access is forbidden: ${path}`,
    );
  }
}
