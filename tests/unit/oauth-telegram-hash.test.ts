import { createHash, createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { verifyTelegramLoginWidgetHash } from "@/lib/oauth/telegram-hash";

function signTelegramLoginWidget(botToken: string, fields: Record<string, string>): string {
  const pairs = Object.entries(fields).sort((a, b) => a[0].localeCompare(b[0]));
  const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join("\n");
  const secretKey = createHash("sha256").update(botToken, "utf8").digest();
  return createHmac("sha256", secretKey).update(dataCheckString, "utf8").digest("hex");
}

describe("verifyTelegramLoginWidgetHash", () => {
  it("accepts a correctly signed telegram login payload within the freshness window", () => {
    const botToken = "123456789:ABCDEF";
    const ts = Math.floor(Date.now() / 1000);
    const base = {
      auth_date: String(ts),
      id: "4242",
      first_name: "T",
    };
    const hash = signTelegramLoginWidget(botToken, base);

    expect(verifyTelegramLoginWidgetHash(botToken, { ...base, hash })).toBe(true);
  });

  it("rejects a mismatched hex signature", () => {
    const botToken = "123456789:ABCDEF";
    const ts = Math.floor(Date.now() / 1000);
    const base = {
      auth_date: String(ts),
      id: "4242",
    };

    expect(
      verifyTelegramLoginWidgetHash(botToken, {
        ...base,
        hash: "00".repeat(32),
      }),
    ).toBe(false);
  });

  it("rejects stale auth_date values", () => {
    const botToken = "123456789:ABCDEF";
    const oldTs = Math.floor(Date.now() / 1000) - 100_000;
    const base = {
      auth_date: String(oldTs),
      id: "1",
    };
    const hash = signTelegramLoginWidget(botToken, base);

    expect(verifyTelegramLoginWidgetHash(botToken, { ...base, hash })).toBe(false);
  });
});
