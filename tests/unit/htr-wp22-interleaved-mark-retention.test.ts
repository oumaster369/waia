import { describe, expect, it } from "vitest";

import {
  attachClosed1mMarkToAccountingBridge,
  createHtrAccountingCycleBridge,
} from "@/lib/trader/accounting/htr-accounting-cycle-bridge";
import {
  makeWp17Bar,
  makeWp17QualifiedHtxVolumeAuthority,
} from "@/tests/unit/helpers/wp17-execution-fixtures";

describe("HTR-WP22 interleaved mark retention", () => {
  it("keeps the BTC mark when an ETH bar arrives with an open BTC position", () => {
    const bridge = createHtrAccountingCycleBridge({
      organizationId: "00000000-0000-4000-8000-000000000022",
      accountKey: "htr-wp22-mark-retention",
      runId: "run-wp22-mark-retention",
    });
    bridge.state.positions.BTCUSDT = {
      quantity: "0.25000000",
      grossPositionBasis: "16250.00",
      netPositionBasis: "16250.00",
    };
    const btcBar = makeWp17Bar(0, { symbol: "BTC/USDT", close: "65000.00" });
    const ethBar = makeWp17Bar(0, { symbol: "ETH/USDT", close: "3200.00" });
    attachClosed1mMarkToAccountingBridge(bridge, btcBar, 0);
    attachClosed1mMarkToAccountingBridge(bridge, ethBar, 1);
    expect(bridge.lastMarkBySymbol.BTCUSDT?.price).toBe("65000.00");
    expect(bridge.lastMarkBySymbol.ETHUSDT?.price).toBe("3200.00");
    expect(bridge.state.marks.BTCUSDT?.price).toBe("65000.00");
    // ETH has no open position, so attached state.marks stay BTC-only.
    expect(bridge.state.marks.ETHUSDT).toBeUndefined();
  });

  it("qualifies HTX authority from a valid same-instrument reference for invalid bars", () => {
    const zero = makeWp17Bar(2, { volume: "0" });
    const negative = makeWp17Bar(3, { volume: "-1" });
    expect(makeWp17QualifiedHtxVolumeAuthority(zero).htxVolumeAuthorityReceipt.verdict).toBe(
      "HTX_VOLUME_AUTHORITY_QUALIFIED",
    );
    expect(makeWp17QualifiedHtxVolumeAuthority(negative).htxVolumeAuthorityReceipt.verdict).toBe(
      "HTX_VOLUME_AUTHORITY_QUALIFIED",
    );
    expect(makeWp17QualifiedHtxVolumeAuthority(zero).htxVolumeRaw.vol).toBe(0);
    expect(makeWp17QualifiedHtxVolumeAuthority(negative).htxVolumeRaw.vol).toBe(-1);
  });
});
