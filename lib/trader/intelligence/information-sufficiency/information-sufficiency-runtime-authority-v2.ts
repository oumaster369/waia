import {
  assertInformationSufficiencyReceiptV2,
  assertRequiredInformationProfileV2,
  type InformationAnalysisPurposeV2,
  type InformationSufficiencyReceiptV2,
  type RequiredInformationProfileV2,
} from "@/lib/trader/intelligence/information-sufficiency/information-sufficiency-v2";
import { historicalInstrumentsMatch } from "@/lib/trader/symbols/historical-instrument";

export const INFORMATION_SUFFICIENCY_RUNTIME_AUTHORITY_V2_SCHEMA_VERSION =
  "information-sufficiency-runtime-authority-v2" as const;
export const SYNTHETIC_RESEARCH_NON_CAPITAL_BINDING_V2_SCHEMA_VERSION =
  "synthetic-research-non-capital-binding-v2" as const;

export type SyntheticResearchNonCapitalHarnessV2 = "FHV_SYNTHETIC_WP7B" | "CAPITAL_TRACE_SYNTHETIC";

export type SyntheticResearchNonCapitalBindingV2 = Readonly<{
  schemaVersion: typeof SYNTHETIC_RESEARCH_NON_CAPITAL_BINDING_V2_SCHEMA_VERSION;
  harness: SyntheticResearchNonCapitalHarnessV2;
  runId: string;
  provenanceDigest: string;
  officialBlindHoldout: false;
  production: false;
  live: false;
  capitalEligible: false;
  capitalUse: false;
}>;

export type InformationSufficiencyRuntimeAuthorityV2 =
  | Readonly<{
      schemaVersion: typeof INFORMATION_SUFFICIENCY_RUNTIME_AUTHORITY_V2_SCHEMA_VERSION;
      kind: "PROFILE_RECEIPT";
      organizationId: string;
      purpose: InformationAnalysisPurposeV2;
      profile: RequiredInformationProfileV2;
      receipt: InformationSufficiencyReceiptV2;
      authority: "EPISTEMIC_PREREQUISITE_ONLY";
    }>
  | Readonly<{
      schemaVersion: typeof INFORMATION_SUFFICIENCY_RUNTIME_AUTHORITY_V2_SCHEMA_VERSION;
      kind: "RESEARCH_NON_CAPITAL";
      organizationId: string;
      purpose: "RESEARCH_NON_CAPITAL";
      declaration: "EXPLICIT_RESEARCH_NON_CAPITAL";
      reason: string;
      authority: "NON_CAPITAL_ONLY";
      syntheticBinding?: SyntheticResearchNonCapitalBindingV2;
    }>;

export type SyntheticResearchNonCapitalAuthorityV2 = Readonly<{
  authority: InformationSufficiencyRuntimeAuthorityV2;
  binding: SyntheticResearchNonCapitalBindingV2;
}>;

export type InformationSufficiencyRuntimeScopeV2 = Readonly<{
  accountId: string | null;
  symbol: string;
  analyticalTimeframe: string;
  pitAnchor: string;
}>;

export type InformationSufficiencyRuntimeBlockReasonV2 =
  | "MISSING_AUTHORITY"
  | "INVALID_AUTHORITY"
  | "ORGANIZATION_MISMATCH"
  | "SCOPE_MISMATCH"
  | "PIT_MISMATCH"
  | "PURPOSE_MISMATCH"
  | "INSUFFICIENT"
  | "UNAVAILABLE"
  | "RESEARCH_NON_CAPITAL_NOT_ALLOWED"
  | "RESEARCH_NON_CAPITAL_SCOPE_MISMATCH";

export type InformationSufficiencyRuntimeAdmissionV2 =
  | Readonly<{
      status: "ADMITTED";
      purpose: "NEW_OPPORTUNITY" | "RESEARCH_NON_CAPITAL";
      authorityKind: InformationSufficiencyRuntimeAuthorityV2["kind"];
      profileId: string | null;
      receiptId: string | null;
      createsCapitalAuthority: false;
    }>
  | Readonly<{
      status: "BLOCKED";
      requiredPurpose: "NEW_OPPORTUNITY";
      reasonCode: InformationSufficiencyRuntimeBlockReasonV2;
      createsCapitalAuthority: false;
    }>;

function requireNonEmpty(value: string, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`INFORMATION_SUFFICIENCY_RUNTIME_INVALID:${field}`);
  }
  return value;
}

function requireDigest(value: string, field: string): string {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`INFORMATION_SUFFICIENCY_RUNTIME_INVALID:${field}`);
  }
  return value;
}

function assertSyntheticResearchNonCapitalBindingV2(
  binding: SyntheticResearchNonCapitalBindingV2,
): void {
  if (
    binding.schemaVersion !== SYNTHETIC_RESEARCH_NON_CAPITAL_BINDING_V2_SCHEMA_VERSION ||
    (binding.harness !== "FHV_SYNTHETIC_WP7B" && binding.harness !== "CAPITAL_TRACE_SYNTHETIC") ||
    binding.officialBlindHoldout !== false ||
    binding.production !== false ||
    binding.live !== false ||
    binding.capitalEligible !== false ||
    binding.capitalUse !== false
  ) {
    throw new Error("INFORMATION_SUFFICIENCY_RUNTIME_INVALID:syntheticBinding");
  }
  requireNonEmpty(binding.runId, "syntheticBinding.runId");
  requireDigest(binding.provenanceDigest, "syntheticBinding.provenanceDigest");
}

