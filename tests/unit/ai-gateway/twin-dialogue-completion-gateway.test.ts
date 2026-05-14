import { afterEach, describe, expect, it, vi } from "vitest";

import { isWaiaAiGatewayFoundationEnabled } from "@/lib/ai-gateway/config";
import { FakeCompletionProvider } from "@/lib/ai-gateway/fake-completion-provider";
import { resolveTwinDialogueAssistantText } from "@/lib/ai-gateway/twin-dialogue-completion-gateway";
import { TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE } from "@/lib/dashboard/twin-dialogue-stub";

function assertTwinDialogueLiveSystemPromptAnchors(sysLower: string) {
  expect(sysLower).toMatch(/reflective|notice/);
  expect(sysLower).toMatch(/at most one question/);
  expect(sysLower).toMatch(/tentative/);
  expect(sysLower).toMatch(/reply in the language the person is writing in/);
  expect(sysLower).toContain("paraphrase");
  expect(sysLower).toContain("default question count is zero");
  expect(sysLower).toContain("quotation");
  expect(sysLower).toContain("one short sentence is a complete reply");
  expect(sysLower).toContain("tension");
  expect(sysLower).toContain("как ты себя чувствуешь");
  expect(sysLower).toContain("что это значит для тебя");
  expect(sysLower).toContain("я слышу, что");
  expect(sysLower).toContain("warmth through attention");
  expect(sysLower).toContain("coldness");
  expect(sysLower).toContain("co-presence caps above apply");
  expect(sysLower).toContain("social presence and register");
  expect(sysLower).toContain("meeting them is the work");
  expect(sysLower).toContain("default to «ты»");
  expect(sysLower).toContain("not from performing it");
  expect(sysLower).toContain("service-agent register");
  expect(sysLower).toContain("art installation");
  expect(sysLower).toContain("non-interpretive register");
  expect(sysLower).toContain("это может указывать");
  expect(sysLower).toContain("this may reflect");
  expect(sysLower).toContain("quote-then-interpret-then-question");
  expect(sysLower).toContain("conversational co-presence");
  expect(sysLower).toContain("speak as someone in the conversation");
  expect(sysLower).toContain("do not narrate the person impersonally");
  expect(sysLower).toContain("do not attribute emotional or mental states");
  expect(sysLower).toContain("direct response initiation");
  expect(sysLower).toContain("enter the moment directly");
  expect(sysLower).toContain(
    "does not need to demonstrate understanding before becoming present",
  );
  expect(sysLower).toContain("do not begin most replies by restating");
  expect(sysLower).toContain("note written about the moment");
  expect(sysLower).not.toContain("of sorts");
  expect(sysLower).not.toContain("internal tension");
  expect(sysLower).toContain("that must be hard");
  expect(sysLower).not.toContain("roleplay");
  expect(sysLower).not.toContain("therapist");
  expect(sysLower).not.toContain("assistant ready to help");
  expect(sysLower).not.toContain("journey");
  expect(sysLower).not.toContain("soul");
  expect(sysLower).not.toContain("awaken");
  expect(sysLower).not.toContain("true self");
  expect(sysLower).not.toContain("destiny");
}

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
  const prevFoundation = process.env.WAIA_AI_GATEWAY_FOUNDATION;
  const prevProvider = process.env.WAIA_AI_PROVIDER;
  const prevOpenAiKey = process.env.WAIA_AI_OPENAI_API_KEY;

  afterEach(() => {
    vi.restoreAllMocks();
    if (prevFoundation === undefined) {
      delete process.env.WAIA_AI_GATEWAY_FOUNDATION;
    } else {
      process.env.WAIA_AI_GATEWAY_FOUNDATION = prevFoundation;
    }
    if (prevProvider === undefined) {
      delete process.env.WAIA_AI_PROVIDER;
    } else {
      process.env.WAIA_AI_PROVIDER = prevProvider;
    }
    if (prevOpenAiKey === undefined) {
      delete process.env.WAIA_AI_OPENAI_API_KEY;
    } else {
      process.env.WAIA_AI_OPENAI_API_KEY = prevOpenAiKey;
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
    delete process.env.WAIA_AI_PROVIDER;
    const out = await resolveTwinDialogueAssistantText({ userContent: "hello" });
    expect(out.text).toBe(TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE);
    expect(out.telemetry).toMatchObject({
      foundation: "fake_stub",
      providerId: "fake",
      providerOutcome: "ok",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    });
    if (out.telemetry.foundation === "fake_stub") {
      expect(out.telemetry.provider_phase_ms).toBeGreaterThanOrEqual(0);
    }
  });

  it("degrades to stub when signal aborted under foundation fake path", async () => {
    process.env.WAIA_AI_GATEWAY_FOUNDATION = "1";
    delete process.env.WAIA_AI_PROVIDER;
    const ac = new AbortController();
    ac.abort();
    const out = await resolveTwinDialogueAssistantText({
      userContent: "hello",
      signal: ac.signal,
    });
    expect(out.text).toBe(TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE);
    expect(out.telemetry).toMatchObject({
      foundation: "fake_stub",
      providerId: "fake",
      providerOutcome: "provider_error",
      degraded: true,
    });
  });

  it("degrades with CONFIG when openai-compatible selected without API key", async () => {
    process.env.WAIA_AI_GATEWAY_FOUNDATION = "1";
    process.env.WAIA_AI_PROVIDER = "openai-compatible";
    delete process.env.WAIA_AI_OPENAI_API_KEY;

    const out = await resolveTwinDialogueAssistantText({ userContent: "hello" });
    expect(out.text).toBe(TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE);
    expect(out.telemetry).toMatchObject({
      foundation: "fake_stub",
      providerId: "openai-compatible",
      providerOutcome: "config",
      degraded: true,
    });
  });

  it("returns live assistant text when openai-compatible succeeds", async () => {
    process.env.WAIA_AI_GATEWAY_FOUNDATION = "1";
    process.env.WAIA_AI_PROVIDER = "openai-compatible";
    process.env.WAIA_AI_OPENAI_API_KEY = "test-key";

    type OpenAiRequestBody = { messages?: Array<{ role: string; content: string }> };
    let parsed: OpenAiRequestBody | null = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      if (typeof init?.body === "string") {
        parsed = JSON.parse(init.body) as OpenAiRequestBody;
      }
      return new Response(
        JSON.stringify({
          id: "chatcmpl-gateway",
          choices: [{ message: { role: "assistant", content: " Twin dialogue reply " } }],
          usage: { prompt_tokens: 2, completion_tokens: 4, total_tokens: 6 },
        }),
        { status: 200 },
      );
    });

    const out = await resolveTwinDialogueAssistantText({ userContent: "user asks" });
    expect(parsed).not.toBeNull();
    const sys = parsed!.messages?.find((m) => m.role === "system")?.content ?? "";
    const sysLower = sys.toLowerCase();
    assertTwinDialogueLiveSystemPromptAnchors(sysLower);

    expect(out.text).toBe("Twin dialogue reply");
    expect(out.telemetry).toMatchObject({
      foundation: "live",
      providerId: "openai-compatible",
      providerOutcome: "ok",
      usage: { promptTokens: 2, completionTokens: 4, totalTokens: 6 },
      providerRequestId: "chatcmpl-gateway",
    });
  });

  it("includes prior replay roles before current user message for openai-compatible", async () => {
    process.env.WAIA_AI_GATEWAY_FOUNDATION = "1";
    process.env.WAIA_AI_PROVIDER = "openai-compatible";
    process.env.WAIA_AI_OPENAI_API_KEY = "test-key";

    type OpenAiRequestBody = { messages?: Array<{ role: string; content: string }> };
    let parsed: OpenAiRequestBody | null = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      if (typeof init?.body === "string") {
        parsed = JSON.parse(init.body) as OpenAiRequestBody;
      }
      return new Response(
        JSON.stringify({
          id: "chatcmpl-replay",
          choices: [{ message: { role: "assistant", content: "ok" } }],
          usage: {},
        }),
        { status: 200 },
      );
    });

    await resolveTwinDialogueAssistantText({
      userContent: "now",
      priorReplayMessages: [
        { role: "user", content: "past-user" },
        { role: "assistant", content: "past-ai" },
      ],
    });

    expect(parsed).not.toBeNull();
    const msgs = parsed!.messages;
    expect(Array.isArray(msgs)).toBe(true);
    expect(msgs!.map((m: { role: string }) => m.role).join("|")).toBe(
      "system|user|assistant|user",
    );
    expect(msgs![3]!.content).toBe("now");
    expect(msgs![0]!.content).toContain("Continue naturally");
    const replaySysLower = msgs![0]!.content.toLowerCase();
    assertTwinDialogueLiveSystemPromptAnchors(replaySysLower);
    expect(replaySysLower).toContain("without repeating verbatim");
  });
});
