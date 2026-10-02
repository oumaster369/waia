import { describe, expect, it } from "vitest";

import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  buildClosedTradeOutcomeEvidencePackageV2,
  type ClosedTradeOutcomeEvidencePackageV2,
  type ClosedTradeOutcomeInputV2,
} from "@/lib/trader/research-v2/closed-trade-outcome-evidence-v2";
import {
  appendResearchMemoryV2,
  resumeResearchMemoryV2,
  type ResearchMemoryV2,
} from "@/lib/trader/research-v2/research-memory-v2";
import { StrategyEvolutionResearchError } from "@/lib/trader/research-v2/research-v2-guards";

const CUTOFF = "2026-01-10T00:00:00.000Z";
const BEFORE = "2026-01-09T23:59:59.000Z";
const FUTURE = "2026-01-10T00:00:01.000Z";
const DIGEST = "a".repeat(64);

const polarityCases = [
  ["PROFIT", { netEconomicResult: "1" }],
  ["LOSS", { netEconomicResult: "-1" }],
  ["FLAT", { netEconomicResult: "0" }],
  ["INCONCLUSIVE", { netEconomicResult: "4", status: "INCONCLUSIVE" }],
  ["INVALIDATED", { netEconomicResult: "-4", status: "INVALIDATED" }],
] as const;

function outcome(
  outcomeId: string,
  overrides: Partial<ClosedTradeOutcomeInputV2> = {},
): ClosedTradeOutcomeInputV2 {
  return {
    outcomeId,
    closedTradeRef: `trade-${outcomeId}`,
    observedAtUtc: BEFORE,
    netEconomicResult: "1",
    causalContextDigestHex: DIGEST,
    ...overrides,
  };
}

function validMixedPackage(): ClosedTradeOutcomeEvidencePackageV2 {
  return buildClosedTradeOutcomeEvidencePackageV2({
    organizationId: "org-cutoff",
    campaignId: "campaign-cutoff",
    symbol: "BTCUSDT",
    evidenceCutoffUtc: CUTOFF,
    outcomes: [
      outcome("profit", { observedAtUtc: BEFORE, netEconomicResult: "1" }),
      outcome("loss", { observedAtUtc: CUTOFF, netEconomicResult: "-1" }),
      outcome("flat", { observedAtUtc: BEFORE, netEconomicResult: "0" }),
      outcome("inconclusive", {
        observedAtUtc: BEFORE,
        netEconomicResult: "4",
        status: "INCONCLUSIVE",
      }),
      outcome("invalidated", {
        observedAtUtc: BEFORE,
        netEconomicResult: "-4",
        status: "INVALIDATED",
      }),
    ],
  });
}

function packageAt(
  evidenceCutoffUtc: string,
  observedAtUtc: string,
  outcomeId = "outcome",
): ClosedTradeOutcomeEvidencePackageV2 {
  return buildClosedTradeOutcomeEvidencePackageV2({
    organizationId: "org-cutoff",
    campaignId: "campaign-cutoff",
    symbol: "BTCUSDT",
    evidenceCutoffUtc,
    outcomes: [outcome(outcomeId, { observedAtUtc })],
  });
}

function resealPackage(
  value: ClosedTradeOutcomeEvidencePackageV2,
): ClosedTradeOutcomeEvidencePackageV2 {
  const { contentDigestHex: _oldDigest, ...body } = value;
  void _oldDigest;
  return { ...body, contentDigestHex: computeSemanticSha256Hex(body) };
}

function resealMemory(value: ResearchMemoryV2): ResearchMemoryV2 {
  const { contentDigestHex: _oldDigest, ...body } = value;
  void _oldDigest;
  return { ...body, contentDigestHex: computeSemanticSha256Hex(body) };
}

function resealUnknown(value: Record<string, unknown>): Record<string, unknown> {
  const { contentDigestHex: _oldDigest, ...body } = value;
  void _oldDigest;
  return { ...body, contentDigestHex: computeSemanticSha256Hex(body) };
}

