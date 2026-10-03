import { afterEach, describe, expect, it, vi } from "vitest";
import {
  connectHtxClient,
  HTX_CONNECT_CLIENT_TIMEOUT_MS,
  listExchangeCredentialsClient,
  revokeExchangeCredentialClient,
} from "@/lib/trader/trader-workspace-client";

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("trader credential HTTP wrappers", () => {
  it("posts an explicit replacement id with same-origin credentials and a bounded signal", async () => {
    const timeoutSignal = new AbortController().signal;
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeoutSignal);
    const fetcher = vi.fn<typeof fetch>(async () => json({ id: "credential-2" }));
    vi.stubGlobal("fetch", fetcher);

    await connectHtxClient({
      apiKey: "access-key",
      apiSecret: "secret-key",
      replacementCredentialId: "credential-1",
    });

    expect(timeout).toHaveBeenCalledWith(HTX_CONNECT_CLIENT_TIMEOUT_MS);
    expect(fetcher).toHaveBeenCalledWith("/api/trader/exchange-credentials/connect", expect.objectContaining({
      method: "POST",
      credentials: "same-origin",
      signal: timeoutSignal,
      body: JSON.stringify({
        venue: "htx",
        apiKey: "access-key",
        apiSecret: "secret-key",
        replacementCredentialId: "credential-1",
      }),
    }));
  });

  it("sends revoke to the encoded same-origin DELETE path with a bounded signal", async () => {
    const timeoutSignal = new AbortController().signal;
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeoutSignal);
    const fetcher = vi.fn<typeof fetch>(async () => json({ id: "credential/one" }));
    vi.stubGlobal("fetch", fetcher);

    await revokeExchangeCredentialClient("credential/one");

    expect(timeout).toHaveBeenCalledWith(HTX_CONNECT_CLIENT_TIMEOUT_MS);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/trader/exchange-credentials/credential%2Fone",
      { method: "DELETE", credentials: "same-origin", signal: timeoutSignal },
    );
  });

  it("returns a fixed network failure when revoke fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => {
      throw new Error("private URL and response details");
    }));

    const result = await revokeExchangeCredentialClient("credential-one");
    expect(result).toMatchObject({ kind: "err", status: 0 });
    expect(result.displayMessage).not.toContain("private URL");
  });

  it("bounds the metadata reconciliation request", async () => {
    const timeoutSignal = new AbortController().signal;
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeoutSignal);
    const fetcher = vi.fn<typeof fetch>(async () => json({ credentials: [] }));
    vi.stubGlobal("fetch", fetcher);

    await listExchangeCredentialsClient();

    expect(timeout).toHaveBeenCalledWith(HTX_CONNECT_CLIENT_TIMEOUT_MS);
    expect(fetcher).toHaveBeenCalledWith("/api/trader/exchange-credentials", {
      credentials: "same-origin",
      signal: timeoutSignal,
    });
  });
});
