import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { withResearchOwnedPostgresPoolV1 } from "@/lib/trader/research/research-owned-postgres-pool-v1";

type HarnessMode = "clean-eof" | "silent";

async function startPostgresHandshakeHarness(mode: HarnessMode) {
  const sockets = new Set<net.Socket>();
  const counts = { connections: 0, startupMessages: 0, queryMessages: 0 };
  const server = net.createServer(socket => {
    counts.connections++;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    let bytes = Buffer.alloc(0);
    let startupSeen = false;
    socket.on("data", (chunk: Buffer) => {
      bytes = Buffer.concat([bytes, chunk]);
      while (true) {
        if (!startupSeen) {
          if (bytes.length < 4) return;
          const length = bytes.readInt32BE(0);
          if (length < 8 || length > 16 * 1024 * 1024) {
            socket.destroy();
            return;
          }
          if (bytes.length < length) return;
          const version = bytes.readInt32BE(4);
          if (length === 8 && (version === 80877103 || version === 80877104)) {
            // PostgreSQL SSLRequest/GSSENCRequest: this local synthetic server
            // explicitly declines encryption and waits for a StartupMessage.
            socket.write("N");
            bytes = bytes.subarray(length);
            continue;
          }
          if (version !== 196608) {
            socket.destroy();
            return;
          }
          counts.startupMessages++;
          startupSeen = true;
          bytes = bytes.subarray(length);
          if (mode === "clean-eof") socket.end();
          continue;
        }
        if (bytes.length < 5) return;
        const length = bytes.readInt32BE(1);
        if (length < 4 || length > 16 * 1024 * 1024) {
          socket.destroy();
          return;
        }
        if (bytes.length < length + 1) return;
        if (bytes[0] === 81 || bytes[0] === 80) counts.queryMessages++;
        bytes = bytes.subarray(length + 1);
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("LOOPBACK_PG_PORT_MISSING");
  return {
    url: `postgres://waia_validate@127.0.0.1:${address.port}/waia_socket_test?sslmode=disable`,
    counts,
    activeSockets: () => sockets.size,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}

const sleep = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

describe("research-owned PostgreSQL pool transport", () => {
  const harnesses: Array<Awaited<ReturnType<typeof startPostgresHandshakeHarness>>> = [];
  afterEach(async () => {
    for (const harness of harnesses.splice(0)) await harness.close();
  });

  it("stops after three clean StartupMessage EOFs and does not reopen later", async () => {
    const harness = await startPostgresHandshakeHarness("clean-eof");
    harnesses.push(harness);
    const controller = new AbortController();
    let workEntered = false;

    await expect(withResearchOwnedPostgresPoolV1(harness.url, controller.signal, 1_000, async pool => {
      workEntered = true;
      await pool.unsafe("select 1");
      return null;
    })).rejects.toThrow();
    expect(workEntered).toBe(true);
    expect(harness.counts).toEqual({ connections: 3, startupMessages: 3, queryMessages: 0 });
    await sleep(100);
    expect(harness.counts.connections).toBe(3);
    expect(harness.activeSockets()).toBe(0);
  }, 15_000);

  it("aborts a silent established handshake and sends no SQL after the abort", async () => {
    const harness = await startPostgresHandshakeHarness("silent");
    harnesses.push(harness);
    const controller = new AbortController();
    let workEntered = false;
    const timeout = setTimeout(() => controller.abort(new Error("TEST_RESEARCH_POOL_ABORT")), 100);
    try {
      await expect(withResearchOwnedPostgresPoolV1(harness.url, controller.signal, 1_000,
        async pool => {
          workEntered = true;
          await pool.unsafe("select 1");
        })).rejects.toThrow("TEST_RESEARCH_POOL_ABORT");
    } finally { clearTimeout(timeout); }
    expect(workEntered).toBe(true);
    expect(harness.counts).toMatchObject({ connections: 1, startupMessages: 1, queryMessages: 0 });
    await sleep(100);
    expect(harness.counts.queryMessages).toBe(0);
    expect(harness.activeSockets()).toBe(0);
  }, 15_000);

  it("does not open a socket or invoke work for an already-aborted signal", async () => {
    const harness = await startPostgresHandshakeHarness("silent");
    harnesses.push(harness);
    const controller = new AbortController();
    controller.abort(new Error("TEST_RESEARCH_POOL_PREABORT"));
    let workEntered = false;

    await expect(withResearchOwnedPostgresPoolV1(harness.url, controller.signal, 1_000, async () => {
      workEntered = true;
      return null;
    })).rejects.toThrow("TEST_RESEARCH_POOL_PREABORT");
    expect(workEntered).toBe(false);
    expect(harness.counts.connections).toBe(0);
  }, 15_000);

  it("rejects multi-host, Unix-socket and session-routing URLs before connecting", async () => {
    const harness = await startPostgresHandshakeHarness("silent");
    harnesses.push(harness);
    const urls = [
      harness.url.replace("127.0.0.1", "127.0.0.1,127.0.0.2"),
      `${harness.url}&host=%2Fvar%2Frun%2Fpostgresql`,
      `${harness.url}&target_session_attrs=read-write`,
    ];

    for (const url of urls) {
      await expect(withResearchOwnedPostgresPoolV1(url, new AbortController().signal, 1_000,
        async () => null)).rejects.toThrow("RESEARCH_POOL_SINGLE_TCP_ENDPOINT_REQUIRED");
    }
    expect(harness.counts.connections).toBe(0);
  }, 15_000);
});
