import { classifyAlertLine } from "@/lib/observability/alerting/alert-classifier";
import { emitAlertDeliveryTelemetry } from "@/lib/observability/alerting/alert-delivery-telemetry";
import { formatAlertMessage } from "@/lib/observability/alerting/alert-formatter";
import { loadAlertingConfig } from "@/lib/observability/alerting/config";
import {
  envelopeFingerprintPrefix,
  sendTelegramAlertMessage,
} from "@/lib/observability/alerting/telegram-alert-sink";
import type { AlertDeliveryOutcome, AlertEnvelope } from "@/lib/observability/alerting/types";

const DEDUPE_WINDOW_MS = 5 * 60 * 1000;

const dedupeExpiryByFingerprint = new Map<string, number>();

function isDuplicate(fingerprint: string, nowMs: number): boolean {
  const existingExpiry = dedupeExpiryByFingerprint.get(fingerprint);
  if (existingExpiry !== undefined && existingExpiry > nowMs) {
    return true;
  }
  dedupeExpiryByFingerprint.set(fingerprint, nowMs + DEDUPE_WINDOW_MS);
  return false;
}

function pruneExpiredDedupeEntries(nowMs: number): void {
  for (const [fingerprint, expiry] of dedupeExpiryByFingerprint.entries()) {
    if (expiry <= nowMs) {
      dedupeExpiryByFingerprint.delete(fingerprint);
    }
  }
}

function mapSendResultToOutcome(result: {
  ok: boolean;
  httpStatus: number;
  retryable: boolean;
  errorCode?: string;
}): AlertDeliveryOutcome {
  if (result.ok) {
    return "success";
  }
  if (result.errorCode === "config_error") {
    return "config_error";
  }
  return "failed";
}

function scheduleAlertDelivery(task: () => Promise<void>): void {
  void (async () => {
    try {
      const nextServer = await import("next/server");
      if (typeof nextServer.after === "function") {
        nextServer.after(task);
        return;
      }
    } catch {
      // Non-Next runtime — fall through to fire-and-forget.
    }
    void task().catch(() => {});
  })();
}

async function deliverAlertEnvelope(envelope: AlertEnvelope, dryRun: boolean): Promise<void> {
  const config = loadAlertingConfig();
  const fingerprintPrefix = envelopeFingerprintPrefix(envelope);

  if (dryRun || !config.enabled) {
    emitAlertDeliveryTelemetry({
      event: "waia_alert_delivery",
      alert_type: envelope.alertType,
      source_stream: envelope.sourceStream,
      outcome: "dry_run",
      fingerprint_prefix: fingerprintPrefix,
    });
    return;
  }

  const text = formatAlertMessage(envelope);
  const { result, attemptCount } = await sendTelegramAlertMessage(config, text);
  emitAlertDeliveryTelemetry({
    event: "waia_alert_delivery",
    alert_type: envelope.alertType,
    source_stream: envelope.sourceStream,
    outcome: mapSendResultToOutcome(result),
    fingerprint_prefix: fingerprintPrefix,
    attempt_count: attemptCount,
    http_status: result.httpStatus > 0 ? result.httpStatus : undefined,
  });
}

function routeAlertLine(line: string): void {
  try {
    const config = loadAlertingConfig();
    if (!config.enabled) {
      return;
    }

    const envelope = classifyAlertLine(line);
    if (envelope === null) {
      return;
    }

    const nowMs = Date.now();
    pruneExpiredDedupeEntries(nowMs);
    if (isDuplicate(envelope.fingerprint, nowMs)) {
      emitAlertDeliveryTelemetry({
        event: "waia_alert_delivery",
        alert_type: envelope.alertType,
        source_stream: envelope.sourceStream,
        outcome: "suppressed",
        fingerprint_prefix: envelopeFingerprintPrefix(envelope),
        suppressed: true,
      });
      return;
    }

    scheduleAlertDelivery(() => deliverAlertEnvelope(envelope, false));
  } catch {
    emitAlertDeliveryTelemetry({
      event: "waia_alert_delivery",
      alert_type: "unknown",
      source_stream: "unknown",
      outcome: "router_error",
      fingerprint_prefix: "unknown",
    });
  }
}

export function createAlertRouterSink<TSink extends (line: string) => void>(
  innerSink: TSink,
): TSink {
  const wrapped = ((line: string) => {
    innerSink(line);
    routeAlertLine(line);
  }) as TSink;
  return wrapped;
}

export async function runAlertDrill(options: { dryRun?: boolean } = {}): Promise<{
  configured: boolean;
  dryRun: boolean;
  message: string;
  deliveryOutcome: AlertDeliveryOutcome;
}> {
  const { createDrillAlertEnvelope } =
    await import("@/lib/observability/alerting/alert-classifier");
  const envelope = createDrillAlertEnvelope();
  const config = loadAlertingConfig();
  const message = formatAlertMessage(envelope);
  const fingerprintPrefix = envelopeFingerprintPrefix(envelope);

  const explicitDryRun = options.dryRun === true;
  const explicitLive = options.dryRun === false;

  if (explicitLive && !config.enabled) {
    emitAlertDeliveryTelemetry({
      event: "waia_alert_delivery",
      alert_type: envelope.alertType,
      source_stream: envelope.sourceStream,
      outcome: "config_error",
      fingerprint_prefix: fingerprintPrefix,
    });
    return {
      configured: false,
      dryRun: false,
      message,
      deliveryOutcome: "config_error",
    };
  }

  const dryRun = explicitDryRun || (!explicitLive && !config.enabled);

  if (dryRun) {
    emitAlertDeliveryTelemetry({
      event: "waia_alert_delivery",
      alert_type: envelope.alertType,
      source_stream: envelope.sourceStream,
      outcome: "dry_run",
      fingerprint_prefix: fingerprintPrefix,
    });
    return {
      configured: config.enabled,
      dryRun: true,
      message,
      deliveryOutcome: "dry_run",
    };
  }

  const { result, attemptCount } = await sendTelegramAlertMessage(config, message);
  const deliveryOutcome = mapSendResultToOutcome(result);
  emitAlertDeliveryTelemetry({
    event: "waia_alert_delivery",
    alert_type: envelope.alertType,
    source_stream: envelope.sourceStream,
    outcome: deliveryOutcome,
    fingerprint_prefix: fingerprintPrefix,
    attempt_count: attemptCount,
    http_status: result.httpStatus > 0 ? result.httpStatus : undefined,
  });

  return {
    configured: true,
    dryRun: false,
    message,
    deliveryOutcome,
  };
}

/** Test helper — reset dedupe state between unit tests. */
export function resetAlertRouterDedupeForTests(): void {
  dedupeExpiryByFingerprint.clear();
}
