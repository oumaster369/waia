---
registryId: GAP-REG-AI-TWIN-V1
title: "AI-TWIN v1 — gap registry"
scope: ai-twin
owner: Architect
linkedSpec: docs/product-specs/ai-twin-v1-completion.md
linkedRoadmap: docs/roadmaps/ai-twin-program-roadmap.md
lastReviewed: 2026-09-01
version: 1.0.0
---

# AI-TWIN v1 — gap registry

## Purpose

Track the evidence-backed difference between the shipped legacy AI-TWIN runtime and the active v1 completion specification. This registry records implementation gaps, not unresolved product meaning; semantic changes return to the Product Constitution and ADR process.

## Evidence baseline

The current runtime provides useful legacy foundations: bounded dialogue/replay, six persisted readiness integers, deterministic aggregation and tab locks, Diary storage/embeddings, a separate system-maturity score, Avatar placeholder and local Society preview. These are not discarded, but they do not satisfy the new semantics.

Primary code evidence at intake:

- `lib/readiness/readiness.ts` computes the floored mean, Diary `>=60`, Society via `socializationCompleted` and final readiness at `100 + socialization`.
- `db/schema.postgres.ts` table `twin_readiness_state` stores six integer columns plus socialization/final flags, without a versioned Human-model ledger.
- `lib/reasoning/twin-readiness.ts` computes a different system-maturity view, confirming that formation and runtime health already exist as separate concepts but are not canonically unified.
- `docs/product/ai-twin-readiness-model.md` defines the legacy `{0,33,67,100}` monotonic contract and old unlocks.
- Current Diary, avatar and Society surfaces lack the canonical observation, biometric trust and mutual-contract semantics.

## Gap entries

| gapId | summary | severity | status | specRef | batchRef | evidence |
|---|---|---|---|---|---|---|
| GAP-TWIN-001 | No append-only observation/claim/relation/hypothesis/consent/correction ledger | critical | open | A1–A3 | DEE-871 | Current `twin_readiness_state` is six ints + flags |
| GAP-TWIN-002 | Extractors do not preserve projection metadata, plural hypotheses and falsifiers | critical | open | A2, C4 | DEE-874 | Legacy readiness signals/prompts |
| GAP-TWIN-003 | Old six domains and arithmetic cannot represent process, dynamics or calibration | critical | open | B1–B5 | DEE-876 | `ai-twin-readiness-model.md`; `readiness.ts` |
| GAP-TWIN-004 | Formation, system health, presence, social readiness and authority can be confused | critical | open | B6 | DEE-876 | Two separate readiness implementations plus legacy flags |
| GAP-TWIN-005 | Dialogue lacks a typed epistemic-value Knowledge Need Planner | major | open | C1, C4 | DEE-878 | Current dialogue orchestration/replay |
| GAP-TWIN-006 | Diary remains score-gated and lacks per-entry modelling/disclosure firewall | critical | open | C2–C3 | DEE-872 | `diaryTabUnlocked = total >= 60` |
| GAP-TWIN-007 | Prediction → outcome → Human correction → calibration loop is incomplete | major | open | C5–C6 | DEE-875 | Feedback/system-readiness structures do not close lifecycle |
| GAP-TWIN-008 | No canonical Adviser reasoning contract or high-impact eval suite | critical | open | D1–D4 | DEE-877, DEE-881 | Current post-readiness state is final/socialization-oriented |
| GAP-TWIN-009 | Formation/Model Health/Initial Review target UX is absent | major | open | B3–B6, D1 | DEE-879 | Legacy dashboard indicators/locks |
| GAP-TWIN-010 | Account/device passkey lifecycle is not an AI-TWIN trust foundation | major | open | E2 | DEE-880 | Existing auth does not meet target ceremony contract |
| GAP-TWIN-011 | Avatar is a placeholder; no approved threat model, DPIA or liveness evidence pipeline | critical | open | E1, E3–E6 | DEE-873, DEE-882, DEE-883 | Avatar placeholder/current UI |
| GAP-TWIN-012 | No honest legacy-to-canonical backfill, shadow comparison or rollback | critical | open | F1–F3 | DEE-884 | Legacy semantics already persisted and tested |
| GAP-TWIN-013 | No integrated privacy/security/canonical Human pilot qualification | critical | open | F4–F6 | DEE-885 | Component tests cannot prove product/autonomy meaning |
| GAP-TWIN-014 | Connected context and delegated action capability system absent | deferred-v2 | deferred | Out of v1 | DEE-886..DEE-893 | Future connectors/gadgets/services request |
| GAP-TWIN-015 | Society is local preview, not mutual Alignment Contracts | deferred-v3 | deferred | Out of v1 | DEE-894..DEE-901 | Current Society prototype |

## Resolution rules

1. A gap closes only when the linked completion criteria have merged evidence; issue status alone is insufficient.
2. Semantic equivalence must be demonstrated, not inferred from a renamed field or UI.
3. Security/privacy/Human gates remain open until the Human decision is recorded.
4. Deferred v2/v3 gaps are not v1 blockers unless v1 accidentally introduces their authority or disclosure behavior.

## Intake rules

- Add a gap when repository/runtime evidence does not satisfy an active completion criterion.
- Cite the observable implementation or missing object; do not infer completion from an issue title.
- Product-semantic disputes are not gaps and must follow the WAIA DEV OS escalation/ADR path.
- Use `deferred-v2` or `deferred-v3` only when the capability is explicitly outside v1 and no v1 safety invariant depends on it.

## Resolution workflow

1. Reproduce or inspect the implementation delta and update the evidence column.
2. Map the gap to exactly one primary integration issue; related issues may contribute but do not share closure ownership.
3. Implement and validate through the canonical plan/PR for that issue.
4. On merge, attach the proof, close the gap only if the completion criterion is satisfied, and preserve Human gates as open where applicable.
5. Reconcile the roadmap and Linear if scope/dependency evidence changed.

## Traceability

| Artefact | Link |
|---|---|
| Completion spec | [`../product-specs/ai-twin-v1-completion.md`](../product-specs/ai-twin-v1-completion.md) |
| Roadmap | [`../roadmaps/ai-twin-program-roadmap.md`](../roadmaps/ai-twin-program-roadmap.md) |
| Lifecycle intake | [`../waia-governance/LIFECYCLE.md`](../waia-governance/LIFECYCLE.md) |
