import { describe, expect, it, vi } from "vitest";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { createAccountObservationSelfServiceConfiguration } from "@/lib/trader/account-observation/self-service-envelope";
import {
  AccountObservationSelfServiceEnrollError,
  enrollSelfServiceAccountObservation,
} from "@/lib/trader/account-observation/self-service-enroll";

import { handleExchangeCredentialsGet, type ConnectHandlerDeps } from "@/lib/trader/credentials/connect-handler";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const INPUT = {
  organizationId: personalOrganizationIdFromUserId(USER_ID),
  credentialId: "22222222-2222-4222-8222-222222222222",
  exchangeAccountId: "73750148",
};

function fakeDb(script: {
  credential?: Record<string, string> | null;
  existing?: { configurationRevision: string; symbols: string[]; [key: string]: unknown } | null;
  activeCount?: number;
}): {
  db: WaiaPostgresDb;
  inserted: unknown[];
  updated: unknown[];
  executed: string[];
} {
  const inserted: unknown[] = [];
  const updated: unknown[] = [];
  const executed: string[] = [];
  const selects: unknown[][] = [
    [
      script.credential === null
        ? undefined
        : (script.credential ?? {
            organizationId: INPUT.organizationId,
            venue: "htx",
            exchangeAccountId: INPUT.exchangeAccountId,
            status: "active",
          }),
    ].filter((row) => row !== undefined),
    script.existing ? [script.existing] : [],
  ];
  let selectIndex = 0;
  const tx = {
    select() {
      return this;
    },
    from() {
      return this;
    },
    where() {
      return this;
    },
    limit() {
      return Promise.resolve(selects[selectIndex++] ?? []);
    },
    execute(query: { queryChunks?: Array<{ value?: unknown }> } | string) {
      const text = typeof query === "string" ? query : JSON.stringify(query);
      executed.push(text);
      if (text.toLowerCase().includes("count"))
        return Promise.resolve([{ n: script.activeCount ?? 0 }]);
      return Promise.resolve([]);
    },
    insert() {
      return {
        values(row: unknown) {
          inserted.push(row);
          return {
            onConflictDoNothing() {
              return { returning: async () => [{ credentialId: INPUT.credentialId }] };
            },
          };
        },
      };
    },
    update() {
      return {
        set(row: unknown) {
          return {
            where() {
              updated.push(row);
              if (script.existing) Object.assign(script.existing, row);
              return Promise.resolve();
            },
          };
        },
      };
    },
  };
  return {
    db: {
      transaction: async <T>(fn: (inner: typeof tx) => Promise<T>) => fn(tx),
    } as unknown as WaiaPostgresDb,
    inserted,
    updated,
    executed,
  };
}

