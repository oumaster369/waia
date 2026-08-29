import { describe, expect, it } from "vitest";

import {
  createFinanceConfirmation,
  verifyFinanceConfirmation,
} from "@/lib/waia-core/finance-assistant/confirmation";

const secret = "a-dedicated-test-secret-that-is-long-enough";
const organizationId = "72d2caf2-cb21-4d8c-a036-72f2a7110cd1";
const userId = "user-1";

async function signPayload(payload: unknown): Promise<string> {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signingKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", signingKey, new TextEncoder().encode(encoded));
  return `${encoded}.${Buffer.from(signature).toString("base64url")}`;
}

describe("Finance Assistant confirmation envelope", () => {
  it("is bound to the user and organization and expires", async () => {
    const issued = new Date("2026-08-24T10:00:00.000Z");
    const token = await createFinanceConfirmation({
      userId,
      organizationId,
      intent: "CREATE_PROJECT",
      fields: { name: "Breath of WAIA" },
      now: issued,
      secret,
    });
    const payload = await verifyFinanceConfirmation(token, {
      userId,
      organizationId,
      now: new Date("2026-08-24T10:05:00.000Z"),
      secret,
    });
    expect(payload.intent).toBe("CREATE_PROJECT");
    await expect(
      verifyFinanceConfirmation(token, {
        userId: "user-2",
        organizationId,
        now: issued,
        secret,
      }),
    ).rejects.toThrow(/scope/i);
    await expect(
      verifyFinanceConfirmation(token, {
        userId,
        organizationId,
        now: new Date("2026-08-24T10:11:00.000Z"),
        secret,
      }),
    ).rejects.toThrow(/expired/i);
  });

  it("rejects a tampered token", async () => {
    const token = await createFinanceConfirmation({
      userId,
      organizationId,
      intent: "CREATE_COUNTERPARTY",
      fields: { displayName: "Patron" },
      secret,
    });
    const [encoded, signature] = token.split(".");
    const tamperedSignature = `${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;

    expect(Buffer.from(tamperedSignature, "base64url")).not.toEqual(
      Buffer.from(signature, "base64url"),
    );
    await expect(
      verifyFinanceConfirmation(`${encoded}.${tamperedSignature}`, {
        userId,
        organizationId,
        secret,
      }),
    ).rejects.toThrow(/invalid/i);
  });

  it("rejects a correctly signed payload outside the closed write schema", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signPayload({
      version: 1,
      subjectUserId: userId,
      organizationId,
      intent: "RUN_SQL",
      fields: [],
      issuedAt: now,
      expiresAt: now + 600,
      nonce: "forged-but-signed",
    });
    await expect(
      verifyFinanceConfirmation(token, { userId, organizationId, secret }),
    ).rejects.toThrow(/invalid|scope/i);
  });
});
