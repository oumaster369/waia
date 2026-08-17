import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { HtxKlineRow } from "@/lib/trader/connectors/htx/types";
import {
  assertHtxVolumeAuthorityQualified,
  HTX_VOLUME_QUALIFICATION_RECEIPT_SCHEMA_VERSION,
  qualifyHtxKlineVolumeAuthority,
} from "@/lib/trader/market-data/volume-qualification/htx-volume-qualification";

function realisticBtcRow(): HtxKlineRow {
  return {
    id: 1_600_000_000,
    open: 49_000,
    high: 49_050,
    low: 48_950,
    close: 49_010,
    amount: 3.946,
    vol: 193_354,
    count: 12,
  };
}

describe("DEE-526 HTX volume qualification (amount=base, vol=quote)", () => {
  it("maps realistic BTC amount≈3.946 / quote≈193k as BASE volume authority, never ~193k", () => {
    const row = realisticBtcRow();
    const receipt = qualifyHtxKlineVolumeAuthority({
      symbol: "BTCUSDT",
      rows: [
        row,
        {
          ...row,
          id: row.id + 60,
          open: 3_000,
          high: 3_010,
          low: 2_990,
          close: 3_000,
          amount: 2.5,
          vol: 7_500,
        },
      ],
    });
    expect(receipt.verdict).toBe("HTX_VOLUME_AUTHORITY_QUALIFIED");
    expect(receipt.schemaVersion).toBe(HTX_VOLUME_QUALIFICATION_RECEIPT_SCHEMA_VERSION);
    expect(receipt.authorityField).toBe("amount");
    expect(receipt.quoteTurnoverField).toBe("vol");
    assertHtxVolumeAuthorityQualified(receipt);
    const impliedVwap = row.vol / row.amount;
    expect(impliedVwap).toBeGreaterThanOrEqual(row.low);
    expect(impliedVwap).toBeLessThanOrEqual(row.high);
    expect(impliedVwap).toBeCloseTo(49_000, -2);
    expect(row.amount).toBeCloseTo(3.946);
    expect(row.amount).not.toBeCloseTo(193_354, -2);
  });

  it("qualifies ETH with amount as ETH quantity and vol as USDT turnover", () => {
    const receipt = qualifyHtxKlineVolumeAuthority({
      symbol: "ETHUSDT",
      rows: [
        {
          id: 100,
          open: 3_000,
          high: 3_010,
          low: 2_990,
          close: 3_000,
          amount: 12.5,
          vol: 37_500,
          count: 4,
        },
        {
          id: 160,
          open: 1_500,
          high: 1_510,
          low: 1_490,
          close: 1_500,
          amount: 8,
          vol: 12_000,
          count: 3,
        },
      ],
    });
    expect(receipt.verdict).toBe("HTX_VOLUME_AUTHORITY_QUALIFIED");
    expect(receipt.authorityField).toBe("amount");
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

  it("blocks when implied VWAP is outside candle high/low", () => {
    const receipt = qualifyHtxKlineVolumeAuthority({
      symbol: "BTCUSDT",
      rows: [
        {
          id: 100,
          open: 100,
          high: 100,
          low: 100,
          close: 100,
          amount: 1,
          vol: 1_000,
          count: 1,
        },
      ],
    });
    expect(receipt.verdict).toBe("HTX_VOLUME_AUTHORITY_BLOCKED_IMPLIED_VWAP_OUT_OF_RANGE");
  });

  it("blocks zero base amount with positive quote turnover", () => {
    const receipt = qualifyHtxKlineVolumeAuthority({
      symbol: "BTCUSDT",
      rows: [
        {
          id: 100,
          open: 100,
          high: 101,
          low: 99,
          close: 100,
          amount: 0,
          vol: 500,
          count: 1,
        },
      ],
    });
    expect(receipt.verdict).toBe("HTX_VOLUME_AUTHORITY_BLOCKED_ZERO_BASE_POSITIVE_QUOTE");
  });
});
