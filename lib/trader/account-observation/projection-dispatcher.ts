import "server-only";
import {
  createProjectionResponse,
  verifyProjectionRequest,
  type ProjectionScope,
  type ProjectionTuple,
  type SignedProjectionResponse,
  type VerifiedProjectionRequest,
} from "./projection-protocol";
import type { AccountObservation, ObservationBinding } from "./types";

export const PROJECTION_DISPATCH_LIMITS = Object.freeze({
  httpRequests: 4,
  queuedReads: 3,
  nonces: 1024,
  quarantineMs: 10_000,
  clockDriftMs: 1_000,
  nonceRetentionMs: 1_000,
  stuckReadMs: 8_000,
});

type Reader = {
  resolveActiveBinding(scope: ProjectionScope): Promise<ObservationBinding | null>;
  readLatest(binding: ObservationBinding): Promise<AccountObservation | null>;
};
type LeaseState = { controller: AbortController; released: boolean; used: boolean; cryptoWork: number };
type Job = {
  request: VerifiedProjectionRequest;
  lease: LeaseState;
  generation: number;
  settled: boolean;
  started: boolean;
  timer: ReturnType<typeof setTimeout>;
  onAbort: () => void;
  resolve: (response: SignedProjectionResponse) => void;
  reject: (error: Error) => void;
};

/** Deliberately contains no listener, environment, SQL factory or automatic retry.
 * The service owner must hold an exclusive lifetime process lock before constructing
 * its single pool/dispatcher. HTTP leases last until response finish/close; query
 * occupancy is separate and survives request cancellation until the reader settles.
 */
