import postgres from "postgres";
import { describe, expect, it } from "vitest";
import {
  admitCurrentAccountBasisV1,
  compareExpectedAccountFrontierV1,
  retainObservedFrontierV1,
} from "@/lib/trader/risk/v2/risk-account-reconciliation-v1";

const url = process.env.DATABASE_URL_POSTGRES?.trim();
const enabled =
  process.env.WAIA_PG_INTEGRATION === "1" && !!url && /waia_dee1121_dee1135_acquisition_/.test(url);

describe.skipIf(!enabled)("current-account issue writes no authority", () => {
  it("leaves allowances, orders, and the current pointer unchanged", async () => {
    const sql = postgres(url!, { max: 1 });
    try {
      const counts = async () => {
        const [row] = await sql`select
          (select count(*)::int from trader_risk_allowances_v2) as allowances,
          (select count(*)::int from trader_orders) as orders,
          (select count(*)::int from trader_risk_account_current_v1) as current_rows`;
        return row;
      };
      const before = await counts();
      expect(
        admitCurrentAccountBasisV1(
          retainObservedFrontierV1(
            compareExpectedAccountFrontierV1({
              expectedExposureNotional: "10",
              expectedPendingNotional: "1",
              actualExposureNotional: "12",
              actualPendingNotional: "0",
              sourceMethodQualified: false,
            }),
          ),
        ),
      ).toEqual({
        decision: "REFUSED",
        reason: "LIVE_CAPITAL_ENVELOPE_ABSENT",
        allowanceId: null,
        orderId: null,
      });
      expect(await counts()).toEqual(before);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