describe("DEE-1208 research evidence cutoff", () => {
  it.each(polarityCases)(
    "refuses future %s outcomes instead of admitting them to an earlier snapshot",
    (_polarity, values) => {
      expect(() =>
        buildClosedTradeOutcomeEvidencePackageV2({
          organizationId: "org-cutoff",
          campaignId: "campaign-cutoff",
          symbol: "BTCUSDT",
          evidenceCutoffUtc: CUTOFF,
          outcomes: [outcome(`future-${_polarity.toLowerCase()}`, {
            ...values,
            observedAtUtc: FUTURE,
          })],
        }),
      ).toThrow("RESEARCH_OUTCOME_AFTER_CUTOFF");
    },
  );

  it("accepts exact cutoff equality and preserves valid mixed-polarity canonical bytes", () => {
    const exact = packageAt(CUTOFF, CUTOFF);
    expect(exact.records[0]?.observedAtUtc).toBe(CUTOFF);

    const mixed = validMixedPackage();
    expect(mixed.polaritiesPresent).toEqual([
      "PROFIT",
      "LOSS",
      "FLAT",
      "INCONCLUSIVE",
      "INVALIDATED",
    ]);
    expect(mixed.records).toHaveLength(5);
    expect(mixed.contentDigestHex).toBe(
      "05d94d73b0114e583f4ced89442a66c53cba3f4fef6d0b3fae0f9f34eec0439f",
    );
    expect(JSON.stringify(mixed)).toBe(
      '{"schemaVersion":"waia.trader.closed_trade_outcome_evidence_package.v2","capitalAuthority":"NONE","organizationId":"org-cutoff","campaignId":"campaign-cutoff","symbol":"BTCUSDT","evidenceCutoffUtc":"2026-01-10T00:00:00.000Z","records":[{"outcomeId":"flat","closedTradeRef":"trade-flat","observedAtUtc":"2026-01-09T23:59:59.000Z","netEconomicResult":"0","causalContextDigestHex":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","polarity":"FLAT","evaluationRole":"NEUTRAL"},{"outcomeId":"inconclusive","closedTradeRef":"trade-inconclusive","observedAtUtc":"2026-01-09T23:59:59.000Z","netEconomicResult":"4","causalContextDigestHex":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","polarity":"INCONCLUSIVE","evaluationRole":"NEUTRAL"},{"outcomeId":"invalidated","closedTradeRef":"trade-invalidated","observedAtUtc":"2026-01-09T23:59:59.000Z","netEconomicResult":"-4","causalContextDigestHex":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","polarity":"INVALIDATED","evaluationRole":"CONTRADICTING"},{"outcomeId":"loss","closedTradeRef":"trade-loss","observedAtUtc":"2026-01-10T00:00:00.000Z","netEconomicResult":"-1","causalContextDigestHex":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","polarity":"LOSS","evaluationRole":"CONTRADICTING"},{"outcomeId":"profit","closedTradeRef":"trade-profit","observedAtUtc":"2026-01-09T23:59:59.000Z","netEconomicResult":"1","causalContextDigestHex":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","polarity":"PROFIT","evaluationRole":"SUPPORTING"}],"polaritiesPresent":["PROFIT","LOSS","FLAT","INCONCLUSIVE","INVALIDATED"],"contentDigestHex":"05d94d73b0114e583f4ced89442a66c53cba3f4fef6d0b3fae0f9f34eec0439f"}',
    );
  });

  it("rechecks a deserialized, internally resealed future package at memory ingestion", () => {
    const valid = packageAt(CUTOFF, BEFORE);
    const tampered = resealPackage({
      ...valid,
      records: valid.records.map((row) => ({ ...row, observedAtUtc: FUTURE })),
    });
    const before = JSON.stringify(tampered);
    expect(() => appendResearchMemoryV2(tampered)).toThrow(StrategyEvolutionResearchError);
    expect(JSON.stringify(tampered)).toBe(before);
  });

  it("refuses a valid prior memory whose retained record is after the incoming cutoff", () => {
    const laterPackage = packageAt(FUTURE, FUTURE, "later");
    const prior = appendResearchMemoryV2(laterPackage);
    const incoming = packageAt(CUTOFF, BEFORE, "earlier");
    const priorBefore = JSON.stringify(prior);
    const incomingBefore = JSON.stringify(incoming);
    expect(() => resumeResearchMemoryV2(prior, incoming)).toThrow(
      "RESEARCH_MEMORY_OUTCOME_AFTER_CUTOFF",
    );
    expect(JSON.stringify(prior)).toBe(priorBefore);
    expect(JSON.stringify(incoming)).toBe(incomingBefore);
  });

  it("does not let a resealed future record in prior memory bypass the new cutoff", () => {
    const base = appendResearchMemoryV2(packageAt(CUTOFF, BEFORE, "prior"));
    const tampered = resealMemory({
      ...base,
      records: base.records.map((row) => ({ ...row, observedAtUtc: FUTURE })),
    });
    const incoming = packageAt(CUTOFF, BEFORE, "new");
    const before = JSON.stringify(tampered);
    expect(() => appendResearchMemoryV2(incoming, tampered)).toThrow(StrategyEvolutionResearchError);
    expect(JSON.stringify(tampered)).toBe(before);
  });

  it("refuses malformed timestamps in current packages and prior memory", () => {
    expect(() => packageAt(CUTOFF, "not-a-date")).toThrow(StrategyEvolutionResearchError);
    const base = appendResearchMemoryV2(packageAt(CUTOFF, BEFORE, "prior"));
    const malformed = resealMemory({
      ...base,
      records: base.records.map((row) => ({ ...row, observedAtUtc: "2026-01-10T00:00:00Z" })),
    });
    expect(() =>
      appendResearchMemoryV2(packageAt(CUTOFF, BEFORE, "new"), malformed),
    ).toThrow(StrategyEvolutionResearchError);
  });

  it("rejects corrupt digests and unsupported serialized package or memory envelopes", () => {
    const validPackage = packageAt(CUTOFF, BEFORE, "envelope");
    expect(() => appendResearchMemoryV2({
      ...validPackage,
      contentDigestHex: "0".repeat(64),
    })).toThrow("RESEARCH_EVIDENCE_PACKAGE_INVALID");

    for (const update of [
      { schemaVersion: "waia.trader.closed_trade_outcome_evidence_package.v99" },
      { capitalAuthority: "CAPITAL_ENABLED" },
    ]) {
      const invalid = resealUnknown({ ...validPackage, ...update }) as unknown as
        ClosedTradeOutcomeEvidencePackageV2;
      expect(() => appendResearchMemoryV2(invalid)).toThrow("RESEARCH_EVIDENCE_PACKAGE_INVALID");
    }

    const validMemory = appendResearchMemoryV2(validPackage);
    expect(() => appendResearchMemoryV2(validPackage, {
      ...validMemory,
      contentDigestHex: "0".repeat(64),
    })).toThrow("RESEARCH_MEMORY_INVALID");
    for (const update of [
      { schemaVersion: "waia.trader.research_memory.v99" },
      { authority: "MUTABLE_RESEARCH_MEMORY" },
      { capitalAuthority: "CAPITAL_ENABLED" },
    ]) {
      const invalid = resealUnknown({ ...validMemory, ...update }) as unknown as ResearchMemoryV2;
      expect(() => appendResearchMemoryV2(validPackage, invalid)).toThrow("RESEARCH_MEMORY_INVALID");
    }
  });

  it("snapshots mutable deserialized package and prior-memory records before returning", () => {
    const mutablePackage = JSON.parse(JSON.stringify(packageAt(CUTOFF, BEFORE, "mutable-package"))) as
      ClosedTradeOutcomeEvidencePackageV2;
    const memoryFromPackage = appendResearchMemoryV2(mutablePackage);
    expect(Object.isFrozen(memoryFromPackage.records[0])).toBe(true);
    expect(memoryFromPackage.contentDigestHex).toBe(
      "c433d7a63d0c1b2683107568f7c5aa2bc79371142590ee0e4a7948ce7d871111",
    );
    expect(JSON.stringify(memoryFromPackage)).toBe(
      '{"schemaVersion":"waia.trader.research_memory.v2","capitalAuthority":"NONE","authority":"APPEND_ONLY_RESEARCH_MEMORY","organizationId":"org-cutoff","campaignId":"campaign-cutoff","evidencePackageDigestHex":"efc24a3a2c383e2d61a9366412b31e0e97e9092995e1e975621cd62f17fe082d","records":[{"outcomeId":"mutable-package","closedTradeRef":"trade-mutable-package","observedAtUtc":"2026-01-09T23:59:59.000Z","netEconomicResult":"1","causalContextDigestHex":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","polarity":"PROFIT","evaluationRole":"SUPPORTING"}],"supportingCount":1,"contradictingCount":0,"contentDigestHex":"c433d7a63d0c1b2683107568f7c5aa2bc79371142590ee0e4a7948ce7d871111"}',
    );
    const packageRecord = mutablePackage.records[0] as { observedAtUtc: string };
    packageRecord.observedAtUtc = FUTURE;
    expect(memoryFromPackage.records[0]?.observedAtUtc).toBe(BEFORE);

    const mutablePrior = JSON.parse(JSON.stringify(
      appendResearchMemoryV2(packageAt(CUTOFF, BEFORE, "mutable-prior")),
    )) as ResearchMemoryV2;
    const memoryFromPrior = appendResearchMemoryV2(
      packageAt(CUTOFF, BEFORE, "new-record"),
      mutablePrior,
    );
    expect(Object.isFrozen(
      memoryFromPrior.records.find((row) => row.outcomeId === "mutable-prior"),
    )).toBe(true);
    const priorRecord = mutablePrior.records[0] as { observedAtUtc: string };
    priorRecord.observedAtUtc = FUTURE;
    expect(memoryFromPrior.records.find((row) => row.outcomeId === "mutable-prior")?.observedAtUtc)
      .toBe(BEFORE);
  });

  it("retains ordinary append, identical deduplication, conflict refusal, and losses", () => {
    const first = validMixedPackage();
    const memory = appendResearchMemoryV2(first);
    const duplicate = resumeResearchMemoryV2(memory, first);
    expect(duplicate.records).toEqual(memory.records);
    expect(duplicate.records.some((row) => row.polarity === "LOSS")).toBe(true);

    const conflict = packageAt(CUTOFF, BEFORE, "loss");
    expect(() => appendResearchMemoryV2(conflict, memory)).toThrow(
      "RESEARCH_MEMORY_OUTCOME_CONFLICT",
    );
  });
});