export function syntheticResearchNonCapitalBindingsEqualV2(
  left: SyntheticResearchNonCapitalBindingV2,
  right: SyntheticResearchNonCapitalBindingV2,
): boolean {
  return (
    left.schemaVersion === right.schemaVersion &&
    left.harness === right.harness &&
    left.runId === right.runId &&
    left.provenanceDigest === right.provenanceDigest &&
    left.officialBlindHoldout === right.officialBlindHoldout &&
    left.production === right.production &&
    left.live === right.live &&
    left.capitalEligible === right.capitalEligible &&
    left.capitalUse === right.capitalUse
  );
}

export function bindInformationSufficiencyReceiptAuthorityV2(
  profile: RequiredInformationProfileV2,
  receipt: InformationSufficiencyReceiptV2,
): InformationSufficiencyRuntimeAuthorityV2 {
  assertRequiredInformationProfileV2(profile);
  assertInformationSufficiencyReceiptV2(receipt, profile);
  return {
    schemaVersion: INFORMATION_SUFFICIENCY_RUNTIME_AUTHORITY_V2_SCHEMA_VERSION,
    kind: "PROFILE_RECEIPT",
    organizationId: profile.organizationId,
    purpose: profile.purpose,
    profile,
    receipt,
    authority: "EPISTEMIC_PREREQUISITE_ONLY",
  };
}

export function declareResearchNonCapitalInformationAuthorityV2(input: {
  organizationId: string;
  reason: string;
}): InformationSufficiencyRuntimeAuthorityV2 {
  return {
    schemaVersion: INFORMATION_SUFFICIENCY_RUNTIME_AUTHORITY_V2_SCHEMA_VERSION,
    kind: "RESEARCH_NON_CAPITAL",
    organizationId: requireNonEmpty(input.organizationId, "organizationId"),
    purpose: "RESEARCH_NON_CAPITAL",
    declaration: "EXPLICIT_RESEARCH_NON_CAPITAL",
    reason: requireNonEmpty(input.reason, "reason"),
    authority: "NON_CAPITAL_ONLY",
  };
}

export function declareSyntheticResearchNonCapitalInformationAuthorityV2(input: {
  organizationId: string;
  harness: SyntheticResearchNonCapitalHarnessV2;
  runId: string;
  provenanceDigest: string;
  officialBlindHoldout: boolean;
  production: boolean;
  live: boolean;
  capitalEligible: boolean;
  capitalUse: boolean;
}): SyntheticResearchNonCapitalAuthorityV2 {
  if (
    input.officialBlindHoldout ||
    input.production ||
    input.live ||
    input.capitalEligible ||
    input.capitalUse
  ) {
    throw new Error("INFORMATION_SUFFICIENCY_SYNTHETIC_RESEARCH_SCOPE_FORBIDDEN");
  }
  const binding: SyntheticResearchNonCapitalBindingV2 = Object.freeze({
    schemaVersion: SYNTHETIC_RESEARCH_NON_CAPITAL_BINDING_V2_SCHEMA_VERSION,
    harness: input.harness,
    runId: requireNonEmpty(input.runId, "syntheticBinding.runId"),
    provenanceDigest: requireDigest(input.provenanceDigest, "syntheticBinding.provenanceDigest"),
    officialBlindHoldout: false,
    production: false,
    live: false,
    capitalEligible: false,
    capitalUse: false,
  });
  assertSyntheticResearchNonCapitalBindingV2(binding);
  const authority: InformationSufficiencyRuntimeAuthorityV2 = Object.freeze({
    schemaVersion: INFORMATION_SUFFICIENCY_RUNTIME_AUTHORITY_V2_SCHEMA_VERSION,
    kind: "RESEARCH_NON_CAPITAL",
    organizationId: requireNonEmpty(input.organizationId, "organizationId"),
    purpose: "RESEARCH_NON_CAPITAL",
    declaration: "EXPLICIT_RESEARCH_NON_CAPITAL",
    reason: `Human-ratified synthetic harness ${binding.harness}; provenance ${binding.provenanceDigest}`,
    authority: "NON_CAPITAL_ONLY",
    syntheticBinding: binding,
  });
  return Object.freeze({
    authority,
    binding,
  });
}

