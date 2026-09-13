// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createObservationCredentialStore } from "@/lib/trader/account-observation/credential-store";
import { accountObservationClock } from "@/lib/trader/account-observation/clock";
import { openHtxObservationReader } from "@/lib/trader/account-observation/htx-reader-opener";
import { createCredentialService } from "@/lib/trader/credentials/credential-service";
import { encryptCredentialPayload } from "@/lib/trader/credentials/envelope-crypto";
import { SecretsStoreMasterKeyProvider } from "@/lib/trader/security/secrets-store-master-key-provider";
import type { ConnectorCredentialInput } from "@/lib/trader/connectors/types";
import type { ExchangeCredentialRepository, ExchangeCredentialRow } from "@/lib/trader/credentials/types";
import type { ObservationBinding } from "@/lib/trader/account-observation/types";

const binding: ObservationBinding = Object.freeze({ organizationId: "00000000-0000-4000-8000-000000000001",
  credentialId: "00000000-0000-4000-8000-000000000002", exchangeAccountId: "123",
  credentialRevision: "1", configurationRevision: "configured" });
const payload = { apiKey: "synthetic-key", apiSecret: "synthetic-secret" };
function setup() {
  const authorizeOpen = vi.fn(async () => true);
  const resolveActiveBinding = vi.fn(async (): Promise<ObservationBinding | null> => ({ ...binding }));
  const getDecryptedCredentials = vi.fn(async (): Promise<ConnectorCredentialInput> => ({ ...payload }));
  const store = createObservationCredentialStore({ authorizeOpen,
    bindingReader: { resolveActiveBinding }, credentialService: { getDecryptedCredentials },
    clock: accountObservationClock, timeoutMs: 1000 });
  const controller = new AbortController();
  return { store, authorizeOpen, resolveActiveBinding, getDecryptedCredentials, controller,
    open: () => store.openCredential(binding, controller.signal) };
}
afterEach(() => vi.useRealTimers());

