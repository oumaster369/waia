---
roadmapId: ROADMAP-AI-TWIN
title: "AI-TWIN — canonical implementation roadmap"
horizon: v1-v3
owner: Architect
linkedSpec: docs/product-specs/ai-twin-v1-completion.md
linkedGapRegistry: docs/gaps/ai-twin-v1-gap-registry.md
lastReviewed: 2026-09-06
version: 1.2.0
---

# AI-TWIN — canonical implementation roadmap

## Purpose

Turn the Human-ratified AI-TWIN constitution into an auditable sequence. This roadmap authorizes no implementation by itself: the Human must explicitly start implementation after DEE-130 preparation and retains every merge/production gate.

The program is deliberately downstream of, but not blocked by, the active AI-TRADER program. It may reuse domain-neutral epistemic patterns after they are stable; it must not edit or couple AI-TRADER runtime/execution authority.

## Integration batches

### 2026-09-06 explicit resumption

The Human resumed source recovery, audit, AI-TWIN documentation/Linear reconciliation and isolated implementation. This supersedes historical blanket waiting below; it does **not** assert Trader completion. Every admitted Twin batch must use a separate main-based worktree, verify dependencies/file overlap, preserve other WIP and leave Trader processes, issues, data, server and automation untouched. Shared auth/database/gateway changes need isolated impact analysis and regression evidence before admission. Merge, deployment, production migrations, paid providers and real-world effects still require separate permission. No periodic automation was requested.

DEE-943 reconciles evidence/canon; DEE-923 is first because DEE-922 is merged and static disclosure needs no shared-runtime mutation. It is not a substitute for DEE-871 or the remaining epistemic work.

Each issue row below is an integration batch with one branch, one canonical plan, one PR and one merge. The order column is a dependency wave, not a license for unreviewed parallel execution.

## Version gates

```text
DEE-130 canon
  -> v1 Formation / Embodiment / Adviser
  -> governed cost evidence + pre-billing disclosure
  -> Human v1 cutover + biometric + rollout decisions
  -> v2 Connected Context / Delegated Actions
  -> Human bounded-action pilot decision
  -> v3 Society / Alignment Contracts
  -> Human price disclosure + Society connection + subscription consent
  -> optional community-sponsored subscription fulfillment
  -> Human Society pilot and launch decision
```

## v1 — Formation, Embodiment & Adviser (DEE-868)

| Order | Issue   | Integration outcome                                        | Depends on                  | Risk                 |
| ----: | ------- | ---------------------------------------------------------- | --------------------------- | -------------------- |
|     0 | DEE-130 | Canon, ADR, spec, gaps, roadmap and Linear graph           | —                           | T1 semantic docs     |
|     1 | DEE-871 | Epistemic ledger and Human-model persistence               | DEE-130                     | T3                   |
|     1 | DEE-873 | Presence/biometric privacy threat model and Human gate     | DEE-130                     | T2 docs / Human gate |
|     1 | DEE-872 | Diary available from consent with privacy firewall         | DEE-130; coordinate DEE-871 | T3                   |
|     2 | DEE-874 | Projection-aware extraction and competing hypotheses       | DEE-871                     | T3                   |
|     2 | DEE-880 | Passkey/device authentication foundation                   | DEE-873                     | T3                   |
|     3 | DEE-876 | Deterministic Formation Contract and Model Health          | DEE-871, DEE-874            | T2/T3                |
|     3 | DEE-875 | Prediction/experiment/outcome/correction loop              | DEE-871, DEE-874            | T2                   |
|     3 | DEE-882 | Active liveness ceremony/evidence pipeline                 | DEE-873, DEE-880            | T3 / Human gate      |
|     4 | DEE-878 | Knowledge Need Planner and adaptive dialogue               | DEE-874, DEE-876            | T2                   |
|     4 | DEE-877 | Adviser contract and safety evals                          | DEE-875, DEE-876            | T2                   |
|     4 | DEE-879 | Formation, Model Health and Initial Review UX              | DEE-876                     | T2                   |
|     5 | DEE-881 | Adviser/co-research workspace                              | DEE-877, DEE-879            | T2                   |
|     5 | DEE-883 | Avatar Studio experience                                   | DEE-879, DEE-882            | T2/T3                |
|     5 | DEE-884 | Legacy migration, backfill and shadow evaluation           | DEE-872, DEE-876, DEE-878   | T3 / Human gate      |
|     6 | DEE-885 | Integrated qualification, Human pilot and production gates | all v1 outcomes             | T3/T4 gates          |

### v1 stop conditions

- Do not implement liveness before DEE-873 Human approval.
- Do not cut over legacy readiness before DEE-884 shadow evidence and Human approval.
- Do not activate production biometrics or pilot/production rollout inside a software merge.
- Do not start v2 as a workaround for incomplete v1 authority separation.

### v1 canonical plans

