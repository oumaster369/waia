import type postgres from "postgres";
import { describe, expect, it, vi } from "vitest";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";

const controls = vi.hoisted(() => ({ prepare: vi.fn() }));
vi.mock("@/lib/trader/research/execopp-qualification/historical-four-surface-ratified-admission-v2",
  async importOriginal => ({ ...await importOriginal<object>(),
    INTERNAL_prepareHistoricalFourSurfaceTechnicalAuthorityCandidateV2: controls.prepare }));
vi.mock("@/lib/trader/historical-simulation-v2/historical-runner-role-v2", () => ({
  requireHistoricalSimulationRunnerLoginV2: vi.fn(),
  assumeHistoricalSimulationRunnerRoleV2: vi.fn(),
  resetHistoricalSimulationRunnerRoleV2: vi.fn(),
}));

import { HISTORICAL_PROPOSAL_REQUEST_DECISION_V2, HISTORICAL_RATIFICATION_REQUEST_V2,
  prepareHistoricalTechnicalProposalOnExecutionServerV2,
  readHistoricalTechnicalProposalForAdminV2 } from
  "@/lib/trader/historical-simulation-v2/ratification-split-v2";

describe("preparation service failure projection — SQL and scientific boundary mocked", () => {
  it.each([false, true])("preserves the primary failure with durable journal enabled=%s", async (enabled) => {
    const scope = { organizationId: "11111111-1111-4111-8111-111111111111",
      runId: "failed-preparation", releaseSha: "a".repeat(40),
      authenticatedOperatorUserId: "22222222-2222-4222-8222-222222222222" };
    const body = { schemaVersion: HISTORICAL_RATIFICATION_REQUEST_V2,
      organizationId: scope.organizationId, runId: scope.runId, releaseSha: scope.releaseSha,
      operatorUserId: scope.authenticatedOperatorUserId,
      humanDecision: HISTORICAL_PROPOSAL_REQUEST_DECISION_V2,
      executionExtent: { initialRecordIndex: 525600, cycleCount: 35 },
      authorityBoundary: { capitalAuthority: "NONE", liveTradingAuthority: "NONE",
        blindHoldoutAuthority: "FORBIDDEN_NOT_PRESENT_NOT_ACCESSED" } };
    const content_digest_hex = computeSemanticSha256Hex(body);
    const request = { id: "33333333-3333-4333-8333-333333333333", content_digest_hex,
      request_json: { ...body, contentDigestHex: content_digest_hex } };
    const queries: string[] = [];
    const eventPhases: string[] = [];
    const eventQuery = vi.fn(async (_parts: TemplateStringsArray, ...values: unknown[]) => {
      eventPhases.push(String(values[7]));
      return [];
    });
    const eventRelease = vi.fn();
    const eventsPool = Object.assign(vi.fn(), {
      reserve: vi.fn(async () => Object.assign(eventQuery, { release: eventRelease })),
      options: { parsers: {}, serializers: {} }, end: vi.fn(async () => undefined),
    }) as unknown as postgres.Sql;
    const query = vi.fn(async (parts: TemplateStringsArray) => {
      const text = parts.join("?"); queries.push(text);
      if (text.includes("FROM trader_historical_preparation_event_v2") && eventPhases.length) {
        return [{ attempt_id: "44444444-4444-4444-8444-444444444444", phase: "FAILED",
          progress_phase: null, completed: null, total: null, error_code: "CANCELLED",
          observed_at: "2026-09-07T07:00:00.000Z", surface_key: null, trial_identity_digest_hex: null }];
      }
      return text.includes("FROM trader_historical_ratification_request_v2") ? [request] : [];
    });
    const release = vi.fn();
    const reserved = Object.assign(query, { release });
    const pool = Object.assign(vi.fn(), { reserve: vi.fn(async () => reserved),
      options: { parsers: {}, serializers: {} } }) as unknown as postgres.Sql;
    const observedBefore = await readHistoricalTechnicalProposalForAdminV2(
      query as unknown as postgres.Sql, scope);
    const primaryFailure = new Error("TECHNICAL_PREPARATION_CANCELLED");
    controls.prepare.mockRejectedValueOnce(primaryFailure);
    await expect(prepareHistoricalTechnicalProposalOnExecutionServerV2(pool, {
      preflight: { organizationId: scope.organizationId, runId: scope.runId,
        releaseSha: scope.releaseSha } as never,
      launchPlan: { accountId: "historical-only", symbol: "BTCUSDT",
        primaryHorizonMinutes: 30, startingCashUsdt: "10000", defaultQuantity: "0.001",
        initialRecordIndex: 525600, cycleCount: 35 },
    }, {}, enabled ? eventsPool : undefined)).rejects.toBe(primaryFailure);
    const observedAfter = await readHistoricalTechnicalProposalForAdminV2(
      query as unknown as postgres.Sql, scope);
    if (enabled) {
      expect(observedAfter).toMatchObject({ preparationAttempt: {
        phase: "FAILED", errorCode: "CANCELLED", authorityGranted: false } });
      expect(eventPhases).toEqual(["STARTED", "FAILED"]);
      expect(eventRelease).toHaveBeenCalledTimes(2);
    } else {
      // Legacy direct callers without the dedicated journal retain the prior contract.
      expect(observedAfter).toEqual(observedBefore);
    }
    expect(observedAfter.preparationState).toBe("REQUEST_RECORDED");
    expect(queries.some(text => /\bINSERT\b|\bUPDATE\b/.test(text))).toBe(false);
    expect(queries.some(text => text.includes("pg_advisory_unlock"))).toBe(true);
    expect(release).toHaveBeenCalledOnce();
  });
});
