import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  assertBillingV2ForbiddenKeys,
  requireBillingV2IsoUtc,
} from "@/lib/trader/billing/v2/billing-v2-guards";

export const BILLING_POLICY_V2_SCHEMA = "waia.trader.billing_policy.v2" as const;

export const BILLING_POLICY_V2_VERSION = "billing-policy/ld-10-v2" as const;

/** Ratified Step 19 / LD-10 performance fee. Not a caller-controlled assessment parameter. */
export const BILLING_PERFORMANCE_FEE_RATE_V2 = "0.30" as const;

export const BILLING_POLICY_V2_CURRENCY = "USD" as const;

export const BILLING_POLICY_V2_MINIMUM_THRESHOLD = "0" as const;

export const BILLING_POLICY_V2_ROUNDING = "FULL_PRECISION_BEFORE_QUANTIZATION" as const;

export const BILLING_POLICY_V2_REPORTING_PERIOD = "SCOPE_ONLY_NOT_PROFIT_TRUTH" as const;

export const BILLING_POLICY_V2_EFFECTIVE_FROM_UTC = "2026-08-18T00:00:00.000Z" as const;

export type BillingPolicyV2 = Readonly<{
  schemaVersion: typeof BILLING_POLICY_V2_SCHEMA;
  policyVersion: typeof BILLING_POLICY_V2_VERSION;
  performanceFeeRate: typeof BILLING_PERFORMANCE_FEE_RATE_V2;
  billingCurrency: typeof BILLING_POLICY_V2_CURRENCY;
  minimumThreshold: typeof BILLING_POLICY_V2_MINIMUM_THRESHOLD;
  roundingPolicy: typeof BILLING_POLICY_V2_ROUNDING;
  reportingPeriodPolicy: typeof BILLING_POLICY_V2_REPORTING_PERIOD;
  effectiveFromUtc: typeof BILLING_POLICY_V2_EFFECTIVE_FROM_UTC;
  capitalAuthority: "NONE";
  contentDigestHex: string;
}>;

function policyBody() {
  return {
    schemaVersion: BILLING_POLICY_V2_SCHEMA,
    policyVersion: BILLING_POLICY_V2_VERSION,
    performanceFeeRate: BILLING_PERFORMANCE_FEE_RATE_V2,
    billingCurrency: BILLING_POLICY_V2_CURRENCY,
    minimumThreshold: BILLING_POLICY_V2_MINIMUM_THRESHOLD,
    roundingPolicy: BILLING_POLICY_V2_ROUNDING,
    reportingPeriodPolicy: BILLING_POLICY_V2_REPORTING_PERIOD,
    effectiveFromUtc: BILLING_POLICY_V2_EFFECTIVE_FROM_UTC,
    capitalAuthority: "NONE" as const,
  };
}

export function buildCanonicalBillingPolicyV2(input: object = {}): BillingPolicyV2 {
  assertBillingV2ForbiddenKeys(
    input,
    ["feeRate", "performanceFeeRate"],
    "BILLING_POLICY_RATE_NOT_CALLER_PARAMETER",
  );
  requireBillingV2IsoUtc(
    BILLING_POLICY_V2_EFFECTIVE_FROM_UTC,
    "BILLING_POLICY_EFFECTIVE_FROM_INVALID",
  );
  const body = policyBody();
  return Object.freeze({
    ...body,
    contentDigestHex: computeSemanticSha256Hex(body),
  });
}

export function assertCanonicalBillingPolicyV2(value: BillingPolicyV2): void {
  const canonical = buildCanonicalBillingPolicyV2();
  if (value.contentDigestHex !== canonical.contentDigestHex) {
    throw new Error("BILLING_POLICY_NOT_CANONICAL");
  }
  if (value.performanceFeeRate !== BILLING_PERFORMANCE_FEE_RATE_V2) {
    throw new Error("BILLING_POLICY_RATE_NOT_CALLER_PARAMETER");
  }
  if (value.policyVersion !== BILLING_POLICY_V2_VERSION) {
    throw new Error("BILLING_POLICY_VERSION_INVALID");
  }
}
