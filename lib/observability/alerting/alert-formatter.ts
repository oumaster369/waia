import type { AlertEnvelope, AlertType } from "@/lib/observability/alerting/types";

const ALERT_TYPE_LABELS: Record<AlertType, string> = {
  duplicate_order_risk: "Duplicate order risk",
  reconciliation_mismatch: "Reconciliation mismatch",
  data_quality_breach: "Data quality breach",
  paper_loop_critical: "Paper loop critical",
  drawdown_stop_account: "Drawdown / STOP_ACCOUNT",
  payment_watcher_failure: "Payment watcher failure",
  payment_watcher_offline: "Payment watcher offline",
};

const EXTENSION_LABELS: Record<string, string> = {
  escalation_kind: "Escalation",
  execution_mode: "Execution mode",
  target_kind: "Target",
  risk_outcome: "Risk outcome",
  reconciliation_classification: "Reconciliation class",
  reason: "Reason",
  drill: "Drill",
};

const TELEGRAM_MAX_TEXT_LENGTH = 4096;

export function alertFingerprintPrefix(fingerprint: string): string {
  return fingerprint.slice(0, 12);
}

export function formatAlertMessage(envelope: AlertEnvelope): string {
  const lines: string[] = [
    "WAIA AI-TRADER CRITICAL",
    `Type: ${ALERT_TYPE_LABELS[envelope.alertType]}`,
    `Org: ${envelope.organizationId ?? "platform"}`,
    `Source: ${envelope.sourceStream}/${envelope.sourceKind}`,
    `Outcome: ${envelope.outcome}`,
  ];

  for (const [key, value] of Object.entries(envelope.extensions)) {
    if (key === "drill" && value === true) {
      lines.push("Drill: true");
      continue;
    }
    const label = EXTENSION_LABELS[key] ?? key;
    lines.push(`${label}: ${String(value)}`);
  }

  lines.push(`Time: ${envelope.observedAt}`);
  lines.push(`Ref: ${alertFingerprintPrefix(envelope.fingerprint)}`);

  const text = lines.join("\n");
  if (text.length <= TELEGRAM_MAX_TEXT_LENGTH) {
    return text;
  }
  return `${text.slice(0, TELEGRAM_MAX_TEXT_LENGTH - 1)}…`;
}

export function formatDrillBanner(configured: boolean): string {
  return configured
    ? "BP-9 alert drill — live Telegram delivery"
    : "BP-9 alert drill — dry-run (alerting secrets not configured)";
}
