import { describe, it, expect, vi } from "vitest";
import { handleAccountObservationGet, type ObservationReadDependencies } from "@/lib/trader/account-observation/read-handler";
import type { ObservationBinding } from "@/lib/trader/account-observation/types";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";

const binding: ObservationBinding = { organizationId: "00000000-0000-4000-8000-000000000001",
  credentialId: "00000000-0000-4000-8000-000000000002", exchangeAccountId: "account",
  credentialRevision: "1", configurationRevision: "config-1" };
const request = () => new Request("http://localhost/api/local-observation?" + new URLSearchParams(binding));
const deps = (): ObservationReadDependencies => ({
  getUserId: vi.fn(async () => "user"), hasTraderAccess: vi.fn(async () => true),
  hasOrgMembership: vi.fn(async () => true), hasOperatorAccess: vi.fn(async () => true),
  resolveActiveBinding: vi.fn(async () => binding), readLatest: vi.fn(async () => null),
});
describe("shared account observation HTTP boundary (injected auth, no production calls)", () => {
  it("requires session and never opens the store on denial", async () => {
    const d = deps(); vi.mocked(d.getUserId).mockResolvedValue(null);
    expect((await handleAccountObservationGet(request(), "tenant", d)).status).toBe(401);
    expect(d.readLatest).not.toHaveBeenCalled();
  });
  it.each(["hasTraderAccess", "hasOrgMembership", "hasOperatorAccess"] as const)("fails closed on %s denial", async key => {
    const d = deps(); vi.mocked(d[key]).mockResolvedValue(false);
    expect((await handleAccountObservationGet(request(), "admin", d)).status).toBe(403);
    expect(d.readLatest).not.toHaveBeenCalled();
  });
  it("tenant does not need operator, missing remains HTTP204 not an empty balance", async () => {
    const d = deps(); vi.mocked(d.hasOperatorAccess).mockResolvedValue(false);
    const response = await handleAccountObservationGet(request(), "tenant", d);
    expect(response.status).toBe(204); expect(await response.text()).toBe("");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(d.hasOperatorAccess).not.toHaveBeenCalled();
  });
  it("stored scope mismatch rejects caller-selected account", async () => {
    const d = deps(); vi.mocked(d.resolveActiveBinding).mockResolvedValue({ ...binding, exchangeAccountId: "other" });
    expect((await handleAccountObservationGet(request(), "tenant", d)).status).toBe(403);
    expect(d.readLatest).not.toHaveBeenCalled();
  });
  it("rechecks membership and revocation after read", async () => {
    const d = deps(); vi.mocked(d.readLatest).mockImplementation(async () => {
      vi.mocked(d.hasOrgMembership).mockResolvedValue(false); return null;
    });
    expect((await handleAccountObservationGet(request(), "tenant", d)).status).toBe(403);
    expect(d.readLatest).toHaveBeenCalledOnce();
  });
  it("does not serialize private/raw dependency failure", async () => {
    const d = deps(); vi.mocked(d.readLatest).mockRejectedValue(new Error("synthetic-private-driver-detail"));
    const response = await handleAccountObservationGet(request(), "tenant", d);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("driver-detail");
  });
  it("rejects duplicate query parameters and unsupported methods", async () => {
    const d = deps();
    expect((await handleAccountObservationGet(new Request(request().url + "&credentialId=other"), "tenant", d)).status).toBe(400);
    expect((await handleAccountObservationGet(new Request(request().url, { method: "POST" }), "tenant", d)).status).toBe(405);
  });
  it("an already aborted request does not read account data", async () => {
    const controller = new AbortController(); controller.abort();
    const d = deps();
    await handleAccountObservationGet(new Request(request().url, { signal: controller.signal }), "tenant", d);
    expect(d.readLatest).not.toHaveBeenCalled();
  });
  it("tenant binding discovery derives organization from verified identity, not query input", async () => {
    const d = deps(); const expected = { ...binding, organizationId: personalOrganizationIdFromUserId("user") };
    vi.mocked(d.resolveActiveBinding).mockResolvedValue(expected);
    const url = "http://localhost/api/trader/account-observation/binding?" + new URLSearchParams({
      credentialId: binding.credentialId, exchangeAccountId: binding.exchangeAccountId,
    });
    const response = await handleAccountObservationGet(new Request(url), "tenant", d, "binding");
    expect(response.status).toBe(200); expect(await response.json()).toEqual(expected);
    expect(d.hasTraderAccess).toHaveBeenCalledWith("user", expected.organizationId, expect.any(AbortSignal));
    expect(d.readLatest).not.toHaveBeenCalled();
    expect((await handleAccountObservationGet(new Request(url + "&organizationId=" + binding.organizationId), "tenant", d, "binding")).status).toBe(400);
  });
  it("admin binding discovery checks the exact selected organization", async () => {
    const d = deps(); const url = "http://localhost/api/trader/admin/account-observation/binding?" + new URLSearchParams({
      organizationId: binding.organizationId, credentialId: binding.credentialId, exchangeAccountId: binding.exchangeAccountId,
    });
    const response = await handleAccountObservationGet(new Request(url), "admin", d, "binding");
    expect(response.status).toBe(200);
    expect(d.hasOperatorAccess).toHaveBeenCalledWith("user", binding.organizationId, expect.any(AbortSignal));
    vi.mocked(d.resolveActiveBinding).mockResolvedValue(null);
    expect((await handleAccountObservationGet(new Request(url), "admin", d, "binding")).status).toBe(204);
  });
  it("rotation during storage read discards the entire old response", async () => {
    const d = deps();
    vi.mocked(d.readLatest).mockImplementation(async () => {
      vi.mocked(d.resolveActiveBinding).mockResolvedValue({ ...binding, credentialRevision: "2" }); return null;
    });
    expect((await handleAccountObservationGet(request(), "tenant", d)).status).toBe(403);
  });
  it("bounds a stalled dependency without exposing data", async () => {
    vi.useFakeTimers();
    try {
      const d = deps(); vi.mocked(d.readLatest).mockImplementation(() => new Promise(() => {}));
      const result = handleAccountObservationGet(request(), "tenant", d);
      await vi.advanceTimersByTimeAsync(5001);
      expect((await result).status).toBe(503);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});
