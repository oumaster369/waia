import { describe, expect, it } from "vitest";

import type { HtxKlineRow } from "@/lib/trader/connectors/htx/types";
import { BTC_USDT } from "@/lib/trader/intelligence/types";
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
  qualifyHtxKlineVolumeAuthority,
} from "@/lib/trader/market-data/volume-qualification/htx-volume-qualification";

function qualifiedRows(): HtxKlineRow[] {
  return [
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
}

describe("DEE-526 HTX volume capital authority gate", () => {
  it("mapper raw ingestion is explicitly non-authoritative and does not use amount??vol", () => {
    expect(htxMappedVolumeAuthorityStatus()).toBe("NON_AUTHORITATIVE_RAW_INGESTION");
    const bars = mapHtxKlinesToBars(BTC_USDT, [
      {
        id: 1,
        open: 100,
        high: 100,
        low: 100,
        close: 100,
        amount: 9999,
        vol: 3,
        count: 1,
      },
    ]);
    // Prefer vol (base-candidate), never amount fallback as authority.
    expect(bars[0]!.volume).toBe("3");
  });

  it("QUALIFIED permits authoritative base volume (vol)", () => {
    const receipt = qualifyHtxKlineVolumeAuthority({
      symbol: "BTCUSDT",
      rows: qualifiedRows(),
    });
    expect(receipt.verdict).toBe("HTX_VOLUME_AUTHORITY_QUALIFIED");
    assertHtxVolumeCapitalAuthorityPermitsCapacity(receipt);
    const base = resolveAuthoritativeHtxBaseVolumeForCapital({
      receipt,
      amount: 1000,
      vol: 10,
    });
    expect(base).toBe(10);
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
    expect(() =>
      resolveAuthoritativeHtxBaseVolumeForCapital({
        receipt,
        amount: 10,
        vol: 10,
      }),
    ).toThrow(HtxVolumeCapitalAuthorityError);
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
    expect(() =>
      resolveAuthoritativeHtxBaseVolumeForCapital({
        receipt: null,
        amount: 1000,
        vol: 10,
      }),
    ).toThrow(HtxVolumeCapitalAuthorityError);
  });

  it("ambiguous amount/vol cannot obtain capital authority by mapper fallback", () => {
    const receipt = qualifyHtxKlineVolumeAuthority({
      symbol: "BTCUSDT",
      rows: [
        {
          id: 1,
          open: 1,
          high: 1,
          low: 1,
          close: 1,
          amount: 5,
          vol: 5,
          count: 1,
        },
      ],
    });
    expect(receipt.verdict).toBe("HTX_VOLUME_AUTHORITY_BLOCKED_AMBIGUOUS_FIELDS");
    expect(() => assertHtxVolumeAuthorityQualified(receipt)).toThrow();
  });

  it("does not invent QUALIFIED or replacement capacity on block", () => {
    const blocked = qualifyHtxKlineVolumeAuthority({
      symbol: "BTCUSDT",
      rows: [],
    });
    expect(blocked.verdict).toBe("HTX_VOLUME_AUTHORITY_BLOCKED_MISSING_FIELDS");
    expect(blocked.authorityField).toBeNull();
    expect(() => assertHtxVolumeCapitalAuthorityPermitsCapacity(blocked)).toThrow(
      HtxVolumeCapitalAuthorityError,
    );
  });
});
