import { describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

import * as pgSchema from "@/db/schema.postgres";
import { createOrdinaryPaperOrderRepositoryFromExecutorPostgres } from "@/lib/trader/execution/ordinary-paper-order-repository-postgres";
import {
  captureScheduledNoncapitalPolledBundleV1,
  logScheduledNoncapitalOwnerStatusV1,
  runScheduledNoncapitalPaperLoopFromEnv,
} from "@/lib/trader/paper/scheduled-noncapital-owner-postgres-v1";
import type { GatewayPollResult } from "@/lib/trader/market-data/market-data-gateway";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";

const ORG = "a0000000-0000-4000-8000-000000012005";
const RELEASE = "a".repeat(40);
const closed = "2026-10-02T12:01:00.000Z";

function bundle(): GatewayPollResult {
  return {
    snapshot: {
      cycleId: "worker-0",
      cycleIndex: 0,
      evaluatedAt: closed,
      bars: [{
        symbol: "BTC/USDT", interval: "1m",
        barOpenTime: "2026-10-02T12:00:00.000Z", barCloseTime: closed,
        open: "65000", high: "65010", low: "64990", close: "65005", volume: "3",
      }],
      quote: {
        symbol: "BTC/USDT", bid: "65004", ask: "65006", last: "65005",
        timestamp: "2026-10-02T12:01:00.000Z",
      },
    },
    fusedContext: {
      instrumentId: "BTC/USDT", fusedAtUtc: closed,
      mtfBars: {}, macroEvidence: [], newsEvidence: [], blockchainEvidence: [],
      regulatoryEvidence: [], protocolEvidence: [], degradationReasons: [],
    },
    mtfBarsByInterval: {},
    canonicalPitCandidates: [],
    informationAcquisition: null,
  } as unknown as GatewayPollResult;
}

describe("DEE-1205 closed scheduled owner", () => {
  it("reports uncertain commits as operational errors without duplicating cycle completion", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const infos = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      logScheduledNoncapitalOwnerStatusV1({ status: "COMMIT_UNCERTAIN", report: null });
      expect(errors).toHaveBeenCalledWith(JSON.stringify({
        event: "waia_paper_loop_owner", phase: "commit_uncertain", status: "COMMIT_UNCERTAIN",
      }));
      expect(infos).not.toHaveBeenCalled();

      logScheduledNoncapitalOwnerStatusV1({ status: "BUSY", report: null });
      expect(infos).toHaveBeenCalledWith(JSON.stringify({
        event: "waia_paper_loop_owner", phase: "owner_status", status: "BUSY",
      }));
      expect(infos.mock.calls.every(([line]) => !String(line).includes("cycle_complete"))).toBe(true);

      infos.mockImplementation(() => { throw new Error("LOGGER_UNAVAILABLE"); });
      expect(() => logScheduledNoncapitalOwnerStatusV1({ status: "REPLAYED", report: {} as never, receiptDigest: "a".repeat(64) }))
        .not.toThrow();
      expect(() => logScheduledNoncapitalOwnerStatusV1({ status: "CONFIRMED_AFTER_UNCERTAINTY", report: {} as never, receiptDigest: "a".repeat(64) }))
        .not.toThrow();
      errors.mockImplementation(() => { throw new Error("LOGGER_UNAVAILABLE"); });
      expect(() => logScheduledNoncapitalOwnerStatusV1({ status: "COMMIT_UNCERTAIN", report: null }))
        .not.toThrow();
    } finally {
      errors.mockRestore();
      infos.mockRestore();
    }
  });

  it("disables before requiring a release, database or market poll", async () => {
    await expect(runScheduledNoncapitalPaperLoopFromEnv({ PAPER_LOOP_ENABLED: "0" }))
      .resolves.toEqual({ status: "NOOP_DISABLED", report: null });
  });

  it("requires a full release before opening the pool or polling", async () => {
    const env = {
      PAPER_LOOP_ENABLED: "1",
      PAPER_LOOP_ORGANIZATION_ID: ORG,
      PAPER_LOOP_ACCOUNT_KEY: "account",
      DATABASE_URL_POSTGRES: "postgresql://never:connect@127.0.0.1:1/never",
    };
    await expect(runScheduledNoncapitalPaperLoopFromEnv(env))
      .rejects.toThrow("SCHEDULED_PAPER_RELEASE_REQUIRED");
    await expect(runScheduledNoncapitalPaperLoopFromEnv({ ...env, WAIA_RELEASE_SHA: "", VERCEL_GIT_COMMIT_SHA: RELEASE }))
      .rejects.toThrow("SCHEDULED_PAPER_RELEASE_REQUIRED");
    await expect(runScheduledNoncapitalPaperLoopFromEnv({ ...env, WAIA_RELEASE_SHA: RELEASE, VERCEL_GIT_COMMIT_SHA: "b".repeat(40) }))
      .rejects.toThrow("SCHEDULED_PAPER_RELEASE_CONFLICT");
  });

  it("aborts the entire public poll before opening the database when its deadline expires", async () => {
    vi.useFakeTimers();
    const fetched = vi.fn((_resource: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      }));
    vi.stubGlobal("fetch", fetched);
    try {
      const pending = runScheduledNoncapitalPaperLoopFromEnv({
        PAPER_LOOP_ENABLED: "1",
        PAPER_LOOP_ORGANIZATION_ID: ORG,
        PAPER_LOOP_ACCOUNT_KEY: "account",
        WAIA_RELEASE_SHA: RELEASE,
        DATABASE_URL_POSTGRES: "postgresql://never:connect@127.0.0.1:1/never",
      });
      const refused = expect(pending).rejects.toThrow("SCHEDULED_PAPER_POLL_DEADLINE");
      await vi.advanceTimersByTimeAsync(45_000);
      await refused;
      expect(fetched).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it("ignores instance-local cycle labels but binds consumed quote and bar evidence", () => {
    const first = captureScheduledNoncapitalPolledBundleV1(bundle(), ORG);
    const upper = captureScheduledNoncapitalPolledBundleV1(bundle(), ORG.toUpperCase());
    expect(upper.identity).toEqual(first.identity);
    expect(upper.inputDigest).toBe(first.inputDigest);
    const relabeled = bundle();
    relabeled.snapshot.cycleId = "another-worker-88";
    relabeled.snapshot.cycleIndex = 88;
    expect(captureScheduledNoncapitalPolledBundleV1(relabeled, ORG).inputDigest).toBe(first.inputDigest);

    const changedQuote = bundle();
    changedQuote.snapshot.quote.last = "65007";
    expect(captureScheduledNoncapitalPolledBundleV1(changedQuote, ORG).inputDigest).not.toBe(first.inputDigest);

    const changedBar = bundle();
    changedBar.snapshot.bars[0]!.close = "65007";
    expect(captureScheduledNoncapitalPolledBundleV1(changedBar, ORG).inputDigest).not.toBe(first.inputDigest);
  });

  it("refuses a malformed organization identity before accepting a poll bundle", () => {
    expect(() => captureScheduledNoncapitalPolledBundleV1(bundle(), "org-1205"))
      .toThrow("SCHEDULED_PAPER_ORG_INVALID");
  });

  it("clones the captured market input and refuses extra authority and inconsistent bar identity", () => {
    const supplied = bundle();
    const captured = captureScheduledNoncapitalPolledBundleV1(supplied, ORG);
    supplied.snapshot.quote.last = "1";
    expect(captured.bundle.snapshot.quote.last).toBe("65005");

    const invalid = bundle();
    invalid.snapshot.evaluatedAt = "2026-10-02T12:02:00.000Z";
    expect(() => captureScheduledNoncapitalPolledBundleV1(invalid, ORG))
      .toThrow("SCHEDULED_PAPER_BAR_IDENTITY_INVALID");

    const forged = bundle();
    forged.informationAcquisition = {} as GatewayPollResult["informationAcquisition"];
    expect(() => captureScheduledNoncapitalPolledBundleV1(forged, ORG))
      .toThrow("SCHEDULED_PAPER_UNEXPECTED_INFORMATION_AUTHORITY");
  });

  it("rejects a root Drizzle pool passed as a held transaction before any query", async () => {
    const client = postgres("postgresql://never:connect@127.0.0.1:1/never", { max: 1, prepare: false });
    try {
      const db = drizzle(client, { schema: pgSchema }) as WaiaPostgresDb;
      expect(() => createOrdinaryPaperOrderRepositoryFromExecutorPostgres(
        db as Parameters<typeof createOrdinaryPaperOrderRepositoryFromExecutorPostgres>[0], ORG, "paper",
      )).toThrow("ORDINARY_PAPER_HELD_TRANSACTION_REQUIRED");
    } finally {
      await client.end({ timeout: 0 });
    }
  });
});
