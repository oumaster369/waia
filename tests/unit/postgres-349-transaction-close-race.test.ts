import { EventEmitter } from "node:events";
import postgres from "postgres";
import { describe, expect, it } from "vitest";

type HeldWrite = (socket: FakeSocket) => void;

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((a) => {
    resolve = a;
  });
  return { promise, resolve };
}

function backendFrame(type: string, payload = Buffer.alloc(0)) {
  const frame = Buffer.allocUnsafe(5 + payload.length);
  frame[0] = type.charCodeAt(0);
  frame.writeInt32BE(4 + payload.length, 1);
  payload.copy(frame, 5);
  return frame;
}

function startupFrames() {
  const authOk = Buffer.alloc(4);
  const backendKey = Buffer.alloc(8);
  backendKey.writeInt32BE(1, 0);
  backendKey.writeInt32BE(1, 4);
  return Buffer.concat([
    backendFrame("R", authOk),
    backendFrame("K", backendKey),
    backendFrame("Z", Buffer.from("I")),
  ]);
}

function simpleQueryFrames(command: string, transactionStatus: "I" | "T") {
  return Buffer.concat([
    backendFrame("C", Buffer.from(`${command}\0`)),
    backendFrame("Z", Buffer.from(transactionStatus)),
  ]);
}

class FakeSocket extends EventEmitter {
  readyState: "open" | "closed" = "open";
  destroyed = false;
  readonly writes: string[] = [];
  private transactionStatus: "I" | "T" = "I";

  constructor(
    private readonly hold: Set<string>,
    private readonly onHeld: HeldWrite,
  ) {
    super();
  }
  setNoDelay() {}
  setKeepAlive() {}

  write(value: Buffer | Uint8Array, callback?: () => void) {
    const bytes = Buffer.from(value);
    const text = bytes
      .toString("utf8")
      .replace(/[^\x20-\x7e]/g, " ")
      .toLowerCase();
    this.writes.push(text);

    // StartupMessage has no type byte and carries the protocol 3.0 version.
    if (bytes.length >= 8 && bytes.readInt32BE(4) === 196608) {
      setImmediate(() => this.emit("data", startupFrames()));
      callback?.();
      return true;
    }

    const query = [
      "select 1",
      "select 2",
      "select 3",
      "select 4",
      "select 5",
      "select 99",
      "pg_catalog.pg_type",
    ].find((candidate) => text.includes(candidate));
    if (query && this.hold.has(query)) {
      this.onHeld(this);
      callback?.();
      return true;
    }

    const command = /\bbegin\b/.test(text)
      ? "BEGIN"
      : /\brollback\b/.test(text)
        ? "ROLLBACK"
        : /\bcommit\b/.test(text)
          ? "COMMIT"
          : query
            ? "SELECT"
            : null;
    if (!command) throw new Error("Unexpected fake-protocol write; refusing to guess");
    if (command === "BEGIN") this.transactionStatus = "T";
    if (command === "ROLLBACK" || command === "COMMIT") this.transactionStatus = "I";
    setImmediate(() => this.emit("data", simpleQueryFrames(command, this.transactionStatus)));
    callback?.();
    return true;
  }

  end() {
    if (this.readyState === "open") setImmediate(() => this.close());
  }
  destroy() {
    this.close();
  }
  close(hadError = false) {
    if (this.readyState === "closed") return;
    this.readyState = "closed";
    this.destroyed = true;
    this.emit("close", hadError);
  }
}

type PoolOptions = {
  max?: number;
  max_pipeline?: number;
  heldQueries?: string[];
  onHeld?: HeldWrite;
  fetch_types?: boolean;
};

function poolWithFakeSockets(options: PoolOptions = {}) {
  const sockets: FakeSocket[] = [];
  const held = new Set(options.heldQueries ?? []);
  // max_pipeline is supported by postgres 3.4.9 at runtime but omitted from
  // its public TypeScript options; this test uses it to deterministically place
  // q[2] in the transaction-local queue after q[0]/q[1] reach the driver.
  const sql = postgres({
    host: "fake-only.invalid",
    user: "unit-test",
    database: "unit-test",
    password: "unit-test",
    ssl: false,
    max: options.max ?? 1,
    max_pipeline: options.max_pipeline ?? 1,
    prepare: false,
    fetch_types: options.fetch_types ?? false,
    no_subscribe: true,
    idle_timeout: 0,
    max_lifetime: 0,
    connect_timeout: 0,
    socket: () => {
      const socket = new FakeSocket(held, (onHeld) => options.onHeld?.(onHeld));
      sockets.push(socket);
      return socket;
    },
  } as unknown as Parameters<typeof postgres>[0]);
  return { sql, sockets, held };
}

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), 4_000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function settle<T>(promise: Promise<T>) {
  return withTimeout(
    promise.then(
      (value) => ({ status: "fulfilled" as const, value }),
      (error) => ({ status: "rejected" as const, error }),
    ),
    "promise settlement",
  );
}

