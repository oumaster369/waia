# ADR-0032: AI-TWIN epistemic formation and authority separation

**Status:** Proposed — Human-ratified on 2026-09-01; becomes Accepted on merge  
**Date:** 2026-09-01  
**Linear:** DEE-130

## Context

The shipped AI-TWIN MVP represents six static topics as monotonic values in `{0,33,67,100}`, computes a floored average, unlocks Diary at `60%` and treats `100%` plus socialization completion as final readiness. A separate system-maturity score describes memory/pattern capability. Dialogue, Diary, avatar and Society prototypes exist, but there is no single versioned Human-model ledger, projection-aware epistemic loop, calibrated formation contract or independent authority model.

The product ambition is larger: a changing Human process, a private co-researcher, a future network of Twins and bounded real-world assistance. Extending the old percentage model would collapse knowledge, account trust, social readiness and action authority into one number, violating Human sovereignty and making progress unverifiable.

## Decision

1. Model the Human as a temporal, relational and revisable process, not a fixed profile.
2. Adopt six new visible domains and a cross-domain dynamic layer (`Sigma`, `Delta`, attractors, tensions, time and projection metadata).
3. Replace prompt-written readiness with deterministic evidence-ledger Formation maturity `0..4`, constitutional caps and explicit Human ratification at `100%`.
4. Make Diary available from initial privacy consent.
5. Replace formation progress with Model Health after `100%`; preserve formation history.
6. Treat Avatar Studio at `20%` as eligibility only; separate liveness, account authentication, uniqueness and legal identity.
7. Treat advice, socialization and external action as separate policy systems.
8. Make Society connections mutual, purpose-bound, versioned and revocable Alignment Contracts.
9. Preserve the universal epistemic spine demonstrated by AI-TRADER while keeping Human and market ontologies, permissions and runtimes separate.
10. Require Human ratification for constitutional semantic changes, production biometric activation, new high-impact authorities and Society launch.

## Consequences

- Existing readiness fields and UI remain a legacy runtime until an explicit migration batch ships.
- A new append-only evidence/model schema, shadow evaluation and backfill strategy are required before cutover.
- Historical Done issues remain valid evidence of the previous MVP; they are not rewritten to imply the target canon.
- The implementation grows in versions: v1 Formation/Embodiment/Adviser, v2 connected context/actions, v3 Society/contracts.
- `100%` becomes a Human-ratified initial contract, not a claim of complete knowledge.
- More abstention, visible unknowns and Human gates are expected product behavior.

## Rejected alternatives

- **Rename the existing six indicators but keep the same arithmetic.** It cannot represent relations, time, projection or calibration.
- **Use one global readiness score.** It conflates epistemic progress with trust, disclosure and authority.
- **Let the language model set progress.** It is non-deterministic, gameable and not auditable.
- **Lock Diary until formation progresses.** It withholds a primary observation channel and makes the score a coercive reward.
- **Treat liveness as identity or uniqueness.** The claims are technically and legally distinct.
- **Rank people by compatibility.** It converts uncertain, purpose-specific hypotheses into social value judgements and engagement incentives.
- **Grant action rights when the Twin is formed.** Knowledge never implies consent or authority.

## Related

- [`../product/AI-TWIN-PRODUCT-CONSTITUTION.md`](../product/AI-TWIN-PRODUCT-CONSTITUTION.md)
- [`../ai-twin/AI-TWIN-CANONICAL-ALGORITHM.md`](../ai-twin/AI-TWIN-CANONICAL-ALGORITHM.md)
- [`../ai-trader/AI-TRADER-CANONICAL-ALGORITHM.md`](../ai-trader/AI-TRADER-CANONICAL-ALGORITHM.md)
