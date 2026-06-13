/** Validate post-auth redirect targets for browser navigation (paths or trusted module origins). */

function trimRedirect(redirect: string): string | null {
  if (typeof redirect !== "string") return null;
  if (redirect !== redirect.trim()) return null;
  const trimmed = redirect.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function allowedModuleOrigins(): string[] {
  const origins: string[] = [];
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const trader = process.env.NEXT_PUBLIC_TRADER_URL?.trim();
  if (site) {
    try {
      origins.push(new URL(site).origin);
    } catch {
      /* ignore */
    }
  }
  if (trader) {
    try {
      origins.push(new URL(trader).origin);
    } catch {
      /* ignore */
    }
  }
  return origins;
}

/** Reject open redirects; allow internal paths and absolute URLs on configured module origins. */
export function safeAuthRedirectTarget(redirect: string): string | null {
  const trimmed = trimRedirect(redirect);
  if (!trimmed) return null;

  if (trimmed.startsWith("/") && !trimmed.startsWith("//") && !trimmed.includes(":")) {
    if (trimmed.includes("\\")) return null;
    if (trimmed.includes("\0")) return null;
    if (trimmed.includes("..")) return null;
    if (/[\r\n\t\f\v]/.test(trimmed)) return null;
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (allowedModuleOrigins().includes(url.origin)) {
      return url.toString();
    }
  } catch {
    return null;
  }

  return null;
}
