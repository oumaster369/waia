/** Reject open redirects before client navigation (protocol-relative URLs, schemes, escapes). */

export function safeInternalRedirectPath(redirect: string): string | null {
  if (typeof redirect !== "string") return null;
  if (redirect !== redirect.trim()) return null;
  if (redirect.length === 0) return null;
  if (!redirect.startsWith("/")) return null;
  if (redirect.startsWith("//")) return null;
  if (redirect.includes(":")) return null;
  if (redirect.includes("\\")) return null;
  if (redirect.includes("\0")) return null;
  if (redirect.includes("..")) return null;
  if (/[\r\n\t\f\v]/.test(redirect)) return null;
  return redirect;
}
