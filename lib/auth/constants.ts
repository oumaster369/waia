/** HttpOnly cookie holding opaque `sessions.id`. */
export const WAIA_SESSION_COOKIE = "waia_session";

/** Default 30 days if env unset */
export function authSessionMaxAgeSeconds(): number {
  const raw = process.env.AUTH_SESSION_MAX_AGE_SECONDS;
  if (raw == null || raw === "") return 60 * 60 * 24 * 30;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 60 * 60 * 24 * 30;
}

export const PASSWORD_MIN_LENGTH = 8;
