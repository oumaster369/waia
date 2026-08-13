# ADR-0029: Compact Forecast V2 seal and bytea replica artifacts

**Status:** Accepted  
**Date:** 2026-08-10  
**Linear:** DEE-518 / DEE-527 (WP-FORECAST-V2)

## Context

Gate-D ratified Forecast V2 with epistemic replicas (K) and aleatoric draws (M) where `S = K·M` may reach millions of ephemeral samples per anchor. Persisting per-sample relational rows would violate the 100 GiB evidence budget and hot-state O(1) invariant (plan §1.8, §1.12).

V1 tables (`trader_intelligence_forecast_record`, per-sample patterns) remain quarantined.

## Decision

1. **Compact seal per forecast.** Persist `distribution_semantic_digest` (`dist-sem-v1`) and metadata; regenerate samples on consumption via `WAIA_RANDOM_BLOCK_V1` + sealed roots.

2. **Replica artifacts as `bytea`.** Table `trader_forecast_replica_artifact_v2` stores sealed replica payloads ≤ 65536 bytes each; trigger-enforced.

3. **No per-sample table.** Forbidden: `trader_forecast_exec_sample_v2` or equivalent row-per-sample persistence.

4. **Package-level binding.** Terminal and Execution Opportunity roles bind through `trader_forecast_predictive_package_target_v2` in the same package.

5. **Migrations 0110–0129.** Additive V2 schema with org-scoped FKs, append-only triggers, RLS pairs.

## Consequences

- Replay determinism is mandatory: `FORECAST_DISTRIBUTION_REPLAY_MISMATCH` fail-closed.
- Storage-scale integration test (plan §8) proves `TOTAL_PROJECTED <= 100 GiB`.
- Decision consumes O(K) streaming regeneration, not stored sample rows.

## Related

- [DEE-518 plan §2.5.2](../plans/dee-518-ai-trader-correctness-mathematical-intelligence-fhv-v1.md)
- [ADR-0030 quantizer](0030-quantize-scale8-half-up-v1.md)
- [ADR-0031 cbrng](0031-waia-cbrng-sha256-ctr-v1.md)
- [LD-6 amendment §4-MV](../ai-trader/amendments/DEE-518-LD-6-FORECAST-V2-MV-AMENDMENT.md)
