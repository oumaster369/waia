import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveWaiaAiTraderFoundationBinding } from "@/lib/ai-gateway/trader-foundation-profile";
import { assembleReasoningContext } from "@/lib/trader/research/assemble-reasoning-context";
import { buildEvolutionCycleMvp } from "@/lib/trader/research/build-evolution-cycle-mvp";
import { buildResearchRejectionRecord } from "@/lib/trader/research/build-research-rejection-record";
import { MarketReasoningGuardrailError } from "@/lib/trader/research/errors";
import {
  RESEARCH_REASONING_AGENTS,
  resolveResearchReasoningAgent,
} from "@/lib/trader/research/market-reasoning-assist-agent";
import {
  runMarketReasoningAssist,
  loadVaultArtifacts,
} from "@/lib/trader/research/run-market-reasoning-assist";
import type { ResearchValidationMetrics } from "@/lib/trader/research/strategy-candidate.types";
import { validateMarketReasoningGuardrails } from "@/lib/trader/research/validate-market-reasoning-guardrails";
import { buildFakeMarketReasoningProposalDraft } from "@/lib/trader/research/build-market-reasoning-proposal";
import { serializeResearchRejectionRecord } from "@/lib/trader/research/serialize-research-rejection-record";
import { serializeEvolutionCycleMvp } from "@/lib/trader/research/serialize-evolution-cycle-mvp";

type Org0Fixture = {
  organizationId: string;
  strategyId: string;
  strategyVersion: string;
  candidateId: string;
  datasetId: string;
  backtestRunId: string;
  blindValidationResultId: string;
  failureMessage: string;
  blindConsumed: boolean;
  walkForwardWindowCount: number;
  validationMetrics: ResearchValidationMetrics;
  walkForwardMetrics: ResearchValidationMetrics[];
  blindMetrics: ResearchValidationMetrics;
};

function loadOrg0Fixture(): Org0Fixture {
  const path = resolve(
    process.cwd(),
    "tests/fixtures/evolution/org0-mean-reversion-rejection.json",
  );
  return JSON.parse(readFileSync(path, "utf8")) as Org0Fixture;
}

function buildOrg0VaultArtifacts(): {
  rejectionRecord: ReturnType<typeof buildResearchRejectionRecord>;
  evolutionCycle: ReturnType<typeof buildEvolutionCycleMvp>;
} {
  const fixture = loadOrg0Fixture();
  const rejectionRecord = buildResearchRejectionRecord({
    organizationId: fixture.organizationId,
    strategyId: fixture.strategyId,
    strategyVersion: fixture.strategyVersion,
    candidateId: fixture.candidateId,
    datasetId: fixture.datasetId,
    backtestRunId: fixture.backtestRunId,
    blindValidationResultId: fixture.blindValidationResultId,
    failureCode: "MULTI_REGIME_COVERAGE_INSUFFICIENT",
    failureMessage: fixture.failureMessage,
    blindConsumed: fixture.blindConsumed,
    walkForwardWindowCount: fixture.walkForwardWindowCount,
    validationMetrics: fixture.validationMetrics,
    walkForwardMetrics: fixture.walkForwardMetrics,
    blindMetrics: fixture.blindMetrics,
  });
  const evolutionCycle = buildEvolutionCycleMvp({ rejectionRecord });
  return { rejectionRecord, evolutionCycle };
}

function writeVaultDir(
  dir: string,
  rejectionRecord: ReturnType<typeof buildResearchRejectionRecord>,
  evolutionCycle: ReturnType<typeof buildEvolutionCycleMvp>,
): void {
  writeFileSync(
    join(dir, "research-rejection-record.json"),
    serializeResearchRejectionRecord(rejectionRecord),
    "utf8",
  );
  writeFileSync(
    join(dir, "evolution-cycle-mvp.json"),
    serializeEvolutionCycleMvp(evolutionCycle),
    "utf8",
  );
}

