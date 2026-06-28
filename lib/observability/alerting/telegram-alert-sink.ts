import { alertFingerprintPrefix } from "@/lib/observability/alerting/alert-formatter";
import type {
  AlertingConfig,
  AlertEnvelope,
  TelegramAlertSinkDeps,
  TelegramSendResult,
} from "@/lib/observability/alerting/types";

const RETRY_BACKOFF_MS = [250, 1000, 4000] as const;
const REQUEST_TIMEOUT_MS = 5000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) {
    return undefined;
  }
  const seconds = Number.parseInt(header, 10);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const dateMs = Date.parse(header);
  if (Number.isFinite(dateMs)) {
    const delta = dateMs - Date.now();
    return delta > 0 ? delta : undefined;
  }
  return undefined;
}

function classifyHttpResult(status: number): TelegramSendResult {
  const retryable = status === 408 || status === 429 || (status >= 500 && status <= 599);
  const configError = status === 400 || status === 401 || status === 403 || status === 404;
  return {
    ok: status >= 200 && status < 300,
    httpStatus: status,
    retryable,
    errorCode: configError ? "config_error" : retryable ? "retryable" : "failed",
  };
}

export async function sendTelegramAlertMessage(
  config: AlertingConfig,
  text: string,
  deps: TelegramAlertSinkDeps = {},
): Promise<{ result: TelegramSendResult; attemptCount: number }> {
  if (!config.enabled || !config.alertsBotToken || !config.chatId || !config.threadId) {
    return {
      result: { ok: false, httpStatus: 0, retryable: false, errorCode: "config_error" },
      attemptCount: 0,
    };
  }

  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const url = `https://api.telegram.org/bot${config.alertsBotToken}/sendMessage`;
  const body = {
    chat_id: config.chatId,
    message_thread_id: Number.parseInt(config.threadId, 10),
    text,
    disable_web_page_preview: true,
  };

  let attemptCount = 0;
  let lastResult: TelegramSendResult = {
    ok: false,
    httpStatus: 0,
    retryable: false,
    errorCode: "failed",
  };

  for (let attempt = 0; attempt < RETRY_BACKOFF_MS.length + 1; attempt += 1) {
    attemptCount = attempt + 1;
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      lastResult = classifyHttpResult(response.status);
      if (lastResult.ok) {
        return { result: lastResult, attemptCount };
      }

      if (!lastResult.retryable || attempt >= RETRY_BACKOFF_MS.length) {
        return { result: lastResult, attemptCount };
      }

      const retryAfterMs = parseRetryAfterMs(response.headers.get("Retry-After"));
      const backoffMs = retryAfterMs ?? RETRY_BACKOFF_MS[attempt];
      await sleep(backoffMs);
    } catch {
      lastResult = {
        ok: false,
        httpStatus: 0,
        retryable: true,
        errorCode: "network_error",
      };
      if (attempt >= RETRY_BACKOFF_MS.length) {
        return { result: lastResult, attemptCount };
      }
      await sleep(RETRY_BACKOFF_MS[attempt]);
    }
  }

  return { result: lastResult, attemptCount };
}

export function envelopeFingerprintPrefix(envelope: AlertEnvelope): string {
  return alertFingerprintPrefix(envelope.fingerprint);
}
