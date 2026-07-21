/** Fail-closed secret and adapter resolution for FHV operations (DEE-416 corrective). */

export class FhvRuntimeConfigError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "FhvRuntimeConfigError";
    this.code = code;
  }
}

export function isFhvProductionRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "production" || env.WAIA_RUNTIME === "cloudflare";
}

export function requireFhvCommandSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.FHV_OPERATOR_COMMAND_SECRET?.trim();
  if (!secret) {
    throw new FhvRuntimeConfigError(
      "FHV_COMMAND_SECRET_MISSING",
      "FHV_OPERATOR_COMMAND_SECRET is required.",
    );
  }
  return secret;
}

export function requireFhvCsrfSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.FHV_ADMIN_CSRF_SECRET?.trim();
  if (!secret) {
    throw new FhvRuntimeConfigError(
      "FHV_CSRF_SECRET_MISSING",
      "FHV_ADMIN_CSRF_SECRET is required.",
    );
  }
  return secret;
}

export function requireFhvObserverTunnelSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.FHV_OBSERVER_TUNNEL_SECRET?.trim();
  if (!secret) {
    throw new FhvRuntimeConfigError(
      "FHV_OBSERVER_TUNNEL_SECRET_MISSING",
      "FHV_OBSERVER_TUNNEL_SECRET is required.",
    );
  }
  return secret;
}

export function requireFhvObserverTunnelBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const baseUrl = env.FHV_OBSERVER_TUNNEL_BASE_URL?.trim();
  if (!baseUrl) {
    throw new FhvRuntimeConfigError(
      "FHV_OBSERVER_TUNNEL_BASE_URL_MISSING",
      "FHV_OBSERVER_TUNNEL_BASE_URL is required.",
    );
  }
  return baseUrl.replace(/\/+$/, "");
}

export function isLocalDevelopmentStatusAdapterEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (isFhvProductionRuntime(env)) {
    return false;
  }
  return env.FHV_STATUS_ADAPTER?.trim() === "local_file";
}

export function requireLocalDevelopmentStatusPath(env: NodeJS.ProcessEnv = process.env): string {
  const path = env.FHV_OPERATOR_STATUS_PATH?.trim();
  if (!path) {
    throw new FhvRuntimeConfigError(
      "FHV_OPERATOR_STATUS_PATH_MISSING",
      "FHV_OPERATOR_STATUS_PATH is required for local_file adapter.",
    );
  }
  return path;
}