describe("market reasoning assist (SEE-R1)", () => {
  it("assembles reasoning context with R1 subset and empty future slots", () => {
    const { rejectionRecord, evolutionCycle } = buildOrg0VaultArtifacts();
    const context = assembleReasoningContext({
      rejectionRecord,
      evolutionCycle,
      assembledAt: "2026-07-03T00:00:00.000Z",
    });

    expect(context.schemaVersion).toBe("waia.trader.reasoning-context.v1");
    expect(context.contextBody.previousRejections).toEqual([]);
    expect(context.contextBody.previousHypotheses).toEqual([]);
    expect(context.contextBody.productionKnowledgeAssets).toEqual([]);
    expect(context.contextBody.marketKnowledge).toEqual([]);
    expect(context.contextBody.marketStatistics).toBeNull();
    expect(context.contextBody.chartSnapshots).toEqual([]);
    expect(context.contextBody.walkForwardSummary.windowCount).toBe(1296);
    expect(context.contextBody.validationMetrics.tradeCount).toBe(
      rejectionRecord.recordBody.validationMetrics.tradeCount,
    );
    expect(context.envelope.contentDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces stable reasoning context digest for fixed assembledAt", () => {
    const { rejectionRecord, evolutionCycle } = buildOrg0VaultArtifacts();
    const a = assembleReasoningContext({
      rejectionRecord,
      evolutionCycle,
      assembledAt: "2026-07-03T00:00:00.000Z",
    });
    const b = assembleReasoningContext({
      rejectionRecord,
      evolutionCycle,
      assembledAt: "2026-07-03T00:00:00.000Z",
    });
    expect(a.envelope.contentDigest).toBe(b.envelope.contentDigest);
  });

  it("runs assist end-to-end with fake provider and writes vault artifacts", async () => {
    const vaultDir = mkdtempSync(join(tmpdir(), "see-r1-vault-"));
    try {
      const { rejectionRecord, evolutionCycle } = buildOrg0VaultArtifacts();
      writeVaultDir(vaultDir, rejectionRecord, evolutionCycle);

      const result = await runMarketReasoningAssist({
        vaultDir,
        assembledAt: "2026-07-03T00:00:00.000Z",
      });

      expect(result.providerId).toBe("fake");
      expect(result.proposal.schemaVersion).toBe("waia.trader.market-reasoning-proposal.v1");
      expect(result.proposal.proposalBody.humanReview.disposition).toBe("pending");
      expect(result.proposal.proposalBody.inputArtifactDigests.reasoningContext).toBe(
        result.reasoningContext.envelope.contentDigest,
      );
      expect(readFileSync(result.reasoningContextPath, "utf8")).toContain("reasoning-context.v1");
      expect(readFileSync(result.proposalPath, "utf8")).toContain("market-reasoning-proposal.v1");
    } finally {
      rmSync(vaultDir, { recursive: true, force: true });
    }
  });

  it("Org-0 replay vault loads when present", () => {
    const vaultDir = resolve(process.cwd(), "replay-runs/RI-P7/dee-371-artifact-check");
    try {
      readFileSync(join(vaultDir, "research-rejection-record.json"));
    } catch {
      return;
    }
    const loaded = loadVaultArtifacts(vaultDir);
    const context = assembleReasoningContext({
      rejectionRecord: loaded.rejectionRecord,
      evolutionCycle: loaded.evolutionCycle,
    });
    expect(context.contextBody.rejectionRecord.recordBody.failureCode).toBe(
      "MULTI_REGIME_COVERAGE_INSUFFICIENT",
    );
    expect(context.contextBody.rejectionRecord.recordBody.missingBuckets).toEqual([
      "non_trending",
      "down_regime",
    ]);
  });

  it("guardrails reject promotion language", () => {
    const { rejectionRecord, evolutionCycle } = buildOrg0VaultArtifacts();
    const context = assembleReasoningContext({ rejectionRecord, evolutionCycle });
    const draft = buildFakeMarketReasoningProposalDraft(context);
    const bad = {
      ...draft,
      reasoningSummary: "promote this strategy to live immediately",
    };
    expect(() =>
      validateMarketReasoningGuardrails({
        rawProviderJson: bad,
        expectedInputDigests: {
          rejectionRecord: context.envelope.sourceArtifactDigests.rejectionRecord,
          evolutionCycle: context.envelope.sourceArtifactDigests.evolutionCycle,
          reasoningContext: context.envelope.contentDigest,
        },
      }),
    ).toThrow(MarketReasoningGuardrailError);
  });

  it("guardrails reject trading instructions", () => {
    const { rejectionRecord, evolutionCycle } = buildOrg0VaultArtifacts();
    const context = assembleReasoningContext({ rejectionRecord, evolutionCycle });
    const draft = buildFakeMarketReasoningProposalDraft(context);
    const bad = {
      ...draft,
      marketExplanation: "place order now on BTC",
    };
    expect(() =>
      validateMarketReasoningGuardrails({
        rawProviderJson: bad,
        expectedInputDigests: {
          rejectionRecord: context.envelope.sourceArtifactDigests.rejectionRecord,
          evolutionCycle: context.envelope.sourceArtifactDigests.evolutionCycle,
          reasoningContext: context.envelope.contentDigest,
        },
      }),
    ).toThrow(MarketReasoningGuardrailError);
  });

  it("guardrails reject executable commands", () => {
    const { rejectionRecord, evolutionCycle } = buildOrg0VaultArtifacts();
    const context = assembleReasoningContext({ rejectionRecord, evolutionCycle });
    const draft = buildFakeMarketReasoningProposalDraft(context);
    const bad = {
      ...draft,
      reasoningSummary: "run pnpm trader:ri:campaign next",
    };
    expect(() =>
      validateMarketReasoningGuardrails({
        rawProviderJson: bad,
        expectedInputDigests: {
          rejectionRecord: context.envelope.sourceArtifactDigests.rejectionRecord,
          evolutionCycle: context.envelope.sourceArtifactDigests.evolutionCycle,
          reasoningContext: context.envelope.contentDigest,
        },
      }),
    ).toThrow(MarketReasoningGuardrailError);
  });

  it("guardrails reject missing falsification conditions", () => {
    const { rejectionRecord, evolutionCycle } = buildOrg0VaultArtifacts();
    const context = assembleReasoningContext({ rejectionRecord, evolutionCycle });
    const draft = buildFakeMarketReasoningProposalDraft(context);
    const bad = {
      ...draft,
      recommendedNextHypothesis: {
        ...draft.recommendedNextHypothesis,
        falsificationConditions: ["only one"],
      },
    };
    expect(() =>
      validateMarketReasoningGuardrails({
        rawProviderJson: bad,
        expectedInputDigests: {
          rejectionRecord: context.envelope.sourceArtifactDigests.rejectionRecord,
          evolutionCycle: context.envelope.sourceArtifactDigests.evolutionCycle,
          reasoningContext: context.envelope.contentDigest,
        },
      }),
    ).toThrow(MarketReasoningGuardrailError);
  });

  it("trader foundation resolver does not read Twin OpenAI key env var", () => {
    const prevTwinKey = process.env.WAIA_AI_OPENAI_API_KEY;
    const prevTraderKey = process.env.WAIA_AI_TRADER_OPENAI_API_KEY;
    const prevFoundation = process.env.WAIA_AI_TRADER_GATEWAY_FOUNDATION;
    const prevReasoning = process.env.WAIA_TRADER_SEE_AI_REASONING;
    const prevProvider = process.env.WAIA_AI_TRADER_PROVIDER;
    try {
      process.env.WAIA_AI_OPENAI_API_KEY = "twin-key-should-not-be-used";
      delete process.env.WAIA_AI_TRADER_OPENAI_API_KEY;
      process.env.WAIA_AI_TRADER_GATEWAY_FOUNDATION = "1";
      process.env.WAIA_TRADER_SEE_AI_REASONING = "1";
      process.env.WAIA_AI_TRADER_PROVIDER = "openai-compatible";
      const binding = resolveWaiaAiTraderFoundationBinding();
      expect(binding.providerId).toBe("fake");
    } finally {
      if (prevTwinKey === undefined) {
        delete process.env.WAIA_AI_OPENAI_API_KEY;
      } else {
        process.env.WAIA_AI_OPENAI_API_KEY = prevTwinKey;
      }
      if (prevTraderKey === undefined) {
        delete process.env.WAIA_AI_TRADER_OPENAI_API_KEY;
      } else {
        process.env.WAIA_AI_TRADER_OPENAI_API_KEY = prevTraderKey;
      }
      if (prevFoundation === undefined) {
        delete process.env.WAIA_AI_TRADER_GATEWAY_FOUNDATION;
      } else {
        process.env.WAIA_AI_TRADER_GATEWAY_FOUNDATION = prevFoundation;
      }
      if (prevReasoning === undefined) {
        delete process.env.WAIA_TRADER_SEE_AI_REASONING;
      } else {
        process.env.WAIA_TRADER_SEE_AI_REASONING = prevReasoning;
      }
      if (prevProvider === undefined) {
        delete process.env.WAIA_AI_TRADER_PROVIDER;
      } else {
        process.env.WAIA_AI_TRADER_PROVIDER = prevProvider;
      }
    }
  });

  it("registers single research reasoning agent", () => {
    expect(Object.keys(RESEARCH_REASONING_AGENTS)).toEqual(["market-reasoning-assist"]);
    expect(resolveResearchReasoningAgent("market-reasoning-assist").agentId).toBe(
      "market-reasoning-assist",
    );
  });
});
