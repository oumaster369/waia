import type { AlertingConfig } from "@/lib/observability/alerting/types";

function readNonEmptyEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

/** BP-9 alerting secrets — dedicated Alerts Bot only; never reads TELEGRAM_BOT_TOKEN. */
export function loadAlertingConfig(): AlertingConfig {
  const alertsBotToken = readNonEmptyEnv("TELEGRAM_ALERTS_BOT_TOKEN");
  const chatId = readNonEmptyEnv("TELEGRAM_ALERTS_CHAT_ID");
  const threadId = readNonEmptyEnv("TELEGRAM_ALERTS_THREAD_ID");

  if (!alertsBotToken || !chatId || !threadId) {
    return { enabled: false };
  }

  return {
    enabled: true,
    alertsBotToken,
    chatId,
    threadId,
  };
}

export function isAlertingEnabled(): boolean {
  return loadAlertingConfig().enabled;
}
