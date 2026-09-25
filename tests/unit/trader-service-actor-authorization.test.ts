import { describe, expect, it, vi } from "vitest";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { OrgScopeError } from "@/lib/waia-core/scope/org-context";
import { createPostgresActorServices } from "@/tests/helpers/trader-actor-services";

const denied = new OrgScopeError("ORG_MEMBERSHIP_REQUIRED");
const dataAccess = vi.fn(() => { throw new Error("UNAUTHORIZED_DATA_ACCESS"); });
const db = {
  select: dataAccess, insert: dataAccess, update: dataAccess, delete: dataAccess,
  transaction: async (body: (tx: WaiaPostgresDb) => unknown) => body(db),
} as unknown as WaiaPostgresDb;
const deps = {
  assertMembership: vi.fn(async () => { throw denied; }),
  writeAudit: vi.fn(),
  createProvider: vi.fn(),
};
const services = createPostgresActorServices(db, deps);

describe("DEE-1100 authenticated outsider at every affected service operation", () => {
  for (const [name, service] of Object.entries(services)) {
    for (const [operation, method] of Object.entries(service)) {
      if (typeof method !== "function") throw new Error(`Unexpected non-operation ${name}.${operation}`);
      it(`${name}.${operation} denies before data, audit or key access`, async () => {
        vi.clearAllMocks();
        const context = { organizationId: "victim-organization", userId: "outsider" };
        await expect(Reflect.apply(method, service, [context, {}, {}, {}])).rejects.toBe(denied);
        expect(deps.assertMembership).toHaveBeenCalledOnce();
        expect(deps.assertMembership).toHaveBeenCalledWith(context);
        expect(dataAccess).not.toHaveBeenCalled();
        expect(deps.writeAudit).not.toHaveBeenCalled();
        expect(deps.createProvider).not.toHaveBeenCalled();
      });
    }
  }
});
