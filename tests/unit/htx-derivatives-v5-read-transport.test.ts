// @vitest-environment node
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountObservationClock } from "@/lib/trader/account-observation/clock";
import type { HtxObservationCredentialHandle } from "@/lib/trader/account-observation/htx-reader-opener";
import type { ObservationBinding } from "@/lib/trader/account-observation/types";
import { AccountObservationReadFailure } from "@/lib/trader/account-observation/service";
import { signHtxRequest } from "@/lib/trader/connectors/htx/signing";
import { createHtxV5ReadTransport } from "@/lib/trader/account-observation/derivatives/htx-v5-read-transport";
import { HTX_V5_READ_ONLY_ROUTES } from "@/lib/trader/account-observation/derivatives/htx-v5-read-contract";

const binding: ObservationBinding = Object.freeze({
  organizationId: "00000000-0000-4000-8000-000000000001",
  credentialId: "00000000-0000-4000-8000-000000000002",
  exchangeAccountId: "123",
  credentialRevision: "1",
  configurationRevision: "config-v1",
});
const apiKey = "synthetic-key";
const apiSecret = "synthetic-secret";
const digest = createHash("sha256").update(apiKey).digest("hex");
const expectedUid = "456";
const modeBody = '{"code":200,"data":{"asset_mode":1},"ts":1780261200000}';
const signal = () => new AbortController().signal;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

function payload(path: string, uid = 456, permission = "readOnly"): unknown {
  if (path === "/v1/account/accounts")
    return { status: "ok", data: [{ id: 123, type: "spot", state: "working" }] };
  if (path === "/v2/user/uid") return { code: 200, data: uid };
  if (path === "/v2/user/api-key")
    return { code: 200, data: [{ accessKey: apiKey, status: "normal", permission }] };
  return null;
}

function credentialHandle(): HtxObservationCredentialHandle & {
  dispose: ReturnType<typeof vi.fn>;
} {
  let live = true;
  let key = apiKey;
  let secret = apiSecret;
  const handle = {
    binding: { ...binding },
    dispose: vi.fn(() => {
      live = false;
    }),
  } as HtxObservationCredentialHandle & { dispose: ReturnType<typeof vi.fn> };
  Object.defineProperties(handle, {
    apiKey: {
      enumerable: false,
      get() {
        if (!live) throw new AccountObservationReadFailure("READ_FAILED");
        return key;
      },
    },
    apiSecret: {
      enumerable: false,
      get() {
        if (!live) throw new AccountObservationReadFailure("READ_FAILED");
        return secret;
      },
    },
    testSetKey: {
      enumerable: false,
      value: (value: string) => {
        key = value;
      },
    },
    testSetSecret: {
      enumerable: false,
      value: (value: string) => {
        secret = value;
      },
    },
  });
  return Object.freeze(handle);
}

function setup(
  overrides: Partial<{
    credential: ReturnType<typeof credentialHandle>;
    fetchImpl: typeof fetch;
    authorizeCurrent: (binding: ObservationBinding, signal: AbortSignal) => Promise<boolean>;
    timeoutMs: number;
    maxResponseBytes: number;
    expectedHtxUid: string;
    expectedPermission: "readOnly" | "readOnly,trade";
    clock: typeof accountObservationClock;
  }> = {},
) {
  const credential = overrides.credential ?? credentialHandle();
  const calls: Array<{ url: URL; init: RequestInit | undefined }> = [];
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    if (overrides.fetchImpl) return overrides.fetchImpl(input, init);
    if (url.hostname === "api.huobi.pro") return json(payload(url.pathname, 456, overrides.expectedPermission ?? "readOnly"));
    return new Response(modeBody, { headers: { "content-type": "application/json" } });
  });
  const authorizeCurrent = overrides.authorizeCurrent ?? vi.fn(async () => true);
  const config = {
    credential,
    clock: overrides.clock ?? accountObservationClock,
    fetchImpl,
    timeoutMs: overrides.timeoutMs ?? 1000,
    maxResponseBytes: overrides.maxResponseBytes ?? 4096,
    authorizeCurrent,
    ...(overrides.expectedHtxUid !== undefined ? { expectedHtxUid: overrides.expectedHtxUid } : {}),
    ...(overrides.expectedPermission !== undefined ? { expectedPermission: overrides.expectedPermission } : {}),
  };
  const transport = createHtxV5ReadTransport(config);
  return { credential, calls, fetchImpl, authorizeCurrent, transport };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-03T12:00:00.000Z"));
});
afterEach(() => vi.useRealTimers());