| Issue   | Plan                                                                                                                         |
| ------- | ---------------------------------------------------------------------------------------------------------------------------- |
| DEE-871 | [`../plans/dee-871-ai-twin-epistemic-ledger.md`](../plans/dee-871-ai-twin-epistemic-ledger.md)                               |
| DEE-872 | [`../plans/dee-872-ai-twin-diary-privacy-firewall.md`](../plans/dee-872-ai-twin-diary-privacy-firewall.md)                   |
| DEE-873 | [`../plans/dee-873-ai-twin-presence-biometric-threat-model.md`](../plans/dee-873-ai-twin-presence-biometric-threat-model.md) |
| DEE-874 | [`../plans/dee-874-ai-twin-observation-hypothesis-engine.md`](../plans/dee-874-ai-twin-observation-hypothesis-engine.md)     |
| DEE-875 | [`../plans/dee-875-ai-twin-calibration-loop.md`](../plans/dee-875-ai-twin-calibration-loop.md)                               |
| DEE-876 | [`../plans/dee-876-ai-twin-formation-model-health.md`](../plans/dee-876-ai-twin-formation-model-health.md)                   |
| DEE-877 | [`../plans/dee-877-ai-twin-adviser-contract-evals.md`](../plans/dee-877-ai-twin-adviser-contract-evals.md)                   |
| DEE-878 | [`../plans/dee-878-ai-twin-knowledge-need-dialogue.md`](../plans/dee-878-ai-twin-knowledge-need-dialogue.md)                 |
| DEE-879 | [`../plans/dee-879-ai-twin-formation-experience.md`](../plans/dee-879-ai-twin-formation-experience.md)                       |
| DEE-880 | [`../plans/dee-880-ai-twin-passkey-foundation.md`](../plans/dee-880-ai-twin-passkey-foundation.md)                           |
| DEE-881 | [`../plans/dee-881-ai-twin-adviser-workspace.md`](../plans/dee-881-ai-twin-adviser-workspace.md)                             |
| DEE-882 | [`../plans/dee-882-ai-twin-liveness-pipeline.md`](../plans/dee-882-ai-twin-liveness-pipeline.md)                             |
| DEE-883 | [`../plans/dee-883-ai-twin-avatar-studio.md`](../plans/dee-883-ai-twin-avatar-studio.md)                                     |
| DEE-884 | [`../plans/dee-884-ai-twin-readiness-migration.md`](../plans/dee-884-ai-twin-readiness-migration.md)                         |
| DEE-885 | [`../plans/dee-885-ai-twin-v1-qualification.md`](../plans/dee-885-ai-twin-v1-qualification.md)                               |

## v2 — Connected Context & Delegated Actions (DEE-870)

DEE-886 is the semantic/provider Human gate. Detailed canonical plans for DEE-887..DEE-893 must be authored from its ratified provider portfolio and risk policy; freezing them now would invent credentials, providers and reserved-matter decisions. Their Linear contracts and dependency order below are execution intake, not implementation permission.

| Order | Issue   | Integration outcome                                        | Depends on                  | Risk            |
| ----: | ------- | ---------------------------------------------------------- | --------------------------- | --------------- |
|     0 | DEE-886 | Connector/capability contract and first provider portfolio | DEE-885                     | T1 / Human gate |
|     1 | DEE-887 | Consent, credential and connector registry                 | DEE-886                     | T3              |
|     1 | DEE-888 | Deterministic action policy/reserved matters               | DEE-886                     | T3              |
|     1 | DEE-889 | Consented read-only context ingestion                      | DEE-886, coordinate DEE-887 | T3              |
|     2 | DEE-890 | Plan → permission → attempt → receipt → Reality spine      | DEE-887, DEE-888            | T3              |
|     3 | DEE-891 | Human authority/control center                             | DEE-887, DEE-890            | T2              |
|     3 | DEE-893 | First Human-approved bounded provider workflows            | DEE-890                     | T3/T4 gate      |
|     4 | DEE-892 | Integrated security qualification and bounded pilot        | all v2 outcomes             | T3/T4 gates     |

## v3 — Society & Alignment Contracts (DEE-869)

DEE-894 is the detailed Society Human gate. Canonical plans for DEE-895..DEE-901 must be authored after its relationship-purpose ontology, disclosure protocol, pilot population and safety policy are ratified; their Linear contracts below preserve scope without pretending those Human decisions already exist.

| Order | Issue   | Integration outcome                                | Depends on                | Risk            |
| ----: | ------- | -------------------------------------------------- | ------------------------- | --------------- |
|     0 | DEE-894 | Detailed Society/Alignment Contract product spec   | DEE-892                   | T1 / Human gate |
|     1 | DEE-895 | Social graph and mutual contract persistence       | DEE-894                   | T3              |
|     1 | DEE-896 | Purpose-specific Social Readiness/disclosure       | DEE-894                   | T3              |
|     1 | DEE-897 | Compatibility hypothesis engine                    | DEE-894                   | T2/T3           |
|     1 | DEE-898 | Safety/privacy/abuse/fairness controls             | DEE-894                   | T3 / Human gate |
|     2 | DEE-899 | Bounded Twin-to-Twin introduction protocol         | DEE-895, DEE-896, DEE-897 | T3              |
|     3 | DEE-901 | Consent-first Society/contract experience          | DEE-895, DEE-899          | T2              |
|     4 | DEE-900 | Integrated pilot, evaluation and Human launch gate | all v3 outcomes           | T3/T4 gates     |

