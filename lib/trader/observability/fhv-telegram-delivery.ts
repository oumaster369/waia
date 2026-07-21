import { FHV_ALERT_POLICY_BASELINE_FHV_V1 } from "@/lib/trader/observability/fhv-alert-policy-v1";
import type { FhvAlertLedgerEntry } from "@/lib/trader/observability/fhv-alert-ledger";

export type FhvTelegramDeliveryAttempt = Readonly<{
  alertId: string;
  attempt: number;
  outcome: "success" | "failed" | "skipped";
  error?: string;
}>;

export async function deliverFhvAlertWithRetry(input: {
  entry: FhvAlertLedgerEntry;
  send: (text: string) => Promise<{ ok: boolean; error?: string }>;
  policy?: typeof FHV_ALERT_POLICY_BASELINE_FHV_V1;
  dedupeSeen?: Set<string>;
}): Promise<FhvTelegramDeliveryAttempt[]> {
  const policy = input.policy ?? FHV_ALERT_POLICY_BASELINE_FHV_V1;
  const dedupeSeen = input.dedupeSeen ?? new Set<string>();
  if (dedupeSeen.has(input.entry.dedupeKey)) {
    return [{ alertId: input.entry.alertId, attempt: 0, outcome: "skipped" }];
  }
  dedupeSeen.add(input.entry.dedupeKey);

  const attempts: FhvTelegramDeliveryAttempt[] = [];
  const text = `[${input.entry.severity}] ${input.entry.alertId}: ${input.entry.message}`;
  for (let index = 0; index < policy.telegramRetryBackoffSec.length; index += 1) {
    const result = await input.send(text);
    attempts.push({
      alertId: input.entry.alertId,
      attempt: index + 1,
      outcome: result.ok ? "success" : "failed",
      error: result.error,
    });
    if (result.ok) {
      return attempts;
    }
  }
  return attempts;
}
