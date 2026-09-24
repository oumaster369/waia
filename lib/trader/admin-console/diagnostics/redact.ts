const SECRET =
  /(?:Bearer\s+\S+|postgres:\/\/[^:]+:[^@]+@|(?:api[_-]?key|secret|password|signature|accesskeyid)\s*[=:]\s*\S+|\b[A-Za-z0-9_\-]{32,}\b|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/gi;

export function redactDiagnosticText(value: string, max = 2000): string {
  const redacted = value.replace(SECRET, (match) => {
    if (match.startsWith("Bearer")) return "[redacted:bearer]";
    if (match.startsWith("postgres://")) return "[redacted:database-url]";
    if (match.includes("@") && match.includes(".")) return "[redacted:email]";
    if (/[=:]/.test(match)) return "[redacted:secret]";
    return "[redacted:token]";
  });
  return redacted.length > max ? redacted.slice(0, max) : redacted;
}
