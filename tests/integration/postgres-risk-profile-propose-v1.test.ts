import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { cancelStoredProfileProposalV1, readStoredProfileAuthorityV1, refuseStoredProfileActivationV1, reproposeStoredProfileV1, retainProposedRiskAccountProfileV1, revokeStoredProfileAuthorityV1 } from "@/lib/trader/risk/v2/risk-account-profile-command-v1";
import { RiskCurrentAccountRefusedV1 } from "@/lib/trader/risk/v2/risk-account-source-profile-v1";
import {
  createRiskAccountProfileV1,
  riskAccountDigestV1,
  RISK_ACCOUNT_CHANNELS_V1,
  RISK_REFERENCE_METHOD_V1,
  type RiskAccountProfileDraftV1,
} from "@/lib/trader/risk/v2/risk-account-source-profile-v1";

const url = process.env.DATABASE_URL_POSTGRES?.trim();
const enabled = process.env.WAIA_PG_INTEGRATION === "1" && !!url && /waia_dee1121_dee1135_acquisition_/.test(url);
const digest = riskAccountDigestV1;
const start = "2026-09-27T12:00:00.000Z";
const end = "2026-09-27T13:00:00.000Z";

function proposalDraft(organizationId: string, accountId: string): RiskAccountProfileDraftV1 {
  const source = "00000000-0000-4000-8000-000000113502";
  const evidence = {
    sourceId: source, captureReceiptDigest: digest("propose-capture"), storageBindingDigest: digest("propose-storage"),
    validationReceiptDigest: digest("propose-validation"), rawBytesDigest: digest("propose-raw"),
  };
  return {
    organizationId, accountId, credentialId: source, exchangeAccountId: "135", accountSourceId: source,
    venue: "HTX", market: "SPOT", referenceCurrency: "USDT", assets: ["BTC", "USDT"],
    instruments: [{ instrumentIdentityDigestHex: digest("BTC/USDT"), symbol: "BTC/USDT", baseAsset: "BTC", quoteAsset: "USDT", referenceSourceId: source }],
    strategyId: "proposal-only", strategyVersion: "v1",
    sourceContract: {
      evidence, statementDigest: digest("propose-contract"), anchorMethod: "INDEPENDENT_SOURCE_ASSERTED_DATED_ACCOUNT",
      validFromUtc: start, validUntilUtc: end, maxSourceAgeMs: 60000, maxReportClockSkewMs: 0,
      coveredAssetSetDigest: digest(["BTC", "USDT"]),
    },
    mutationBounds: ["BTC", "USDT"].flatMap(asset => RISK_ACCOUNT_CHANNELS_V1.map(channel => ({
      asset, channel, intervalStartUtc: start, intervalEndUtc: end,
      maximumPositiveQuantity: "0.1", maximumNegativeQuantity: "0.1", contractStatementDigest: digest("propose-contract"),
    }))),
    reference: {
      qualification: {
        evidence, methodVersion: RISK_REFERENCE_METHOD_V1, statementDigest: digest("propose-method"),
        validFromUtc: start, validUntilUtc: end,
        reportTimeSemantics: "HTX_RESPONSE_GENERATION_WITH_QUALIFIED_SIDE_AGE_BOUND", venueDependence: "SINGLE_VENUE_HTX",
      },
      windowDurationMs: 1000, slotOffsetsMs: [0, 500], slotToleranceMs: 0, maxSideAgeMs: 10, validityMs: 30000,
    },
    allocation: {
      evidence, statementDigest: digest("NOT_AN_ADOPTED_CAP"), allocationId: "INACTIVE_FIXTURE_ONLY", version: "v1",
      approvedNotional: "1", allowedSymbols: ["BTC/USDT"], validFromUtc: start, validUntilUtc: end,
    },
    governance: { coolingOffMs: 1, reviewReason: "Retained proposal only; not an adopted cap or trading authority" },
    work: { maxRawBytes: 4096, requestTimeoutMs: 1000, maxPages: 20, maxMembers: 50, maxLedgerEvents: 50, retentionSeconds: 3600 },
  };
}

