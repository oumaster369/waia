import { afterEach, describe, expect, it } from "vitest";

import { FakeCompletionProvider } from "@/lib/ai-gateway/fake-completion-provider";
import { OpenAiCompatibleCompletionProvider } from "@/lib/ai-gateway/openai-compatible-completion-provider";
import {
  getWaiaAiCompletionProviderForId,
  resolveWaiaAiCompletionBinding,
  resolveWaiaAiProviderId,
} from "@/lib/ai-gateway/provider-selector";

describe("resolveWaiaAiProviderId", () => {
  const prev = process.env.WAIA_AI_PROVIDER;

  afterEach(() => {
    if (prev === undefined) {
      delete process.env.WAIA_AI_PROVIDER;
    } else {
      process.env.WAIA_AI_PROVIDER = prev;
    }
  });

  it("defaults to fake when unset", () => {
    delete process.env.WAIA_AI_PROVIDER;
    expect(resolveWaiaAiProviderId()).toBe("fake");
  });

  it("accepts openai-compatible", () => {
    process.env.WAIA_AI_PROVIDER = "openai-compatible";
    expect(resolveWaiaAiProviderId()).toBe("openai-compatible");
  });

  it("accepts mixed-case openai-compatible", () => {
    process.env.WAIA_AI_PROVIDER = " OpenAI-Compatible ";
    expect(resolveWaiaAiProviderId()).toBe("openai-compatible");
  });

  it("maps unknown values to fake", () => {
    process.env.WAIA_AI_PROVIDER = "anthropic";
    expect(resolveWaiaAiProviderId()).toBe("fake");
  });
});

describe("getWaiaAiCompletionProviderForId", () => {
  it("returns FakeCompletionProvider for fake", () => {
    expect(getWaiaAiCompletionProviderForId("fake")).toBeInstanceOf(FakeCompletionProvider);
  });

  it("returns OpenAiCompatibleCompletionProvider for openai-compatible", () => {
    expect(getWaiaAiCompletionProviderForId("openai-compatible")).toBeInstanceOf(
      OpenAiCompatibleCompletionProvider,
    );
  });
});

describe("resolveWaiaAiCompletionBinding", () => {
  const prev = process.env.WAIA_AI_PROVIDER;

  afterEach(() => {
    if (prev === undefined) {
      delete process.env.WAIA_AI_PROVIDER;
    } else {
      process.env.WAIA_AI_PROVIDER = prev;
    }
  });

  it("returns fake binding by default", () => {
    delete process.env.WAIA_AI_PROVIDER;
    const b = resolveWaiaAiCompletionBinding();
    expect(b.providerId).toBe("fake");
    expect(b.provider).toBeInstanceOf(FakeCompletionProvider);
  });

  it("returns openai-compatible binding when configured", () => {
    process.env.WAIA_AI_PROVIDER = "openai-compatible";
    const b = resolveWaiaAiCompletionBinding();
    expect(b.providerId).toBe("openai-compatible");
    expect(b.provider).toBeInstanceOf(OpenAiCompatibleCompletionProvider);
  });
});
