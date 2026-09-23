import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ADMIN_REASON } from "@/lib/trader/admin-console/reason-codes";
import {
  GUARDIAN_FRESH_MS,
  presentGuardian,
  presentOpenPosition,
} from "@/lib/trader/admin-console/read-models/positions";

const NOW = new Date("2026-09-23T12:00:00.000Z");
const LOT = {
  id: "lot-1",
  organizationId: "org-1",
  symbol: "BTCUSDT",
  venue: "htx",
  positionSide: "LONG",
  openQty: "1.25000000",
  remainingQty: "0.50000000",
  avgCost: "100.00",
  openedAt: "2026-09-23T11:00:00.000Z",
  now: NOW,
};

describe("open positions", () => {
  it("keeps quantities as text and separates a fresh Guardian assessment", () => {
    const row = presentOpenPosition({
      ...LOT,
      guardian: {
        assessmentId: "g-1",
        assessedAt: new Date(NOW.getTime() - 60_000).toISOString(),
        recommendation: "HOLD",
        openPositionSufficiency: "SUFFICIENT",
        newOpportunitySufficiency: "INSUFFICIENT",
      },
      attribution: {
        state: "attributed",
        mode: "paper",
        exchangeAccountId: "acct-1",
        organizationId: "org-1",
      },
    });
    expect(row.openQty).toBe("1.25000000");
    expect(row.remainingQty).toBe("0.50000000");
    expect(row.avgCost).toBe("100.00");
    expect(row.guardian.freshness).toBe("fresh");
    expect(row.guardian.recommendation).toBe("HOLD");
    expect(row.guardian.openPositionSufficiency).toBe("SUFFICIENT");
    expect(row.guardian.newOpportunitySufficiency).toBe("INSUFFICIENT");
    expect(row.attribution.label).toBe("acct-1");
    expect(row.riskPermission.reason).toBe(ADMIN_REASON.riskPermissionNotLinked);
    expect(row.executedReduction.reason).toBe(ADMIN_REASON.executedReductionNotLinked);
  });

  it("marks a missing or old Guardian assessment stale and an unlinked lot unallocated", () => {
    const missing = presentGuardian(null, NOW);
    expect(missing.reason).toBe(ADMIN_REASON.guardianAssessmentMissing);
    const stale = presentGuardian(
      {
        assessmentId: "g-2",
        assessedAt: new Date(NOW.getTime() - GUARDIAN_FRESH_MS - 1).toISOString(),
        recommendation: "REDUCE",
        openPositionSufficiency: "SUFFICIENT",
        newOpportunitySufficiency: "SUFFICIENT",
      },
      NOW,
    );
    expect(stale.freshness).toBe("stale");
    expect(stale.recommendation).toBe("REDUCE");
    const row = presentOpenPosition({
      ...LOT,
      guardian: null,
      attribution: { state: "unattributed", reason: ADMIN_REASON.unattributed },
    });
    expect(row.attribution.label).toBe("Не распределено");
    expect(row.guardian.reason).toBe(ADMIN_REASON.guardianAssessmentMissing);
  });

  it("does not select credential secrets or Guardian payloads", () => {
    const source = readFileSync(
      path.join(process.cwd(), "lib/trader/admin-console/handlers/positions.ts"),
      "utf8",
    );
    expect(source).not.toContain("encrypted_payload");
    expect(source).not.toContain("wrapped_dek");
    expect(source).not.toContain("canonical_json");
    expect(source).not.toContain("opening_causal_lineage_json");
    expect(source).toContain("DISTINCT ON (organization_id, lot_id)");
  });
});
