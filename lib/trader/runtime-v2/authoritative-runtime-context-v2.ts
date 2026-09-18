import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import type { RuntimePostureV2 } from "@/lib/trader/runtime-authority/v2/runtime-authority-assessment-v2";
import type { LiveEdgeDriftPostureV2 } from "@/lib/trader/restriction/live-edge-drift-restriction-v2";

export const AUTHORITATIVE_RUNTIME_CONTEXT_SCHEMA_V2 =
  "waia.trader.authoritative_runtime_context.v2" as const;

const HEX64 = /^[0-9a-f]{64}$/;

export type AuthoritativeRuntimeContextV2 = Readonly<{
  schemaVersion: typeof AUTHORITATIVE_RUNTIME_CONTEXT_SCHEMA_V2;
  authority: "ENVELOPE_ONLY";
  capitalAuthority: "NONE";
  organizationId: string;
  accountId: string;
  symbol: string;
  pitAnchor: string;
  runtimePosture: RuntimePostureV2;
  runtimeAssessmentDigestHex: string;
  driftPosture: LiveEdgeDriftPostureV2;
  driftRestrictionDigestHex: string;
  qualificationTupleDigestHex: string;
  packageDigestHex: string;
  informationContractDigestHex: string;
  informationNeedPlanDigestHex: string;
  releaseDigestHex: string;
  contentDigestHex: string;
}>;

export type AuthoritativeRuntimeContextV2Input = Omit<
  AuthoritativeRuntimeContextV2,
  "schemaVersion" | "authority" | "capitalAuthority" | "contentDigestHex"
>;

function requireHex(value: string, code: string): void {
  if (!HEX64.test(value)) throw new Error(code);
}

function requireText(value: string, code: string): void {
  if (!value.trim()) throw new Error(code);
}

export function buildAuthoritativeRuntimeContextV2(
  input: AuthoritativeRuntimeContextV2Input,
): AuthoritativeRuntimeContextV2 {
  requireText(input.organizationId, "RUNTIME_CONTEXT_ORGANIZATION_INVALID");
  requireText(input.accountId, "RUNTIME_CONTEXT_ACCOUNT_INVALID");
  requireText(input.symbol, "RUNTIME_CONTEXT_SYMBOL_INVALID");
  const parsed = Date.parse(input.pitAnchor);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== input.pitAnchor) {
    throw new Error("RUNTIME_CONTEXT_PIT_INVALID");
  }
  requireHex(input.runtimeAssessmentDigestHex, "RUNTIME_CONTEXT_ASSESSMENT_INVALID");
  requireHex(input.driftRestrictionDigestHex, "RUNTIME_CONTEXT_DRIFT_INVALID");
  requireHex(input.qualificationTupleDigestHex, "RUNTIME_CONTEXT_TUPLE_INVALID");
  requireHex(input.packageDigestHex, "RUNTIME_CONTEXT_PACKAGE_INVALID");
  requireHex(input.informationContractDigestHex, "RUNTIME_CONTEXT_CONTRACT_INVALID");
  requireHex(input.informationNeedPlanDigestHex, "RUNTIME_CONTEXT_NEED_PLAN_INVALID");
  requireHex(input.releaseDigestHex, "RUNTIME_CONTEXT_RELEASE_INVALID");

  const body = {
    schemaVersion: AUTHORITATIVE_RUNTIME_CONTEXT_SCHEMA_V2,
    authority: "ENVELOPE_ONLY" as const,
    capitalAuthority: "NONE" as const,
    organizationId: input.organizationId,
    accountId: input.accountId,
    symbol: input.symbol,
    pitAnchor: input.pitAnchor,
    runtimePosture: input.runtimePosture,
    runtimeAssessmentDigestHex: input.runtimeAssessmentDigestHex,
    driftPosture: input.driftPosture,
    driftRestrictionDigestHex: input.driftRestrictionDigestHex,
    qualificationTupleDigestHex: input.qualificationTupleDigestHex,
    packageDigestHex: input.packageDigestHex,
    informationContractDigestHex: input.informationContractDigestHex,
    informationNeedPlanDigestHex: input.informationNeedPlanDigestHex,
    releaseDigestHex: input.releaseDigestHex,
  };
  return Object.freeze({
    ...body,
    contentDigestHex: computeSemanticSha256Hex(body),
  });
}
