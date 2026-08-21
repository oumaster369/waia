import type { EconomicAdmissibleSizeSetV1 } from "@/lib/trader/intelligence/decision-economics/dee659-execution-payoff-authorities-v1";
import { compareDecimal, formatDecimal, parseDecimal } from "@/lib/trader/risk/numeric";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";

export const ECONOMIC_ADMISSIBLE_SIZE_SET_V2 = "economic-admissible-size-set/v2" as const;

type EconomicSizeAuthorityV2 = Readonly<{
  sizeSetId: string;
  organizationId: string;
  accountId: string;
  instrumentIdentityDigestHex: string;
  decisionContentDigestHex: string;
  authorityReceiptDigestHex: string;
}>;

export type DiscreteEconomicAdmissibleSizeSetV2 = EconomicSizeAuthorityV2 &
  Readonly<{
    schemaVersion: typeof ECONOMIC_ADMISSIBLE_SIZE_SET_V2;
    shape: "DISCRETE";
    unit: "BASE_ASSET_QUANTITY";
    exactQuantities: readonly string[];
    contentDigestHex: string;
  }>;

export type ContinuousEconomicAdmissibleSizeSetV2 = EconomicSizeAuthorityV2 &
  Readonly<{
    schemaVersion: typeof ECONOMIC_ADMISSIBLE_SIZE_SET_V2;
    shape: "CONTINUOUS_INTERVAL";
    unit: "BASE_ASSET_QUANTITY";
    minimumQuantity: string;
    maximumQuantity: string;
    contentDigestHex: string;
  }>;

export type EconomicAdmissibleSizeSetV2 =
  | DiscreteEconomicAdmissibleSizeSetV2
  | ContinuousEconomicAdmissibleSizeSetV2;

export type EconomicSizeIntersectionV2 =
  | Readonly<{
      status: "PERMITTED";
      approvedQuantity: string;
      disposition: "AS_PROPOSED" | "CLAMPED_WITHIN_QUALIFIED_SET";
    }>
  | Readonly<{
      status: "EMPTY";
      approvedQuantity: null;
      disposition: "DECISION_REEVALUATION_OR_VETO_REQUIRED";
      reasonCode: "NO_DECISION_QUALIFIED_SIZE_WITHIN_RISK_CAP";
    }>
  | Readonly<{
      status: "INVALID";
      approvedQuantity: null;
      disposition: "VETO_REQUIRED";
      reasonCode: "ECONOMIC_SIZE_AUTHORITY_INVALID" | "RISK_CAP_INVALID";
    }>;

const DIGEST = /^[0-9a-f]{64}$/;

function canonicalPositive(value: string): string {
  const parsed = parseDecimal(value);
  if (parsed <= 0n) throw new Error("quantity must be positive scale-8 decimal");
  return formatDecimal(parsed);
}

function validateAuthority(authority: EconomicSizeAuthorityV2): void {
  if (
    authority.sizeSetId.trim() === "" ||
    authority.organizationId.trim() === "" ||
    authority.accountId.trim() === "" ||
    !DIGEST.test(authority.instrumentIdentityDigestHex) ||
    !DIGEST.test(authority.decisionContentDigestHex) ||
    !DIGEST.test(authority.authorityReceiptDigestHex)
  ) {
    throw new Error("economic size authority is malformed");
  }
}

function omitDigest<T extends { contentDigestHex: string }>(input: T): Omit<T, "contentDigestHex"> {
  const { contentDigestHex, ...payload } = input;
  void contentDigestHex;
  return payload;
}

function freezeSet<T extends EconomicAdmissibleSizeSetV2>(input: T): T {
  if (input.shape === "DISCRETE") Object.freeze(input.exactQuantities);
  return Object.freeze(input);
}

export function createDiscreteEconomicAdmissibleSizeSetV2(
  input: EconomicSizeAuthorityV2 & { exactQuantities: readonly string[] },
): DiscreteEconomicAdmissibleSizeSetV2 {
  validateAuthority(input);
  if (input.exactQuantities.length === 0) throw new Error("discrete size set must not be empty");
  const exactQuantities = [...new Set(input.exactQuantities.map(canonicalPositive))].sort((a, b) =>
    compareDecimal(a, b),
  );
  if (exactQuantities.length !== input.exactQuantities.length) {
    throw new Error("discrete size set must contain unique quantities");
  }
  const payload = {
    ...input,
    schemaVersion: ECONOMIC_ADMISSIBLE_SIZE_SET_V2,
    shape: "DISCRETE" as const,
    unit: "BASE_ASSET_QUANTITY" as const,
    exactQuantities,
  };
  return freezeSet({ ...payload, contentDigestHex: computeStableJsonDigest(payload) });
}

