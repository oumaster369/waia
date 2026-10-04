---
kind: plan-amendment
---

# DEE-1159 development stage binding

This amendment follows the sealed modeled-stage kernel. It does not change that kernel's public call: an owned executor, a descriptor minted by `sealOwnedResearchModeledStageDescriptorV1`, and an already verified payload. `scientificQualified` and `capitalEligible` stay false. Blind replay, scientific qualification, live orders, and migrations 0229 and 0230 stay out of this slice.

`runBoundDevelopmentModeledStagesV1` is the DEVELOPMENT dispatch for train, validation, and walk-forward. It refuses a forged callback, a parameter, evaluator, cost, or universe mismatch, a registration that was not sealed before scoring, and a repeated validation selection. It then calls only the sealed kernel and writes runner-observed receipts through the same executor. The receipt table statement is not a journal migration and is not applied here.

`runWalkForwardValidation` no longer scores a caller-supplied backtest. The legacy research pipeline still fits a lookback scorer, runs validation by strategy id, and records `evidenceBacktestUsesTrainFit: false`. That path remains ineligible and is not switched in this slice, because it also carries the blind tail and does not have a registered stage payload.

DEE-1159 and parent DEE-1152 stay open.

## 2026-10-03 independent audit and repair boundary

PR760 is merged as `0f6be381a68589d4abd4c8920b5a1fd3f5a02110`. The next slice is still a draft and is not admitted for merge or deployment. Its previous green checks on a stacked base omitted the normal main-target CI gates.

The bounded repair binds requested executable identity to the existing trusted deployment release assertion, records and checks the actual approved D-5 model digest, authenticates the descriptor before inspecting it, and requires a real root PostgreSQL database rather than a structural transaction callback or nested savepoint. Tenant identities and hostile input snapshots are checked before any validation reservation or kernel execution. These checks do not establish source provenance or scientific qualification.

The current `committedBeforeScoring: true` registration sealer remains an in-process caller assertion. It does not prove a durable pre-score registration. The supplied stage payload is also not a source-owner capability. Until a real owner loads and validates committed experiment/attempt/issued-source records, reserves validation use before exposing its data, constructs distinct stage ledgers, and invokes the real kernel, neither claim may be treated as acceptance. Current source issuance/readers cover observation and training only; do not relabel that range as validation or walk-forward.

Before integration, replace this missing owner boundary, establish canonical reservation/result persistence and privileges, and prove the actual caller with real PostgreSQL and the unmocked kernel. Include concurrency, root-commit uncertainty, retry after disclosure, cross-organization refusal and immutable stage identities. A bare table migration alone does not satisfy those requirements. No production schema or financial rule is changed by this draft. Legacy missing-identity evidence remains ineligible; blind authorization and scientific qualification remain separate.

## 2026-10-04 stage ledger isolation repair

The current batch binder accepts different stage labels with the same historical run or account namespace. That can carry mock orders, positions or accounting state between training and validation/window replays. Before any validation reservation or kernel call, validate each ledger scope and refuse reuse of either the historical run ID or historical account key within the batch. Keep the logical account in the experiment unchanged. Focused regressions must demonstrate rejection of each alias independently and between walk-forward windows, with no DB transaction or kernel invocation; distinct namespaces must still reach the kernel unchanged.

This is a bounded repair inside the existing draft. It does not establish durable preregistration, trusted payload loading, cross-call namespace ownership, a validation disclosure owner, a real caller, native acceptance or scientific qualification. Those remain required before integration; no database migration or production execution is part of this repair.

## 2026-10-04 durable registration caller package

Add two separate operator-authorized, default-off `discovery-run` modes calling the existing committed experiment registry and issued V2 attempt writer. The first accepts an internal organization and a bounded regular JSON proposal file, validates the existing full experiment contract, and returns only registration identity. The second accepts only organization, registered spec digest, source-run ID and stable command ID; the existing V2 writer verifies the persisted source/experiment and commits the issued attempt. Neither mode prepares a source, scores, selects a candidate or chains the next stage automatically.

Reject mixed, duplicated, unknown and positional flags before any file or database access; require CLI enablement and existing operator authorization before reading the proposal or opening the DB. Read at most256KiB plus one byte from an opened regular file, reject oversized/invalid UTF-8/invalid JSON or mismatched organization, and never print raw proposal, errors, paths or connection data. Output contains explicit registration-only authority and false scientific/capital eligibility. Existing root transaction, retry/conflict and provenance checks remain in the writers. Separate commands are separate root commits; do not claim atomic registration of the whole pipeline.

Focused CLI/file tests must verify order and refusal without side effects. A synthetic isolated PostgreSQL case must exercise the actual branches with real writers, read back both durable records, retry the same identities, and prove that no modeled orders/fills/traces were produced. Existing missing production schema and validation/WF source-owner acceptance remain blockers; test fixture DDL is not a production migration. No production invocation, external data scoring or permission to merge this T3 draft is introduced.

## 2026-10-04 DEVELOPMENT evaluation range preflight

The issued V2 owner currently binds only the observation/train metadata: it can accept a registered experiment whose later validation or walk-forward declarations have impossible one-minute counts or lie outside DEVELOPMENT. Before expanding source issuance, reject those declarations inside the existing metadata owner, before source payload loading, issued-attempt insertion or training. Validate canonical minute boundaries, exact duration/count arithmetic and safe integers for validation and every ordered walk-forward slice, all within the existing DEVELOPMENT interval. Reuse the experiment contract's ordering/non-overlap rules. Do not change the generic experiment contract or read/validate the blind payload; this gate applies to this closed DEVELOPMENT lane only.

The check establishes declared range integrity, not actual source availability, hashes, PIT qualification or disclosure authority. Do not derive absolute record indexes from timestamp differences across unverified gaps. The trusted future source owner must observe and prove each selected source range and retain the registered discovery context. Focused negative cases and isolated PostgreSQL must prove refusal before any attempt or modeled effects; valid DEVELOPMENT registrations and existing training/recovery acceptance must remain unchanged.
