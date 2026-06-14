/** Mask an API key for display — first 4 + ellipsis + last 4; short keys fully masked. */
export function maskApiKey(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (trimmed.length < 8) {
    return "••••";
  }
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}