describe("HTX V5 owned read-only transport", () => {
  it("signs the six legacy fixed typed V5 GET routes and returns post-read identity evidence", async () => {
    const f = setup({ expectedHtxUid: expectedUid });
    const fillStart = Date.now() - 60_000;
    const fillEnd = Date.now();
    const results = [
      await f.transport.readAssetMode(signal()),
      await f.transport.readBalance(signal()),
      await f.transport.readPositions({ contractCode: "BTC-USDT" }, signal()),
      await f.transport.readOpenOrders(
        { contractCode: "BTC-USDT", marginMode: "cross", limit: 25 },
        signal(),
      ),
      await f.transport.readAlgoOrders(
        { type: "sl", contractCode: "BTC-USDT", limit: 20 },
        signal(),
      ),
      await f.transport.readFills(
        {
          contractCode: "BTC-USDT",
          startTimeMs: fillStart,
          endTimeMs: fillEnd,
          limit: 20,
        },
        signal(),
      ),
    ];
    expect(results.every((result) => result.body === modeBody)).toBe(true);
    expect(results[0]?.identity).toMatchObject({
      binding,
      accessKeySha256: digest,
      htxUid: expectedUid,
      permission: "readOnly",
      checkedAt: Date.now(),
    });
    expect(Object.isFrozen(results[0])).toBe(true);
    expect(Object.isFrozen(results[0]?.identity)).toBe(true);
    const v5 = f.calls.filter(({ url }) => url.hostname === "api.hbdm.com");
    expect(v5.map(({ url }) => url.pathname)).toEqual(Object.values(HTX_V5_READ_ONLY_ROUTES).filter(path => path !== HTX_V5_READ_ONLY_ROUTES.bills));
    expect(
      v5.map(({ url }) => Object.fromEntries(url.searchParams.entries()).contract_code),
    ).toEqual([undefined, undefined, "BTC-USDT", "BTC-USDT", "BTC-USDT", "BTC-USDT"]);
    const expectedQueries = [
      {},
      {},
      { contract_code: "BTC-USDT" },
      { contract_code: "BTC-USDT", limit: "25", direct: "next", margin_mode: "cross" },
      { type: "sl", limit: "20", direct: "next", contract_code: "BTC-USDT" },
      {
        contract_code: "BTC-USDT",
        start_time: String(fillStart),
        end_time: String(fillEnd),
        limit: "20",
        direct: "next",
      },
    ];
    for (const [index, { url, init }] of v5.entries()) {
      expect(init).toMatchObject({
        method: "GET",
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
      });
      expect(init?.headers).toEqual({ Accept: "application/json" });
      expect(url.searchParams.get("AccessKeyId")).toBe(apiKey);
      expect(url.searchParams.get("SignatureMethod")).toBe("HmacSHA256");
      expect(url.searchParams.get("SignatureVersion")).toBe("2");
      expect(url.searchParams.has("Signature")).toBe(true);
      const signed = Object.fromEntries(url.searchParams.entries());
      const signature = signed.Signature;
      delete signed.Signature;
      const business = { ...signed };
      for (const authKey of ["AccessKeyId", "SignatureMethod", "SignatureVersion", "Timestamp"])
        delete business[authKey];
      expect(business).toEqual(expectedQueries[index]);
      expect(signature).toBe(
        signHtxRequest({
          method: "GET",
          host: "api.hbdm.com",
          path: url.pathname,
          params: signed,
          secret: apiSecret,
        }),
      );
    }
    const metadata = f.calls.filter(({ url }) => url.hostname === "api.huobi.pro");
    expect(metadata).toHaveLength(36);
    expect(metadata.filter(({ url }) => url.pathname === "/v1/account/accounts")).toHaveLength(12);
    expect(metadata.filter(({ url }) => url.pathname === "/v2/user/uid")).toHaveLength(12);
    expect(metadata.filter(({ url }) => url.pathname === "/v2/user/api-key")).toHaveLength(12);
    expect(f.authorizeCurrent).toHaveBeenCalledTimes(72);
    expect(JSON.stringify(results)).not.toContain(apiKey);
    expect(JSON.stringify(results)).not.toContain(apiSecret);
    expect(Object.keys(f.transport).sort()).toEqual([
      "dispose",
      "readAlgoOrders",
      "readAssetMode",
      "readBalance",
      "readBills",
      "readFills",
      "readOpenOrders",
      "readPositions",
      "settled",
    ]);
    expect(f.transport).not.toHaveProperty("signedGet");
    expect(f.transport).not.toHaveProperty("setAssetMode");
    expect(f.authorizeCurrent).toHaveBeenCalled();
    f.transport.dispose();
    await f.transport.settled();
    expect(f.credential.dispose).not.toHaveBeenCalled();
  });
  it("keeps default admission read-only and permits an explicit trade-permission observation only on fixed GETs", async () => {
    const denied = setup({ fetchImpl: vi.fn<typeof fetch>(async input => {
      const url = new URL(String(input));
      return url.hostname === "api.huobi.pro"
        ? json(payload(url.pathname, 456, "readOnly,trade"))
        : new Response(modeBody);
    }) });
    await expect(denied.transport.readBalance(signal())).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(denied.calls.filter(call => call.url.hostname === "api.hbdm.com")).toHaveLength(0);
    denied.transport.dispose();

    const permitted = setup({ expectedPermission: "readOnly,trade", fetchImpl: vi.fn<typeof fetch>(async input => {
      const url = new URL(String(input));
      return url.hostname === "api.huobi.pro"
        ? json(payload(url.pathname, 456, "readOnly,trade"))
        : new Response(modeBody);
    }) });
    const result = await permitted.transport.readBalance(signal());
    expect(result.identity.permission).toBe("readOnly,trade");
    expect(permitted.calls.filter(call => call.url.hostname === "api.hbdm.com")).toHaveLength(1);
    expect(permitted.calls.every(call => call.init?.method === "GET")).toBe(true);
    expect(permitted.calls.filter(call => call.url.hostname === "api.hbdm.com").map(call => call.url.pathname))
      .toEqual([HTX_V5_READ_ONLY_ROUTES.balance]);
    permitted.transport.dispose();
  });
  it("denies a permission change between the pre-read and post-read identity checks", async () => {
    for (const [expected, first, later] of [
      ["readOnly,trade", "readOnly,trade", "readOnly"],
      ["readOnly", "readOnly", "readOnly,trade"],
    ] as const) {
      let keyChecks = 0;
      const f = setup({ expectedPermission: expected, fetchImpl: vi.fn<typeof fetch>(async input => {
        const url = new URL(String(input));
        if (url.hostname !== "api.huobi.pro") return new Response(modeBody);
        if (url.pathname === "/v2/user/api-key") {
          keyChecks++;
          return json(payload(url.pathname, 456, keyChecks <= 1 ? first : later));
        }
        return json(payload(url.pathname));
      }) });
      await expect(f.transport.readBalance(signal())).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
      expect(keyChecks).toBeGreaterThanOrEqual(2);
      expect(f.calls.filter(call => call.url.hostname === "api.hbdm.com")).toHaveLength(1);
      f.transport.dispose();
    }
  });
  it("refuses malformed expected-permission options before any request", () => {
    expect(() => setup({ expectedPermission: "trade" as never })).toThrow("INVALID_RESPONSE");
  });

  it("rejects malformed route options before any signed network request", () => {
    const f = setup();
    expect(() => f.transport.readOpenOrders({ limit: 101 }, signal())).toThrow();
    expect(f.fetchImpl).not.toHaveBeenCalled();
    f.transport.dispose();
  });

  it("fails before V5 I/O when the configured external UID does not match", async () => {
    const f = setup({ expectedHtxUid: "596179655" });
    await expect(f.transport.readAssetMode(signal())).rejects.toMatchObject({
      code: "IDENTITY_MISMATCH",
    });
    expect(f.calls.some(({ url }) => url.hostname === "api.hbdm.com")).toBe(false);
    f.transport.dispose();
  });

  it("rejects UID changes across a V5 response and never returns that body", async () => {
    let uidReads = 0;
    const uidCalls: Array<{ url: URL; init: RequestInit | undefined }> = [];
    const f = setup({
      fetchImpl: vi.fn<typeof fetch>(async (input, init) => {
        const url = new URL(String(input));
        uidCalls.push({ url, init });
        if (url.hostname === "api.huobi.pro") {
          if (url.pathname === "/v2/user/uid") uidReads += 1;
          return json(payload(url.pathname, uidReads <= 1 ? 456 : 789));
        }
        return new Response(modeBody);
      }),
    });
    await expect(f.transport.readAssetMode(signal())).rejects.toMatchObject({
      code: "IDENTITY_MISMATCH",
    });
    expect(uidCalls.some(({ url }) => url.hostname === "api.hbdm.com")).toBe(true);
    f.transport.dispose();
  });

  it("rejects a non-monotonic identity timestamp on a later read", async () => {
    const f = setup();
    await f.transport.readAssetMode(signal());
    vi.setSystemTime(new Date("2026-10-02T12:00:00.000Z"));
    await expect(f.transport.readBalance(signal())).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
    expect(f.calls.filter(({ url }) => url.hostname === "api.hbdm.com")).toHaveLength(1);
    f.transport.dispose();
  });

  it("does not publish when current authorization is revoked after the V5 request", async () => {
    let v5Requested = false;
    const f = setup({
      authorizeCurrent: async () => !v5Requested,
      fetchImpl: vi.fn<typeof fetch>(async (input) => {
        const url = new URL(String(input));
        if (url.hostname === "api.huobi.pro") return json(payload(url.pathname));
        v5Requested = true;
        return new Response(modeBody);
      }),
    });
    await expect(f.transport.readAssetMode(signal())).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
    f.transport.dispose();
  });

  it("rejects changed key, secret, binding revision, or disposed protected handle", async () => {
    const keyChange = setup({
      fetchImpl: vi.fn<typeof fetch>(async (input) => {
        const url = new URL(String(input));
        if (url.hostname === "api.huobi.pro") return json(payload(url.pathname));
        (keyChangeCredential as unknown as { testSetKey(value: string): void }).testSetKey(
          "changed-key",
        );
        return new Response(modeBody);
      }),
    });
    const keyChangeCredential = keyChange.credential;
    await expect(keyChange.transport.readAssetMode(signal())).rejects.toMatchObject({
      code: "IDENTITY_MISMATCH",
    });
    keyChange.transport.dispose();

    const secretChangeCredential = credentialHandle();
    const secretChange = setup({
      credential: secretChangeCredential,
      fetchImpl: vi.fn<typeof fetch>(async (input) => {
        const url = new URL(String(input));
        if (url.hostname === "api.huobi.pro") return json(payload(url.pathname));
        (secretChangeCredential as unknown as { testSetSecret(value: string): void }).testSetSecret(
          "changed-secret",
        );
        return new Response(modeBody);
      }),
    });
    await expect(secretChange.transport.readAssetMode(signal())).rejects.toMatchObject({
      code: "IDENTITY_MISMATCH",
    });
    secretChange.transport.dispose();

    const revisionCredential = credentialHandle();
    const revision = setup({
      credential: revisionCredential,
      fetchImpl: vi.fn<typeof fetch>(async (input) => {
        const url = new URL(String(input));
        if (url.hostname === "api.huobi.pro") return json(payload(url.pathname));
        (revisionCredential.binding as { credentialRevision: string }).credentialRevision = "2";
        return new Response(modeBody);
      }),
    });
    await expect(revision.transport.readAssetMode(signal())).rejects.toMatchObject({
      code: "IDENTITY_MISMATCH",
    });
    revision.transport.dispose();

    const disposedCredential = credentialHandle();
    const disposed = setup({ credential: disposedCredential });
    disposedCredential.dispose();
    await expect(disposed.transport.readAssetMode(signal())).rejects.toMatchObject({
      code: "READ_FAILED",
    });
    expect(disposed.fetchImpl).not.toHaveBeenCalled();
    disposed.transport.dispose();
  });

  it.each([302, 401, 403, 429, 500])("sanitizes HTTP %s and cancels its body", async (status) => {
    let routeSeen = false;
    const cancel = vi.fn();
    const f = setup({
      fetchImpl: vi.fn<typeof fetch>(async (input) => {
        const url = new URL(String(input));
        if (url.hostname === "api.huobi.pro") return json(payload(url.pathname));
        routeSeen = true;
        return new Response(new ReadableStream({ cancel }), { status });
      }),
    });
    await expect(f.transport.readAssetMode(signal())).rejects.not.toThrow(apiSecret);
    expect(routeSeen).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
    f.transport.dispose();
    await f.transport.settled();
  });

  it("rejects redirected responses returned by an injected fetch", async () => {
    const cancel = vi.fn();
    const f = setup({
      fetchImpl: vi.fn<typeof fetch>(async (input) => {
        const url = new URL(String(input));
        if (url.hostname === "api.huobi.pro") return json(payload(url.pathname));
        const response = new Response(new ReadableStream({ cancel }));
        Object.defineProperty(response, "redirected", { value: true });
        Object.defineProperty(response, "url", { value: "https://evil.example/redirect" });
        return response;
      }),
    });
    await expect(f.transport.readAssetMode(signal())).rejects.toMatchObject({
      code: "READ_FAILED",
    });
    expect(cancel).toHaveBeenCalledTimes(1);
    f.transport.dispose();
    await f.transport.settled();
  });

  it("bounds response bytes, rejects invalid UTF-8, and blocks raw or JSON-escaped secrets", async () => {
    for (const body of [new Uint8Array(1025), new Uint8Array([0xff])]) {
      const cancel = vi.fn();
      const f = setup({
        maxResponseBytes: 1024,
        fetchImpl: vi.fn<typeof fetch>(async (input) => {
          const url = new URL(String(input));
          if (url.hostname === "api.huobi.pro") return json(payload(url.pathname));
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(body);
              },
              cancel,
            }),
          );
        }),
      });
      await expect(f.transport.readAssetMode(signal())).rejects.toMatchObject({
        code: "INVALID_RESPONSE",
      });
      expect(cancel).toHaveBeenCalledTimes(1);
      f.transport.dispose();
      await f.transport.settled();
    }
    for (const echo of [`{"echo":"${apiSecret}"}`, '{"echo":"synthetic\\u002dsecret"}']) {
      const f = setup({
        fetchImpl: vi.fn<typeof fetch>(async (input) => {
          const url = new URL(String(input));
          if (url.hostname === "api.huobi.pro") return json(payload(url.pathname));
          return new Response(echo);
        }),
      });
      await expect(f.transport.readAssetMode(signal())).rejects.toMatchObject({
        code: "INVALID_RESPONSE",
      });
      f.transport.dispose();
    }
  });

  it.each(["abort", "dispose"] as const)(
    "cancels and waits for a late V5 body after caller %s",
    async (cancelMode) => {
      let resolveRoute!: (response: Response) => void;
      const cancel = vi.fn();
      const f = setup({
        fetchImpl: vi.fn<typeof fetch>((input) => {
          const url = new URL(String(input));
          if (url.hostname === "api.huobi.pro") return Promise.resolve(json(payload(url.pathname)));
          return new Promise<Response>((resolve) => {
            resolveRoute = resolve;
          });
        }),
      });
      const abort = new AbortController();
      const read = f.transport.readAssetMode(abort.signal);
      await vi.waitFor(() => expect(resolveRoute).toBeTypeOf("function"));
      if (cancelMode === "abort") abort.abort();
      else f.transport.dispose();
      await expect(read).rejects.toMatchObject({ code: "READ_FAILED" });
      const late = new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(modeBody));
          },
          cancel,
        }),
      );
      resolveRoute(late);
      await f.transport.settled();
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(f.credential.dispose).not.toHaveBeenCalled();
    },
  );

  it("rechecks admission after rejected fetches within the bounded work", async () => {
    let accountReads = 0;
    const f = setup({
      fetchImpl: vi.fn<typeof fetch>(async (input) => {
        const url = new URL(String(input));
        if (url.hostname === "api.huobi.pro") {
          if (url.pathname === "/v1/account/accounts") accountReads += 1;
          return json(payload(url.pathname));
        }
        const error = new AccountObservationReadFailure("READ_FAILED");
        Object.defineProperty(error, "message", { value: apiSecret });
        Object.defineProperty(error, "cause", { value: apiSecret });
        throw error;
      }),
    });
    await expect(f.transport.readAssetMode(signal())).rejects.toMatchObject({
      code: "READ_FAILED",
      message: "READ_FAILED",
    });
    expect(accountReads).toBe(2);
    f.transport.dispose();
  });

  it("times out, prevents overlap, and keeps settlement waiting for late fetch cleanup", async () => {
    let resolveRoute!: (response: Response) => void;
    const cancel = vi.fn();
    const f = setup({
      timeoutMs: 100,
      fetchImpl: vi.fn<typeof fetch>((input) => {
        const url = new URL(String(input));
        if (url.hostname === "api.huobi.pro") return Promise.resolve(json(payload(url.pathname)));
        return new Promise<Response>((resolve) => {
          resolveRoute = resolve;
        });
      }),
    });
    const pending = f.transport.readAssetMode(signal());
    const rejected = expect(pending).rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    await expect(f.transport.readBalance(signal())).rejects.toMatchObject({ code: "READ_FAILED" });
    const settled = f.transport.settled();
    let settledDone = false;
    void settled.then(() => {
      settledDone = true;
    });
    await Promise.resolve();
    expect(settledDone).toBe(false);
    resolveRoute(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(modeBody));
          },
          cancel,
        }),
      ),
    );
    await settled;
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("captures options and exposes no generic or write operation", () => {
    const f = setup();
    const mutable = { contractCode: "BTC-USDT", limit: 25 };
    const pending = f.transport.readOpenOrders(mutable, signal());
    mutable.contractCode = "EVIL-USDT";
    mutable.limit = 100;
    expect(f.fetchImpl).not.toHaveBeenCalled();
    expect(f.transport).not.toHaveProperty("signedGet");
    expect(f.transport).not.toHaveProperty("setAssetMode");
    expect(f.transport).not.toHaveProperty("placeOrder");
    return pending.then(() => {
      const route = f.calls.find(({ url }) => url.hostname === "api.hbdm.com")?.url;
      expect(route?.pathname).toBe(HTX_V5_READ_ONLY_ROUTES.openOrders);
      expect(route?.searchParams.get("contract_code")).toBe("BTC-USDT");
      expect(route?.searchParams.get("limit")).toBe("25");
      f.transport.dispose();
    });
  });
});