export function evaluateInformationSufficiencyRuntimeAdmissionV2(input: {
  authority: InformationSufficiencyRuntimeAuthorityV2 | null | undefined;
  organizationId: string;
  requiredPurpose: "NEW_OPPORTUNITY";
  allowResearchNonCapital: boolean;
  syntheticResearchBinding?: SyntheticResearchNonCapitalBindingV2;
  expectedScope?: Readonly<{
    accountId?: string | null;
    symbol?: string;
    analyticalTimeframe?: string;
    pitAnchor?: string;
  }>;
}): InformationSufficiencyRuntimeAdmissionV2 {
  const blocked = (
    reasonCode: InformationSufficiencyRuntimeBlockReasonV2,
  ): InformationSufficiencyRuntimeAdmissionV2 => ({
    status: "BLOCKED",
    requiredPurpose: input.requiredPurpose,
    reasonCode,
    createsCapitalAuthority: false,
  });
  const authority = input.authority;
  if (!authority) return blocked("MISSING_AUTHORITY");

  try {
    if (
      authority.schemaVersion !== INFORMATION_SUFFICIENCY_RUNTIME_AUTHORITY_V2_SCHEMA_VERSION ||
      authority.organizationId !== input.organizationId
    ) {
      return blocked(
        authority.organizationId === input.organizationId
          ? "INVALID_AUTHORITY"
          : "ORGANIZATION_MISMATCH",
      );
    }

    if (authority.kind === "RESEARCH_NON_CAPITAL") {
      if (
        authority.purpose !== "RESEARCH_NON_CAPITAL" ||
        authority.declaration !== "EXPLICIT_RESEARCH_NON_CAPITAL" ||
        authority.authority !== "NON_CAPITAL_ONLY"
      ) {
        return blocked("INVALID_AUTHORITY");
      }
      requireNonEmpty(authority.reason, "reason");
      if (!input.allowResearchNonCapital) return blocked("RESEARCH_NON_CAPITAL_NOT_ALLOWED");
      if (authority.syntheticBinding) {
        try {
          assertSyntheticResearchNonCapitalBindingV2(authority.syntheticBinding);
          if (input.syntheticResearchBinding) {
            assertSyntheticResearchNonCapitalBindingV2(input.syntheticResearchBinding);
          }
        } catch {
          return blocked("RESEARCH_NON_CAPITAL_SCOPE_MISMATCH");
        }
        if (
          !input.syntheticResearchBinding ||
          !syntheticResearchNonCapitalBindingsEqualV2(
            authority.syntheticBinding,
            input.syntheticResearchBinding,
          )
        ) {
          return blocked("RESEARCH_NON_CAPITAL_SCOPE_MISMATCH");
        }
      } else if (input.syntheticResearchBinding) {
        return blocked("RESEARCH_NON_CAPITAL_SCOPE_MISMATCH");
      }
      return {
        status: "ADMITTED",
        purpose: "RESEARCH_NON_CAPITAL",
        authorityKind: authority.kind,
        profileId: null,
        receiptId: null,
        createsCapitalAuthority: false,
      };
    }

    if (
      authority.kind !== "PROFILE_RECEIPT" ||
      authority.authority !== "EPISTEMIC_PREREQUISITE_ONLY"
    ) {
      return blocked("INVALID_AUTHORITY");
    }
    assertRequiredInformationProfileV2(authority.profile);
    assertInformationSufficiencyReceiptV2(authority.receipt, authority.profile);
    if (
      authority.profile.organizationId !== input.organizationId ||
      authority.receipt.organizationId !== input.organizationId
    ) {
      return blocked("ORGANIZATION_MISMATCH");
    }
    if (
      authority.purpose !== input.requiredPurpose ||
      authority.profile.purpose !== input.requiredPurpose ||
      authority.receipt.purpose !== input.requiredPurpose
    ) {
      return blocked("PURPOSE_MISMATCH");
    }
    const expectedScope = input.expectedScope;
    if (
      (expectedScope?.accountId !== undefined &&
        (authority.profile.accountId !== expectedScope.accountId ||
          authority.receipt.accountId !== expectedScope.accountId)) ||
      (expectedScope?.symbol !== undefined &&
        ((authority.profile.symbol !== expectedScope.symbol &&
          !historicalInstrumentsMatch(authority.profile.symbol, expectedScope.symbol)) ||
          (authority.receipt.symbol !== expectedScope.symbol &&
            !historicalInstrumentsMatch(authority.receipt.symbol, expectedScope.symbol)))) ||
      (expectedScope?.analyticalTimeframe !== undefined &&
        (authority.profile.analyticalTimeframe !== expectedScope.analyticalTimeframe ||
          authority.receipt.analyticalTimeframe !== expectedScope.analyticalTimeframe))
    ) {
      return blocked("SCOPE_MISMATCH");
    }
    if (
      expectedScope?.pitAnchor !== undefined &&
      authority.receipt.pitAnchor !== expectedScope.pitAnchor
    ) {
      return blocked("PIT_MISMATCH");
    }
    if (authority.receipt.status === "UNAVAILABLE") return blocked("UNAVAILABLE");
    if (authority.receipt.status !== "SUFFICIENT") return blocked("INSUFFICIENT");
    return {
      status: "ADMITTED",
      purpose: "NEW_OPPORTUNITY",
      authorityKind: authority.kind,
      profileId: authority.profile.id,
      receiptId: authority.receipt.id,
      createsCapitalAuthority: false,
    };
  } catch {
    return blocked("INVALID_AUTHORITY");
  }
}
