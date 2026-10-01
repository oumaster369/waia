import { describe, expect, it } from "vitest";

import {
  issuedAllowanceKillSwitchBindDispositionV2,
  issuedAllowanceRefusalTerminalizesStoredRowV2,
} from "@/lib/trader/risk/v2/risk-allowance-repository-postgres";

describe("kill switch bind of an issued allowance", () => {
  it("terminalizes only an ISSUED row and still classifies the kill reason", () => {
    expect(issuedAllowanceKillSwitchBindDispositionV2("ISSUED")).toBe("TERMINALIZE");
    expect(issuedAllowanceKillSwitchBindDispositionV2("CONSUMED")).toBe("THROW");
    expect(issuedAllowanceKillSwitchBindDispositionV2("REVOKED")).toBe("THROW");
    expect(issuedAllowanceKillSwitchBindDispositionV2(null)).toBe("THROW");
    expect(issuedAllowanceKillSwitchBindDispositionV2(undefined)).toBe("THROW");
    expect(issuedAllowanceRefusalTerminalizesStoredRowV2("KILL_SWITCH_TRIPPED")).toBe(true);
  });
});
