import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/health/payment-watcher/route";
import { resetWaiaSqliteSingleton } from "@/db/client";
import * as waiaRuntimeDb from "@/db/waia-runtime-db";
import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";
import { CANONICAL_NETWORK } from "@/lib/waia-core/payment-watcher/watcher-config";
import type { WatcherCheckpointRepository } from "@/lib/waia-core/payment-watcher/checkpoint-repository.types";
import * as checkpointAdapters from "@/lib/waia-core/payment-watcher/checkpoint-repository-adapters";

describe("GET /api/health/payment-watcher", () => {
  afterEach(() => {
    resetWaiaSqliteSingleton();
    vi.restoreAllMocks();
  });

  it("returns ok when scan lag is below threshold", async () => {
    const now = new Date();
    const mockRepo: WatcherCheckpointRepository = {
      load: vi.fn().mockResolvedValue({
        network: CANONICAL_NETWORK,
        lastScannedBlock: "100",
        lastScannedAt: now,
        leaseUntil: null,
        lastError: null,
        lastErrorAt: null,
        cycleCount: 1,
        createdAt: now,
        updatedAt: now,
      }),
      bootstrap: vi.fn(),
      tryAcquireLease: vi.fn(),
      releaseLease: vi.fn(),
      saveProgress: vi.fn(),
      recordError: vi.fn(),
    };

    vi.spyOn(waiaRuntimeDb, "getWaiaRuntimeDb").mockResolvedValue({
      kind: "sqlite",
      db: {} as never,
    } satisfies WaiaRuntimeDb);
    vi.spyOn(checkpointAdapters, "createSqliteWatcherCheckpointRepositoryAdapter").mockReturnValue(
      mockRepo,
    );

    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      network: string;
      ok: boolean;
      scan_lag_seconds: number | null;
    };
    expect(body.network).toBe("TRC-20");
    expect(body.ok).toBe(true);
    expect(typeof body.scan_lag_seconds).toBe("number");
  });

  it("returns stale when checkpoint is missing", async () => {
    const mockRepo: WatcherCheckpointRepository = {
      load: vi.fn().mockResolvedValue(null),
      bootstrap: vi.fn(),
      tryAcquireLease: vi.fn(),
      releaseLease: vi.fn(),
      saveProgress: vi.fn(),
      recordError: vi.fn(),
    };

    vi.spyOn(waiaRuntimeDb, "getWaiaRuntimeDb").mockResolvedValue({
      kind: "sqlite",
      db: {} as never,
    } satisfies WaiaRuntimeDb);
    vi.spyOn(checkpointAdapters, "createSqliteWatcherCheckpointRepositoryAdapter").mockReturnValue(
      mockRepo,
    );

    const res = await GET();
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      network: string;
      ok: boolean;
      scan_lag_seconds: number | null;
    };
    expect(body.ok).toBe(false);
  });
});
