import { describe, expect, it } from "vitest";

import type { HtxKlineRow } from "@/lib/trader/connectors/htx/types";
import { BTC_USDT } from "@/lib/trader/intelligence/types";
import { htxVolumeRawFromClosedBar } from "@/lib/trader/backtest/historical-execution-profile";
import {
  htxMappedVolumeAuthorityStatus,
  mapHtxKlinesToBars,
} from "@/lib/trader/market-data/htx-kline-mapper";
import {
  assertHtxVolumeCapitalAuthorityPermitsCapacity,
  HtxVolumeCapitalAuthorityError,
  resolveAuthoritativeHtxBaseVolumeForCapital,
} from "@/lib/trader/market-data/volume-qualification/htx-volume-authority-capital-v1";
import {
  assertHtxVolumeAuthorityQualified,
  HTX_VOLUME_QUALIFICATION_RECEIPT_SCHEMA_V1_RETIRED,
  qualifyHtxKlineVolumeAuthority,
  type HtxVolumeQualificationReceiptV1,
} from "@/lib/trader/market-data/volume-qualification/htx-volume-qualification";

function qualifiedRows(): HtxKlineRow[] {
  return [
    {
      id: 100,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      amount: 10,
      vol: 1000,
      count: 1,
    },
    {
      id: 160,
      open: 50,
      high: 51,
      low: 49,
      close: 50,
      amount: 10,
      vol: 500,
      count: 1,
    },
  ];
}

describe("DEE-526 HTX volume capital authority gate (amount=base)", () => {
  it("mapper Bar.volume is base amount, never quote turnover", () => {
    expect(htxMappedVolumeAuthorityStatus()).toBe("NON_AUTHORITATIVE_RAW_INGESTION");
    const bars = mapHtxKlinesToBars(BTC_USDT, [
      {
        id: 1,
        open: 49_000,
        high: 49_050,
        low: 48_950,
        close: 49_010,
        amount: 3.946,
        vol: 193_354,
        count: 1,
      },
    ]);
    expect(Number(bars[0]!.volume)).toBeCloseTo(3.946);
    expect(Number(bars[0]!.volume)).not.toBeCloseTo(193_354, -2);
  });

  it("QUALIFIED permits authoritative BASE volume from amount", () => {
    const receipt = qualifyHtxKlineVolumeAuthority({
      symbol: "BTCUSDT",
      rows: qualifiedRows(),
    });
    expect(receipt.verdict).toBe("HTX_VOLUME_AUTHORITY_QUALIFIED");
    assertHtxVolumeCapitalAuthorityPermitsCapacity(receipt);
    const base = resolveAuthoritativeHtxBaseVolumeForCapital({
      receipt,
      amount: 10,
      vol: 1000,
    });
    expect(base).toBe(10);
  });

  it("mutating quote turnover cannot silently mutate base quantity", () => {
    const receipt = qualifyHtxKlineVolumeAuthority({
      symbol: "BTCUSDT",
      rows: qualifiedRows(),
    });
    const before = resolveAuthoritativeHtxBaseVolumeForCapital({
      receipt,
      amount: 3.946,
      vol: 193_354,
    });
    const after = resolveAuthoritativeHtxBaseVolumeForCapital({
      receipt,
      amount: 3.946,
      vol: 9_999_999,
    });
    expect(before).toBe(3.946);
    expect(after).toBe(3.946);
  });

  it("quote turnover cannot become base participation capacity", () => {
    const receipt = qualifyHtxKlineVolumeAuthority({
      symbol: "BTCUSDT",
      rows: qualifiedRows(),
    });
    expect(() =>
      resolveAuthoritativeHtxBaseVolumeForCapital({
        receipt,
        amount: 0,
        vol: 193_354,
      }),
    ).toThrow(HtxVolumeCapitalAuthorityError);
  });

  it("zero base volume cannot create execution capacity", () => {
    const receipt = qualifyHtxKlineVolumeAuthority({
      symbol: "BTCUSDT",
      rows: qualifiedRows(),
    });
    expect(
      resolveAuthoritativeHtxBaseVolumeForCapital({
        receipt,
        amount: 0,
        vol: 0,
      }),
    ).toBe(0);
  });

  it("historical execution consumes mapped base volume, not fabricated quote*close", () => {
    const bars = mapHtxKlinesToBars(BTC_USDT, [
      {
        id: 1,
        open: 49_000,
        high: 49_050,
        low: 48_950,
        close: 49_010,
        amount: 3.946,
        vol: 193_354,
        count: 1,
      },
    ]);
    const raw = htxVolumeRawFromClosedBar(bars[0]!);
    expect(raw.amount).toBeCloseTo(3.946);
    expect(raw.amount).not.toBeCloseTo(193_354, -2);
  });

  it("old reversed v1 receipts cannot authorize the corrected path", () => {
    const retired = {
      schemaVersion: HTX_VOLUME_QUALIFICATION_RECEIPT_SCHEMA_V1_RETIRED,
      verdict: "HTX_VOLUME_AUTHORITY_QUALIFIED",
      authorityField: "amount",
      venue: "HTX",
      marketType: "SPOT",
      symbol: "BTCUSDT",
      interval: "1m",
      sampleCount: 2,
      divergenceCount: 0,
      qualifiedAtUtc: "2026-01-01T00:00:00.000Z",
      qualificationReceiptDigest: "a".repeat(64),
    } as unknown as HtxVolumeQualificationReceiptV1;
    expect(() => assertHtxVolumeCapitalAuthorityPermitsCapacity(retired)).toThrow(
      HtxVolumeCapitalAuthorityError,
    );
    try {
      assertHtxVolumeCapitalAuthorityPermitsCapacity(retired);
    } catch (err) {
      expect((err as HtxVolumeCapitalAuthorityError).code).toBe(
        "HTX_VOLUME_AUTHORITY_BLOCKED_RETIRED_SEMANTICS",
      );
    }
    expect(() => assertHtxVolumeAuthorityQualified(retired)).toThrow();
  });

  it("BLOCKED denies capital capacity", () => {
    const receipt = qualifyHtxKlineVolumeAuthority({
      symbol: "BTCUSDT",
      rows: [
        {
          id: 1,
          open: 100,
          high: 100,
          low: 100,
          close: 100,
          amount: 10,
          vol: 10,
          count: 1,
        },
      ],
    });
    expect(receipt.verdict).toBe("HTX_VOLUME_AUTHORITY_BLOCKED_AMBIGUOUS_FIELDS");
    expect(() => assertHtxVolumeCapitalAuthorityPermitsCapacity(receipt)).toThrow(
      HtxVolumeCapitalAuthorityError,
    );
  });

  it("missing qualification denies capital authority", () => {
    expect(() => assertHtxVolumeCapitalAuthorityPermitsCapacity(undefined)).toThrow(
      HtxVolumeCapitalAuthorityError,
    );
    try {
      assertHtxVolumeCapitalAuthorityPermitsCapacity(undefined);
    } catch (err) {
      expect(err).toBeInstanceOf(HtxVolumeCapitalAuthorityError);
      expect((err as HtxVolumeCapitalAuthorityError).code).toBe("HTX_VOLUME_AUTHORITY_MISSING");
    }
  });
});
