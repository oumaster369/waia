import { createHash } from "node:crypto";

import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { assessQualifiedVerdictUpdateV2 } from "@/lib/trader/knowledge/qualified-verdict-update-v2";

export const KNOWLEDGE_EDGE_VERSION_SCHEMA_V2 = "knowledge-edge-version/v2" as const;

export const KNOWLEDGE_EDGE_VERSION_REASON_CLASSES = [
  "INITIAL_ASSERTION",
  "EVIDENCE_ONLY_ZERO_DELTA",
  "QUALIFIED_VERDICT_UPDATE",
  "OPERATOR_GOVERNED_CORRECTION",
  "SUPERSEDED_BY_VERSION",
  "RETIRED",
] as const;

export type KnowledgeEdgeVersionReasonClass =
  (typeof KNOWLEDGE_EDGE_VERSION_REASON_CLASSES)[number];

export const KNOWLEDGE_EDGE_LIFECYCLE_STATES = ["ACTIVE", "RETIRED"] as const;
export type KnowledgeEdgeLifecycleState = (typeof KNOWLEDGE_EDGE_LIFECYCLE_STATES)[number];

export const KNOWLEDGE_AUTHORITY_REASON = {
  LEGACY_MKB_MUTATION_DISABLED: "LEGACY_MKB_MUTATION_DISABLED",
  LEGACY_KNOWLEDGE_DELETE_DISABLED: "LEGACY_KNOWLEDGE_DELETE_DISABLED",
  REASON_CLASS_INVALID: "REASON_CLASS_INVALID",
  PRODUCING_RECEIPT_UNRESOLVABLE: "PRODUCING_RECEIPT_UNRESOLVABLE",
  STALE_VERSION: "STALE_VERSION",
  QUALIFIED_VERDICT_DELTA_RESERVED_DEE_773: "QUALIFIED_VERDICT_DELTA_RESERVED_DEE_773",
  QUALIFIED_VERDICT_UNBOUNDED_DELTA: "QUALIFIED_VERDICT_UNBOUNDED_DELTA",
  QUALIFIED_VERDICT_IDENTITY_MUTATION: "QUALIFIED_VERDICT_IDENTITY_MUTATION",
  TERMINAL_STATE: "TERMINAL_STATE",
  INITIAL_ASSERTION_ALREADY_EXISTS: "INITIAL_ASSERTION_ALREADY_EXISTS",
  ZERO_DELTA_REQUIRED: "ZERO_DELTA_REQUIRED",
} as const;

export class KnowledgeAuthorityError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "KnowledgeAuthorityError";
    this.code = code;
  }
}

export type KnowledgeEdgeEpistemicContent = Readonly<{
  fromRef: string;
  toRef: string;
  relationKind: string;
  confidence: string;
  strength: string;
  regimeScope: string;
  failureCasesJson: string;
  hypothesisId: string | null;
  verified: boolean;
  lifecycleState: KnowledgeEdgeLifecycleState;
}>;

export type KnowledgeEdgeVersionSnapshot = Readonly<{
  id?: string;
  version: number;
  content: KnowledgeEdgeEpistemicContent;
  contentDigestHex: string;
  reasonClass: KnowledgeEdgeVersionReasonClass;
}>;

export type PlanKnowledgeEdgeVersionInput = Readonly<{
  reasonClass: string;
  producedByReceiptDigestHex: string;
  expectedVersion: number;
  nextContent: KnowledgeEdgeEpistemicContent;
  pitEventAt: Date;
  recordedAt: Date;
}>;

export type KnowledgeEdgeVersionPlan =
  | {
      ok: true;
      action: "insert";
      version: number;
      reasonClass: KnowledgeEdgeVersionReasonClass;
      contentDigestHex: string;
      lifecycleState: KnowledgeEdgeLifecycleState;
    }
  | { ok: true; action: "idempotent"; version: number; contentDigestHex: string }
  | { ok: false; code: string };

const RECEIPT_HEX = /^[0-9a-f]{64}$/;

export function isKnowledgeEdgeVersionReasonClass(
  value: string,
): value is KnowledgeEdgeVersionReasonClass {
  return (KNOWLEDGE_EDGE_VERSION_REASON_CLASSES as readonly string[]).includes(value);
}

