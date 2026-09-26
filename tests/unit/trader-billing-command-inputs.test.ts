import { describe, expect, it, vi } from "vitest";
import { handleAdminInvoiceCommandPost } from "@/lib/trader/billing/admin-route-handler";
import { ISSUANCE_ATTESTATION_KEYS, isIssuanceAttestationComplete } from "@/lib/trader/billing/invoice-issuance.types";

const complete = Object.fromEntries(ISSUANCE_ATTESTATION_KEYS.map((key) => [key, true]));
describe("DEE-1112 manual invoice command inputs", () => {
  it("requires every own attestation to be literal true and tolerates malformed runtime values", () => {
    expect(isIssuanceAttestationComplete(complete)).toBe(true);
    for (const value of [null, undefined, [], true, "true", 1, {}, Object.create(complete)]) {
      expect(isIssuanceAttestationComplete(value)).toBe(false);
    }
    for (const key of ISSUANCE_ATTESTATION_KEYS) {
      for (const value of [false, null, undefined, "true", "false", 1, {}, []]) {
        expect(isIssuanceAttestationComplete({ ...complete, [key]: value })).toBe(false);
      }
    }
  });
  it("does not let an arbitrary request status impersonate an internal handler result", async () => {
    const getUserId = vi.fn(async () => null);
    const getRuntimeDb = vi.fn();
    const result = await handleAdminInvoiceCommandPost(new Request("http://localhost/invoice", {
      method: "POST", body: JSON.stringify({ status: 200, command: "approve", attestations: complete,
        organization_id: "00000000-0000-4000-8000-000000000001" }),
    }), { getUserId, getRuntimeDb, disposeRuntimeDb: vi.fn() }, "00000000-0000-4000-8000-000000000001");
    expect(result.status).toBe(401);
    expect(getUserId).toHaveBeenCalledOnce();
    expect(getRuntimeDb).not.toHaveBeenCalled();
  });
  it("refuses malformed request inputs and all request cooling overrides before opening a runtime", async () => {
    const getRuntimeDb = vi.fn();
    const getUserId = vi.fn();
    const valid = { command: "approve", organization_id: "00000000-0000-4000-8000-000000000001", attestations: complete };
    const malformed = [null, [], 1, "approve", { ...valid, command: 7 }, { ...valid, organization_id: [] },
      { ...valid, reason: 1 }, { ...valid, attestations: null }, { ...valid, attestations: [] },
      { ...valid, attestations: "true" }, { ...valid, attestations: 1 }, { ...valid, attestations: undefined },
      ...[0, -1, 1, null, "900000", []].map((cooling_off_ms) => ({ ...valid, cooling_off_ms }))];
    for (const body of malformed) {
      const result = await handleAdminInvoiceCommandPost(new Request("http://localhost/invoice", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      }), { getUserId, getRuntimeDb, disposeRuntimeDb: vi.fn() }, valid.organization_id);
      expect(result.status).toBe(400);
    }
    expect(getRuntimeDb).not.toHaveBeenCalled();
    expect(getUserId).not.toHaveBeenCalled();
  });
});
