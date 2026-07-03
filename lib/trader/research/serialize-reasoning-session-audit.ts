import type { ReasoningSessionAudit } from "@/lib/trader/research/reasoning-session-audit.types";

export function serializeReasoningSessionAudit(audit: ReasoningSessionAudit): string {
  return `${JSON.stringify(audit, null, 2)}\n`;
}
