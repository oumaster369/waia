import { afterEach, describe, expect, it, vi } from "vitest";
import { createProjectionClient, type ProjectionClient } from "@/lib/trader/account-observation/projection-client";
import { createProjectionDispatcher } from "@/lib/trader/account-observation/projection-dispatcher";
import { createProjectionHttpServer } from "@/lib/trader/account-observation/projection-http";
import { PROJECTION_PATHS, type ProjectionTuple } from "@/lib/trader/account-observation/projection-protocol";
import type { AccountObservation, ObservationBinding } from "@/lib/trader/account-observation/types";
import { binding, observation } from "./account-observation-stream-fixtures";

const ORIGIN = "https://observation-reader.waia.life";
const KEY = new Uint8Array(32).fill(31);
const TUPLE: ProjectionTuple = Object.freeze({
  audience: ORIGIN,
  releaseSha: "b".repeat(40),
  epochId: "44444444-4444-4444-8444-444444444444",
  keyId: "composition-test",
});
const SCOPE = Object.freeze({
  organizationId: binding.organizationId,
  credentialId: binding.credentialId,
  exchangeAccountId: binding.exchangeAccountId,
});
const INITIAL_WALL = 1_800_000_000_000;

const servers: ReturnType<typeof createProjectionHttpServer>[] = [];
const dispatchers: ReturnType<typeof createProjectionDispatcher>[] = [];
const clients: ProjectionClient[] = [];

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

async function startServer(server: ReturnType<typeof createProjectionHttpServer>): Promise<number> {
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected an ephemeral loopback listener");
  return address.port;
}

async function closeServer(server: ReturnType<typeof createProjectionHttpServer>): Promise<void> {
  if (!server.listening) return;
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

afterEach(async () => {
  for (const client of clients.splice(0)) client.dispose();
  for (const dispatcher of dispatchers.splice(0)) dispatcher.stop();
  for (const server of servers.splice(0)) await closeServer(server);
  vi.restoreAllMocks();
});

describe("projection client, HTTP adapter, and dispatcher composition", () => {
  it("round-trips signed snapshots and empty results over a real ephemeral socket, then refuses replay and body mutation before reading", async () => {
    let wall = INITIAL_WALL - 10_000;
    let mono = 0;
    const capturedObservation: AccountObservation = deepFreeze(observation());
    let resolveCalls = 0;
    let latestCalls = 0;
    const reader = {
      resolveActiveBinding: vi.fn(async (): Promise<ObservationBinding | null> =>
        ++resolveCalls === 1 ? binding : null),
      readLatest: vi.fn(async (): Promise<AccountObservation | null> =>
        ++latestCalls === 1 ? capturedObservation : null),
    };
    const dispatcher = createProjectionDispatcher({ tuple: TUPLE, keyBytes: KEY, reader,
      wallClock: () => wall, monotonicClock: () => mono });
    dispatchers.push(dispatcher);
    // Simulate completion of boot quarantine through injected clocks only.
    wall += 10_000;
    mono += 10_000;
    expect(dispatcher.status().ready).toBe(true);

    const server = createProjectionHttpServer({ dispatcher });
    const port = await startServer(server);
    const originalFetch = globalThis.fetch;
    const sent: Array<{ path: string; body: string; signature: string }> = [];
    const adapter: typeof fetch = async (input, init) => {
      const destination = new URL(String(input));
      if (destination.origin !== ORIGIN || destination.search !== "" || destination.hash !== "" ||
          (destination.pathname !== PROJECTION_PATHS.resolveBinding && destination.pathname !== PROJECTION_PATHS.readLatest)) {
        throw new Error("unexpected projection destination");
      }
      const headers = init?.headers as Record<string, string>;
      sent.push({ path: destination.pathname, body: String(init?.body),
        signature: headers["x-waia-projection-signature"] });
      // Keep the production-facing request fixed at the approved HTTPS origin;
      // this test-only adapter maps that origin to its owned loopback listener.
      return originalFetch(`http://127.0.0.1:${port}${destination.pathname}`, init);
    };
    const client = createProjectionClient({
      fetch: adapter,
      clock: () => wall,
      tuple: TUPLE,
      keyBytes: KEY,
      accessClientId: "synthetic-access-id",
      accessClientSecret: "synthetic-access-secret",
      deadlineMs: INITIAL_WALL + 5_000,
    });
    clients.push(client);

    await expect(client.resolveActiveBinding(SCOPE)).resolves.toEqual(binding);
    await expect(client.readLatest(binding)).resolves.toEqual(capturedObservation);
    await expect(client.resolveActiveBinding(SCOPE)).resolves.toBeNull();
    await expect(client.readLatest(binding)).resolves.toBeNull();
    expect(sent.map((request) => request.path)).toEqual([
      PROJECTION_PATHS.resolveBinding,
      PROJECTION_PATHS.readLatest,
      PROJECTION_PATHS.resolveBinding,
      PROJECTION_PATHS.readLatest,
    ]);
    expect(reader.resolveActiveBinding).toHaveBeenCalledTimes(2);
    expect(reader.readLatest).toHaveBeenCalledTimes(2);
    expect(dispatcher.status().nonceCount).toBe(4);

    const callsBeforeRejectedRequests = {
      resolve: reader.resolveActiveBinding.mock.calls.length,
      latest: reader.readLatest.mock.calls.length,
    };
    const replay = await originalFetch(`http://127.0.0.1:${port}${sent[0].path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-waia-projection-signature": sent[0].signature },
      body: sent[0].body,
      cache: "no-store",
      redirect: "error",
    });
    expect(replay.status).toBe(503);

    const modifiedBody = sent[0].body.replace("account-a", "account-b");
    expect(modifiedBody).not.toBe(sent[0].body);
    const tampered = await originalFetch(`http://127.0.0.1:${port}${sent[0].path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-waia-projection-signature": sent[0].signature },
      body: modifiedBody,
      cache: "no-store",
      redirect: "error",
    });
    expect(tampered.status).toBe(503);
    expect(await tampered.text()).toBe('{"error":"ACCOUNT_OBSERVATION_PROJECTION_UNAVAILABLE"}');
    expect(reader.resolveActiveBinding).toHaveBeenCalledTimes(callsBeforeRejectedRequests.resolve);
    expect(reader.readLatest).toHaveBeenCalledTimes(callsBeforeRejectedRequests.latest);
    expect(dispatcher.status().nonceCount).toBe(4);
  });
});
