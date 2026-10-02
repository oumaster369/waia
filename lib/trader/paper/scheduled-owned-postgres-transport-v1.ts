import { enforceServerOnly } from "@/lib/enforce-server-only";
enforceServerOnly();
import net from "node:net";
import { EventEmitter } from "node:events";

/** Private transport profile: the closed scheduled owner is the only composition caller. */
export type ScheduledPostgresEndpointV1 = Readonly<{ host: string; port: number; tls: boolean }>;
type NativeSocket = {
  opened: Promise<unknown>;
  closed: Promise<void>;
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  close(): Promise<void>;
  startTls(options: { expectedServerHostname: string }): NativeSocket;
};
type NativeConnect = (address: { hostname: string; port: number },
  options: { secureTransport: "starttls" | "off" }) => NativeSocket;
type WorkerDriverSocket = EventEmitter & {
  host: string; port: number; readyState: string; destroyed: boolean;
  raw: NativeSocket; reader: ReadableStreamDefaultReader<Uint8Array>;
  writer: WritableStreamDefaultWriter<Uint8Array>;
  markProtocolActive(): void;
  read(): Promise<void>; write(data: Uint8Array, callback?: () => void): boolean;
  end(data?: Uint8Array): void; destroy(): void;
};

const CONNECT_MS = 10_000;
const TERMINATE_FLUSH_MS = 50;
const MAX_ATTEMPTS = 3;
const closedError = () => new Error("SCHEDULED_POSTGRES_SCOPE_CLOSED");

