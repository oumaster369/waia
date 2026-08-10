# ADR-0031: `WAIA_RANDOM_BLOCK_V1` / `waia-cbrng/sha256-ctr/v1`

**Status:** Accepted  
**Date:** 2026-08-10  
**Linear:** DEE-518 / DEE-527, DEE-531 (WP-FORECAST-V2, WP-RESEARCH-HARNESS)

## Context

Forecast V2 epistemic bootstrap, aleatoric pool sampling, scoring CRN, and research validation bootstrap require deterministic, replayable randomness without mutable PRNG cursors or library-default RNG (plan §2.4.0, §2.6, B2).

## Decision

Adopt **`waia-cbrng/sha256-ctr/v1`** with **`WAIA_RANDOM_BLOCK_V1`** 64-byte preimage layout:

| Offset | Field |
|--------|-------|
| 0–7 | `MAGIC` = `WAIACBR1` |
| 8–15 | 8-byte ASCII `DOMAIN` constant |
| 16–47 | 32-byte `ROOT_SEED` (never uint32 truncation) |
| 48–51 | `replica_u32` BE |
| 52–55 | `sample_u32` BE |
| 56–59 | `draw_u32` BE |
| 60–63 | `retry_u32` BE |

`block = SHA256(preimage)`.

**Frozen DOMAIN constants:** `EPIBOOT1`, `ALEDRAW1`, `SCORECRN1`, `VALBOOT1`.

**Frozen 16-byte root prefixes:** `WAIAEPIBOOTROOT1`, `WAIAALEDRAWROOT1`, `WAIASCOREROOT001`, `WAIAVALBOOTROOT1`.

**`UNBIASED_INT(N)`** via rejection sampling on uint53 from block bytes — no floating Bernoulli for bootstrap restart (`p = 1/L` exact integer test).

## Forbidden

- Mutable PRNG cursor state
- `Math.random`, library default RNG
- Floating `Math.cbrt` for bootstrap block length `L`
- Long symbolic domain string hashing at runtime

## Consequences

- Known-answer vectors mandatory for each DOMAIN.
- `stationary-bootstrap/v1` uses `EPIBOOT1` exclusively.
- Research harness significance resampling uses `VALBOOT1` with `B = 10000`.

## Related

- [ADR-0029](0029-compact-forecast-v2-seal-and-bytea-artifacts.md)
- [DEE-518 plan §2.6](../plans/dee-518-ai-trader-correctness-mathematical-intelligence-fhv-v1.md)
