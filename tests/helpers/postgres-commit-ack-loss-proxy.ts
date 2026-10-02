import net from "node:net";

/** Test-only plaintext loopback proxy. It drops one acknowledged server COMMIT
 * before its response reaches the client; subsequent connections pass through.
 * No query text, authentication bytes or connection strings leave this helper. */
export async function startCommitAckLossProxy(input: {
  targetHost: "127.0.0.1";
  targetPort: number;
}): Promise<{
  port: number;
  stats: () => Readonly<{ connections: number; commitResponsesWithheld: number; protocolErrors: number }>;
  close: () => Promise<void>;
}> {
  if (input.targetHost !== "127.0.0.1" || !Number.isInteger(input.targetPort) ||
      input.targetPort < 1 || input.targetPort > 65535) throw new Error("ACK_PROXY_LOOPBACK_REQUIRED");
  const sockets = new Set<net.Socket>();
  const counters = { connections: 0, commitResponsesWithheld: 0, protocolErrors: 0 };
  let claimed = false;
  const server = net.createServer((downstream) => {
    counters.connections++;
    const upstream = net.connect({ host: input.targetHost, port: input.targetPort });
    sockets.add(downstream); sockets.add(upstream);
    let frontend = Buffer.alloc(0), backend = Buffer.alloc(0);
    let startup = true, targeted = false, committed = false;
    const heldResponses: Buffer[] = [];
    let heldBytes = 0;
    const stop = () => { downstream.destroy(); upstream.destroy(); };
    const invalid = () => { counters.protocolErrors++; stop(); };
    for (const socket of [upstream, downstream]) {
      socket.on("error", stop);
      socket.on("close", () => { sockets.delete(socket); stop(); });
      socket.setTimeout(30_000, stop);
    }
    downstream.on("data", (chunk: Buffer) => {
      frontend = Buffer.concat([frontend, chunk]);
      // StartupMessage has no type byte. TLS/GSS negotiation is deliberately
      // unsupported: the fixture must use an explicit plaintext local URL.
      if (startup) {
        if (frontend.length < 4) { upstream.write(chunk); return; }
        const length = frontend.readInt32BE(0);
        if (length < 8 || length > 16 * 1024 * 1024) { invalid(); return; }
        if (frontend.length < length) { upstream.write(chunk); return; }
        if (frontend.readInt32BE(4) !== 196608) { invalid(); return; }
        frontend = frontend.subarray(length); startup = false;
      }
      while (frontend.length >= 5) {
        const length = frontend.readInt32BE(1);
        if (length < 4 || length > 16 * 1024 * 1024) { invalid(); return; }
        if (frontend.length < length + 1) break;
        const kind = String.fromCharCode(frontend[0]!);
        const body = frontend.subarray(5, length + 1);
        let query: string | null = null;
        if (kind === "Q") query = body.subarray(0, body.indexOf(0)).toString("utf8");
        if (kind === "P") {
          const nameEnd = body.indexOf(0), queryEnd = body.indexOf(0, nameEnd + 1);
          if (nameEnd >= 0 && queryEnd > nameEnd) query = body.subarray(nameEnd + 1, queryEnd).toString("utf8");
        }
        if (!claimed && query !== null && /^\s*commit(?:\s+transaction)?\s*;?\s*$/i.test(query)) {
          claimed = true; targeted = true;
        }
        frontend = frontend.subarray(length + 1);
      }
      if (!upstream.destroyed) upstream.write(chunk);
    });
    upstream.on("data", (chunk: Buffer) => {
      backend = Buffer.concat([backend, chunk]);
      while (backend.length >= 5) {
        const length = backend.readInt32BE(1);
        if (length < 4 || length > 16 * 1024 * 1024) { invalid(); return; }
        if (backend.length < length + 1) break;
        const frame = Buffer.from(backend.subarray(0, length + 1));
        backend = backend.subarray(length + 1);
        if (!targeted) { downstream.write(frame); continue; }
        heldResponses.push(frame); heldBytes += frame.length;
        if (heldBytes > 1024 * 1024) { invalid(); return; }
        const kind = String.fromCharCode(frame[0]!);
        if (kind === "C") committed = frame.subarray(5).toString("utf8") === "COMMIT\0";
        if (kind === "Z") {
          if (committed && frame[5] === 73) { // ReadyForQuery: idle, after real server COMMIT.
            counters.commitResponsesWithheld++; stop(); return;
          }
          // A real server error/rollback is not an acknowledged commit.
          for (const response of heldResponses) downstream.write(response);
          heldResponses.length = 0; heldBytes = 0; targeted = false;
        }
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("ACK_PROXY_PORT_MISSING");
  return {
    port: address.port,
    stats: () => Object.freeze({ ...counters }),
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}
