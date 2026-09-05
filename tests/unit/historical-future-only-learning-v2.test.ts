import { describe, expect, it, vi } from "vitest";

import { prepareHistoricalFutureOnlyForecastV2 } from
  "@/lib/trader/historical-simulation-v2/future-only-learning-v2";
import { buildHistoricalKnowledgeSnapshotAuthorityV2 } from
  "@/lib/trader/intelligence/forecast-v2/historical-knowledge-snapshot-authority-v2";
import { computeSemanticSha256Hex } from
  "@/lib/trader/intelligence/htr-semantic-canonical-json";
import type { HistoricalKnowledgePortV2, HistoricalSimulationV2Cycle } from
  "@/lib/trader/backtest/historical-simulation-v2";

const ORG = "11111111-1111-4111-8111-111111111111";
const RUN = "historical-learning-run";
const PIT = "2026-08-01T01:00:00.000Z";
const digest = (value: string) => value.repeat(64);
const membershipBody = {
  schemaVersion: "waia.trader.historical_dataset_membership.v2" as const,
  organizationId: ORG, cycleId: "cycle-60", manifestSemanticDigestHex: digest("1"),
  sealReceiptDigestHex: digest("2"), partitionDigestHex: digest("3"),
  partitionRawSha256Hex: digest("4"), partition: "WALK_FORWARD" as const,
  symbol: "BTCUSDT" as const, recordIndex: 60, barContentDigestHex: digest("5"),
  sealedCycleContentDigestHex: digest("6"),
};
const cycle: HistoricalSimulationV2Cycle = Object.freeze({
  cycleId: "cycle-60", observedAt: PIT, symbol: "BTCUSDT", referencePrice: "50000",
  datasetMembership: Object.freeze({ ...membershipBody,
    contentDigestHex: computeSemanticSha256Hex(membershipBody) }),
});

function inputFor(knowledgeDigest: string, overrides: Record<string, unknown> = {}) {
  return {
    knowledgeContentDigestHex: knowledgeDigest,
    historicalKnowledgeSnapshotAuthority: buildHistoricalKnowledgeSnapshotAuthorityV2({
      organizationId: ORG, runId: RUN, symbol: "BTCUSDT", pitAnchor: PIT,
      visibleEvidenceCount: knowledgeDigest === digest("b") ? 1 : 0,
      knowledgeContentDigestHex: knowledgeDigest,
    }),
    ...overrides,
  } as never;
}

function knowledge(options: { maturedAt?: string; after?: string } = {}): HistoricalKnowledgePortV2 {
  const before = digest("a");
  const after = options.after ?? digest("b");
  return {
    snapshotAsOf: vi.fn(async (asOf) => ({ asOf, contentDigestHex: before })),
    closeMaturedForecasts: vi.fn(async () => [{
      forecastAuthorityContentDigestHex: digest("c"),
      maturedAt: options.maturedAt ?? "2026-08-01T00:59:00.000Z",
      outcomeContentDigestHex: digest("d"),
    }]),
    applyMaturedClosures: vi.fn(async ({ strictlyBefore }) => ({
      asOf: strictlyBefore, contentDigestHex: after,
    })),
  };
}

describe("Historical future-only outcome learning", () => {
  it("applies a matured outcome before and only to the next PIT-bound Forecast", async () => {
    const port = knowledge();
    const resolveForecastInput = vi.fn(async ({ knowledge: snapshot }) =>
      inputFor(snapshot.contentDigestHex));
    const result = await prepareHistoricalFutureOnlyForecastV2({
      organizationId: ORG, runId: RUN, split: "walk_forward", cycle,
      knowledge: port, resolveForecastInput,
    });

    expect(result.knowledgeBefore.contentDigestHex).toBe(digest("a"));
    expect(result.knowledgeAfterClosure.contentDigestHex).toBe(digest("b"));
    expect(result.closures).toHaveLength(1);
    expect(resolveForecastInput).toHaveBeenCalledWith({ cycle,
      knowledge: result.knowledgeAfterClosure });
    expect(vi.mocked(port.closeMaturedForecasts).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(port.applyMaturedClosures).mock.invocationCallOrder[0]!,
    );
    expect(vi.mocked(port.applyMaturedClosures).mock.invocationCallOrder[0]).toBeLessThan(
      resolveForecastInput.mock.invocationCallOrder[0]!,
    );
    expect(result.forecastInput.knowledgeContentDigestHex).toBe(digest("b"));
  });

  it.each([PIT, "2026-08-01T01:01:00.000Z"])(
    "rejects same-PIT or future outcome evidence at %s",
    async (maturedAt) => {
      await expect(prepareHistoricalFutureOnlyForecastV2({
        organizationId: ORG, runId: RUN, split: "walk_forward", cycle,
        knowledge: knowledge({ maturedAt }), resolveForecastInput: async () => inputFor(digest("b")),
      })).rejects.toThrow("CLOSURE_AUTHORITY");
    },
  );

  it("rejects stale or cross-run Forecast knowledge instead of relaxing admission", async () => {
    await expect(prepareHistoricalFutureOnlyForecastV2({
      organizationId: ORG, runId: RUN, split: "walk_forward", cycle,
      knowledge: knowledge(), resolveForecastInput: async () => inputFor(digest("a")),
    })).rejects.toThrow("FORECAST_KNOWLEDGE_BINDING");

    await expect(prepareHistoricalFutureOnlyForecastV2({
      organizationId: ORG, runId: RUN, split: "walk_forward", cycle,
      knowledge: knowledge(), resolveForecastInput: async () => inputFor(digest("b"), {
        historicalKnowledgeSnapshotAuthority: buildHistoricalKnowledgeSnapshotAuthorityV2({
          organizationId: ORG, runId: "other-run", symbol: "BTCUSDT", pitAnchor: PIT,
          visibleEvidenceCount: 1, knowledgeContentDigestHex: digest("b"),
        }),
      }),
    })).rejects.toThrow("FORECAST_KNOWLEDGE_BINDING");
  });

  it("keeps blind holdout unrepresentable", async () => {
    await expect(prepareHistoricalFutureOnlyForecastV2({
      organizationId: ORG, runId: RUN, split: "blind" as never, cycle,
      knowledge: knowledge(), resolveForecastInput: async () => inputFor(digest("b")),
    })).rejects.toThrow("SCOPE");
  });
});
