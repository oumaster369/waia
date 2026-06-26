import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/health/settlement/route";
import { resetWaiaSqliteSingleton } from "@/db/client";
import * as waiaRuntimeDb from "@/db/waia-runtime-db";
import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";
import type { ConfirmedPaymentsReader } from "@/lib/trader/settlement/confirmed-payments-reader.port";
import * as sqliteReader from "@/lib/trader/settlement/confirmed-payments-reader-sqlite";

describe("GET /api/health/settlement", () => {
  afterEach(() => {
    resetWaiaSqliteSingleton();
    vi.restoreAllMocks();
  });

  it("returns ok when backlog is below threshold", async () => {
    const mockReader: ConfirmedPaymentsReader = {
      listUnsettledConfirmedTraderPayments: vi.fn().mockResolvedValue([]),
      countUnsettledConfirmedTraderPayments: vi.fn().mockResolvedValue(3),
      countExceptionSettlements: vi.fn().mockResolvedValue(1),
    };

    vi.spyOn(waiaRuntimeDb, "getWaiaRuntimeDb").mockResolvedValue({
      kind: "sqlite",
      db: {} as never,
    } satisfies WaiaRuntimeDb);
    vi.spyOn(sqliteReader, "createSqliteConfirmedPaymentsReader").mockReturnValue(mockReader);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      backlog: number;
      exception_count: number;
      ok: boolean;
    };
    expect(body.backlog).toBe(3);
    expect(body.exception_count).toBe(1);
    expect(body.ok).toBe(true);
  });

  it("returns stale when backlog exceeds threshold", async () => {
    const mockReader: ConfirmedPaymentsReader = {
      listUnsettledConfirmedTraderPayments: vi.fn().mockResolvedValue([]),
      countUnsettledConfirmedTraderPayments: vi.fn().mockResolvedValue(12),
      countExceptionSettlements: vi.fn().mockResolvedValue(0),
    };

    vi.spyOn(waiaRuntimeDb, "getWaiaRuntimeDb").mockResolvedValue({
      kind: "sqlite",
      db: {} as never,
    } satisfies WaiaRuntimeDb);
    vi.spyOn(sqliteReader, "createSqliteConfirmedPaymentsReader").mockReturnValue(mockReader);

    const res = await GET();
    expect(res.status).toBe(503);
    const body = (await res.json()) as { ok: boolean; backlog: number };
    expect(body.ok).toBe(false);
    expect(body.backlog).toBe(12);
  });
});
