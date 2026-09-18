import { describe, expect, it } from "vitest";

import {
  KNOWLEDGE_AUTHORITY_REASON,
  KNOWLEDGE_EDGE_VERSION_REASON_CLASSES,
  computeKnowledgeEdgeVersionContentDigestHex,
  isKnowledgeEdgeVersionReasonClass,
  planKnowledgeEdgeVersionAppend,
  type KnowledgeEdgeEpistemicContent,
  type KnowledgeEdgeVersionSnapshot,
} from "@/lib/trader/knowledge/knowledge-edge-version-v2";

const RECEIPT = "a".repeat(64);
const PIT = new Date("2026-01-01T00:00:00.000Z");
const RECORDED = new Date("2026-01-02T00:00:00.000Z");

const baseContent: KnowledgeEdgeEpistemicContent = {
  fromRef: "from:a",
  toRef: "to:b",
  relationKind: "observes",
  confidence: "0.7000",
  strength: "1",
  regimeScope: "ALL",
  failureCasesJson: "[]",
  hypothesisId: null,
  verified: true,
  lifecycleState: "ACTIVE",
};

function snapshot(
  content: KnowledgeEdgeEpistemicContent,
  version = 1,
): KnowledgeEdgeVersionSnapshot {
  return {
    version,
    content,
    contentDigestHex: computeKnowledgeEdgeVersionContentDigestHex(content),
    reasonClass: "INITIAL_ASSERTION",
  };
}

describe("DEE-771 Knowledge edge version planner", () => {
  it("accepts every closed reason class and refuses every other value", () => {
    const current = snapshot(baseContent);
    for (const reasonClass of KNOWLEDGE_EDGE_VERSION_REASON_CLASSES) {
      expect(isKnowledgeEdgeVersionReasonClass(reasonClass)).toBe(true);
      const nextContent =
        reasonClass === "RETIRED"
          ? { ...baseContent, lifecycleState: "RETIRED" as const }
          : reasonClass === "OPERATOR_GOVERNED_CORRECTION"
            ? { ...baseContent, strength: "2" }
            : baseContent;
      const expectedVersion = reasonClass === "INITIAL_ASSERTION" ? 0 : 1;
      const plan = planKnowledgeEdgeVersionAppend(
        reasonClass === "INITIAL_ASSERTION" ? null : current,
        {
          reasonClass,
          producedByReceiptDigestHex: RECEIPT,
          expectedVersion,
          nextContent,
          pitEventAt: PIT,
          recordedAt: RECORDED,
        },
      );
      expect(plan.ok).toBe(true);
    }
    expect(
      planKnowledgeEdgeVersionAppend(null, {
        reasonClass: "PNL_REINFORCEMENT",
        producedByReceiptDigestHex: RECEIPT,
        expectedVersion: 0,
        nextContent: baseContent,
        pitEventAt: PIT,
        recordedAt: RECORDED,
      }),
    ).toEqual({ ok: false, code: KNOWLEDGE_AUTHORITY_REASON.REASON_CLASS_INVALID });
  });

  it("is byte-identical across wall-clock for the same epistemic content", () => {
    const first = computeKnowledgeEdgeVersionContentDigestHex(baseContent);
    const second = computeKnowledgeEdgeVersionContentDigestHex({ ...baseContent });
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(
      computeKnowledgeEdgeVersionContentDigestHex({
        ...baseContent,
        confidence: "0.7001",
      }),
    ).not.toBe(first);
  });

  it("refuses an unresolvable producing receipt", () => {
    expect(
      planKnowledgeEdgeVersionAppend(null, {
        reasonClass: "INITIAL_ASSERTION",
        producedByReceiptDigestHex: "not-a-digest",
        expectedVersion: 0,
        nextContent: baseContent,
        pitEventAt: PIT,
        recordedAt: RECORDED,
      }),
    ).toEqual({ ok: false, code: KNOWLEDGE_AUTHORITY_REASON.PRODUCING_RECEIPT_UNRESOLVABLE });
  });

  it("refuses a stale expected version and keeps the planner deterministic", () => {
    const current = snapshot(baseContent);
    expect(
      planKnowledgeEdgeVersionAppend(current, {
        reasonClass: "EVIDENCE_ONLY_ZERO_DELTA",
        producedByReceiptDigestHex: RECEIPT,
        expectedVersion: 0,
        nextContent: baseContent,
        pitEventAt: PIT,
        recordedAt: RECORDED,
      }),
    ).toEqual({ ok: false, code: KNOWLEDGE_AUTHORITY_REASON.STALE_VERSION });
  });

  it("treats the same digest+reason as an idempotent no-op", () => {
    const current = snapshot(baseContent);
    const plan = planKnowledgeEdgeVersionAppend(current, {
      reasonClass: "INITIAL_ASSERTION",
      producedByReceiptDigestHex: RECEIPT,
      expectedVersion: 1,
      nextContent: baseContent,
      pitEventAt: PIT,
      recordedAt: RECORDED,
    });
    expect(plan).toEqual({
      ok: true,
      action: "idempotent",
      version: 1,
      contentDigestHex: current.contentDigestHex,
    });
  });

  it("records EVIDENCE_ONLY_ZERO_DELTA without changing confidence", () => {
    const current = snapshot(baseContent);
    const plan = planKnowledgeEdgeVersionAppend(current, {
      reasonClass: "EVIDENCE_ONLY_ZERO_DELTA",
      producedByReceiptDigestHex: RECEIPT,
      expectedVersion: 1,
      nextContent: baseContent,
      pitEventAt: PIT,
      recordedAt: RECORDED,
    });
    expect(plan).toEqual({
      ok: true,
      action: "insert",
      version: 2,
      reasonClass: "EVIDENCE_ONLY_ZERO_DELTA",
      contentDigestHex: current.contentDigestHex,
      lifecycleState: "ACTIVE",
    });
  });

  it("reserves non-zero QUALIFIED_VERDICT_UPDATE for DEE-773", () => {
    const current = snapshot(baseContent);
    expect(
      planKnowledgeEdgeVersionAppend(current, {
        reasonClass: "QUALIFIED_VERDICT_UPDATE",
        producedByReceiptDigestHex: RECEIPT,
        expectedVersion: 1,
        nextContent: { ...baseContent, confidence: "0.8000" },
        pitEventAt: PIT,
        recordedAt: RECORDED,
      }),
    ).toEqual({
      ok: false,
      code: KNOWLEDGE_AUTHORITY_REASON.QUALIFIED_VERDICT_DELTA_RESERVED_DEE_773,
    });
  });

  it("refuses writes against a retired edge", () => {
    const current = snapshot({ ...baseContent, lifecycleState: "RETIRED" });
    expect(
      planKnowledgeEdgeVersionAppend(current, {
        reasonClass: "OPERATOR_GOVERNED_CORRECTION",
        producedByReceiptDigestHex: RECEIPT,
        expectedVersion: 1,
        nextContent: baseContent,
        pitEventAt: PIT,
        recordedAt: RECORDED,
      }),
    ).toEqual({ ok: false, code: KNOWLEDGE_AUTHORITY_REASON.TERMINAL_STATE });
  });
});
