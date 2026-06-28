import { afterEach, describe, expect, it, vi } from "vitest";

import { sendTelegramAlertMessage } from "@/lib/observability/alerting/telegram-alert-sink";

describe("telegram-alert-sink", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns config_error when alerting is not enabled", async () => {
    const result = await sendTelegramAlertMessage({ enabled: false }, "hello");
    expect(result.result.errorCode).toBe("config_error");
    expect(result.attemptCount).toBe(0);
  });

  it("succeeds on first 200 response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const result = await sendTelegramAlertMessage(
      {
        enabled: true,
        alertsBotToken: "test-token",
        chatId: "-100123",
        threadId: "42",
      },
      "hello",
      { fetchImpl, sleep: async () => {} },
    );
    expect(result.result.ok).toBe(true);
    expect(result.attemptCount).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries retryable 500 responses", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 500 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await sendTelegramAlertMessage(
      {
        enabled: true,
        alertsBotToken: "test-token",
        chatId: "-100123",
        threadId: "42",
      },
      "hello",
      { fetchImpl, sleep },
    );

    expect(result.result.ok).toBe(true);
    expect(result.attemptCount).toBe(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("does not retry 401 config errors", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 401 }));
    const result = await sendTelegramAlertMessage(
      {
        enabled: true,
        alertsBotToken: "test-token",
        chatId: "-100123",
        threadId: "42",
      },
      "hello",
      { fetchImpl, sleep: async () => {} },
    );
    expect(result.result.ok).toBe(false);
    expect(result.result.errorCode).toBe("config_error");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
