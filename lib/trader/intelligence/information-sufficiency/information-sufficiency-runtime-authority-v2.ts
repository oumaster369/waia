import {
  assertInformationSufficiencyReceiptV2,
  assertRequiredInformationProfileV2,
  type InformationAnalysisPurposeV2,
  type InformationSufficiencyReceiptV2,
  type RequiredInformationProfileV2,
} from "@/lib/trader/intelligence/information-sufficiency/information-sufficiency-v2";

export const INFORMATION_SUFFICIENCY_RUNTIME_AUTHORITY_V2_SCHEMA_VERSION =
  "information-sufficiency-runtime-authority-v2" as const;

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
  | "RESEARCH_NON_CAPITAL_NOT_ALLOWED";

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

export function evaluateInformationSufficiencyRuntimeAdmissionV2(input: {
  authority: InformationSufficiencyRuntimeAuthorityV2 | null | undefined;
  organizationId: string;
  requiredPurpose: "NEW_OPPORTUNITY";
  allowResearchNonCapital: boolean;
  expectedScope?: Readonly<{
    accountId?: string;
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
        (authority.profile.symbol !== expectedScope.symbol ||
          authority.receipt.symbol !== expectedScope.symbol)) ||
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
