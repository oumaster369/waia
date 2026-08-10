import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { HtxKlineRow } from "@/lib/trader/connectors/htx/types";
import {
  assertHtxVolumeAuthorityQualified,
  qualifyHtxKlineVolumeAuthority,
} from "@/lib/trader/market-data/volume-qualification/htx-volume-qualification";

describe("DEE-526 HTX volume qualification", () => {
  it("qualifies synthetic rows where amount tracks vol * close", () => {
    const rows: HtxKlineRow[] = [
      {
        id: 100,
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        amount: 1000,
        vol: 10,
        count: 1,
      },
      {
        id: 160,
        open: 50,
        high: 51,
        low: 49,
        close: 50,
        amount: 500,
        vol: 10,
        count: 1,
      },
    ];
    const receipt = qualifyHtxKlineVolumeAuthority({ symbol: "BTCUSDT", rows });
    expect(receipt.verdict).toBe("HTX_VOLUME_AUTHORITY_QUALIFIED");
    expect(receipt.authorityField).toBe("amount");
    assertHtxVolumeAuthorityQualified(receipt);
  });

  it("blocks ambiguous fixture where amount equals vol", () => {
    const fixturePath = path.join(process.cwd(), "tests/fixtures/trader/htx-kline-btcusdt-1m.json");
    const raw = JSON.parse(readFileSync(fixturePath, "utf8")) as {
      kline?: { data?: HtxKlineRow[] };
    };
    const receipt = qualifyHtxKlineVolumeAuthority({
      symbol: "BTCUSDT",
      rows: raw.kline?.data ?? [],
    });
    expect(receipt.verdict).toBe("HTX_VOLUME_AUTHORITY_BLOCKED_AMBIGUOUS_FIELDS");
  });

  it("blocks when amount and vol diverge beyond tolerance", () => {
    const rows: HtxKlineRow[] = [
      {
        id: 100,
        open: 100,
        high: 100,
        low: 100,
        close: 100,
        amount: 1000,
        vol: 1,
        count: 1,
      },
    ];
    const receipt = qualifyHtxKlineVolumeAuthority({ symbol: "BTCUSDT", rows });
    expect(receipt.verdict).toBe("HTX_VOLUME_AUTHORITY_BLOCKED_AMOUNT_VOL_DIVERGENCE");
  });
});