describe("observation protected-store adapter (synthetic data only)", () => {
  it("checks authorization and full binding before/after scoped decryption, returns a disposable nonserializing handle", async () => {
    const f = setup(); const events: string[] = [];
    f.authorizeOpen.mockImplementation(async () => { events.push("authorize"); return true; });
    f.resolveActiveBinding.mockImplementation(async () => { events.push("binding"); return { ...binding }; });
    f.getDecryptedCredentials.mockImplementation(async () => { events.push("decrypt"); return { ...payload }; });
    const handle = await f.open();
    expect(events).toEqual(["authorize", "binding", "decrypt", "authorize", "binding"]);
    expect(f.getDecryptedCredentials).toHaveBeenCalledWith({ organizationId: binding.organizationId }, binding.credentialId);
    expect(f.resolveActiveBinding).toHaveBeenCalledWith({ organizationId: binding.organizationId,
      credentialId: binding.credentialId, exchangeAccountId: binding.exchangeAccountId });
    expect(handle.binding).toEqual(binding); expect(handle.apiKey).toBe(payload.apiKey); expect(handle.apiSecret).toBe(payload.apiSecret);
    expect(JSON.stringify(handle)).not.toMatch(/synthetic|apiKey|apiSecret/);
    expect({ ...handle }).not.toHaveProperty("apiSecret");
    f.controller.abort(); expect(handle.apiKey).toBe(payload.apiKey); // OPEN signal does not revoke returned ownership.
    handle.dispose(); handle.dispose(); expect(() => handle.apiKey).toThrow("READ_FAILED");
    expect(() => handle.apiSecret).toThrow("READ_FAILED"); f.store.dispose();
  });
  it("never decrypts without explicit open authorization", async () => {
    const f = setup(); f.authorizeOpen.mockResolvedValue(false);
    await expect(f.open()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(f.resolveActiveBinding).not.toHaveBeenCalled(); expect(f.getDecryptedCredentials).not.toHaveBeenCalled();
  });
  it.each(["organizationId", "credentialId", "exchangeAccountId", "credentialRevision", "configurationRevision"] as const)(
    "rejects %s mismatch before and after decryption", async field => {
      const other = { ...binding, [field]: field === "organizationId" || field === "credentialId"
        ? "00000000-0000-4000-8000-000000000099" : "999" };
      const before = setup(); before.resolveActiveBinding.mockResolvedValueOnce(other);
      await expect(before.open()).rejects.toMatchObject({ code: "IDENTITY_MISMATCH" });
      expect(before.getDecryptedCredentials).not.toHaveBeenCalled();
      const after = setup(); after.resolveActiveBinding.mockResolvedValueOnce(binding).mockResolvedValueOnce(other);
      await expect(after.open()).rejects.toMatchObject({ code: "IDENTITY_MISMATCH" });
      expect(after.getDecryptedCredentials).toHaveBeenCalledTimes(1);
    });
  it("refuses absent or revoked current binding", async () => {
    const f = setup(); f.resolveActiveBinding.mockResolvedValue(null);
    await expect(f.open()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(f.getDecryptedCredentials).not.toHaveBeenCalled();
    const after = setup(); after.resolveActiveBinding.mockResolvedValueOnce(binding).mockResolvedValueOnce(null);
    await expect(after.open()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });
  it("does not publish decrypted data when open authorization changes", async () => {
    const f = setup(); f.authorizeOpen.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(f.open()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(f.getDecryptedCredentials).toHaveBeenCalledTimes(1);
  });
  it.each([null, {}, { apiKey: "", apiSecret: "secret" }, { apiKey: "key?Signature=x", apiSecret: "secret" },
    { apiKey: "key", apiSecret: "" }, { apiKey: "key", apiSecret: "x".repeat(513) }])(
    "refuses malformed protected-store payload without returning raw data", async value => {
      const f = setup(); f.getDecryptedCredentials.mockResolvedValue(value as ConnectorCredentialInput);
      await expect(f.open()).rejects.toMatchObject({ message: "READ_FAILED" });
    });
  it("sanitizes throwing payload getters and fixed store/admission errors", async () => {
    const f = setup(); f.getDecryptedCredentials.mockResolvedValue(Object.defineProperty({}, "apiKey", {
      get() { throw new Error("synthetic-sensitive-getter"); },
    }) as ConnectorCredentialInput);
    await expect(f.open()).rejects.toMatchObject({ message: "READ_FAILED" });
    for (const field of ["authorizeOpen", "resolveActiveBinding", "getDecryptedCredentials"] as const) {
      const broken = setup(); broken[field].mockRejectedValueOnce(new Error("synthetic-private-store-error"));
      await expect(broken.open()).rejects.toMatchObject({ message: "READ_FAILED" });
    }
  });
  it("captures requested identity before awaited authorization", async () => {
    const f = setup(); let finish!: (value: boolean) => void; const mutable = { ...binding };
    f.authorizeOpen.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const pending = f.store.openCredential(mutable, f.controller.signal); mutable.exchangeAccountId = "999";
    finish(true); const handle = await pending; expect(handle.binding.exchangeAccountId).toBe("123"); handle.dispose();
  });
  it.each(["timeout", "cancel"])("bounds %s, prevents overlapping decryption and drops late payload without touching keys", async mode => {
    vi.useFakeTimers(); const f = setup(); let finish!: (value: ConnectorCredentialInput) => void;
    f.getDecryptedCredentials.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const pending = f.open(); const assertion = expect(pending).rejects.toMatchObject({ code: mode === "timeout" ? "TIMEOUT" : "READ_FAILED" });
    await vi.advanceTimersByTimeAsync(0);
    if (mode === "timeout") await vi.advanceTimersByTimeAsync(1000); else f.controller.abort();
    await assertion;
    await expect(f.store.openCredential(binding, new AbortController().signal)).rejects.toMatchObject({ code: "READ_FAILED" });
    expect(f.getDecryptedCredentials).toHaveBeenCalledTimes(1);
    const keyGetter = vi.fn(() => payload.apiKey);
    const late = Object.defineProperty({ apiSecret: payload.apiSecret }, "apiKey", { get: keyGetter });
    finish(late as ConnectorCredentialInput); await vi.advanceTimersByTimeAsync(0);
    expect(keyGetter).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    const fresh = await f.store.openCredential(binding, new AbortController().signal); fresh.dispose();
  });
  it("does not decrypt when delayed authorization completes after timeout", async () => {
    vi.useFakeTimers(); const f = setup(); let finish!: (value: boolean) => void;
    f.authorizeOpen.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const assertion = expect(f.open()).rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(1000); await assertion; finish(true); await vi.advanceTimersByTimeAsync(0);
    expect(f.getDecryptedCredentials).not.toHaveBeenCalled();
  });
  it("drops already decrypted material if the post-open binding check times out", async () => {
    vi.useFakeTimers(); const f = setup(); let finish!: (value: ObservationBinding) => void;
    f.resolveActiveBinding.mockResolvedValueOnce(binding).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const pending = f.open(); const assertion = expect(pending).rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(0); expect(f.getDecryptedCredentials).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000); await assertion;
    await expect(f.store.openCredential(binding, new AbortController().signal)).rejects.toMatchObject({ code: "READ_FAILED" });
    finish(binding); await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0); expect(f.getDecryptedCredentials).toHaveBeenCalledTimes(1);
  });
  it("shutdown interrupts an in-flight store open and refuses any subsequent access", async () => {
    vi.useFakeTimers(); const f = setup(); let finish!: (value: ConnectorCredentialInput) => void;
    f.getDecryptedCredentials.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const pending = f.open(); const assertion = expect(pending).rejects.toMatchObject({ code: "READ_FAILED" });
    await vi.advanceTimersByTimeAsync(0); f.store.dispose(); await assertion;
    finish({ ...payload }); await vi.advanceTimersByTimeAsync(0);
    await expect(f.open()).rejects.toMatchObject({ code: "READ_FAILED" });
    expect(f.getDecryptedCredentials).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it("does not invoke any dependency for an already cancelled opening", async () => {
    const f = setup(); f.controller.abort();
    await expect(f.open()).rejects.toMatchObject({ code: "READ_FAILED" });
    expect(f.authorizeOpen).not.toHaveBeenCalled(); expect(f.resolveActiveBinding).not.toHaveBeenCalled();
    expect(f.getDecryptedCredentials).not.toHaveBeenCalled();
  });
  it("disposes all owned handles and refuses new requests after store shutdown", async () => {
    const f = setup(); const first = await f.open(); const second = await f.open(); f.store.dispose(); f.store.dispose();
    expect(() => first.apiKey).toThrow("READ_FAILED"); expect(() => second.apiSecret).toThrow("READ_FAILED");
    await expect(f.open()).rejects.toMatchObject({ code: "READ_FAILED" });
    expect(f.getDecryptedCredentials).toHaveBeenCalledTimes(2);
  });
  it("composes through the existing opener without replacing separate exchange admission", async () => {
    const f = setup(); const fetchImpl = vi.fn<typeof fetch>(); const verifyReadAdmission = vi.fn(async () => false);
    await expect(openHtxObservationReader({ authorizeOpen: f.authorizeOpen, openCredential: f.store.openCredential,
      clock: accountObservationClock, fetchImpl, host: "api.huobi.pro", verifyReadAdmission },
    { binding, symbols: ["BTCUSDT"], readTimeoutMs: 1000, pageSize: 10, maxPages: 2,
      maxRecords: 20, maxResponseBytes: 1024, tradeWindowMs: 60000 }, new AbortController().signal))
      .rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(f.getDecryptedCredentials).toHaveBeenCalledTimes(1); expect(verifyReadAdmission).toHaveBeenCalledTimes(1);
    expect(fetchImpl).not.toHaveBeenCalled(); f.store.dispose();
  });
  it("uses real protected-store crypto with a synthetic provider and preserves the not-ready gate", async () => {
    const provider = await SecretsStoreMasterKeyProvider.create({
      secretGetter: async () => Buffer.alloc(32, 7).toString("base64"), productionReady: true });
    const encrypted = await encryptCredentialPayload(provider, payload);
    const row: ExchangeCredentialRow = { id: binding.credentialId, organizationId: binding.organizationId, venue: "htx",
      exchangeAccountId: binding.exchangeAccountId, status: "active", apiKeyMasked: "synthetic***", permissionMetadata: null,
      createdAt: new Date(), updatedAt: new Date(), revokedAt: null, ...encrypted };
    const getCredentialRowById = vi.fn<ExchangeCredentialRepository["getCredentialRowById"]>(async (context, id) =>
      context.organizationId === row.organizationId && id === row.id ? row : null);
    const repository: ExchangeCredentialRepository = { getCredentialRowById,
      insertCredentialRow: vi.fn(), listCredentialRowsForOrg: vi.fn(), revokeCredentialRow: vi.fn() };
    const protectedService = createCredentialService({ repository, createProvider: async () => provider, writeAudit: vi.fn() });
    const make = (credentialService: Pick<typeof protectedService, "getDecryptedCredentials">) => createObservationCredentialStore({
      credentialService, authorizeOpen: async () => true, bindingReader: { resolveActiveBinding: async () => binding },
      clock: accountObservationClock, timeoutMs: 1000 });
    const store = make(protectedService); const handle = await store.openCredential(binding, new AbortController().signal);
    expect(handle.apiKey).toBe(payload.apiKey); expect(handle.apiSecret).toBe(payload.apiSecret); handle.dispose(); store.dispose();
    const unavailable = make(createCredentialService({ repository, writeAudit: vi.fn(),
      createProvider: async () => SecretsStoreMasterKeyProvider.createNotConfigured() }));
    getCredentialRowById.mockClear();
    await expect(unavailable.openCredential(binding, new AbortController().signal)).rejects.toMatchObject({ code: "READ_FAILED" });
    expect(getCredentialRowById).not.toHaveBeenCalled(); unavailable.dispose();
  });
});
