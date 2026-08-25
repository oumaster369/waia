import { describe, expect, it } from "vitest";

import {
  isValidTronAddress,
  tronScanAddressUrl,
  tronScanTransactionUrl,
} from "@/lib/treasury-admin/explorer";

describe("Treasury TronScan links", () => {
  it("builds links only for strict public Tron identifiers", () => {
    const address = "TYASr5UV6HEcXatwdFQfmLVUqQQQMUxHLS";
    const txHash = "a".repeat(64);
    expect(isValidTronAddress(address)).toBe(true);
    expect(tronScanAddressUrl(address)).toBe(`https://tronscan.org/#/address/${address}`);
    expect(tronScanTransactionUrl(txHash)).toBe(`https://tronscan.org/#/transaction/${txHash}`);
  });

  it("does not turn arbitrary strings into external links", () => {
    expect(tronScanAddressUrl("javascript:alert(1)")).toBeNull();
    expect(tronScanTransactionUrl("../settings")).toBeNull();
  });
});
