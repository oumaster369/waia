import { afterEach, describe, expect, it, vi } from "vitest";

import {
  OpenAiCompatibleCompletionProvider,
  resolveWaiaAiOpenAiTwinDialogueTemperature,
  WAIA_AI_MAX_ASSISTANT_OUTPUT_CHARS,
} from "@/lib/ai-gateway/openai-compatible-completion-provider";

describe("OpenAiCompatibleCompletionProvider", () => {
  const prevKey = process.env.WAIA_AI_OPENAI_API_KEY;
  const prevBase = process.env.WAIA_AI_OPENAI_BASE_URL;
  const prevTimeout = process.env.WAIA_AI_OPENAI_REQUEST_TIMEOUT_MS;
  const prevTemperature = process.env.WAIA_AI_OPENAI_TEMPERATURE;

  afterEach(() => {
    vi.restoreAllMocks();
    if (prevKey === undefined) delete process.env.WAIA_AI_OPENAI_API_KEY;
    else process.env.WAIA_AI_OPENAI_API_KEY = prevKey;
    if (prevBase === undefined) delete process.env.WAIA_AI_OPENAI_BASE_URL;
    else process.env.WAIA_AI_OPENAI_BASE_URL = prevBase;
    if (prevTimeout === undefined) delete process.env.WAIA_AI_OPENAI_REQUEST_TIMEOUT_MS;
    else process.env.WAIA_AI_OPENAI_REQUEST_TIMEOUT_MS = prevTimeout;
    if (prevTemperature === undefined) delete process.env.WAIA_AI_OPENAI_TEMPERATURE;
    else process.env.WAIA_AI_OPENAI_TEMPERATURE = prevTemperature;
  });

  it("returns CONFIG when API key missing", async () => {
    delete process.env.WAIA_AI_OPENAI_API_KEY;
    const p = new OpenAiCompatibleCompletionProvider();
    const r = await p.complete({
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      maxOutputTokens: 10,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("CONFIG");
  });

  it("POSTs to configured base URL with Bearer auth", async () => {
    process.env.WAIA_AI_OPENAI_API_KEY = "secret-key";
    process.env.WAIA_AI_OPENAI_BASE_URL = "https://example.invalid";

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "chatcmpl-1",
          choices: [{ message: { role: "assistant", content: " assistant reply " } }],
          usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const p = new OpenAiCompatibleCompletionProvider();
    const r = await p.complete({
      model: "gpt-test",
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "hello" },
      ],
      maxOutputTokens: 128,
      temperature: 0,
    });

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.text).toBe("assistant reply");
      expect(r.providerRequestId).toBe("chatcmpl-1");
      expect(r.usage?.totalTokens).toBe(8);
    }

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchSpy.mock.calls[0]!;
    expect(String(calledUrl)).toBe("https://example.invalid/v1/chat/completions");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual(
      expect.objectContaining({
        Authorization: "Bearer secret-key",
        "Content-Type": "application/json",
      }),
    );
    const parsedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(parsedBody.model).toBe("gpt-test");
    expect(parsedBody.max_tokens).toBe(128);
    expect(parsedBody.temperature).toBe(0);
  });

  it("accepts GPT-5-style assistant message content as array of text parts (DEE-126)", async () => {
    process.env.WAIA_AI_OPENAI_API_KEY = "secret-key";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "chatcmpl-gpt55",
          choices: [
            {
              message: {
                role: "assistant",
                content: [{ type: "text", text: " Hello from parts " }],
              },
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const p = new OpenAiCompatibleCompletionProvider();
    const r = await p.complete({
      model: "gpt-5.5",
      messages: [{ role: "user", content: "hi" }],
      maxOutputTokens: 64,
    });

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toBe("Hello from parts");
  });

  it("concatenates multiple GPT-5-style text content parts", async () => {
    process.env.WAIA_AI_OPENAI_API_KEY = "k";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: [
                  { type: "text", text: "First" },
                  { type: "text", text: "Second" },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const p = new OpenAiCompatibleCompletionProvider();
    const r = await p.complete({
      model: "gpt-5.5",
      messages: [{ role: "user", content: "x" }],
      maxOutputTokens: 10,
    });

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toBe("FirstSecond");
  });

  it("maps refusal-only content part to PROVIDER_ERROR", async () => {
    process.env.WAIA_AI_OPENAI_API_KEY = "k";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: [{ type: "refusal", refusal: "I can't help with that." }],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const p = new OpenAiCompatibleCompletionProvider();
    const r = await p.complete({
      model: "gpt-5.5",
      messages: [{ role: "user", content: "x" }],
      maxOutputTokens: 10,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("PROVIDER_ERROR");
  });

  it("maps assistant content array with only non-text parts to PROVIDER_ERROR", async () => {
    process.env.WAIA_AI_OPENAI_API_KEY = "k";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: [{ type: "image_url", image_url: { url: "https://example.com/x.png" } }],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const p = new OpenAiCompatibleCompletionProvider();
    const r = await p.complete({
      model: "m",
      messages: [{ role: "user", content: "x" }],
      maxOutputTokens: 10,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("PROVIDER_ERROR");
  });

  it("maps 401 to CONFIG", async () => {
    process.env.WAIA_AI_OPENAI_API_KEY = "bad";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 401 }));
    const p = new OpenAiCompatibleCompletionProvider();
    const r = await p.complete({
      model: "m",
      messages: [{ role: "user", content: "x" }],
      maxOutputTokens: 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("CONFIG");
  });

  it("maps 429 to RATE_LIMIT", async () => {
    process.env.WAIA_AI_OPENAI_API_KEY = "k";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 429 }));
    const p = new OpenAiCompatibleCompletionProvider();
    const r = await p.complete({
      model: "m",
      messages: [{ role: "user", content: "x" }],
      maxOutputTokens: 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("RATE_LIMIT");
  });

  it("maps 5xx to PROVIDER_ERROR retryable", async () => {
    process.env.WAIA_AI_OPENAI_API_KEY = "k";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 503 }));
    const p = new OpenAiCompatibleCompletionProvider();
    const r = await p.complete({
      model: "m",
      messages: [{ role: "user", content: "x" }],
      maxOutputTokens: 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("PROVIDER_ERROR");
      expect(r.retryable).toBe(true);
    }
  });

  it("maps empty assistant content to PROVIDER_ERROR", async () => {
    process.env.WAIA_AI_OPENAI_API_KEY = "k";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "   " } }] }), {
        status: 200,
      }),
    );
    const p = new OpenAiCompatibleCompletionProvider();
    const r = await p.complete({
      model: "m",
      messages: [{ role: "user", content: "x" }],
      maxOutputTokens: 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("PROVIDER_ERROR");
  });

  it("rejects assistant text longer than WAIA_AI_MAX_ASSISTANT_OUTPUT_CHARS", async () => {
    process.env.WAIA_AI_OPENAI_API_KEY = "k";
    const longText = "x".repeat(WAIA_AI_MAX_ASSISTANT_OUTPUT_CHARS + 1);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: longText } }] }), {
        status: 200,
      }),
    );
    const p = new OpenAiCompatibleCompletionProvider();
    const r = await p.complete({
      model: "m",
      messages: [{ role: "user", content: "x" }],
      maxOutputTokens: 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("PROVIDER_ERROR");
  });

  it("maps JSON parse failure on 200 to PROVIDER_ERROR", async () => {
    process.env.WAIA_AI_OPENAI_API_KEY = "k";
    const badJson = {
      json: () => Promise.reject(new SyntaxError("bad json")),
      ok: true,
      status: 200,
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(badJson as unknown as Response);
    const p = new OpenAiCompatibleCompletionProvider();
    const r = await p.complete({
      model: "m",
      messages: [{ role: "user", content: "x" }],
      maxOutputTokens: 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("PROVIDER_ERROR");
  });

  it("returns TIMEOUT when wall deadline aborts fetch", async () => {
    process.env.WAIA_AI_OPENAI_API_KEY = "k";
    process.env.WAIA_AI_OPENAI_REQUEST_TIMEOUT_MS = "30";

    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        const sig = init?.signal;
        if (!(sig instanceof AbortSignal)) {
          reject(new Error("expected AbortSignal"));
          return;
        }
        sig.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });

    const p = new OpenAiCompatibleCompletionProvider();
    const r = await p.complete({
      model: "m",
      messages: [{ role: "user", content: "x" }],
      maxOutputTokens: 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("TIMEOUT");
  });

  it("maps pre-aborted user AbortSignal to PROVIDER_ERROR", async () => {
    process.env.WAIA_AI_OPENAI_API_KEY = "k";
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        const sig = init?.signal;
        if (!(sig instanceof AbortSignal)) {
          reject(new Error("expected AbortSignal"));
          return;
        }
        sig.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });

    const ac = new AbortController();
    ac.abort();
    const p = new OpenAiCompatibleCompletionProvider();
    const r = await p.complete(
      {
        model: "m",
        messages: [{ role: "user", content: "x" }],
        maxOutputTokens: 1,
      },
      ac.signal,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("PROVIDER_ERROR");
  });

  it("maps mid-flight user AbortSignal abort to PROVIDER_ERROR", async () => {
    process.env.WAIA_AI_OPENAI_API_KEY = "k";
    const userAc = new AbortController();

    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        const sig = init?.signal;
        if (!(sig instanceof AbortSignal)) {
          reject(new Error("expected AbortSignal"));
          return;
        }
        sig.addEventListener("abort", () => reject(new Error("aborted")));
        queueMicrotask(() => userAc.abort());
      });
    });

    const p = new OpenAiCompatibleCompletionProvider();
    const r = await p.complete(
      {
        model: "m",
        messages: [{ role: "user", content: "x" }],
        maxOutputTokens: 1,
      },
      userAc.signal,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("PROVIDER_ERROR");
  });
});