describe.skipIf(!enabled)("profile propose writes no current authority", () => {
  it("retains one proposal and leaves the current pointer empty", async () => {
    const sql = postgres(url!, { max: 1 });
    const accountId = `propose-${randomUUID().slice(0, 8)}`;
    try {
      const [org] = await sql<{ id: string }[]>`select id from organizations limit 1`;
      const [user] = await sql<{ id: string }[]>`select id from users limit 1`;
      expect(org?.id).toBeTruthy();
      expect(user?.id).toBeTruthy();
      const [before] = await sql<{ allowances: number; orders: number; current_rows: number }[]>`select
        (select count(*)::int from trader_risk_allowances_v2) as allowances,
        (select count(*)::int from trader_orders) as orders,
        (select count(*)::int from trader_risk_account_current_v1) as current_rows`;
      const [audit] = await sql<{ id: string }[]>`insert into audit_logs
        (id, actor_type, actor_id, action, entity_type, entity_id, organization_id, metadata_json)
        values (${randomUUID()}::uuid, 'service', ${user!.id}, 'trader.risk_account_profile.propose',
          'trader.risk_account_profile', ${accountId}, ${org!.id}::uuid, '{}'::jsonb)
        returning id`;
      const profile = createRiskAccountProfileV1(proposalDraft(org!.id, accountId));
      const retained = await retainProposedRiskAccountProfileV1(sql, {
        profile, actorId: user!.id, auditId: audit!.id, commandId: randomUUID(),
      });
      expect(retained).toMatchObject({ decision: "RETAINED_NON_AUTHORITY", action: "PROPOSE", currentPointer: null, allowanceId: null, orderId: null });
      const [event] = await sql<{ action: string; n: number }[]>`select action, count(*)::int n
        from trader_risk_account_profile_events_v1 where account_id = ${accountId} group by action`;
      expect(event).toEqual({ action: "PROPOSE", n: 1 });
      expect(await readStoredProfileAuthorityV1(sql, org!.id, accountId)).toEqual({
        action: "PROPOSE", authority: "NONE", currentPointer: null, allocationCopied: false,
      });
      await expect(refuseStoredProfileActivationV1(sql, { organizationId: org!.id, accountId, action: "ACTIVATE" })).rejects.toBeInstanceOf(RiskCurrentAccountRefusedV1);
      const [still] = await sql<{ action: string; n: number }[]>`select action, count(*)::int n
        from trader_risk_account_profile_events_v1 where account_id = ${accountId} group by action`;
      expect(still).toEqual({ action: "PROPOSE", n: 1 });
      const cancelled = await cancelStoredProfileProposalV1(sql, {
        organizationId: org!.id, accountId, actorId: user!.id, auditId: audit!.id, commandId: randomUUID(),
      });
      expect(cancelled).toMatchObject({ decision: "RETAINED_NON_AUTHORITY", action: "CANCEL", currentPointer: null, allowanceId: null, orderId: null });
      expect(await readStoredProfileAuthorityV1(sql, org!.id, accountId)).toEqual({
        action: "CANCEL", authority: "NONE", currentPointer: null, allocationCopied: false,
      });
      await expect(cancelStoredProfileProposalV1(sql, {
        organizationId: org!.id, accountId, actorId: user!.id, auditId: audit!.id, commandId: randomUUID(),
      })).rejects.toBeInstanceOf(RiskCurrentAccountRefusedV1);
      const chain = await sql<{ action: string }[]>`select action from trader_risk_account_profile_events_v1
        where account_id = ${accountId} order by event_sequence`;
      expect(chain.map(row => row.action)).toEqual(["PROPOSE", "CANCEL"]);
      await expect(revokeStoredProfileAuthorityV1(sql, { organizationId: org!.id, accountId })).rejects.toThrow(/PROFILE_AUTHORITY_ABSENT/);
      const afterRevoke = await sql<{ action: string }[]>`select action from trader_risk_account_profile_events_v1
        where account_id = ${accountId} order by event_sequence`;
      expect(afterRevoke.map(row => row.action)).toEqual(["PROPOSE", "CANCEL"]);
      await expect(reproposeStoredProfileV1(sql, {
        organizationId: org!.id, accountId, actorId: user!.id, auditId: audit!.id, commandId: randomUUID(),
        profileDigest: "ab".repeat(32),
      })).rejects.toThrow(/PROFILE_DIGEST_MISMATCH/);
      const reopened = await reproposeStoredProfileV1(sql, {
        organizationId: org!.id, accountId, actorId: user!.id, auditId: audit!.id, commandId: randomUUID(),
        profileDigest: retained.profileDigest,
      });
      expect(reopened).toMatchObject({ decision: "RETAINED_NON_AUTHORITY", action: "PROPOSE", currentPointer: null, allowanceId: null, orderId: null });
      expect(await readStoredProfileAuthorityV1(sql, org!.id, accountId)).toEqual({
        action: "PROPOSE", authority: "NONE", currentPointer: null, allocationCopied: false,
      });
      const reopenedChain = await sql<{ action: string }[]>`select action from trader_risk_account_profile_events_v1
        where account_id = ${accountId} order by event_sequence`;
      expect(reopenedChain.map(row => row.action)).toEqual(["PROPOSE", "CANCEL", "PROPOSE"]);
      await expect(retainProposedRiskAccountProfileV1(sql, {
        profile, actorId: user!.id, auditId: audit!.id, commandId: randomUUID(),
      })).rejects.toThrow(/PROFILE_PROPOSAL_EXISTS/);
      const afterRepeat = await sql<{ action: string }[]>`select action from trader_risk_account_profile_events_v1
        where account_id = ${accountId} order by event_sequence`;
      expect(afterRepeat.map(row => row.action)).toEqual(["PROPOSE", "CANCEL", "PROPOSE"]);
      const [after] = await sql<{ allowances: number; orders: number; current_rows: number }[]>`select
        (select count(*)::int from trader_risk_allowances_v2) as allowances,
        (select count(*)::int from trader_orders) as orders,
        (select count(*)::int from trader_risk_account_current_v1) as current_rows`;
      expect(after).toEqual(before);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
