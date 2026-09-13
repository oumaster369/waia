import { describe, expect, it, vi } from "vitest";
import { HtxExchangeConnector } from "@/lib/trader/connectors/htx/htx-exchange-connector";
import { HtxRestClient } from "@/lib/trader/connectors/htx/client";
import { createExchangeConnector } from "@/lib/trader/connectors/registry";
import { createLiveHtxConnector } from "@/lib/trader/live/live-connector";
import type { CredentialService } from "@/lib/trader/credentials/types";
import {
  resolveHtxSecureCredential,
  toHtxExchangeConnectorConfig,
} from "@/lib/trader/security/htx-secure-credential-resolver";

const credentials = { apiKey: "synthetic-key-956", apiSecret: "synthetic-secret-956" };
const account = { id: 956, type: "spot", state: "working" };
const key = { accessKey: credentials.apiKey, permission: "readOnly", status: "normal" };
const policy = { minIntervalMs: 0, maxRetries: 0, baseDelayMs: 0, maxDelayMs: 0 };

function harness(
  overrides: Record<string, unknown | (() => never)> = {},
  expectedSpotAccountId?: string,
) {
  const bodies: Record<string, unknown | (() => never)> = {
    "/v1/account/accounts": { status: "ok", data: [account] },
    "/v2/user/uid": { code: 200, data: 956 },
    "/v2/user/api-key": { code: 200, data: [key] },
    ...overrides,
  };
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    const body = bodies[path];
    if (typeof body === "function") body();
    if (!body) throw new Error("Unexpected mock endpoint");
    return Response.json(body);
  }) as typeof fetch;
  const config = { ...credentials, fetchImpl, transportPolicy: policy, expectedSpotAccountId };
  return {
    connector: new HtxExchangeConnector(config),
    client: new HtxRestClient(config),
    fetchImpl,
    bodies,
  };
}