async function closePool(pool: ReturnType<typeof poolWithFakeSockets>) {
  for (const socket of pool.sockets) socket.close();
  await withTimeout(pool.sql.end({ timeout: 0 }), "pool end");
}

describe("postgres 3.4.9 transaction behavior after socket close", () => {
  it("models ReadyForQuery as transactional until COMMIT or ROLLBACK", async () => {
    const socket = new FakeSocket(new Set(), () => {});
    const statuses: string[] = [];
    socket.on("data", (frame: Buffer) => statuses.push(String.fromCharCode(frame.at(-1)!)));
    for (const command of ["BEGIN", "SELECT 1", "ROLLBACK", "BEGIN", "COMMIT"]) {
      socket.write(Buffer.from(command));
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    expect(statuses).toEqual(["T", "T", "I", "T", "I"]);
  });

  it("rejects work sent between a socket error and close(true) with the original error", async () => {
    const selected = deferred();
    const submitted = deferred();
    const original = new Error("fake socket transport failure");
    const pool = poolWithFakeSockets({
      heldQueries: ["select 1", "select 2"],
      onHeld: () => selected.resolve(),
    });
    let firstError: unknown;
    let secondOutcome: Awaited<ReturnType<typeof settle>> | undefined;
    try {
      const transaction = pool.sql.begin(async (tx) => {
        await tx`select 1`.simple().catch((error) => {
          firstError = error;
        });
        const second = settle(tx`select 2`.simple());
        submitted.resolve();
        secondOutcome = await second;
      });
      await withTimeout(selected.promise, "first held query");
      pool.sockets[0]!.emit("error", original);
      await withTimeout(submitted.promise, "query submitted after socket error");
      await new Promise<void>((resolve) => setImmediate(resolve));
      pool.sockets[0]!.close(true);
      const begin = await settle(transaction);
      expect(firstError).toBe(original);
      expect(secondOutcome?.status).toBe("rejected");
      if (secondOutcome?.status === "rejected") expect(secondOutcome.error).toBe(original);
      expect(begin.status).toBe("rejected");
      if (begin.status === "rejected") expect(begin.error).toBe(original);
    } finally {
      await closePool(pool);
    }
  });

  it("clears startup query state before retrying array-type discovery", async () => {
    const selected = deferred();
    const selectedQuery = deferred();
    const pool = poolWithFakeSockets({
      fetch_types: true,
      heldQueries: ["pg_catalog.pg_type", "select 99"],
      onHeld: (socket) => {
        if (socket.writes.at(-1)?.includes("pg_catalog.pg_type")) selected.resolve();
        if (socket.writes.at(-1)?.includes("select 99")) selectedQuery.resolve();
      },
    });
    try {
      let querySettled = false;
      const query = settle(pool.sql`select 99`.simple()).then((result) => {
        querySettled = true;
        return result;
      });
      await withTimeout(selected.promise, "array-type discovery");
      const first = pool.sockets[0]!;
      // A command result without ReadyForQuery leaves partial per-query state
      // on the socket that is about to close.
      first.emit("data", backendFrame("C", Buffer.from("SELECT 1\0")));
      pool.held.delete("pg_catalog.pg_type");
      first.close();
      await withTimeout(selectedQuery.promise, "query after startup reconnect");
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(querySettled).toBe(false);
      pool.sockets[1]!.emit("data", simpleQueryFrames("SELECT", "I"));
      const outcome = await query;
      expect(outcome.status).toBe("fulfilled");
      expect(pool.sockets.length).toBe(2);
      expect(pool.sockets[1]!.writes.some((write) => write.includes("pg_catalog.pg_type"))).toBe(
        true,
      );
      expect(pool.sockets[1]!.writes.some((write) => write.includes("select 99"))).toBe(true);
    } finally {
      await closePool(pool);
    }
  });

  it("settles callback and begin, and skips rollback writes after close", async () => {
    const selected = deferred();
    const pool = poolWithFakeSockets({
      heldQueries: ["select 1"],
      onHeld: () => selected.resolve(),
    });
    let callbackSettled = false;
    try {
      const transaction = pool.sql.begin(async (tx) => {
        try {
          await tx`select 1`.simple();
        } finally {
          callbackSettled = true;
        }
      });
      await withTimeout(selected.promise, "held SELECT");
      pool.sockets[0]!.close();
      const begin = await settle(transaction);
      const ending = await settle(pool.sql.end({ timeout: 0 }));
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(begin.status).toBe("rejected");
      if (begin.status === "rejected")
        expect(begin.error).toMatchObject({ code: "CONNECTION_CLOSED" });
      expect(callbackSettled).toBe(true);
      expect(ending.status).toBe("fulfilled");
      expect(pool.sockets[0]!.writes.some((write) => /\brollback\b/.test(write))).toBe(false);
      expect(pool.sockets[0]!.readyState).toBe("closed");
    } finally {
      await closePool(pool);
    }
  });

  it("rejects active, pipelined, and transaction-queued queries and emits no COMMIT", async () => {
    const selected = deferred();
    const pool = poolWithFakeSockets({
      heldQueries: ["select 1"],
      onHeld: () => selected.resolve(),
    });
    let outcomes: Array<{ status: string; error?: unknown }> = [];
    try {
      const transaction = pool.sql.begin(async (tx) => {
        const queries = [tx`select 1`.simple(), tx`select 2`.simple(), tx`select 3`.simple()];
        outcomes = await Promise.all(
          queries.map((query) =>
            query.then(
              () => ({ status: "fulfilled" }),
              (error) => ({ status: "rejected", error }),
            ),
          ),
        );
      });
      await withTimeout(selected.promise, "first queued-case SELECT");
      pool.sockets[0]!.close();
      const begin = await settle(transaction);
      const ending = await settle(pool.sql.end({ timeout: 0 }));

      expect(begin.status).toBe("rejected");
      if (begin.status === "rejected")
        expect(begin.error).toMatchObject({ code: "CONNECTION_CLOSED" });
      expect(outcomes).toHaveLength(3);
      expect(outcomes.map((outcome) => outcome.status)).toEqual([
        "rejected",
        "rejected",
        "rejected",
      ]);
      for (const outcome of outcomes)
        expect(outcome.error).toMatchObject({ code: "CONNECTION_CLOSED" });
      // q[2] waited in the transaction-local queue and must share begin's captured close error.
      if (begin.status === "rejected") expect(outcomes[2]!.error).toBe(begin.error);
      expect(
        pool.sockets.flatMap((socket) => socket.writes).some((write) => /\bcommit\b/.test(write)),
      ).toBe(false);
      expect(ending.status).toBe("fulfilled");
    } finally {
      await closePool(pool);
    }
  });

  it("rejects late transaction work and reconnects the same connection on a fresh socket", async () => {
    const selected = deferred();
    const continueCallback = deferred();
    let lateError: unknown;
    let callbackSettled = false;
    const pool = poolWithFakeSockets({
      max: 1,
      heldQueries: ["select 1"],
      onHeld: () => selected.resolve(),
    });
    try {
      const transaction = pool.sql.begin(async (tx) => {
        try {
          await tx`select 1`.simple().catch(() => {});
          await continueCallback.promise;
          await tx`select 4`.simple().catch((error) => {
            lateError = error;
            throw error;
          });
        } finally {
          callbackSettled = true;
        }
      });
      await withTimeout(selected.promise, "held late-callback SELECT");
      const oldSocket = pool.sockets[0]!;
      oldSocket.close();
      const begin = await settle(transaction);
      continueCallback.resolve();
      await withTimeout(
        transaction.then(
          () => undefined,
          () => undefined,
        ),
        "late callback settlement",
      );
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(begin.status).toBe("rejected");
      if (begin.status === "rejected") {
        expect(begin.error).toMatchObject({ code: "CONNECTION_CLOSED" });
        expect(lateError).toBe(begin.error);
      }
      expect(callbackSettled).toBe(true);
      expect(oldSocket.writes.some((write) => write.includes("select 4"))).toBe(false);

      const cleanQuery = await settle(pool.sql`select 99`.simple());
      expect(cleanQuery.status).toBe("fulfilled");
      const newSocket = pool.sockets.find(
        (socket) =>
          socket !== oldSocket && socket.writes.some((write) => write.includes("select 99")),
      );
      expect(newSocket).toBeDefined();
      expect(oldSocket.writes.some((write) => write.includes("select 99"))).toBe(false);
      const ending = await settle(pool.sql.end({ timeout: 0 }));
      expect(ending.status).toBe("fulfilled");
    } finally {
      continueCallback.resolve();
      await closePool(pool);
    }
  });

  it("preserves an open-connection callback error after a successful query and rollback", async () => {
    const pool = poolWithFakeSockets();
    const original = new Error("original callback failure");
    let querySucceeded = false;
    try {
      const transaction = pool.sql.begin(async (tx) => {
        await tx`select 5`.simple();
        querySucceeded = true;
        throw original;
      });
      const outcome = await settle(transaction);
      expect(outcome.status).toBe("rejected");
      if (outcome.status === "rejected") expect(outcome.error).toBe(original);
      expect(querySucceeded).toBe(true);
      expect(
        pool.sockets.flatMap((socket) => socket.writes).some((write) => /\brollback\b/.test(write)),
      ).toBe(true);
      expect(
        pool.sockets.flatMap((socket) => socket.writes).some((write) => /\bcommit\b/.test(write)),
      ).toBe(false);
    } finally {
      await closePool(pool);
    }
  });
});
