/**
 * DEE-436 — canonical Linux boot_id representation (UUID at host boundary).
 */

export const FHV_T4_BOOT_ID_CANONICAL_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class FhvT4BootIdError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvT4BootIdError";
  }
}

/** Normalize Linux /proc/sys/kernel/random/boot_id to lowercase UUID form. */
export function normalizeFhvT4BootId(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (/^[0-9a-f]{32}$/.test(trimmed)) {
    return `${trimmed.slice(0, 8)}-${trimmed.slice(8, 12)}-${trimmed.slice(12, 16)}-${trimmed.slice(16, 20)}-${trimmed.slice(20)}`;
  }
  if (!FHV_T4_BOOT_ID_CANONICAL_PATTERN.test(trimmed)) {
    throw new FhvT4BootIdError(
      "FHV_T4_BOOT_ID_INVALID",
      "bootId must be a lowercase UUID or 32-char hex string.",
    );
  }
  return trimmed;
}

export function assertFhvT4BootIdEqual(left: string, right: string): void {
  if (normalizeFhvT4BootId(left) !== normalizeFhvT4BootId(right)) {
    throw new FhvT4BootIdError("FHV_T4_BOOT_ID_MISMATCH", "bootId mismatch.");
  }
}
