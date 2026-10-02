import { beforeEach, describe, expect, it, vi } from "vitest";

const { postgresMock, createTransportMock } = vi.hoisted(() => ({
  postgresMock: vi.fn(),
  createTransportMock: vi.fn(),
}));

vi.mock("postgres", () => ({ default: postgresMock }));
vi.mock("@/lib/trader/paper/scheduled-owned-postgres-transport-v1", () => ({
  createScheduledPostgresTransportV1: createTransportMock,
}));

import {
  ScheduledPostgresCleanupUnconfirmedError,
  withJoinedScheduledTransactionV1,
  withScheduledOwnedPostgresOperationV1,
  withScheduledOwnedPostgresPoolV1,
} from "@/lib/trader/paper/scheduled-owned-postgres-pool-v1";

const URL = "postgres://fixture@localhost/test?sslmode=disable";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

type FakeSql = ((strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>) & {
  begin: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
};

function fakeSql(handler: (text: string, values: unknown[]) => unknown): FakeSql {
  const query = ((strings: TemplateStringsArray, ...values: unknown[]) =>
    Promise.resolve(handler(String.raw(strings, ...values), values))) as FakeSql;
  query.begin = vi.fn();
  query.end = vi.fn().mockResolvedValue(undefined);
  return query;
}

function installOperationPools(options: Readonly<{
  transactionError?: Error;
  witness?: (call: number, text: string) => unknown;
  onEffect?: () => void;
}> = {}) {
  const events: string[] = [];
  let witnessCalls = 0;
  const tx = fakeSql((text) => {
    events.push(`tx:${text}`);
    if (text.includes("pg_backend_pid()")) {
      return [{ pid: 4321, started: "2026-10-02 12:00:00+00" }];
    }
    if (text.includes("INSERT INTO") || text.includes("effect")) options.onEffect?.();
    return [];
  });
  const primary = fakeSql((text) => { events.push(`primary:${text}`); return []; });
  primary.begin.mockImplementation(async (callback: (tx: FakeSql) => Promise<unknown>) => {
    const result = await callback(tx);
    if (options.transactionError) throw options.transactionError;
    return result;
  });
  const verifier = fakeSql((text) => {
    events.push(`verify:${text}`);
    if (text.includes("pg_stat_activity")) {
      witnessCalls += 1;
      return options.witness?.(witnessCalls, text) ?? [{ present: false }];
    }
    return [{ receipt_digest: "synthetic-receipt" }];
  });
  let poolCalls = 0;
  postgresMock.mockImplementation(() => {
    poolCalls += 1;
    if (poolCalls === 1) return primary;
    if (poolCalls === 2) return verifier;
    throw new Error("unexpected third SQL pool");
  });
  return { events, tx, primary, verifier, getWitnessCalls: () => witnessCalls };
}

describe("withScheduledOwnedPostgresPoolV1 lifetime", () => {
  let endMock: ReturnType<typeof vi.fn>;
  let sealMock: ReturnType<typeof vi.fn>;
  let closeMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    endMock = vi.fn().mockResolvedValue(undefined);
    sealMock = vi.fn();
    closeMock = vi.fn().mockResolvedValue(undefined);
    createTransportMock.mockResolvedValue({ socket: vi.fn(), seal: sealMock, close: closeMock, markProtocolActive: vi.fn() });
    postgresMock.mockReturnValue({ end: endMock, begin: vi.fn() });
  });

  it("preserves a fulfilled work value when abort cleanup rejects pool.end", async () => {
    const controller = new AbortController();
    const endFailure = new Error("cleanup end failed");
    endMock.mockRejectedValue(endFailure);

    await expect(withScheduledOwnedPostgresPoolV1(URL, controller.signal, async () => {
      controller.abort(new Error("deadline elapsed during cleanup"));
      return "committed-result";
    })).resolves.toBe("committed-result");
    expect(endMock).toHaveBeenCalledWith({ timeout: 0 });
    expect(sealMock).toHaveBeenCalled();
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it("preserves the work rejection when pool.end also rejects", async () => {
    const controller = new AbortController();
    const workFailure = new Error("work failed");
    endMock.mockRejectedValue(new Error("cleanup end failed"));

    await expect(withScheduledOwnedPostgresPoolV1(URL, controller.signal, async () => {
      controller.abort();
      throw workFailure;
    })).rejects.toBe(workFailure);
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it("does not return on abort until deferred work has actually settled", async () => {
    const controller = new AbortController();
    const work = deferred<string>();
    let entered = false;
    let returned = false;
    const operation = withScheduledOwnedPostgresPoolV1(URL, controller.signal, async () => {
      entered = true;
      return work.promise;
    }).then((value) => { returned = true; return value; });

    await vi.waitFor(() => expect(entered).toBe(true));
    expect(entered).toBe(true);
    controller.abort();
    await Promise.resolve();
    expect(returned).toBe(false);
    work.resolve("settled-value");
    await expect(operation).resolves.toBe("settled-value");
    expect(returned).toBe(true);
  });

  it("awaits transport.close before returning the work result", async () => {
    const close = deferred<void>();
    closeMock.mockReturnValue(close.promise);
    let returned = false;
    const operation = withScheduledOwnedPostgresPoolV1(URL, new AbortController().signal,
      async () => "result").then((value) => { returned = true; return value; });

    await vi.waitFor(() => expect(closeMock).toHaveBeenCalledTimes(1));
    expect(returned).toBe(false);
    close.resolve();
    await expect(operation).resolves.toBe("result");
    expect(returned).toBe(true);
  });

  it("does not construct transport or postgres for an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort(new Error("already aborted"));

    await expect(withScheduledOwnedPostgresPoolV1(URL, controller.signal, async () => "unused"))
      .rejects.toThrow();
    expect(createTransportMock).not.toHaveBeenCalled();
    expect(postgresMock).not.toHaveBeenCalled();
  });
});

describe("withJoinedScheduledTransactionV1", () => {
  it("joins a transaction callback after an early driver rejection and preserves that rejection", async () => {
    const callbackGate = deferred<string>();
    const driverFailure = new Error("connection closed before callback settled");
    let callbackEntered = false;
    let returned = false;
    const tx = { marker: "realistic-transaction-shape" };

    const operation = withJoinedScheduledTransactionV1(
      async (callback) => {
        void callback(tx);
        throw driverFailure;
      },
      async (receivedTx) => {
        expect(receivedTx).toBe(tx);
        callbackEntered = true;
        return callbackGate.promise;
      },
    ).then(
      (value) => { returned = true; return value; },
      (error: unknown) => { returned = true; throw error; },
    );

    await Promise.resolve();
    await Promise.resolve();
    expect(callbackEntered).toBe(true);
    expect(returned).toBe(false);

    callbackGate.resolve("callback settled after driver failure");
    await expect(operation).rejects.toBe(driverFailure);
    expect(returned).toBe(true);
  });

  it("returns an acknowledged transaction result unchanged", async () => {
    const tx = { marker: "acknowledged-transaction" };
    const result = await withJoinedScheduledTransactionV1(
      async (callback) => callback(tx),
      async (receivedTx) => {
        expect(receivedTx).toBe(tx);
        return "commit acknowledged";
      },
    );

    expect(result).toBe("commit acknowledged");
  });
});

describe("withScheduledOwnedPostgresOperationV1 cleanup scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createTransportMock.mockResolvedValue({ socket: vi.fn(), seal: vi.fn(), close: vi.fn().mockResolvedValue(undefined), markProtocolActive: vi.fn() });
    postgresMock.mockReturnValue({ end: vi.fn().mockResolvedValue(undefined), begin: vi.fn() });
  });

  it("captures backend identity inside the transaction before effects and reuses one verifier for exit and receipt", async () => {
    const pools = installOperationPools({ witness: (call) => [{ present: call === 1 }] });
    const events: string[] = [];
    const result = await withScheduledOwnedPostgresOperationV1(URL, new AbortController().signal,
      async (operation) => {
        const primaryResult = await operation.primary((pool) => pool.begin(async (tx) => {
          await tx`INSERT INTO synthetic_effects (value) VALUES ('effect')`;
          return "COMMIT_ACKNOWLEDGED";
        }));
        events.push(primaryResult);
        return operation.verify(async (pool) => {
          await pool`SELECT receipt_digest FROM synthetic_receipts`;
          return "RECEIPT_READ";
        });
      });

    expect(result).toBe("RECEIPT_READ");
    const identityIndex = pools.events.findIndex(event => event.includes("pg_backend_pid()"));
    const effectIndex = pools.events.findIndex(event => event.includes("INSERT INTO synthetic_effects"));
    const witnessEvents = pools.events.filter(event => event.startsWith("verify:") && event.includes("pg_stat_activity"));
    expect(identityIndex).toBeGreaterThanOrEqual(0);
    expect(effectIndex).toBeGreaterThan(identityIndex);
    expect(witnessEvents).toHaveLength(2);
    expect(witnessEvents[0]).toContain("backend_start=");
    expect(witnessEvents[0]).toContain("::text::timestamptz");
    expect(pools.getWitnessCalls()).toBe(2);
    expect(postgresMock).toHaveBeenCalledTimes(2);
    expect(createTransportMock).toHaveBeenCalledTimes(2);
    expect(pools.verifier.end).toHaveBeenCalledTimes(1);
    expect(pools.events.some(event => event.includes("receipt_digest"))).toBe(true);
    expect(events).toEqual(["COMMIT_ACKNOWLEDGED"]);
  });

  it("preserves an acknowledged transaction when backend-exit witnessing fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const pools = installOperationPools({ witness: () => { throw new Error("witness unavailable"); } });
    const receiptRead = vi.fn(async () => "RECEIPT_READ");
    try {
      const result = await withScheduledOwnedPostgresOperationV1(URL, new AbortController().signal,
        async operation => {
          const acknowledged = await operation.primary(pool => pool.begin(async tx => {
            await tx`INSERT INTO synthetic_effects (value) VALUES ('effect')`;
            return "COMMIT_ACKNOWLEDGED";
          }));
          await expect(operation.verify(async () => receiptRead())).rejects
            .toBeInstanceOf(ScheduledPostgresCleanupUnconfirmedError);
          expect(receiptRead).not.toHaveBeenCalled();
          return acknowledged;
        });
      expect(result).toBe("COMMIT_ACKNOWLEDGED");
      expect(receiptRead).not.toHaveBeenCalled();
      expect(pools.primary.end).toHaveBeenCalledTimes(1);
      expect(pools.verifier.end).toHaveBeenCalledTimes(1);
      expect(postgresMock).toHaveBeenCalledTimes(2);
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("database_cleanup_unconfirmed"));
    } finally { consoleError.mockRestore(); }
  });

  it("returns explicit cleanup uncertainty when the transaction and its exit witness fail", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const pools = installOperationPools({ witness: () => { throw new Error("witness unavailable"); } });
    const transactionFailure = new Error("transaction failed");
    try {
      await expect(withScheduledOwnedPostgresOperationV1(URL, new AbortController().signal,
        operation => operation.primary(pool => pool.begin(async tx => {
          await tx`INSERT INTO synthetic_effects (value) VALUES ('effect')`;
          throw transactionFailure;
        })))).rejects.toBeInstanceOf(ScheduledPostgresCleanupUnconfirmedError);
      expect(pools.primary.end).toHaveBeenCalledTimes(1);
      expect(pools.verifier.end).toHaveBeenCalledTimes(1);
      expect(postgresMock).toHaveBeenCalledTimes(2);
    } finally { consoleError.mockRestore(); }
  });

  it("deadline-closes a blocked verifier and refuses any pool allocation after scope return", async () => {
    vi.useFakeTimers();
    const secondWitness = deferred<void>();
    const blockedWitness = deferred<unknown[]>();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const pools = installOperationPools({ witness: (call) => {
      if (call === 1) return [{ present: true }];
      secondWitness.resolve();
      return blockedWitness.promise;
    } });
    pools.verifier.end.mockImplementation(async () => { blockedWitness.resolve([{ present: true }]); });
    let savedOperation: Parameters<Parameters<typeof withScheduledOwnedPostgresOperationV1>[2]>[0] | undefined;
    try {
      const operationPromise = withScheduledOwnedPostgresOperationV1(URL, new AbortController().signal,
        async operation => {
          savedOperation = operation;
          return operation.primary(pool => pool.begin(async tx => {
            await tx`INSERT INTO synthetic_effects (value) VALUES ('effect')`;
            return "COMMIT_ACKNOWLEDGED";
          }));
        });
      await vi.advanceTimersByTimeAsync(50);
      await secondWitness.promise;
      await vi.advanceTimersByTimeAsync(39_950);
      await expect(operationPromise).resolves.toBe("COMMIT_ACKNOWLEDGED");
      expect(pools.verifier.end).toHaveBeenCalledTimes(1);
      expect(pools.primary.end).toHaveBeenCalledTimes(1);
      await expect(savedOperation!.verify(async () => "late")).rejects.toThrow("SCHEDULED_POSTGRES_SCOPE_CLOSED");
      await expect(savedOperation!.primary(async () => "late")).rejects.toThrow("SCHEDULED_POSTGRES_SCOPE_CLOSED");
      expect(postgresMock).toHaveBeenCalledTimes(2);
      expect(createTransportMock).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      consoleError.mockRestore();
      vi.useRealTimers();
    }
  });
});