describe("DEE-1032 self-service observation envelope", () => {
  it("keeps the production Org-0 configuration revision", () => {
    const config = createAccountObservationSelfServiceConfiguration();
    expect(config.revision).toBe(
      "sha256:6adf6fd4a1f08081df76d44651d17f2030ae1a4d7f94e1d9cfd554f6ba5e7254",
    );
    expect(config.symbols).toEqual(["BTCUSDT"]);
    expect(config.pollIntervalMs).toBe(60_000);
    expect(config.htxCoverage?.host).toBe("api.huobi.pro");
  });

  it("codes enroll refusals without leaking SQL", () => {
    const error = new AccountObservationSelfServiceEnrollError("CAPACITY");
    expect(error.message).toBe("ACCOUNT_OBSERVATION_SELF_SERVICE_ENROLL_REFUSED:CAPACITY");
    expect(JSON.stringify(error)).not.toContain("postgres");
  });

  it("inserts collection-state for the exact stored HTX credential", async () => {
    const { db, inserted, executed } = fakeDb({ activeCount: 1 });
    await expect(enrollSelfServiceAccountObservation(db, INPUT)).resolves.toBe("PROVISIONED");
    expect(inserted).toEqual([
      {
        organizationId: INPUT.organizationId,
        credentialId: INPUT.credentialId,
        exchangeAccountId: INPUT.exchangeAccountId,
        configurationRevision: createAccountObservationSelfServiceConfiguration().revision,
        symbols: ["BTCUSDT"],
      },
    ]);
    expect(executed.some((item) => item.toLowerCase().includes("lock table"))).toBe(true);
  });

  it("is idempotent when the envelope already matches", async () => {
    const config = createAccountObservationSelfServiceConfiguration();
    const { db, inserted } = fakeDb({
      existing: { configurationRevision: config.revision, symbols: ["BTCUSDT"] },
    });
    await expect(enrollSelfServiceAccountObservation(db, INPUT)).resolves.toBe(
      "ALREADY_PROVISIONED",
    );
    expect(inserted).toEqual([]);
  });

  function existingOperatorState() {
    return {
      configurationRevision: "sha256:" + "a".repeat(64),
      symbols: ["BTCUSDT", "ETHUSDT"],
      nextDueAt: "2026-01-01T00:01:00.000Z",
      lastObservationId: "33333333-3333-4333-8333-333333333333",
      consecutiveFailures: 2,
      leaseToken: "44444444-4444-4444-8444-444444444444",
      leaseOwner: "synthetic-v5-observer",
      leaseExpiresAt: "2026-01-01T00:02:00.000Z",
    };
  }

  it("preserves an existing operator V5 revision, symbols, schedule and active lease", async () => {
    const existing = existingOperatorState();
    const before = structuredClone(existing);
    const { db, inserted, updated, executed } = fakeDb({ existing, activeCount: 20 });
    await expect(enrollSelfServiceAccountObservation(db, INPUT)).resolves.toBe(
      "ALREADY_PROVISIONED",
    );
    expect(existing).toEqual(before);
    expect(inserted).toEqual([]);
    expect(updated).toEqual([]);
    expect(executed).toEqual([]);
  });

  it("listing a connected Read+Trade account preserves its configured observation binding", async () => {
    const existing = existingOperatorState();
    const before = structuredClone(existing);
    const { db, inserted, updated, executed } = fakeDb({ existing });
    const metadata = {
      id: INPUT.credentialId,
      venue: "htx",
      exchangeAccountId: INPUT.exchangeAccountId,
      apiKeyMasked: "synthetic-mask",
      status: "active" as const,
      permissionMetadata: { scopes: ["readOnly", "trade"], observationReadPermitted: true },
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      revokedAt: null,
    };
    const createProvider = vi.fn(async () => { throw new Error("NO_DECRYPTION_IN_LIST"); });
    const createConnector = vi.fn(() => { throw new Error("NO_VENUE_CALL_IN_LIST"); });
    const disposeRuntimeDb = vi.fn(async () => undefined);
    const deps: ConnectHandlerDeps = {
      getUserId: async () => USER_ID,
      hasTraderAccess: async () => true,
      getRuntimeDb: async () => ({ kind: "postgres", db }),
      disposeRuntimeDb,
      createProvider,
      createConnector,
      createCredentialService: () => ({
        listCredentialMetadata: async () => [metadata],
        storeCredentials: async () => { throw new Error("NO_STORE_IN_LIST"); },
        getDecryptedCredentials: async () => { throw new Error("NO_DECRYPTION_IN_LIST"); },
        revokeCredentials: async () => { throw new Error("NO_REVOKE_IN_LIST"); },
      }),
    };
    const result = await handleExchangeCredentialsGet(deps);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ credentials: [{ id: INPUT.credentialId }] });
    expect(existing).toEqual(before);
    expect(inserted).toEqual([]);
    expect(updated).toEqual([]);
    expect(executed).toEqual([]);
    expect(createProvider).not.toHaveBeenCalled();
    expect(createConnector).not.toHaveBeenCalled();
    expect(disposeRuntimeDb).toHaveBeenCalledOnce();
  });

  it("refuses non-HTX, revoked, or mismatched credentials", async () => {
    for (const credential of [
      null,
      {
        organizationId: INPUT.organizationId,
        venue: "binance",
        exchangeAccountId: INPUT.exchangeAccountId,
        status: "active",
      },
      {
        organizationId: INPUT.organizationId,
        venue: "htx",
        exchangeAccountId: INPUT.exchangeAccountId,
        status: "revoked",
      },
      {
        organizationId: INPUT.organizationId,
        venue: "htx",
        exchangeAccountId: "different-account",
        status: "active",
      },
      {
        organizationId: "33333333-3333-4333-8333-333333333333",
        venue: "htx",
        exchangeAccountId: INPUT.exchangeAccountId,
        status: "active",
      },
    ]) {
      const { db, inserted, updated } = fakeDb({ credential, existing: existingOperatorState() });
      await expect(enrollSelfServiceAccountObservation(db, INPUT)).rejects.toMatchObject({
        code: "CREDENTIAL",
      });
      expect(inserted).toEqual([]);
      expect(updated).toEqual([]);
    }
  });

  it("refuses a 21st active HTX enrollment", async () => {
    const { db, inserted } = fakeDb({ activeCount: 20 });
    await expect(enrollSelfServiceAccountObservation(db, INPUT)).rejects.toMatchObject({
      code: "CAPACITY",
    });
    expect(inserted).toEqual([]);
  });
});
