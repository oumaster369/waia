import { createHash } from "node:crypto";

export function fingerprintDiagnostic(input: {
  service: string;
  errorClass: string;
  message: string;
  stack?: string | null;
}): string {
  const message = input.message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "#")
    .replace(/\b[0-9a-f]{8,}\b/gi, "#")
    .replace(/\d+/g, "#");
  const frames = (input.stack ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("at "))
    .slice(0, 3)
    .map((line) => line.replace(/:\d+:\d+/g, ""))
    .join("\n");
  return createHash("sha256")
    .update(`${input.service}\n${input.errorClass}\n${message}\n${frames}`)
    .digest("hex");
}
