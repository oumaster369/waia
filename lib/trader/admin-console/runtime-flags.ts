import { getCloudflareContext } from "@opennextjs/cloudflare";

/** Public console configuration only; never enumerate Worker bindings or expose secrets. */
export function adminRuntimeFlag(
  key: "WAIA_RELEASE_SHA" | "WAIA_ADMIN_ASSISTANT_ENABLED",
): string | undefined {
  try {
    const env = getCloudflareContext().env as unknown as Record<string, unknown>;
    if (typeof env[key] === "string") return env[key] as string;
  } catch {
    /* Local Node tests/builds have no Worker request context. */
  }
  return process.env[key];
}
