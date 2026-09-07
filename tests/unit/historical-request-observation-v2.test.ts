import type postgres from "postgres";
import { describe, expect, it, vi } from "vitest";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { HISTORICAL_PROPOSAL_REQUEST_DECISION_V2, HISTORICAL_RATIFICATION_REQUEST_V2,
  readHistoricalTechnicalProposalForAdminV2 } from
  "@/lib/trader/historical-simulation-v2/ratification-split-v2";

const scope = { organizationId: "11111111-1111-4111-8111-111111111111",
  runId: "recorded-request", releaseSha: "a".repeat(40),
  authenticatedOperatorUserId: "22222222-2222-4222-8222-222222222222" };
function row(overrides: Record<string, unknown> = {}) {
  const body = { schemaVersion: HISTORICAL_RATIFICATION_REQUEST_V2,
    organizationId: scope.organizationId, runId: scope.runId, releaseSha: scope.releaseSha,
    operatorUserId: scope.authenticatedOperatorUserId,
    humanDecision: HISTORICAL_PROPOSAL_REQUEST_DECISION_V2,
    executionExtent: { initialRecordIndex: 525600, cycleCount: 35 },
    authorityBoundary: { capitalAuthority: "NONE", liveTradingAuthority: "NONE",
      blindHoldoutAuthority: "FORBIDDEN_NOT_PRESENT_NOT_ACCESSED" }, ...overrides };
  const digest = computeSemanticSha256Hex(body);
  return { id: "33333333-3333-4333-8333-333333333333",
    request_json: { ...body, contentDigestHex: digest }, content_digest_hex: digest };
}
function sqlMock(requests: unknown[], proposals: unknown[] = []) {
  const sql = vi.fn().mockResolvedValueOnce(requests).mockResolvedValueOnce(proposals);
  return { sql, port: sql as unknown as postgres.Sql };
}

describe("authenticated durable historical request observation (SQL boundary mocked)", () => {
  it("distinguishes no request without reading proposal or approval", async () => {
    const { sql, port } = sqlMock([]);
    expect(await readHistoricalTechnicalProposalForAdminV2(port, scope)).toEqual({
      preparationState: "NOT_REQUESTED", proposalAvailable: false });
    expect(sql).toHaveBeenCalledOnce();
    expect(sql.mock.calls[0]?.slice(1)).toEqual([scope.organizationId, scope.runId, scope.releaseSha]);
  });
  it("returns only validated recorded intent, not a running or ratified state", async () => {
    const request = row();
    const { sql, port } = sqlMock([request]);
    const result = await readHistoricalTechnicalProposalForAdminV2(port, scope);
    expect(result).toEqual({ preparationState: "REQUEST_RECORDED", proposalAvailable: false,
      requestId: request.id, requestedExtent: { initialRecordIndex: 525600, cycleCount: 35 } });
    expect(sql).toHaveBeenCalledTimes(2);
    expect(Object.isFrozen(result)).toBe(true);
  });
  it.each(["organizationId", "runId", "releaseSha", "operatorUserId"])(
    "refuses a sealed wrong %s before reading proposal", async (field) => {
      const { sql, port } = sqlMock([row({ [field]: "different-binding" })]);
      await expect(readHistoricalTechnicalProposalForAdminV2(port, scope)).rejects.toThrow(/BINDING/);
      expect(sql).toHaveBeenCalledOnce();
    });
  it("does not confuse corrupted or duplicate request rows with absence", async () => {
    for (const rows of [[{ ...row(), content_digest_hex: "b".repeat(64) }], [row(), row()]]) {
      await expect(readHistoricalTechnicalProposalForAdminV2(sqlMock(rows).port, scope))
        .rejects.toThrow("REQUEST_INTEGRITY");
    }
    const changed = row();
    changed.request_json.executionExtent.cycleCount = 99;
    await expect(readHistoricalTechnicalProposalForAdminV2(sqlMock([changed]).port, scope))
      .rejects.toThrow("DIGEST");
  });
  it("does not confuse mismatched proposal rows with pending preparation", async () => {
    const { port } = sqlMock([row()], [{ proposal_json: { requestId: "different" } }]);
    await expect(readHistoricalTechnicalProposalForAdminV2(port, scope)).rejects.toThrow("PROPOSAL_MISSING");
  });
});
