import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  handleAccountObservationGet,
  type ObservationReadDependencies,
} from "@/lib/trader/account-observation/read-handler";
import { handleAccountObservationStream } from "@/lib/trader/account-observation/stream-handler";
import type {
  AccountObservation,
  ObservationBinding,
} from "@/lib/trader/account-observation/types";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { observation } from "./account-observation-stream-fixtures";

const USER = "00000000-0000-4000-8000-0000000000aa";
const OPERATOR = "00000000-0000-4000-8000-0000000000bb";

/** Tenant and Admin must converge on one organization, so both surfaces address this exact binding. */
const sharedBinding: ObservationBinding = {
  organizationId: personalOrganizationIdFromUserId(USER),
  credentialId: "22222222-2222-4222-8222-222222222222",
  exchangeAccountId: "account-a",
  credentialRevision: "7",
  configurationRevision: "config-7",
};

/** One stored revision, produced once by the single collector pipeline. */
const STORED_REVISION: AccountObservation = { ...observation(), binding: sharedBinding };

function storedObservation(): AccountObservation {
  return structuredClone(STORED_REVISION);
}

const SECRET_KEYS = [
  "apiKey",
  "apiSecret",
  "encryptedPayload",
  "wrappedDekKey",
  "wrappedDekKeyVersion",
  "payloadKeyVersion",
  "apiKeyMasked",
  "permissionMetadata",
];

type Store = {
  deps: ObservationReadDependencies;
  readLatest: ObservationReadDependencies["readLatest"];
  resolveActiveBinding: ObservationReadDependencies["resolveActiveBinding"];
};

/**
 * A single stored-observation source shared by both surfaces. Each surface gets its own
 * authorization identity, but neither gets its own pipeline.
 */
function sharedStore(): Store {
  const readLatest = vi.fn(async () => storedObservation());
  const resolveActiveBinding = vi.fn(async () => sharedBinding);
  return {
    readLatest,
    resolveActiveBinding,
    deps: {
      getUserId: vi.fn(async () => USER),
      hasTraderAccess: vi.fn(async () => true),
      hasOrgMembership: vi.fn(async () => true),
      hasOperatorAccess: vi.fn(async () => true),
      resolveActiveBinding,
      readLatest,
    },
  };
}

const observationRequest = () =>
  new Request(
    "http://localhost/api/trader/account-observation?" + new URLSearchParams(sharedBinding),
  );

const bindingRequest = (surface: "tenant" | "admin") =>
  new Request(
    "http://localhost/api/trader/account-observation/binding?" +
      new URLSearchParams(
        surface === "admin"
          ? {
              organizationId: sharedBinding.organizationId,
              credentialId: sharedBinding.credentialId,
              exchangeAccountId: sharedBinding.exchangeAccountId,
            }
          : {
              credentialId: sharedBinding.credentialId,
              exchangeAccountId: sharedBinding.exchangeAccountId,
            },
      ),
  );

const frame = (chunk: ReadableStreamReadResult<Uint8Array>) =>
  chunk.value ? new TextDecoder().decode(chunk.value) : "";

