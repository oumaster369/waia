import type { AlertDeliveryOutcome } from "@/lib/observability/alerting/types";

export type AlertDeliveryTelemetryPayload = {
  event: "waia_alert_delivery";
  alert_type: string;
  source_stream: string;
  outcome: AlertDeliveryOutcome;
  fingerprint_prefix: string;
  attempt_count?: number;
  http_status?: number;
  suppressed?: boolean;
};

export type AlertDeliveryTelemetrySink = (line: string) => void;

const defaultSink: AlertDeliveryTelemetrySink = (line) => {
  console.info(line);
};

export function emitAlertDeliveryTelemetry(
  payload: AlertDeliveryTelemetryPayload,
  sink: AlertDeliveryTelemetrySink = defaultSink,
): void {
  sink(JSON.stringify(payload));
}