describe("resolveWaiaAiOpenAiTwinDialogueTemperature", () => {
  const prevTemperature = process.env.WAIA_AI_OPENAI_TEMPERATURE;

  afterEach(() => {
    if (prevTemperature === undefined) delete process.env.WAIA_AI_OPENAI_TEMPERATURE;
    else process.env.WAIA_AI_OPENAI_TEMPERATURE = prevTemperature;
  });

  it("returns 0 when unset", () => {
    delete process.env.WAIA_AI_OPENAI_TEMPERATURE;
    expect(resolveWaiaAiOpenAiTwinDialogueTemperature()).toBe(0);
  });

  it("returns 0 when empty after trim", () => {
    process.env.WAIA_AI_OPENAI_TEMPERATURE = "   ";
    expect(resolveWaiaAiOpenAiTwinDialogueTemperature()).toBe(0);
  });

  it("parses finite values", () => {
    process.env.WAIA_AI_OPENAI_TEMPERATURE = "0.35";
    expect(resolveWaiaAiOpenAiTwinDialogueTemperature()).toBe(0.35);
  });

  it("returns 0 for non-finite strings", () => {
    process.env.WAIA_AI_OPENAI_TEMPERATURE = "not-a-number";
    expect(resolveWaiaAiOpenAiTwinDialogueTemperature()).toBe(0);
  });

  it("clamps to [0, 2]", () => {
    process.env.WAIA_AI_OPENAI_TEMPERATURE = "-1";
    expect(resolveWaiaAiOpenAiTwinDialogueTemperature()).toBe(0);
    process.env.WAIA_AI_OPENAI_TEMPERATURE = "3";
    expect(resolveWaiaAiOpenAiTwinDialogueTemperature()).toBe(2);
  });
});