describe("DEE-1019 tenant/Admin observation parity, enumeration and secret exclusion", () => {
  it("serves Admin the same stored observation revision as the tenant", async () => {
    const store = sharedStore();

    const tenant = await handleAccountObservationGet(observationRequest(), "tenant", store.deps);
    const admin = await handleAccountObservationGet(observationRequest(), "admin", store.deps);

    expect(tenant.status).toBe(200);
    expect(admin.status).toBe(200);

    const tenantBody = (await tenant.json()) as AccountObservation;
    const adminBody = (await admin.json()) as AccountObservation;

    expect(adminBody).toStrictEqual(tenantBody);
    expect(adminBody.observationId).toBe(storedObservation().observationId);
    expect(adminBody.binding).toStrictEqual(sharedBinding);
    expect(adminBody.binding.credentialRevision).toBe(tenantBody.binding.credentialRevision);
    expect(adminBody.binding.configurationRevision).toBe(tenantBody.binding.configurationRevision);

    // Both surfaces read the one stored source; neither has a private pipeline.
    expect(store.readLatest).toHaveBeenCalledTimes(2);
    for (const call of vi.mocked(store.readLatest).mock.calls) {
      expect(call[0]).toStrictEqual(sharedBinding);
    }
  });

  it("resolves the same binding identity from tenant session and Admin selection", async () => {
    const store = sharedStore();

    const tenant = await handleAccountObservationGet(
      bindingRequest("tenant"),
      "tenant",
      store.deps,
      "binding",
    );
    const admin = await handleAccountObservationGet(
      bindingRequest("admin"),
      "admin",
      store.deps,
      "binding",
    );

    expect(await tenant.json()).toStrictEqual(sharedBinding);
    expect(await admin.json()).toStrictEqual(sharedBinding);
    expect(store.deps.hasOperatorAccess).toHaveBeenCalledWith(
      USER,
      sharedBinding.organizationId,
      expect.any(AbortSignal),
    );
  });

  describe("streaming parity", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => {
      expect(vi.getTimerCount()).toBe(0);
      vi.useRealTimers();
    });

    it("emits an identical first SSE observation frame on both surfaces", async () => {
      const frames: Record<string, string> = {};
      for (const surface of ["tenant", "admin"] as const) {
        const store = sharedStore();
        const response = await handleAccountObservationStream(observationRequest(), (next) =>
          handleAccountObservationGet(next, surface, store.deps),
        );
        expect(response.headers.get("content-type")).toContain("text/event-stream");
        const reader = response.body!.getReader();
        frames[surface] = frame(await reader.read());
        await reader.cancel();
      }

      expect(frames.admin).toBe(frames.tenant);
      expect(frames.tenant).toContain(storedObservation().observationId);
      for (const key of SECRET_KEYS) expect(frames.tenant).not.toContain(key);
    });
  });

  it("denies an Admin operator who is not authorized for the selected organization", async () => {
    const store = sharedStore();
    vi.mocked(store.deps.getUserId).mockResolvedValue(OPERATOR);
    vi.mocked(store.deps.hasOperatorAccess).mockResolvedValue(false);

    const response = await handleAccountObservationGet(observationRequest(), "admin", store.deps);

    expect(response.status).toBe(403);
    expect(store.readLatest).not.toHaveBeenCalled();
    const body = await response.text();
    expect(body).not.toContain(sharedBinding.exchangeAccountId);
    expect(body).not.toContain(sharedBinding.credentialId);
  });

  it("gives Admin no enumeration oracle between unauthorized and unconfigured accounts", async () => {
    const unauthorized = sharedStore();
    vi.mocked(unauthorized.deps.hasOperatorAccess).mockResolvedValue(false);

    const unconfigured = sharedStore();
    vi.mocked(unconfigured.resolveActiveBinding).mockResolvedValue(null);

    const denied = await handleAccountObservationGet(
      observationRequest(),
      "admin",
      unauthorized.deps,
    );
    const missing = await handleAccountObservationGet(
      observationRequest(),
      "admin",
      unconfigured.deps,
    );

    expect(missing.status).toBe(denied.status);
    expect(await missing.text()).toBe(await denied.text());
  });

  it("keeps Admin inside the selected organization when storage resolves a different tenant", async () => {
    const store = sharedStore();
    vi.mocked(store.resolveActiveBinding).mockResolvedValue({
      ...sharedBinding,
      organizationId: personalOrganizationIdFromUserId(OPERATOR),
    });

    const response = await handleAccountObservationGet(observationRequest(), "admin", store.deps);

    expect(response.status).toBe(403);
    expect(store.readLatest).not.toHaveBeenCalled();
  });

  it.each(["tenant", "admin"] as const)(
    "%s projection carries no credential material",
    async (surface) => {
      const store = sharedStore();
      const response = await handleAccountObservationGet(observationRequest(), surface, store.deps);
      const body = await response.text();

      for (const key of SECRET_KEYS) expect(body).not.toContain(key);
      expect(body).not.toMatch(/secret|cipher|private_key|passphrase/i);
    },
  );

  it.each(["tenant", "admin"] as const)(
    "%s refuses a contaminated stored payload instead of forwarding it",
    async (surface) => {
      const store = sharedStore();
      vi.mocked(store.readLatest).mockResolvedValue({
        ...storedObservation(),
        apiSecret: "htx-live-secret-value",
        encryptedPayload: "ciphertext-value",
      } as unknown as AccountObservation);

      const response = await handleAccountObservationGet(observationRequest(), surface, store.deps);

      expect(response.status).toBe(503);
      const body = await response.text();
      expect(body).not.toContain("htx-live-secret-value");
      expect(body).not.toContain("ciphertext-value");
    },
  );

  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "exposes no %s affordance for orders, withdrawals or transfers",
    async (method) => {
      const store = sharedStore();
      const response = await handleAccountObservationGet(
        new Request(observationRequest().url, { method }),
        "admin",
        store.deps,
      );

      expect(response.status).toBe(405);
      expect(store.readLatest).not.toHaveBeenCalled();
    },
  );
});
