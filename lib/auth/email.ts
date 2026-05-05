export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** MVP: require a plausible email shape for credential flows. */
export function isLikelyEmail(value: string): boolean {
  const v = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export function deriveIdentityLabelFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  const cleaned = local.replace(/[._-]+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : email;
}
