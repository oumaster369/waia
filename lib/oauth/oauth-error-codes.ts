/** Stable query values for `/` redirects after OAuth failures (`?oauth_error=...`). */

export type OauthErrorCode =
  | "OAUTH_DENIED"
  | "OAUTH_INVALID_STATE"
  | "OAUTH_CONFIG"
  | "OAUTH_TOKEN";

export const OAUTH_ERROR_QUERY = "oauth_error" as const;
