import postgres from "postgres";
import { describe, expect, it } from "vitest";
import {
  admitCurrentAccountBasisV1,
  compareExpectedAccountFrontierV1,
  holdUnpublishedInclusionsV1,
  observeSealedExpectedFrontierV1,
  retainObservedFrontierV1,
} from "@/lib/trader/risk/v2/risk-account-reconciliation-v1";
import { readCurrentAccountAuthorityV1 } from "@/lib/trader/risk/v2/risk-current-account-read-v1";
import { gateCurrentAccountExecutionBindV1 } from "@/lib/trader/risk/v2/risk-account-profile-command-v1";

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
  it("reads an absent current pointer as not current", async () => {
    const sql = postgres(url!, { max: 1 });
    try {
      const [count] = await sql`select count(*)::int n from trader_risk_account_current_v1`;
      expect(count!.n).toBe(0);
      expect(await readCurrentAccountAuthorityV1(sql, "00000000-0000-4000-8000-000000113501", "missing-account"))
        .toEqual({ current: false, reason: "NO_CURRENT_POINTER" });
      const before = await sql`select
        (select count(*)::int from trader_risk_allowances_v2) as allowances,
        (select count(*)::int from trader_orders) as orders,
        (select count(*)::int from trader_risk_account_current_v1) as current_rows,
        (select count(*)::int from trader_risk_account_profile_events_v1) as events`;
      expect(await gateCurrentAccountExecutionBindV1(sql, "00000000-0000-4000-8000-000000113501", "missing-account"))
        .toEqual({ decision: "REFUSED", reason: "NO_CURRENT_POINTER", bindInvoked: false });
      expect(await sql`select
        (select count(*)::int from trader_risk_allowances_v2) as allowances,
        (select count(*)::int from trader_orders) as orders,
        (select count(*)::int from trader_risk_account_current_v1) as current_rows,
        (select count(*)::int from trader_risk_account_profile_events_v1) as events`).toEqual(before);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
  it("observes a sealed Expected frontier and still writes nothing", async () => {
    const sql = postgres(url!, { max: 1 });
    try {
      const before = await sql`select
        (select count(*)::int from trader_risk_allowances_v2) as allowances,
        (select count(*)::int from trader_orders) as orders,
        (select count(*)::int from trader_risk_account_current_v1) as current_rows`;
      const observed = observeSealedExpectedFrontierV1({
        expected: {
          stateVersion: "1", nextAdmissionSequence: "1", nextEventSequence: "1", eventHeadDigest: null,
          reconciledExposureNotional: "10", pendingExposureNotional: "1", reservationNotional: "0", obligations: [],
        },
        actualExposureNotional: "12", actualPendingNotional: "0", sourceMethodQualified: false,
        externalDebtNotional: null,
      });
      expect(() => observeSealedExpectedFrontierV1({
        expected: {
          stateVersion: "1", nextAdmissionSequence: "1", nextEventSequence: "1", eventHeadDigest: null,
          reconciledExposureNotional: "10", pendingExposureNotional: "1", reservationNotional: "0", obligations: [],
        },
        actualExposureNotional: "12", actualPendingNotional: "0", sourceMethodQualified: false,
        externalDebtNotional: "0",
      })).toThrow();
      expect(observed.publication).toEqual({ decision: "REFUSED", reason: "LIVE_CAPITAL_ENVELOPE_ABSENT" });
      expect(admitCurrentAccountBasisV1(retainObservedFrontierV1(observed))).toEqual({
        decision: "REFUSED", reason: "LIVE_CAPITAL_ENVELOPE_ABSENT", allowanceId: null, orderId: null,
      });
      expect(await sql`select
        (select count(*)::int from trader_risk_allowances_v2) as allowances,
        (select count(*)::int from trader_orders) as orders,
        (select count(*)::int from trader_risk_account_current_v1) as current_rows`).toEqual(before);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
  it("holds an inclusion unpublished and writes no inclusion row", async () => {
    const sql = postgres(url!, { max: 1 });
    try {
      const [before] = await sql`select count(*)::int n from trader_risk_account_inclusions_v1`;
      const id = "ab".repeat(32);
      expect(holdUnpublishedInclusionsV1({ truthRecordIds: [id], alreadyDisposedTruthIds: [] })).toEqual({
        disposition: "HELD_UNPUBLISHED", truthRecordIds: [id], inclusionWrite: null, currentPointer: null,
      });
      const [after] = await sql`select count(*)::int n from trader_risk_account_inclusions_v1`;
      expect(after!.n).toBe(before!.n);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
