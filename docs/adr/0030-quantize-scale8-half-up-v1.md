# ADR-0030: `quantizeScale8HalfUp/v1` (Forecast-only canonical quantizer)

**Status:** Accepted  
**Date:** 2026-08-10  
**Linear:** DEE-518 / DEE-527 (WP-FORECAST-V2)

## Context

Forecast V2 requires byte-exact reproducible canonical strings for `distribution_semantic_digest` streaming (plan §2.5.2). Risk/execution arithmetic on main uses scale-8 truncation toward zero via `lib/trader/risk/numeric.ts` — a separate semantics layer (plan §2.5.1, HPA-5).

Gate-D Human ratification (2026-08-09) plus DEE-518 C1 explicitly scopes HALF_UP quantizer to Forecast generative seals only.

## Decision

Adopt **`quantizeScale8HalfUp/v1`** for Forecast V2:

1. Decode IEEE-754 binary64 to exact rational representation.
2. Multiply by `10^8`; integer HALF_UP (ties away from zero).
3. Emit fixed 8-decimal canonical UTF-8 string.
4. Reject non-finite inputs fail-closed.

**Scope boundary:** Applies ONLY to Forecast generative canonicalization and `distribution_semantic_digest`. Does **not** replace Risk/execution `multiplyDecimal` truncation or `fill-economics.ts` local HALF_UP for bps amounts.

## Consequences

- Known-answer tests required for quantizer vectors.
- Unification with Risk numeric would require separate Human-approved ADR.
- `quantizer_version = quantizeScale8HalfUp/v1` appears in `dist-sem-v1` header block.

## Related

- [ADR-0029 compact Forecast V2](0029-compact-forecast-v2-seal-and-bytea-artifacts.md)
- [DEE-518 plan §2.5](../plans/dee-518-ai-trader-correctness-mathematical-intelligence-fhv-v1.md)
