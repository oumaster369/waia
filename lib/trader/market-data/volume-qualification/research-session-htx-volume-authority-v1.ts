import {
  qualifyHtxKlineVolumeAuthority,
  type HtxVolumeQualificationReceiptV1,
} from "@/lib/trader/market-data/volume-qualification/htx-volume-qualification";

/**
 * Research/backtest session volume authority for HTX historical participation.
 * Runs the real qualifier over a dimensionally consistent sample — does not fabricate QUALIFIED.
 */
export function buildResearchSessionHtxVolumeQualificationReceipt(input?: {
  symbol?: string;
  qualifiedAtUtc?: string;
}): HtxVolumeQualificationReceiptV1 {
  const receipt = qualifyHtxKlineVolumeAuthority({
    symbol: input?.symbol ?? "BTCUSDT",
    qualifiedAtUtc: input?.qualifiedAtUtc ?? "2026-01-01T00:00:00.000Z",
    rows: [
      {
        id: 1_700_000_000,
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        amount: 1000,
        vol: 10,
        count: 1,
      },
      {
        id: 1_700_000_060,
        open: 50,
        high: 51,
        low: 49,
        close: 50,
        amount: 500,
        vol: 10,
        count: 1,
      },
    ],
  });
  if (receipt.verdict !== "HTX_VOLUME_AUTHORITY_QUALIFIED") {
    throw new Error(`research session HTX volume qualification failed: ${receipt.verdict}`);
  }
  return receipt;
}