describe("DEE-956 exact HTX admission", () => {
  it("propagates the expected account through the connector registry", async () => {
    const { fetchImpl } = harness();
    const connector = createExchangeConnector("htx", {
      credentials, fetchImpl, expectedSpotAccountId: "957",
    });
    expect((await connector.validateCredentials(credentials)).valid).toBe(false);
  });

  it.each(["956", "957"])("the stored-credential factory admits only exact account %s", async (exchangeAccountId) => {
    const { fetchImpl } = harness();
    const service: CredentialService = {
      listCredentialMetadata: vi.fn(async () => [{
        id: "mock-credential", venue: "htx", exchangeAccountId, apiKeyMasked: null,
        status: "active" as const, permissionMetadata: null, createdAt: new Date(0), updatedAt: new Date(0), revokedAt: null,
      }]),
      getDecryptedCredentials: vi.fn(async () => credentials),
      storeCredentials: vi.fn(), revokeCredentials: vi.fn(),
    };
    const pending = createLiveHtxConnector({
      context: { organizationId: "mock-org-956" }, credentialId: "mock-credential", credentialService: service, fetchImpl,
    });
    if (exchangeAccountId === "957") await expect(pending).rejects.toThrow("exact stored account admission failed");
    else expect((await (await pending).getAccountInfo()).accountId).toBe(exchangeAccountId);
    expect(service.storeCredentials).not.toHaveBeenCalled();
  });

  it("selects the exact key, never the first unrelated row", async () => {
    const { connector } = harness({
      "/v2/user/api-key": {
        code: 200,
        data: [{ ...key, accessKey: "another-key", permission: "readOnly,withdraw" }, key],
      },
    });
    expect(await connector.validateCredentials(credentials)).toMatchObject({
      valid: true,
      accountId: "956",
    });
    expect((await connector.getAccountInfo()).permissions).toEqual(["read"]);
  });

  it.each([
    ["unrelated key", [{ ...key, accessKey: "another-key" }]],
    ["duplicate exact keys", [key, key]],
    ["missing key", []],
    ["malformed rows", {}],
    ["null row", [null]],
    ["expired key", [{ ...key, status: "expired" }]],
    ["unknown key status", [{ ...key, status: "mystery" }]],
    ["missing permissions", [{ ...key, permission: undefined }]],
    ["non-string permissions", [{ ...key, permission: ["readOnly"] }]],
    ["empty permissions", [{ ...key, permission: "" }]],
    ["empty token", [{ ...key, permission: "readOnly,," }]],
    ["unknown scope", [{ ...key, permission: "readOnly,unknown" }]],
    ["explicit transfer", [{ ...key, permission: "readOnly,transfer" }]],
    ["management scope", [{ ...key, permission: "readOnly,manage" }]],
    ["withdraw", [{ ...key, permission: "readOnly,withdraw" }]],
    ["trade without required read", [{ ...key, permission: "trade" }]],
  ])("rejects %s and leaves no usable session", async (_name, data) => {
    const { connector } = harness({ "/v2/user/api-key": { code: 200, data } });
    const result = await connector.validateCredentials(credentials);
    expect(result.valid).toBe(false);
    expect(result.accountId).toBeUndefined();
    await expect(connector.getAccountInfo()).rejects.toThrow();
    expect(JSON.stringify(result)).not.toContain(credentials.apiKey);
    expect(JSON.stringify(result)).not.toContain(credentials.apiSecret);
  });

  it.each([
    ["denied", { code: 403, message: "permission denied" }],
    [
      "timeout",
      () => {
        throw new DOMException("mock timeout", "TimeoutError");
      },
    ],
  ])("rejects %s permission probe", async (_name, body) => {
    const { connector } = harness({ "/v2/user/api-key": body });
    expect((await connector.validateCredentials(credentials)).valid).toBe(false);
    await expect(connector.getAccountInfo()).rejects.toThrow();
  });

  it.each([null, -1, 0, 1.5, "956"])("rejects invalid UID %s", async (data) => {
    const { connector } = harness({ "/v2/user/uid": { code: 200, data } });
    expect((await connector.validateCredentials(credentials)).valid).toBe(false);
  });

  it.each([
    ["multiple spot accounts", [account, { ...account, id: 957 }]],
    ["duplicate spot account", [account, account]],
    ["unsafe account number", [{ ...account, id: Number.MAX_SAFE_INTEGER + 1 }]],
    ["malformed account", [null]],
    ["non-array accounts", {}],
  ])("rejects %s without choosing first", async (_name, data) => {
    const { connector } = harness({ "/v1/account/accounts": { status: "ok", data } });
    expect((await connector.validateCredentials(credentials)).valid).toBe(false);
  });

  it("rejects caller credentials different from the configured signing client", async () => {
    const { connector, fetchImpl } = harness();
    expect(
      (await connector.validateCredentials({ ...credentials, apiKey: "other-key" })).valid,
    ).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("clears previous admission after a failed revalidation", async () => {
    const { connector, bodies } = harness();
    expect((await connector.validateCredentials(credentials)).valid).toBe(true);
    bodies["/v2/user/api-key"] = { code: 200, data: [] };
    expect((await connector.validateCredentials(credentials)).valid).toBe(false);
    await expect(connector.getAccountInfo()).rejects.toThrow();
  });

  it("redacts credential values echoed in a rejected probe", async () => {
    const { connector } = harness({
      "/v2/user/api-key": { code: 403, message: `${credentials.apiKey} ${credentials.apiSecret}` },
    });
    const result = await connector.validateCredentials(credentials);
    expect(result.valid).toBe(false);
    expect(JSON.stringify(result)).not.toContain(credentials.apiKey);
    expect(JSON.stringify(result)).not.toContain(credentials.apiSecret);
  });

  it("preserves the stored account through the secure resolver", async () => {
    const resolved = resolveHtxSecureCredential({
      venue: "htx",
      credentials,
      exchangeAccountId: "957",
      permissionMetadata: {
        version: 1,
        marketType: "spot",
        exchangeAccountId: "957",
        scopes: ["read"],
        warnings: [],
        withdrawForbidden: true,
        transferForbidden: true,
      },
    });
    expect(toHtxExchangeConnectorConfig(resolved)).toHaveProperty("expectedSpotAccountId", "957");
    const { connector } = harness({}, "957");
    expect((await connector.validateCredentials(credentials)).valid).toBe(false);
  });

  it.each(["", " "])("rejects missing stored account identity %j", (exchangeAccountId) => {
    expect(() =>
      resolveHtxSecureCredential({
        venue: "htx",
        credentials,
        exchangeAccountId,
        permissionMetadata: null,
      }),
    ).toThrow();
  });
});