export function createContinuousEconomicAdmissibleSizeSetV2(
  input: EconomicSizeAuthorityV2 & { minimumQuantity: string; maximumQuantity: string },
): ContinuousEconomicAdmissibleSizeSetV2 {
  validateAuthority(input);
  const minimumQuantity = canonicalPositive(input.minimumQuantity);
  const maximumQuantity = canonicalPositive(input.maximumQuantity);
  if (compareDecimal(minimumQuantity, maximumQuantity) > 0) {
    throw new Error("continuous size set minimum exceeds maximum");
  }
  const payload = {
    ...input,
    schemaVersion: ECONOMIC_ADMISSIBLE_SIZE_SET_V2,
    shape: "CONTINUOUS_INTERVAL" as const,
    unit: "BASE_ASSET_QUANTITY" as const,
    minimumQuantity,
    maximumQuantity,
  };
  return freezeSet({ ...payload, contentDigestHex: computeStableJsonDigest(payload) });
}

export function validateEconomicAdmissibleSizeSetV2(input: EconomicAdmissibleSizeSetV2): boolean {
  try {
    validateAuthority(input);
    const recomputed = computeStableJsonDigest(omitDigest(input));
    if (recomputed !== input.contentDigestHex) return false;
    if (input.shape === "DISCRETE") {
      if (input.exactQuantities.length === 0) return false;
      const canonical = input.exactQuantities.map(canonicalPositive);
      return (
        new Set(canonical).size === canonical.length &&
        canonical.every((value, index) => value === input.exactQuantities[index]) &&
        canonical.every((value, index) => index === 0 || compareDecimal(canonical[index - 1]!, value) < 0)
      );
    }
    const minimum = canonicalPositive(input.minimumQuantity);
    const maximum = canonicalPositive(input.maximumQuantity);
    return (
      minimum === input.minimumQuantity &&
      maximum === input.maximumQuantity &&
      compareDecimal(minimum, maximum) <= 0
    );
  } catch {
    return false;
  }
}

export function economicAdmissibleSizeSetV2FromDecisionV1(input: {
  decisionContentDigestHex: string;
  sizeSet: EconomicAdmissibleSizeSetV1;
}): DiscreteEconomicAdmissibleSizeSetV2 {
  return createDiscreteEconomicAdmissibleSizeSetV2({
    sizeSetId: input.sizeSet.sizeSetId,
    organizationId: input.sizeSet.organizationId,
    accountId: input.sizeSet.accountId,
    instrumentIdentityDigestHex: input.sizeSet.instrumentIdentityDigestHex,
    decisionContentDigestHex: input.decisionContentDigestHex,
    authorityReceiptDigestHex: input.sizeSet.authorityReceiptDigestHex,
    exactQuantities: input.sizeSet.exactQuantities,
  });
}

export function intersectEconomicAdmissibleSizeSetV2(input: {
  economicSizeSet: EconomicAdmissibleSizeSetV2;
  riskCapQuantity: string;
}): EconomicSizeIntersectionV2 {
  if (!validateEconomicAdmissibleSizeSetV2(input.economicSizeSet)) {
    return {
      status: "INVALID",
      approvedQuantity: null,
      disposition: "VETO_REQUIRED",
      reasonCode: "ECONOMIC_SIZE_AUTHORITY_INVALID",
    };
  }
  let cap: string;
  try {
    cap = canonicalPositive(input.riskCapQuantity);
  } catch {
    return {
      status: "INVALID",
      approvedQuantity: null,
      disposition: "VETO_REQUIRED",
      reasonCode: "RISK_CAP_INVALID",
    };
  }

  const sizeSet = input.economicSizeSet;
  if (sizeSet.shape === "CONTINUOUS_INTERVAL") {
    if (compareDecimal(cap, sizeSet.minimumQuantity) < 0) {
      return {
        status: "EMPTY",
        approvedQuantity: null,
        disposition: "DECISION_REEVALUATION_OR_VETO_REQUIRED",
        reasonCode: "NO_DECISION_QUALIFIED_SIZE_WITHIN_RISK_CAP",
      };
    }
    const approvedQuantity =
      compareDecimal(cap, sizeSet.maximumQuantity) >= 0 ? sizeSet.maximumQuantity : cap;
    return {
      status: "PERMITTED",
      approvedQuantity,
      disposition:
        approvedQuantity === sizeSet.maximumQuantity
          ? "AS_PROPOSED"
          : "CLAMPED_WITHIN_QUALIFIED_SET",
    };
  }

  const approvedQuantity = [...sizeSet.exactQuantities]
    .reverse()
    .find((quantity) => compareDecimal(quantity, cap) <= 0);
  if (!approvedQuantity) {
    return {
      status: "EMPTY",
      approvedQuantity: null,
      disposition: "DECISION_REEVALUATION_OR_VETO_REQUIRED",
      reasonCode: "NO_DECISION_QUALIFIED_SIZE_WITHIN_RISK_CAP",
    };
  }
  return {
    status: "PERMITTED",
    approvedQuantity,
    disposition:
      approvedQuantity === sizeSet.exactQuantities.at(-1)
        ? "AS_PROPOSED"
        : "CLAMPED_WITHIN_QUALIFIED_SET",
  };
}