## Cross-version economics and universal access (DEE-922)

These batches preserve the v1/v2/v3 gates. Historically (2026-09-02) they were deferred until Trader completion and Human restart. The 2026-09-06 instruction now permits individually audited, isolated Twin batches; unresolved task-specific dependencies remain binding.

| Order | Issue   | Integration outcome                                                                        | Depends on                              | Risk                          |
| ----: | ------- | ------------------------------------------------------------------------------------------ | --------------------------------------- | ----------------------------- |
|     0 | DEE-922 | Additive AI-TWIN subscription/pricing/access canon and Linear graph                        | DEE-130, DEE-612                        | T1 semantic docs              |
|     1 | DEE-923 | Exact pre-billing disclosure below the Formation dialogue                                  | DEE-922; coordinate DEE-879             | T2 frontend                   |
|     1 | DEE-924 | Verified per-active-Twin cost snapshots and Human-approved `cost x 5` price book           | DEE-922; WAIA Core/Treasury foundations | T3 backend                    |
|     2 | DEE-925 | Consented Society connection and subscription activation lifecycle                         | DEE-894, DEE-895, DEE-924               | T3/T4 backend and Human gates |
|     3 | DEE-926 | Community-sponsored subscription request, reservation, payment and entitlement fulfillment | DEE-612, DEE-925                        | T3 backend                    |
|     4 | DEE-927 | User-dashboard and public Support sponsorship experience                                   | DEE-925, DEE-926; coordinate DEE-901    | T2 frontend                   |

### Economic and access stop conditions

- Do not begin billing at Formation `100%` or `READY`.
- Do not publish or bill a calculated price until a Human approves the exact price-book version.
- Do not activate a Society subscription without a voluntary connection choice, price disclosure and explicit Human confirmation.
- Historical blanket pause for DEE-923..DEE-927 is superseded by the explicit 2026-09-06 isolated-work instruction above. No task starts solely because the pause ended: prove its dependencies, scope and non-interference first.
- Do not apply payment, entitlement or sponsored-access production migrations inside a software merge.
- Do not count sponsored subscriptions as ordinary donation/Patron share without a later Human-ratified policy.

## Execution rule

Qualification includes **all** version outcomes: DEE-892 requires DEE-891/893 as well as backend evidence; DEE-900 requires DEE-901 as well as safety/protocol evidence. A partial Linear graph is not whole-version qualification. DEE-872 must coordinate the consent/ledger contract with DEE-871 before persistence implementation.

Each row is one integration issue, branch, canonical plan, PR and merge. An issue must be refreshed from `main`, must not begin while a blocking Human gate is unresolved, and must update this roadmap/gap registry when scope or proof changes. Parallel work is allowed only for rows at the same order whose file ownership and migrations are demonstrably non-overlapping.

## Batch schema

Every batch requires: Linear issue identifier; exactly one execution label; version milestone/epic; Context, Goal, Scope, Do NOT, Acceptance Criteria, Files, Dependencies and Validation commands; risk tier; branch from current `origin/main`; canonical plan; one PR; completion-spec/gap evidence; and explicit Human gates. `Done` means merged evidence, not implementation intent.

## Dependencies

- Human-ratified [`AI-TWIN Product Constitution`](../product/AI-TWIN-PRODUCT-CONSTITUTION.md) and ADR-0032.
- WAIA Core identity, tenancy, audit and current staged persistence/AI Gateway contracts.
- Existing legacy AI-TWIN runtime as migration evidence, never as target semantic truth.
- AI-TRADER canonical algorithm as a read-only architecture precedent. AI-TWIN implementation cannot mutate or block its active completion work.
- Explicit Human permission to start implementation after DEE-130, plus all per-version security/production gates.
- DEE-612 universal-access doctrine and existing WAIA Core subscription/entitlement/Treasury foundations for DEE-922..DEE-927.

## Traceability

| Artefact               | Link                                                                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Product constitution   | [`../product/AI-TWIN-PRODUCT-CONSTITUTION.md`](../product/AI-TWIN-PRODUCT-CONSTITUTION.md)                                                     |
| Completion spec        | [`../product-specs/ai-twin-v1-completion.md`](../product-specs/ai-twin-v1-completion.md)                                                       |
| Gap registry           | [`../gaps/ai-twin-v1-gap-registry.md`](../gaps/ai-twin-v1-gap-registry.md)                                                                     |
| Preparation plan       | [`../plans/dee-130-ai-twin-canonical-product-epistemic-architecture.md`](../plans/dee-130-ai-twin-canonical-product-epistemic-architecture.md) |
| Linear epics           | DEE-868 (v1), DEE-870 (v2), DEE-869 (v3)                                                                                                       |
| Economics/access canon | DEE-922; [`../plans/dee-922-ai-twin-subscription-access-canon.md`](../plans/dee-922-ai-twin-subscription-access-canon.md)                      |
