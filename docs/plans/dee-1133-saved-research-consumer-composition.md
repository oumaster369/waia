---
integrationIssue: DEE-1133
integrationTitle: "Compose saved Understanding and research consumption under one holder"
parentIssue: DEE-639
branch: dee-1133-saved-research-consumer-composition
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, postgres-ci]
requiredValidation: [lint, typecheck, targeted-unit, native-postgres, build, validate-canon, validate-pr-governance, validate-execution-v2-consumer-graph, validate-reality-v2-consumer-graph]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-progress
  currentWorkPackage: WP-1
  completedWorkPackages: []
  remainingWorkPackages: [WP-1, WP-2, WP-3]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "WP-1 fixed completion writer and held accounting source frozen for independent review and coordinated scoped checks. WP-2 composition and native execution are not yet released."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1133 — Saved Understanding and application consumption

## Admission and dependency

Single backend/T3 issue [DEE-1133](https://linear.app/deepsense/issue/DEE-1133/ai-trader-compose-saved-understanding-and-research-consumption-under), UUID `3780a700-af54-4095-bc08-374fa20dba9f`, parent P10/DEE-639. Root reports DEE-1132 Done and this dependency unblocked. This is the sole canonical plan on the matching branch, committed for root review before executable work. Its draft state and null validation fields do not claim implementation or validation success.

DEE-1132/PR691 was checked and merged at `2026-09-27T17:16:37Z` as accepted main `630abef5b3be074764715fb94047f43db3ad6765`, tree `48518be94496a4fdfc1ac9a476468fd8a9ec4550`. That tree exactly equals the reviewed/tested published head `b71abcf96f85fc3530d0f23ec47d2e97884cff4b`. Root post-merge receipt `evidence/dee-1132/root-postmerge-reconciliation.json` records main synchronization and source carry. The existing clean checkout was reused with no active product process; the new branch starts at that exact commit. No duplicate issue, worktree or PR was created. Root's release covers this plan only; executable edits, tests, heavy checks and native/DB execution await their separate grants.

Historical prospective source `5740475f7d9c54af20e7262d13e29f5b4e882990` and intermediate PR head `fbccbddb99e5db48c4d9370bf531ce3965baa35e` are not the implementation base. A fresh immutable comparison rechecked all 23 existing independently reviewed source paths plus the still-absent new writer. Only three reviewed paths changed: application repository, application manifest and application capability test. The accepted application now calls exactly the two inert held measurement delegates in the MI service; that service remains the sole direct canonical repository importer. Preserve this corrected boundary, the actual shared-reader guards and all their negative controls.

The accepted application manifest has 91 command paths, digest `69173bd6a13256fe6dcb31ccd7fa21bb3d59776248d64e1ed6b121a02c9fecc2`, and 11 pure paths, digest `fbbeb707fe792747e88ad5e76782651f40fa7fd9351a6b47b2af83cf09bb8bb8`; every recorded file hash was compared with accepted source without running a generator. The Understanding pure manifest digest remains `abb0618c8dc0298376fe7513c184d6c20f67aa93551caadfb1febf4f3de9f3b4`. Measure the successor command closure from actual dependencies, while preserving both pure manifests and all meaning. Accepted DEE-1132 CI proved the old 45 application cases and strict 25-suite union; it does not prove the new composite route's capacity or recovery.

Accepted proposal: external `parallel-runtime-owner/next-runtime-map-42d5/REPORT-2026-09-27-5740475f.md`, SHA `f2f50b4c469183492ae71bc9abf58f77a529fc8938720c7d7ec47e4e06454dc3`, freeze `b55181aaf9c35d9482f8ceac84a115c7b83817de2f444d02c65cf98e4c024cd4`. Independent prospective review: `milestone-audits/DEE1132-next-runtime-proposal-review-5740475f/REPORT.md`, SHA `f0aece324e74d5fb27969addc43b2d63953b50937d8e416bf11ad234fa074e76`, manifest `71b29a31416f99d35358aadaebdcb7ac14abb348ddf28802806ecadc2e171994`. Root verified the five proposal artifacts and 23 source pins. Prospective acceptance establishes the finite contract, not implementation correctness or capacity.

## Goal and exact preconditions

Add one explicit `complete-consumer` operation under the existing saved-application CLI mode. It completes actual saved Understanding for one explicitly selected source packet B when that completion is absent, then consumes the existing research application under the same private current holder. This closes the saved Understanding-B→application-consumption owner/recovery boundary within P10; it does not implement unattended selection/cadence or the full 23-stage runtime.

The operation requires:

- An existing exact research assignment/profile, consecutive P/A completions, application and committed availability certificate S. No assignment/application/certificate creation or new S on this path.
- One explicitly selected B>A with saved PIT strictly later than S and advancing source close. B's real recorded packet/source identities and immediate relative-sequence research predecessor must exist. Retain nonzero firstSourceSequence handling.
- Exact tenant/account/symbol/source configuration/profile/computation/registry/actor bindings. Registry version/lifecycle and source/revision checks retain their existing meaning.
- The actual supported successor command manifest. Native fixtures create P/A and S under that manifest; unsupported older command manifests refuse without compatibility invention or saved-row rewrite.

For P0/A1/B3, predecessor2 metadata may be read, but packet2/completion2 bodies are outside scope. Missing predecessor2 refuses; there is no implicit next-B choice, scan, skipping or backfill. Source acquisition remains external to this command and its existing holder may remain busy until expiry.

## Fixed computation, ownership and accounting

Mechanically share the existing Understanding preparation/completion writer: real RR snapshot, fixed evaluator/sealer, then RC assignment/completion, source/revision/predecessor and receipt-authority rechecks. The old public root-pool wrapper retains assignment creation, range validation, transactions, outputs and refusal behavior. The new route requires the existing assignment and uses a narrow internal bound seam on the actual originating held client. It must not nest the public root owner, invent a transaction facade, duplicate the writer, or accept a caller-prepared output/evaluator/callback.

Completed consumption replays in READ ONLY before claim. Otherwise one private current holder covers the B-completion transaction followed by the existing consumption transaction. Separate commits intentionally retain a valid B completion if consumption fails. Incomplete restart still respects the previous live organization holder until actual expiry; no release, renewal, transfer, old-holder resurrection or second claim is added. Unknown SQL/commit errors must not become market unavailability, completed success or a false rollback claim.

Holder-bearing completion and consumption rows and application audit linkage share the actual holder tuple and one new lease epoch. **The sufficiency receipt has no holder columns:** it is persisted in the same completion transaction and atomically fenced by that completion's deferred holder check. Do not add schema fields. Research and application SERVICE identities remain distinct, with existing USER membership/assignment checks.

One existing HeldResearchAccounting covers preparation, every nested persistence query and actual BEGIN/COMMIT/ROLLBACK finalization through consumption. Preserve 512 SQL statements,120000ms,67,108,864 total unique bytes, three selected bodies P/A/B, row/replay caps,5s lock/30s statement limits and the existing lease maximum. **The 4,000,000-byte additional-body component is subordinate to that 64MiB total, not extra headroom.** Replace independent old-writer budget defaults on the composite route with descendants of the shared accounting; preserve the old wrapper's behavior. Admit candidate completion/receipt bytes and later projected rows before body transfer, with exact projection/identity accounting and no budget reset.

Keep pure computation, categories, all 12 claims, FOR/AGAINST/UNASSESSED/maxAge, trust, policy and authority unchanged. Equivalence with the existing two stages concerns **deterministic evidence meaning and policy outputs**; independently sampled operational timestamps and separately claimed holder bytes need not match. Actual maximum 32-history capacity must be measured for this new route; DEE-1132's earlier measurements do not prove it fits.

## Closed file map

Only these 15 executable/test paths plus this canonical plan are admitted for the planned implementation. The historical 12-path contract is retained; root explicitly admitted three strict closure/inventory followthrough paths after accepted-main inspection demonstrated that the current checks pin receipt writes and both fixed recomputation calls in the old repository. This is real delegation/source-identity maintenance, not cosmetic markers or wider capability allowance. Any further path requires root evidence-backed admission before edits.

| Path | Change |
|---|---|
| `lib/trader/paper/research-understanding-v1/completion-write-postgres.ts` (new) | Extract fixed internal completion preparation/held writer with original seal, receipt, source/predecessor and current-holder guards; no caller-output command API. |
| `lib/trader/paper/research-understanding-v1/repository-postgres.ts` | Delegate old completion behavior to the shared seam while preserving root-only/range/assignment/RR→RC/replay contracts. |
| `lib/trader/paper/research-understanding-v1/held-replay.ts` | Bind narrow fixed completion preparation/write methods to the real held client and one accounting object; retain read-only replay and actual codec ownership. |
| `lib/trader/paper/research-application-v1/repository-postgres.ts` | Capture the explicit operation; require existing dependencies, complete only B under the private holder, then call existing consume with that holder. |
| `lib/trader/paper/research-application-v1/cli-options.ts` | Admit `complete-consumer` and mandatory consumer-sequence through existing strict flags/file validation. |
| `scripts/trader/generate-research-application-manifest.ts` | Admit only the exact new internal module in the closed command inventory; preserve pure allowlist/traversal and forbidden capabilities. |
| `lib/trader/paper/research-application-v1/computation-manifest.ts` | Generate actual selected command dependency hashes; retain unchanged pure manifest/meaning. Measure command count rather than forcing the old count. |
| `tests/helpers/research-application-v1-process.ts` | Provide real source-only B setup while retaining existing fixture behavior; no manufactured completion or automatic 1126 completion for the selected B. |
| `tests/integration/postgres-research-application-v1.test.ts` | Add actual composite CLI, shared-holder, crash/restart, source scope and capacity cases; preserve all 45 existing cases/expectations. |
| `tests/unit/research-application-v1-owner.test.ts` | Add capture/refusal/range/owned-client controls; actual positive persistence remains native. |
| `tests/unit/research-application-v1-bounds.test.ts` | Cover aggregate accounting, reserved cleanup and late/oversize refusal across both stages without per-child reset. |
| `tests/unit/research-application-v1-capability.test.ts` | Pin the new closed command module and strict operation/flags while retaining old mode isolation and forbidden imports. |
| `lib/trader/intelligence/information-sufficiency/information-sufficiency-consumer-inventory-v2.ts` | Attribute the actual fixed internal completion writer and public-owner delegation; preserve assignment-reader identity, distinct no-authority role and strict producer symbols. |
| `tests/unit/trader-information-sufficiency-consumer-closure.test.ts` | Trace actual public owner → fixed completion writer, receipt/authority calls and narrow held delegate; retain read-only assignment-reader and forbidden caller-output/evaluator/root-pool nesting controls. |
| `tests/unit/trader-market-understanding-consumer-closure.test.ts` | Trace both actual fixed recomputation paths after extraction; preserve deferred generic Understanding persistence, public-owner responsibility and all forbidden authority/bypass gates. |

The existing CLI entry and run wrapper need no edits. The application command still excludes the public Understanding repository/loop; the old Understanding mode excludes the application repository. Both manifest generators must be checked; both pure manifests stay unchanged. The accepted MI service and canonical MI inventory/closure files need no edits; application measurement lineage retains its exact two service calls and no source/trust/Forecast authority. Existing workflow filters cover these paths and the already registered native files, so strict25 suite identities and CI services remain unchanged.

## Do not

Do not edit SQL/schema/journal/workflow, runtime lease semantics, pure policy/normalizer, ordinary Knowledge/Forecast/Decision/Risk/Execution/Guardian, host/service configuration or prior evidence. No new ledger, job queue, source polling, batch/multi-B mode, earliest-B policy, lease handoff or reset/increase of limits. No scientific/financial rule, qualification, promotion, live authority, C3 mutation or actual trade/activation is supplied by this task. Source-capture ownership, unattended selection/cadence/frontier, full 23-stage P10, P11 and P12 jobs remain open.

## Acceptance Criteria

1. **Actual producer/consumer:** the early CLI starts with B completion/consumption absent, writes the real canonical receipt/completion and consumption with one new holder epoch, and returns only the committed result. Compare deterministic evidence/policy meaning with the existing stages; verify receipt atomicity through completion fencing.
2. **Bounded selection:** P0/A1/B3 succeeds using predecessor2 metadata only; absent predecessor2 refuses without hidden backfill or a fourth body. Cover nonzero firstSourceSequence and exact relative predecessor.
3. **Durable restart:** actual process death before/after each completion/consumption commit preserves exactly the committed prefix, resumes without duplicate receipt/audit, and does not resample PIT or create new S. Retain unknown-commit uncertainty until exact replay.
4. **Exclusion:** competing, stale, expired and replaced holders fail closed at actual write/post-write/deferred checks. Completed READ ONLY replay makes no claim or new effect, even with an unrelated live holder; incomplete recovery does not bypass that holder.
5. **Identity and honest uncertainty:** PIT<=S, tenant/actor/profile/source/registry/manifest and revision conflicts refuse. Actual unresolved B stays unresolved with unchanged categories/fold/selection/maxAge; no evidence padding or capital authority.
6. **Measured shared limits:** actual selected maximum 32 history with missing B completion succeeds within the single unchanged512-statement and byte/deadline budgets. Actual 513/late/oversize controls refuse; count nested queries and finalization. If capacity fails, report it and optimize only within admitted semantics; do not raise caps or silently split the operation.
7. **Compatibility:** retain all 45 existing application tests plus the unchanged old Understanding native/compatibility behavior, deterministic output bytes and pure manifests. Check both generators, actual selected command closure and forbidden public-wrapper/legacy/venue/capital imports.
8. **Evidence and integration:** appropriate scoped units/readiness, independent frozen-source review, separately admitted local native evidence, then exact-head full-unit coverage with existing intentional skips retained and the complete strict 25-suite GitHub executed proof with no skipped registered assertions. Preserve raw failures and exact command/time/head attribution; no count, mock or source-only substitute for native success.

## WP-1 — Accepted base, plan and fixed writer extraction

Checked DEE-1132 merge and exact accepted-main identity are recorded above. This sole-plan commit awaits root review before source admission. After that release, extract the fixed writer and bound accounting seam within the map; preserve the original public Understanding behavior. Freeze a coherent source delta and prove both pure manifests and existing public capability/transaction boundaries before proceeding. No independently budgeted public-owner nesting.

## WP-2 — One-B composition and bounded proof

Wire only `complete-consumer`, strict capture and existing mode dispatch; generate actual command identity. Add the native/source-only fixture and meaningful owner/bounds/capability controls covering the acceptance criteria. Retain old 45 and old Understanding behavior. Freeze executable source for independent review before root admits the fixed native runner or assigns exclusive PG/heavy resources. Actual maximum 32 composite capacity and real restart/fencing proof remain unexecuted until that admission.

## WP-3 — Readiness, native acceptance and root publication

Run appropriate local checks serially under root resource coordination, preserve logs/receipts and all failures, and resolve findings inside the admitted map. Native runs require a separate frozen-runner/root grant; no automatic retries, database repair/reset or competing clients. Seal local results and independent acceptance, then let root prepare/publish the single PR and verify exact-head CI/reviews/blockers before checked merge. No release/activation follows.

## Validation and evidence order

Planned commands, **not executed for this plan-only admission**:

- Check the actual generated inventories: `pnpm exec tsx scripts/trader/generate-research-understanding-manifest.ts --check`, its `--runtime` inspection, and `pnpm exec tsx scripts/trader/generate-research-application-manifest.ts --check`.
- Run the five existing application unit files (owner, bounds, capability, specification, compatibility) and directly affected existing Understanding contract/evaluation/source-bounds/CLI/capability tests, both adjusted Understanding/sufficiency closure files and the unchanged strict MI closure test. Positive persistence is proved through native tests, not an enlarged in-memory fake.
- For production extraction readiness, run `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm validate:canon`, `pnpm validate:pr-governance`, `pnpm validate:execution-v2-consumer-graph` and `pnpm validate:reality-v2-consumer-graph`; no duplicate full local unit suite solely to replace GitHub.
- After independent source/runner review and root grant, run the complete existing application native file with its added composite cases and the unchanged Understanding native file against admitted fresh local fixtures/full accepted migration identities. Retain before/after source, posture, raw results, complete cleanup and closed-client receipts. Scheduling or fixture differences require explicit attribution, never a manufactured union.
- Root owns rendered-body preflight, exact-head GitHub full units/mandatory strict25-suite union, final review and publication/merge. This source plan supplies no claim that those gates already passed.

## WP-1 source handoff — 2026-09-27

Root accepted sole plan `5854be7d875edc71418dd9dfbce2fa37bcd40d46` and released WP-1 source only; admission is `parallel-runtime-owner/dee1133-root-plan-admission-5854be7d/admission.json`. The extracted writer owns the original fixed seal and RC source/predecessor/receipt/current-holder checks. The public wrapper retains assignment creation, RR commit before fixed computation, RC settings and post-commit deadline handling. Its independent read budgets remain independent.

The held seam mints private, one-use snapshot/completion handles from the actual fixed reader/evaluator and binds them to the originating accounting object. It accepts no caller-prepared evidence/output, evaluator or callback. The actual bound client's logger counts nested service SQL; candidate completion and receipt projections are admitted through metadata SQL before inserts and nested body reads. Receipt creation uses the exact existing millisecond transaction-time default for byte accounting. No transaction, connection, public root owner or alternative persistence writer is introduced. Strict sufficiency/Understanding closure follows the real delegation and retains assignment-reader and authority negatives. Added inert-transport controls exercise existing completion replay, forged/copied/reused/foreign-accounting handle refusal and the original statement/deadline across preparation and write. They are not native persistence proof.

Deterministic application manifest generation completed from these actual dependencies. The actual command closure has 93 paths (the old 91 plus the fixed internal writer and its unchanged existing sufficiency repository), with no removals. The only changed prior command dependency is the held seam; both pure manifests and the accepted MI service's two measurement delegates are preserved. No composite operation, fixture, native test, SQL, schema, migration, workflow, lease policy or pure meaning changed in WP-1. All 45 existing application native cases and the old Understanding native file remain unchanged.

This is source handoff only. Scoped tests/readiness have not run, compatibility is not yet claimed, and native execution remains separately gated. Freeze and raw generation receipt: `parallel-runtime-owner/dee1133-wp1-source-5854be7d/`. WP-2 wiring waits for independent review and root disposition.
