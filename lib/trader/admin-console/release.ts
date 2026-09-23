const SHA = /^[0-9a-f]{40}$/;

export type AdminReleaseFact =
  | {
      state: "value";
      sha: string;
      source: "WAIA_RELEASE_SHA";
      verified: false;
      reason: "RELEASE_SHA_UNVERIFIED";
    }
  | { state: "unavailable"; reason: "WAIA_RELEASE_SHA_NOT_SET" };

export function readAdminRelease(
  env: { WAIA_RELEASE_SHA?: string | undefined } = process.env,
): AdminReleaseFact {
  const sha = env.WAIA_RELEASE_SHA?.trim().toLowerCase() ?? "";
  if (!SHA.test(sha)) {
    return { state: "unavailable", reason: "WAIA_RELEASE_SHA_NOT_SET" };
  }
  return {
    state: "value",
    sha,
    source: "WAIA_RELEASE_SHA",
    verified: false,
    reason: "RELEASE_SHA_UNVERIFIED",
  };
}
