import {
  buildHostModuleMap,
  defaultPrimaryHostname,
  isTraderHostRoutingEnabled,
  moduleOrigin,
} from "@/lib/hosts/config";
import type { ModuleHost, ModuleKey } from "@/lib/hosts/types";

export { isTraderHostRoutingEnabled } from "@/lib/hosts/config";

export function normalizeHostname(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  const withoutPort = trimmed.split(":")[0] ?? trimmed;
  return withoutPort;
}

export function extractHostnameFromHeaders(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-host");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) {
      return normalizeHostname(first);
    }
  }

  const host = headers.get("host");
  if (host) {
    return normalizeHostname(host);
  }

  return defaultPrimaryHostname();
}

function resolveHostname(input: Request | Headers | string): string {
  if (typeof input === "string") {
    return normalizeHostname(input);
  }
  if (input instanceof Headers) {
    return extractHostnameFromHeaders(input);
  }
  return extractHostnameFromHeaders(input.headers);
}

export function resolveModuleHost(input: Request | Headers | string): ModuleHost {
  const hostname = resolveHostname(input);
  const moduleKey = buildHostModuleMap().get(hostname) ?? "primary";
  return {
    module: moduleKey,
    host: hostname,
    origin: moduleOrigin(moduleKey),
  };
}

export function isModuleHost(input: Request | Headers | string, module: ModuleKey): boolean {
  if (!isTraderHostRoutingEnabled() && module === "trader") {
    return false;
  }
  return resolveModuleHost(input).module === module;
}

export function buildModuleUrl(module: ModuleKey, path: string): string {
  const origin = moduleOrigin(module);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${origin}${normalizedPath}`;
}
