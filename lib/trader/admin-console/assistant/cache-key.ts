import { createHash } from "node:crypto";

export function assistantCacheKey(input: {
  question: string;
  entity: string;
  revision: string;
  scope: string;
  period: string;
  mode: string;
  currency: string;
  promptVersion: string;
  toolPolicyVersion: string;
}): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}
