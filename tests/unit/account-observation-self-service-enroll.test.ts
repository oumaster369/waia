import { describe, expect, it } from "vitest";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { createAccountObservationSelfServiceConfiguration } from "@/lib/trader/account-observation/self-service-envelope";
import {
  AccountObservationSelfServiceEnrollError,
  enrollSelfServiceAccountObservation,
} from "@/lib/trader/account-observation/self-service-enroll";

const INPUT = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  credentialId: "22222222-2222-4222-8222-222222222222",
  exchangeAccountId: "73750148",
};

function fakeDb(script: {
  credential?: Record<string, string> | null;
  existing?: { configurationRevision: string; symbols: string[] } | null;
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
          return Promise.resolve();
        },
      };
    },
    update() {
      return {
        set(row: unknown) {
          return {
            where() {
              updated.push(row);
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

  it("realigns a stale envelope for the exact stored triple", async () => {
    const { db, inserted, updated } = fakeDb({
      existing: { configurationRevision: "sha256:old", symbols: ["ETHUSDT"] },
    });
    await expect(enrollSelfServiceAccountObservation(db, INPUT)).resolves.toBe("PROVISIONED");
    expect(inserted).toEqual([]);
    expect(updated).toEqual([
      {
        configurationRevision: createAccountObservationSelfServiceConfiguration().revision,
        symbols: ["BTCUSDT"],
      },
    ]);
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
        organizationId: "33333333-3333-4333-8333-333333333333",
        venue: "htx",
        exchangeAccountId: INPUT.exchangeAccountId,
        status: "active",
      },
    ]) {
      const { db } = fakeDb({ credential });
      await expect(enrollSelfServiceAccountObservation(db, INPUT)).rejects.toMatchObject({
        code: "CREDENTIAL",
      });
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