/** No caller-supplied factory or transport override. Runtime selection is private. */
export async function createScheduledPostgresTransportV1(endpoint: ScheduledPostgresEndpointV1, signal: AbortSignal) {
  signal.throwIfAborted();
  const worker = globalThis.navigator?.userAgent === "Cloudflare-Workers";
  let connect: NativeConnect | undefined;
  if (worker) {
    // Keep the normal postgres workerd export; resolve only the public runtime module.
    // @ts-expect-error Workers provides this built-in module; it is not a Node dependency.
    const runtime = await import(/* webpackIgnore: true */ /* @vite-ignore */ "cloudflare:sockets") as { connect: NativeConnect };
    connect = runtime.connect;
  } else if (process.release?.name !== "node") {
    throw new Error("SCHEDULED_POSTGRES_RUNTIME_UNSUPPORTED");
  } else if (endpoint.tls) {
    // postgres replaces a Node socket's listeners on TLS upgrade. That socket's
    // lifetime is not owned by this adapter. Node is only a cleartext loopback
    // fixture profile; the deployed scheduled owner uses verified Worker TLS.
    throw new Error("SCHEDULED_POSTGRES_NODE_TLS_UNSUPPORTED");
  }
  signal.throwIfAborted();
  let sealed = false, attempts = 0;
  const owned = new Set<{ destroy(): void; markProtocolActive?(): void }>();
  const pending = new Set<Promise<unknown>>();
  const track = <T>(promise: Promise<T>): Promise<T | undefined> => {
    const settled = promise.catch(() => undefined);
    pending.add(settled);
    void settled.then(() => pending.delete(settled));
    return settled;
  };
  const seal = () => {
    sealed = true;
    for (const socket of owned) socket.destroy();
  };
  signal.addEventListener("abort", seal, { once: true });

  function nodeSocket(): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      Object.assign(socket, { host: endpoint.host, port: endpoint.port });
      owned.add(socket);
      let handedOff = false;
      const timer = setTimeout(() => socket.destroy(new Error("SCHEDULED_POSTGRES_CONNECT_TIMEOUT")), CONNECT_MS);
      track(new Promise<void>((closed) => socket.once("close", () => {
        clearTimeout(timer); owned.delete(socket);
        if (!handedOff) reject(closedError());
        closed();
      })));
      socket.once("error", reject);
      socket.once("connect", () => {
        clearTimeout(timer);
        if (sealed || signal.aborted) { socket.destroy(); reject(closedError()); return; }
        handedOff = true; resolve(socket);
      });
      socket.connect({ host: endpoint.host, port: endpoint.port });
    });
  }

  async function workerSocket(): Promise<WorkerDriverSocket> {
    const tcp = new EventEmitter() as WorkerDriverSocket;
    Object.assign(tcp, { host: endpoint.host, port: endpoint.port, readyState: "opening", destroyed: false });
    const transports = new Set<NativeSocket>();
    let generation = 0, reading = false, first = endpoint.tls, closed = false;
    let protocolReadyForClose = false;
    tcp.markProtocolActive = () => { if (!tcp.destroyed) protocolReadyForClose = true; };
    let rejectOpening: (error: Error) => void = () => undefined;
    const emitClosed = () => {
      if (closed) return;
      closed = true; tcp.readyState = "closed"; tcp.emit("close");
    };
    const fail = (error: unknown) => {
      if (tcp.listenerCount("error")) tcp.emit("error", error);
      tcp.destroy();
    };
    const wrap = (raw: NativeSocket): NativeSocket => {
      transports.add(raw);
      const epoch = ++generation;
      track(raw.closed.then(() => { if (epoch === generation) emitClosed(); },
        (error) => { if (epoch === generation) fail(error); }));
      return {
        get opened() { return raw.opened; },
        get readable() { return raw.readable; },
        get writable() { return raw.writable; },
        get closed() { return raw.closed; },
        close: () => raw.close(),
        startTls: () => {
          if (sealed || signal.aborted || tcp.destroyed) { fail(closedError()); throw closedError(); }
          let upgraded: NativeSocket;
          try { upgraded = raw.startTls({ expectedServerHostname: endpoint.host }); }
          catch (error) { fail(error); throw error; }
          const wrapped = wrap(upgraded);
          track(upgraded.opened.then(() => {
            if (!sealed && !tcp.destroyed) tcp.emit("secureConnect");
          }, fail));
          return wrapped;
        },
      };
    };
    tcp.read = () => {
      if (reading || tcp.destroyed) return Promise.resolve();
      reading = true;
      return track((async () => {
        try {
          while (!tcp.destroyed) {
            const item = await tcp.reader.read();
            if (tcp.destroyed) return;
            if (item.done) { emitClosed(); return; }
            const one = first; first = false;
            if (one) reading = false;
            tcp.emit("data", Buffer.from(item.value));
            if (one) return;
          }
        } catch (error) { if (!tcp.destroyed) fail(error); }
        finally { reading = false; }
      })()).then(() => undefined);
    };
    tcp.write = (data, callback) => {
      if (sealed || signal.aborted || tcp.destroyed) {
        queueMicrotask(() => fail(closedError())); return false;
      }
      track(tcp.writer.write(data).then(() => callback?.(), fail));
      void tcp.read();
      return true;
    };
    tcp.end = (data) => { if (data) tcp.write(data, () => tcp.destroy()); else tcp.destroy(); };
    tcp.destroy = () => {
      if (tcp.destroyed) return;
      const protocolReady = protocolReadyForClose && (tcp.readyState === "open" || tcp.readyState === "upgrade");
      tcp.destroyed = true; owned.delete(tcp);
      // Native opened may remain pending after close. Reject our factory now;
      // all native transports/streams are still explicitly closed and joined.
      rejectOpening(closedError());
      track((async () => {
        // Worker close can finish locally while the remote session remains open.
        // Send only the protocol Terminate frame (never SQL/retry). Its write is
        // owned even if the short flush budget expires; stream abort joins it.
        if (protocolReady && tcp.writer) {
          let flushTimer: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([
              track(Promise.resolve().then(() => tcp.writer.write(new Uint8Array([88, 0, 0, 0, 4])))),
              new Promise<void>((resolve) => { flushTimer = setTimeout(resolve, TERMINATE_FLUSH_MS); }),
            ]);
          } finally { if (flushTimer) clearTimeout(flushTimer); }
        }
        // Native close alone can wait behind a stalled TLS write. Abort both streams first.
        if (tcp.reader) track(Promise.resolve().then(() => tcp.reader.cancel()));
        if (tcp.writer) track(Promise.resolve().then(() => tcp.writer.abort()));
        // A detached pre-TLS socket may throw; never let that skip its successor.
        for (const raw of transports) track(Promise.resolve().then(() => raw.close()));
      })());
      emitClosed();
    };
    owned.add(tcp);
    const timer = setTimeout(() => tcp.destroy(), CONNECT_MS);
    try {
      const raw = connect!({ hostname: endpoint.host, port: endpoint.port },
        { secureTransport: endpoint.tls ? "starttls" : "off" });
      tcp.raw = wrap(raw);
      tcp.writer = tcp.raw.writable.getWriter(); tcp.reader = tcp.raw.readable.getReader();
      await new Promise<void>((resolve, reject) => {
        rejectOpening = reject;
        // Late native settlement cannot hand off a socket after this rejects.
        void raw.opened.then(() => resolve(), reject);
        if (sealed || signal.aborted || tcp.destroyed) reject(closedError());
      });
      if (sealed || signal.aborted || tcp.destroyed) throw closedError();
      tcp.readyState = "open"; return tcp;
    } catch (error) { tcp.destroy(); throw error; }
    finally { clearTimeout(timer); }
  }

  return {
    socket: async () => {
      if (sealed || signal.aborted) throw closedError();
      if (attempts >= MAX_ATTEMPTS) throw new Error("SCHEDULED_POSTGRES_CONNECTION_ATTEMPTS_EXHAUSTED");
      attempts++;
      return worker ? workerSocket() : nodeSocket();
    },
    seal,
    // The pool calls this only after a SQL result, not merely after TLS opens.
    markProtocolActive: () => { for (const socket of owned) socket.markProtocolActive?.(); },
    close: async () => {
      seal();
      signal.removeEventListener("abort", seal);
      while (pending.size) await Promise.all([...pending]);
    },
  };
}
