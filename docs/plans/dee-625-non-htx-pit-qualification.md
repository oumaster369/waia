---
integrationIssue: DEE-625
integrationTitle: "Selective Non-HTX PIT Historical Qualification"
parentIssue: DEE-594
branch: dee-625-non-htx-intake
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation:
  - selective-intake-contract-negatives
  - deterministic-receipt-replay
  - blind-2025-seal
  - whole-consumer-closure
  - one-full-fresh-sqlite-suite
  - independent-exact-head-review
  - dee-653-exact-head-admission
state:
  status: in-progress
  currentWorkPackage: DEE-716
  completedWorkPackages: []
  remainingWorkPackages: [DEE-716, DEE-717, DEE-719, DEE-718]
  prNumber: null
  prUrl: null
  blockedReason: null
provenance:
  authoritativeBase: ec3ad645cfdfb2b01b1686a597e68e85d390fdc1
  humanRatification: "Human said Работай after the controller presented the exact conservative two-class intake; authority is limited to Alternative.me fear_greed_index and receipt-only CoinDesk/Cointelegraph/Decrypt RSS news_headline, fixed pre-holdout partitions, and explicit exclusions."
---

# DEE-625 — Selective Non-HTX PIT Historical Qualification

## Frozen intake

1. `fear_greed_index` via public, credential-free Alternative.me `/fng/`: a bounded capability probe may produce immutable endpoint/retrieval/content receipts. A replay corpus is admitted only if immutable historical event, availability, ingest and revision identity are all proven for 2020–2024. Otherwise the result is receipt-only `NOT_QUALIFIED`.
2. `news_headline` via current CoinDesk, Cointelegraph and Decrypt RSS: receipt-only `NOT_QUALIFIED`, because the current feeds do not establish truthful historical archive, availability, ingest or revision lineage.
3. Every other registered non-HTX provider remains excluded from this train. No credential, license or provider class is added.

## Fixed partitions and authority

- DEVELOPMENT: 2020–2022.
- WALK_FORWARD_PREDICTIVE: 2023.
- WALK_FORWARD_ECONOMIC: 2024.
- BLIND_HOLDOUT: 2025 onward, sealed and rejected before payload access.
- Authority is `RESEARCH_NON_CAPITAL`. Receipts cannot confer REQUIRED/OPTIONAL, Forecast, Decision, Risk, Execution, production/live or capital authority.

## Invariants

1. Event time alone never proves time of knowability.
2. Missing availability, ingest, immutable-history or revision evidence forces `NOT_QUALIFIED` and `corpusAdmitted=false`.
3. Current RSS is never retrospectively rewritten into history.
4. No interpolation, zero/stale/current/synthetic fill exists.
5. Exact raw content, capability evidence, partition policy and final receipt digests are deterministic and mutation-sensitive.
6. Replay consumes receipts/corpus only; it never calls a live provider.
7. Blind 2025 rejects before item selection or payload access.
8. Provider count never proves independence; all three RSS feeds are separate provider receipts for the same unqualified class and add no effective-information authority.
9. Rollback is one revert of the squash merge; no migration or external durable mutation exists.

## A → B → C → D

- DEE-716 A freezes the API, closed vocabulary, fixed partitions and exclusion policy.
- DEE-717 B evaluates only bounded Alternative.me capability evidence and fails closed unless all PIT dimensions are proven.
- DEE-719 C emits deterministic receipt-only RSS `NOT_QUALIFIED` evidence.
- DEE-718 D closes replay, consumer inventory, deterministic mutation proofs and blind seal.

## Validation

```bash
pnpm test --run tests/unit/trader-non-htx-pit-qualification-v1.test.ts
pnpm typecheck
pnpm build
./scripts/linear/validate-integration-train-manifest.sh docs/plans/dee-625-non-htx-pit-qualification.integration-train.json DEE-625 frozen
pnpm validate:canon
pnpm validate:pr-governance
```

After semantic completion and preliminary review, run one full suite on a freshly migrated SQLite database. Publish one PR only from an exact reviewed head with zero P1/P2, authoritative CI and DEE-653 PASS.

## Bounded capability result

- The exact public request returned HTTP 200 at `2026-08-26T03:11:11.000Z` with 3,125 event-time rows.
- Exact response bytes SHA-256: `db55e69207fa75f59a3518728da2cf91b02b6dc280a045a60b5e1b64dfa4ca33`.
- The response exposes event timestamps but no historical `availableAt`, revision identity, ingest lineage or immutable-history proof. Therefore `fear_greed_index` is receipt-only `NOT_QUALIFIED`; no corpus was created.
- CoinDesk, Cointelegraph and Decrypt current RSS remain receipt-only `NOT_QUALIFIED`; no historical reconstruction was attempted.
