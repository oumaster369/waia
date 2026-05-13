import type { OauthErrorCode } from "@/lib/oauth/oauth-error-codes";

/** Human-readable landing copy for `?oauth_error=` query values after OAuth redirect failures. */
export function oauthErrorQueryMessage(rawCode: string | null): string | null {
  if (rawCode == null || rawCode === "") return null;
  switch (rawCode as OauthErrorCode) {
    case "OAUTH_DENIED":
      return "Sign-in was cancelled or isn’t allowed for this account. Try email above or another provider.";
    case "OAUTH_INVALID_STATE":
      return "That sign-in link expired or was invalid. Try the provider button again.";
    case "OAUTH_CONFIG":
      return "Sign-in with this provider isn’t available right now. Use email above.";
    case "OAUTH_TOKEN":
      return "We couldn’t finish signing you in with that provider. Try again shortly or use email.";
    default:
      return "Sign-in didn’t complete. Try again or use email.";
  }
}
