import { afterEach, describe, expect, it } from "vitest";

import { isWaiaAiGatewayFoundationEnabled } from "@/lib/ai-gateway/config";
import { FakeCompletionProvider } from "@/lib/ai-gateway/fake-completion-provider";
import { resolveTwinDialogueAssistantText } from "@/lib/ai-gateway/twin-dialogue-completion-gateway";
import { TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE } from "@/lib/dashboard/twin-dialogue-stub";

describe("isWaiaAiGatewayFoundationEnabled", () => {
  const prev = process.env.WAIA_AI_GATEWAY_FOUNDATION;

  afterEach(() => {
    if (prev === undefined) {
      delete process.env.WAIA_AI_GATEWAY_FOUNDATION;
    } else {
      process.env.WAIA_AI_GATEWAY_FOUNDATION = prev;
    }
  });

  it("is false when unset", () => {
    delete process.env.WAIA_AI_GATEWAY_FOUNDATION;
    expect(isWaiaAiGatewayFoundationEnabled()).toBe(false);
  });

  it("is true only for explicit allowlist tokens", () => {
    for (const v of ["1", "true", "yes", "on", " TRUE "]) {
      process.env.WAIA_AI_GATEWAY_FOUNDATION = v;
      expect(isWaiaAiGatewayFoundationEnabled()).toBe(true);
    }
  });

  it("is false for disabled tokens and unknown strings", () => {
    for (const v of ["0", "false", "no", "off", "", "maybe", " \t "]) {
      process.env.WAIA_AI_GATEWAY_FOUNDATION = v;
      expect(isWaiaAiGatewayFoundationEnabled()).toBe(false);
    }
  });
});

describe("FakeCompletionProvider", () => {
  it("returns stub text without network", async () => {
    const provider = new FakeCompletionProvider();
    const result = await provider.complete({
      model: "fake/no-network",
      messages: [{ role: "user", content: "ignored-by-fake" }],
      maxOutputTokens: 10,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe(TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE);
    }
  });

  it("returns PROVIDER_ERROR when signal already aborted", async () => {
    const provider = new FakeCompletionProvider();
    const ac = new AbortController();
    ac.abort();
    const result = await provider.complete(
      { model: "fake/no-network", messages: [], maxOutputTokens: 1 },
      ac.signal,
    );
    expect(result.ok).toBe(false);
  });
});

describe("resolveTwinDialogueAssistantText", () => {
  const prev = process.env.WAIA_AI_GATEWAY_FOUNDATION;

  afterEach(() => {
    if (prev === undefined) {
      delete process.env.WAIA_AI_GATEWAY_FOUNDATION;
    } else {
      process.env.WAIA_AI_GATEWAY_FOUNDATION = prev;
    }
  });

  it("uses legacy telemetry path when foundation disabled", async () => {
    delete process.env.WAIA_AI_GATEWAY_FOUNDATION;
    const out = await resolveTwinDialogueAssistantText({ userContent: "hello" });
    expect(out.text).toBe(TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE);
    expect(out.telemetry).toEqual({ foundation: "off" });
  });

  it("uses fake provider path when foundation enabled", async () => {
    process.env.WAIA_AI_GATEWAY_FOUNDATION = "1";
    const out = await resolveTwinDialogueAssistantText({ userContent: "hello" });
    expect(out.text).toBe(TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE);
    expect(out.telemetry.foundation).toBe("fake_stub");
    if (out.telemetry.foundation === "fake_stub") {
      expect(out.telemetry.provider_phase_ms).toBeGreaterThanOrEqual(0);
    }
  });

  it("degrades to stub when signal aborted under foundation path", async () => {
    process.env.WAIA_AI_GATEWAY_FOUNDATION = "1";
    const ac = new AbortController();
    ac.abort();
    const out = await resolveTwinDialogueAssistantText({
      userContent: "hello",
      signal: ac.signal,
    });
    expect(out.text).toBe(TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE);
    expect(out.telemetry).toMatchObject({
      foundation: "fake_stub",
      degraded: true,
    });
  });
});