export function computeKnowledgeEdgeVersionContentDigestHex(
  content: KnowledgeEdgeEpistemicContent,
): string {
  return computeSemanticSha256Hex({
    confidence: content.confidence,
    failureCasesJson: content.failureCasesJson,
    fromRef: content.fromRef,
    hypothesisId: content.hypothesisId,
    lifecycleState: content.lifecycleState,
    relationKind: content.relationKind,
    regimeScope: content.regimeScope,
    strength: content.strength,
    toRef: content.toRef,
    verified: content.verified,
  });
}

export function knowledgeEdgeVersionRowId(seed: string): string {
  const hash = createHash("sha256").update(seed, "utf8").digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function epistemicEquals(
  left: KnowledgeEdgeEpistemicContent,
  right: KnowledgeEdgeEpistemicContent,
): boolean {
  return (
    computeKnowledgeEdgeVersionContentDigestHex(left) ===
    computeKnowledgeEdgeVersionContentDigestHex(right)
  );
}

export function planKnowledgeEdgeVersionAppend(
  current: KnowledgeEdgeVersionSnapshot | null,
  input: PlanKnowledgeEdgeVersionInput,
): KnowledgeEdgeVersionPlan {
  if (!isKnowledgeEdgeVersionReasonClass(input.reasonClass)) {
    return { ok: false, code: KNOWLEDGE_AUTHORITY_REASON.REASON_CLASS_INVALID };
  }
  if (!RECEIPT_HEX.test(input.producedByReceiptDigestHex)) {
    return { ok: false, code: KNOWLEDGE_AUTHORITY_REASON.PRODUCING_RECEIPT_UNRESOLVABLE };
  }

  const nextDigest = computeKnowledgeEdgeVersionContentDigestHex(input.nextContent);
  const currentVersion = current?.version ?? 0;
  if (input.expectedVersion !== currentVersion) {
    return { ok: false, code: KNOWLEDGE_AUTHORITY_REASON.STALE_VERSION };
  }

  if (
    current &&
    current.contentDigestHex === nextDigest &&
    current.reasonClass === input.reasonClass
  ) {
    return {
      ok: true,
      action: "idempotent",
      version: current.version,
      contentDigestHex: nextDigest,
    };
  }

  if (current?.content.lifecycleState === "RETIRED") {
    return { ok: false, code: KNOWLEDGE_AUTHORITY_REASON.TERMINAL_STATE };
  }

  if (input.reasonClass === "INITIAL_ASSERTION" && current) {
    return { ok: false, code: KNOWLEDGE_AUTHORITY_REASON.INITIAL_ASSERTION_ALREADY_EXISTS };
  }

  if (input.reasonClass === "INITIAL_ASSERTION" && currentVersion !== 0) {
    return { ok: false, code: KNOWLEDGE_AUTHORITY_REASON.INITIAL_ASSERTION_ALREADY_EXISTS };
  }

  if (
    input.reasonClass === "EVIDENCE_ONLY_ZERO_DELTA" ||
    input.reasonClass === "SUPERSEDED_BY_VERSION"
  ) {
    if (!current) {
      return { ok: false, code: KNOWLEDGE_AUTHORITY_REASON.STALE_VERSION };
    }
    if (input.nextContent.confidence !== current.content.confidence) {
      return { ok: false, code: KNOWLEDGE_AUTHORITY_REASON.ZERO_DELTA_REQUIRED };
    }
    if (
      !epistemicEquals(
        { ...current.content, lifecycleState: input.nextContent.lifecycleState },
        { ...input.nextContent, lifecycleState: current.content.lifecycleState },
      )
    ) {
      return { ok: false, code: KNOWLEDGE_AUTHORITY_REASON.ZERO_DELTA_REQUIRED };
    }
  }

  if (input.reasonClass === "QUALIFIED_VERDICT_UPDATE") {
    if (!current) {
      return { ok: false, code: KNOWLEDGE_AUTHORITY_REASON.STALE_VERSION };
    }
    const assessment = assessQualifiedVerdictUpdateV2(current.content, input.nextContent);
    if (!assessment.ok) {
      return { ok: false, code: assessment.code };
    }
  }

  if (input.reasonClass === "RETIRED" && input.nextContent.lifecycleState !== "RETIRED") {
    return { ok: false, code: KNOWLEDGE_AUTHORITY_REASON.TERMINAL_STATE };
  }

  const lifecycleState: KnowledgeEdgeLifecycleState =
    input.reasonClass === "RETIRED" ? "RETIRED" : input.nextContent.lifecycleState;

  return {
    ok: true,
    action: "insert",
    version: currentVersion + 1,
    reasonClass: input.reasonClass,
    contentDigestHex: nextDigest,
    lifecycleState,
  };
}
