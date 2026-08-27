# DEE-648 — Forecast Model Registry and Challenger Arena

## Admission and frozen boundary

Base: `b62f8e6432a62227902007b4e97f8bf746360822`. Duplicate/ownership/dependency audit found DEE-648 as the sole remaining owner; DEE-648A/DEE-741 owns contracts and persistence, DEE-647 owns Predictive Admission, DEE-632 owns production Forecast authority, and DEE-539 owns package selection. This change owns research-only registry, adapter and arena code.

The only mathematical predictor permitted by the merged input contract is `anchorRealizedVol20m_1m`; HypothesisAssessment remains applicability-only. All trials bind the exact Terminal and 13-D Execution Opportunity target digests, common PIT anchor, literal algorithm, deterministic failures, fixtures and resource budgets before execution. Holdout, PnL selection and capital promotion are structurally absent.

## Surfaces

- Producer: content-addressed `ModelTrialSpecV2` and deterministic registry.
- Consumer: research-only Forecast V2 adapter and common-anchor arena.
- Replay: digest reconstruction plus exact artifact/spec/input identity binding.
- Persistence: none; merged DEE-648A binding remains the sole selected-package persistence surface.
- Tests: registry conflicts, undeclared/future inputs, target/anchor mismatch, joint/marginal scoring and no-promotion firewall.
- Inventory: only `lib/trader/research/forecast-model-registry/**`, `lib/trader/research/challenger-arena/**`, dedicated unit tests and this plan.

Tier B families remain exact `RESEARCH_ONLY_UNIMPLEMENTED_<reason>` outcomes where no Human-frozen literal trial exists. No formula is improvised.