export function createProjectionDispatcher(options: {
  tuple: ProjectionTuple;
  keyBytes: Uint8Array;
  reader: Reader;
  wallClock?: () => number;
  monotonicClock?: () => number;
}) {
  if (options.keyBytes.byteLength !== 32) throw unavailable();
  const keyBytes = Uint8Array.from(options.keyBytes);
  const tuple = Object.freeze({ ...options.tuple });
  const reader = options.reader;
  const wallClock = options.wallClock ?? Date.now;
  const monotonicClock = options.monotonicClock ?? (() => performance.now());
  let anchorWall = wallClock();
  let anchorMono = monotonicClock();
  if (!validClock(anchorWall, anchorMono)) throw unavailable();
  let lastMono = anchorMono;
  let readyAfter = anchorMono + PROJECTION_DISPATCH_LIMITS.quarantineMs;
  let admissionFloor: number | null = null;
  let generation = 0;
  let stopped = false;
  let poisoned = false;
  let active: Job | null = null;
  const queue: Job[] = [];
  const leases = new Set<LeaseState>();
  const nonces = new Map<string, number>();

  async function withCryptoLease<T>(lease: LeaseState, work: () => Promise<T>): Promise<T> {
    lease.cryptoWork++;
    try { return await work(); }
    finally {
      lease.cryptoWork--;
      if (lease.released && lease.cryptoWork === 0) leases.delete(lease);
    }
  }

  function cancelJob(job: Job) {
    if (job.settled) return;
    job.settled = true;
    clearTimeout(job.timer);
    job.lease.controller.signal.removeEventListener("abort", job.onAbort);
    const queuedIndex = queue.indexOf(job);
    if (queuedIndex !== -1) queue.splice(queuedIndex, 1);
    job.reject(unavailable());
    // An active reader keeps its slot, even if the caller already received an error.
  }

  function invalidateRequests() {
    generation++;
    for (const lease of leases) lease.controller.abort();
    for (const job of [...queue]) cancelJob(job);
  }

  function observeClock(): number {
    const wall = wallClock();
    const mono = monotonicClock();
    if (!validClock(wall, mono) || mono < lastMono) {
      poisoned = true;
      invalidateRequests();
      throw unavailable();
    }
    lastMono = mono;
    if (Math.abs(wall - anchorWall - (mono - anchorMono)) > PROJECTION_DISPATCH_LIMITS.clockDriftMs) {
      anchorWall = wall;
      anchorMono = mono;
      readyAfter = mono + PROJECTION_DISPATCH_LIMITS.quarantineMs;
      admissionFloor = null;
      invalidateRequests();
    }
    if (admissionFloor === null && mono >= readyAfter && !poisoned && !stopped) {
      // The ten-second quiet boundary expires every formerly valid signed request.
      admissionFloor = wall;
      nonces.clear();
    }
    return wall;
  }

  function assertReady(): number {
    const now = observeClock();
    if (stopped || poisoned || admissionFloor === null) throw unavailable();
    return now;
  }

  function assertJob(job: Job) {
    const now = assertReady();
    if (job.settled || job.lease.controller.signal.aborted || job.generation !== generation ||
        job.request.issuedAtMs < admissionFloor! || job.request.deadlineMs <= now) throw unavailable();
  }

  async function execute(job: Job) {
    const watchdog = setTimeout(() => {
      // Never replace this pool while its query/transaction cleanup is unresolved.
      poisoned = true;
      invalidateRequests();
    }, PROJECTION_DISPATCH_LIMITS.stuckReadMs);
    let data: AccountObservation | ObservationBinding | null;
    try {
      assertJob(job);
      data = await (job.request.operation === "resolveBinding"
        ? reader.resolveActiveBinding(job.request.payload as ProjectionScope)
        : reader.readLatest(job.request.payload as ObservationBinding));
    } catch {
      cancelJob(job);
      return;
    } finally {
      clearTimeout(watchdog);
      active = null;
      pump();
    }
    try {
      assertJob(job);
      const response = await withCryptoLease(job.lease, () => createProjectionResponse(job.request, data, keyBytes));
      assertJob(job);
      job.settled = true;
      clearTimeout(job.timer);
      job.lease.controller.signal.removeEventListener("abort", job.onAbort);
      job.resolve(response);
    } catch { cancelJob(job); }
  }

  function pump() {
    if (active) return;
    try { assertReady(); } catch { return; }
    while (queue.length) {
      const job = queue.shift()!;
      try { assertJob(job); } catch { cancelJob(job); continue; }
      active = job;
      job.started = true;
      void execute(job);
      return;
    }
  }

  const clockMonitor = setInterval(() => {
    try { observeClock(); } catch { /* Invalid clock has already closed admission. */ }
  }, 250);
  clockMonitor.unref?.();

  return {
    /** Acquire synchronously before reading the HTTP body; release exactly when the
     * response is finished/closed, including on rejection and client disconnect. */
    acquire() {
      assertReady();
      if (leases.size >= PROJECTION_DISPATCH_LIMITS.httpRequests) throw unavailable();
      const lease: LeaseState = { controller: new AbortController(), released: false, used: false, cryptoWork: 0 };
      leases.add(lease);
      return {
        signal: lease.controller.signal,
        release() {
          if (lease.released) return;
          lease.released = true;
          lease.controller.abort();
          // A closed socket cannot abandon ongoing WebCrypto work and acquire an
          // unlimited replacement stream of verifications/signatures.
          if (lease.cryptoWork === 0) leases.delete(lease);
        },
        async run(rawRequest: unknown): Promise<SignedProjectionResponse> {
          if (lease.used || lease.released || lease.controller.signal.aborted) throw unavailable();
          lease.used = true;
          const requestGeneration = generation;
          try {
            assertReady();
            const request = await withCryptoLease(lease, () => verifyProjectionRequest(rawRequest, { expectedTuple: tuple, keyBytes, clock: wallClock }));
            const now = assertReady();
            if (lease.controller.signal.aborted || requestGeneration !== generation ||
                request.issuedAtMs < admissionFloor! || request.deadlineMs <= now) throw unavailable();
            for (const [nonce, expires] of nonces) if (expires < now) nonces.delete(nonce);
            const nonce = `${request.tuple.epochId}:${request.requestId.toLowerCase()}`;
            if (nonces.has(nonce) || nonces.size >= PROJECTION_DISPATCH_LIMITS.nonces) throw unavailable();
            // Synchronous, process-wide claim follows signature verification and
            // precedes queue admission/SQL. Busy/refused requests are never retried.
            nonces.set(nonce, request.deadlineMs + PROJECTION_DISPATCH_LIMITS.nonceRetentionMs);
            if (queue.length >= PROJECTION_DISPATCH_LIMITS.queuedReads) throw unavailable();
            return await new Promise<SignedProjectionResponse>((resolve, reject) => {
              const job: Job = {
                request, lease, generation, settled: false, started: false,
                timer: setTimeout(() => cancelJob(job), request.deadlineMs - now),
                onAbort: () => cancelJob(job), resolve, reject,
              };
              lease.controller.signal.addEventListener("abort", job.onAbort, { once: true });
              queue.push(job);
              pump();
            });
          } catch { throw unavailable(); }
        },
      };
    },
    status() {
      try { observeClock(); } catch { /* Report closed admission without clock details. */ }
      return Object.freeze({ ready: !stopped && !poisoned && admissionFloor !== null,
        httpRequests: leases.size, activeReads: active ? 1 : 0, queuedReads: queue.length,
        nonceCount: nonces.size, draining: stopped, poisoned });
    },
    /** Does not close/recreate SQL or release its occupied slot; host drain must
     * wait for activeReads=0 before pool.end and process-lock release. */
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(clockMonitor);
      invalidateRequests();
      keyBytes.fill(0);
    },
  };
}

function validClock(wall: number, mono: number) {
  return Number.isSafeInteger(wall) && Number.isFinite(mono) && mono >= 0;
}
function unavailable() { return new Error("ACCOUNT_OBSERVATION_PROJECTION_UNAVAILABLE"); }
