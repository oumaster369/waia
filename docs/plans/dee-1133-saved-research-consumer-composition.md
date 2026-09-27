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
  status: integration-ready
  currentWorkPackage: WP-3
  completedWorkPackages: [WP-1, WP-2]
  remainingWorkPackages: [WP-3]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: b99cc34ab09739f8bbe7ea303206307af4f95d3b
  lastValidationAt: "2026-09-27T19:42:17.918Z"
  blockedReason: null
  nextAction: "Validate and freeze this sole-plan publication carry; root owns rendered-body preflight and one PR. Record actual PR metadata only after creation, then require exact published-head full-unit/strict25 CI and fresh checked-merge admission."
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

Only these 16 executable/test paths plus this canonical plan are admitted for the planned implementation. The historical 12-path contract is retained; root explicitly admitted three strict closure/inventory followthrough paths after accepted-main inspection demonstrated that the current checks pin receipt writes and both fixed recomputation calls in the old repository. This is real delegation/source-identity maintenance, not cosmetic markers or wider capability allowance. Any further path requires root evidence-backed admission before edits.

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
| `tests/unit/trader-research-understanding-contract.test.ts` | Adapt only the existing inert completion insert port to scalar RETURNING after the admitted stored-digest postcondition; preserve every deadline/replay/no-doublewrite assertion and transaction clock. |

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

## WP-1 acceptance and WP-2 source release — 2026-09-27

Clean WP-1 executable source `b040b2a909823fe6e84a1226ab473f4df8170d26`, tree `a9c6c1f8ecff54c4e8da7ea1b323211dd58621e1`, passed exactly seven root-granted serial scoped checks at `17:44:52.082752–17:45:26.102801Z`: application manifest check, Understanding pure check/runtime inventory, 299 unit assertions in 13 files with zero skips, ten-path ESLint, typecheck and canon. No source change occurred during checks. Source freeze `parallel-runtime-owner/dee1133-wp1-source-5854be7d/FREEZE.json` SHA `fc4ff64f2ff4bd59c850ac6897396f81f130233b69f3568544b6031a18d5e125` seals 18 artifacts; scoped-check freeze `parallel-runtime-owner/dee1133-wp1-checks-b040b2a9/FREEZE.json` SHA `831060ee9310a13ebb5c2d61414135b4195cc4087a3fb4e558521ba664b9e043` seals 24. Actual selected application/Understanding closures are 93/85 paths; both pure manifests are unchanged.

Independent finite review `milestone-audits/DEE1133-WP1-source-b040b2a9/REPORT.md` SHA `27b79af00e3e74c7c8a2110eba8a1c10b5c8179fe9ccde842ed5f6fbc639ecd6`, nine-artifact freeze `4259b97f81cc66c9f990bd542c6a1f170f624243fbfe043df9b1cd4eb61d414d`, found no blocking source issue and verified all source/check pins. Root adoption `parallel-runtime-owner/dee1133-wp1-source-5854be7d/root-wp1-adoption.json` SHA `beb2e08645293bf0fc36ac2e31461bb2828fc58910d8e6025455ee83398c2f5b` accepts only WP-1 source and these attributed checks.

The extraction has one precise harmless refusal-timing difference: a missing assignment or elapsed deadline discovered by fixed snapshot capture now refuses before the read-only RR transaction commits, whereas the old wrapper could discover that refusal after RR commit. Successful fixed computation still follows the public wrapper's RR commit. No identical SQL timing or operational identity is claimed.

Root released WP-2 source after this sole-plan checkpoint. The explicit one-B route must prove actual private same-holder/accounting and RR→RC/finalization wiring; native candidate projection, maximum32 capacity, restart/fencing and old native compatibility remain unexecuted. Heavy checks, DB/native, publication and merge require separate root grants. No additional path or semantic scope is admitted.

## WP-2 source handoff — 2026-09-27

After sole-plan checkpoint `74d003b2ad8d1800cdd61259b86ff064c726d51e`, the existing command admits only explicit `complete-consumer` with required consumer sequence. Completed consumption still replays READ ONLY before claim. Otherwise the fixed owner claims once, reads/validates actual P/A/application/S and source-only B in RR, writes missing Understanding B in RC through its private minted handle, then invokes the existing consumption transaction with the same private holder/accounting. Existing B is recomputed and preserved. No application, assignment, certificate, source packet, predecessor or new S is created by this route. Missing dependencies, exact actor/configuration/profile/manifest/registry conflicts and B PIT/close failures refuse before B persistence.

Preparation returns an immutable primitive facts projection minted from its actual saved snapshot/fixed computation. Facts are used only for pre-write scope and chronology checks and are never accepted by the writer. The old public wrapper explicitly returns only its prior outcome/completion fields. The source-only native fixture uses actual recorded source/canonical paths and synthetic fresh normalizer preconditions; selected B is not automatically completed by the old research loop. Default fixture behavior remains the original one.

The application native file now declares **71 cases: all 45 prior case declarations/expectations byte-identical plus 26 new expanded cases**. The unchanged Understanding file retains 24 cases; proposed full native union is 95, all unexecuted for this source. New coverage includes actual early CLI/same-holder and old return shape; actual32-history capacity/candidate projections; P0/A1/B3 with predecessor2 metadata only; nonzero relative predecessor; missing dependencies/predecessor; PIT/registry/USER refusals; unresolved B; receipt/completion/consumption failure and expiry; real replacement and competing connections; completed READ ONLY replay under a live unrelated holder; process death before completion commit, between committed B and consumption commit, and after final commit; late actual completion acknowledgment; and shared statement exhaustion. The statement-limit scenario explicitly injects real bounded SELECT load on the actual held client/original ledger, separately from the natural32-history capacity measurement. Neither mocked counters nor assumed timings substitute for natural capacity.

Both pure manifests and MI delegates remain unchanged. Actual generated command closure remains 93 paths, now hashing the new operation and fixed facts. No schema/SQL/journal/workflow, native suite registration, qualification, lease semantics or pure meaning changes. This handoff does not claim any new checks/native success; independent frozen-source review and granted serial non-DB readiness follow. Root must admit any new accepted-main integration and the fixed native runner/database before execution.

Root independently confirmed and explicitly admitted a finite inherited success-postcondition correction before edit: an unchecked completion INSERT could be suppressed by a native BEFORE trigger, committing a new receipt without the completion's per-row deferred fence. The same fixed writer now uses one scalar `RETURNING contentDigest` and requires exactly one row matching the expected completion digest before success/commit, universally for both owners. This adds no SQL roundtrip and does not change valid outputs, caps, schema, pure meaning or authority. Erroneous success on a suppressed insert is intentionally no longer preserved. Two added native controls exercise the composite and existing public owner, require receipt/completion rollback, then actual recovery; both are unexecuted.

Exact root correction admission: `parallel-runtime-owner/dee1133-wp2-source-preparation/root-completion-write-postcondition-admission.json`, SHA `4ca35723e0088b80a677f31461982ec79c5b57248d986e862b39215cc1111b40`.


## WP-2 focused-check correction admission — 2026-09-27

On clean executable `3fef3c0977c5282998360dc2a462d499f2a7e57b`, all three manifest checks passed; the focused group at `18:24:27.911292–18:24:42.850060Z` returned **302 PASS / 1 FAIL / 0 skips in 13 files**. The existing Understanding contract late-write-ack test expected `INVOCATION_DEADLINE_EXCEEDED` but its inert `insert().values()` port lacked the newly required `.returning()`. The test failed before its late-COMMIT acknowledgment condition; it does not demonstrate a changed deadline rule. Raw logs and exact command/head receipt remain at `parallel-runtime-owner/dee1133-wp2-checks-3fef3c09/`; stdout SHA `878e70315046760f0bbc6e530776ca99159bde36032c5978ee25dc344cc212c2`, stderr SHA `7884ce691c69c295a273509ef2022b76b8136405a91ca20fb9c3ef40e52a6a93`. Remaining readiness stopped, resources released, and source stayed unchanged.

Root explicitly admitted the exact sixteenth nonplan path shown above: correct only that existing inert insertion port to return the actual supplied completion digest through the one-scalar projection. Retain all 40 existing test declarations/assertions, transaction/late-ack clock semantics, expected refusal, fresh replay and no-doublewrite controls. No production change, relaxed postcondition or enlarged fake persistence is authorized by this amendment. This sole-plan checkpoint precedes the fixture edit; then freeze the successor and rerun the affected focused group/manifests and remaining granted readiness serially. Prior RED evidence is retained, and no DB/native/publication grant is supplied.


## Accepted WP-2 source/readiness and incoming main — 2026-09-27

Independent finite WP-2 review `milestone-audits/DEE1133-WP2-source-3fef3c09/REPORT.md` SHA `b40e97f66beff33c69f0780dfcbecad682f9a4d3f1f0590f61bd02b9a7aab910`, freeze `be3c49d3d5c7ae883ff0978bd035967496312c8e832e723110aa100bb73bb09a`, accepts immutable production3fef and exact fixture/observation carry to clean executable `6640fd7cb5db6e6d5b33e7ecc90d50ef69ea5f68`, tree `a3bde0cbcfb482a525c0f5a05b9853c0d02f58c9`. Root adoption `root-adoption.json` in that review directory, SHA `4fb4c0612189d47eb820a92ac2887ff67f582d4c6b5598f70a8ba04484353db6`, accepts this finite source and local readiness only; no unresolved actionable source finding remains.

Actual focused **303 PASS / 13 files / zero skips** belongs to `f6bf708898c9babb28f068af590dbb5023ee13f3`, with production/unit/manifests exact through6640. Eleven serial checks passed on unchanged clean6640 at `18:30:34.953139–18:32:00.536975Z`: three manifest checks/inventory, sixteen-path ESLint, full lint/typecheck/build/canon/governance and Execution/Reality graphs. Full lint retained328 warnings/zero errors; build retained its middleware-convention warning. Readiness `parallel-runtime-owner/dee1133-wp2-checks-6640fd7c/REPORT.md` SHA `080f73acd5b93f386f38143bc968ae84a25585679ddc53b9290b1864294fcdeb`,39-artifact freeze `e89bc0e208649fa8994f3ff963bd63579b152ba482afe8d499bfdf6d9d69f611`, preserves exact command/head/time/raw-stream receipts. Both actual REDs remain preserved: initial302/1 returning-fixture failure and subsequent scoped native-observer lint failure. No production guard or old expectation was weakened.

Root checked PR692/DEE-1134 merged at `2026-09-27T18:47:11Z`; new accepted main is `f01d4de878410fa4f7e37543f27d84ee48f191fa`, tree `14e3e282ea5435294ef05a880041f0d9fcad7380`. Root post-merge receipt `evidence/dee-1134/root-postmerge-reconciliation.json` SHA `9b173e98c981672fa8ed8ced15a0144db0b39bb2cbfffa594f78675e1af8f64f` confirms equality with the validated PR tree and primary fast-forward. Fresh immutable comparison from630 shows exactly four incoming paths: `lib/trader/execution/v2/authority-postgres.ts`, `tests/integration/postgres-execution-v2.test.ts`, `docs/ai-trader/reality-v2-source-consumer-inventory.json`, and `docs/plans/dee-1134-execution-bind-account-lock-order.md`. These are accepted DEE-1134 account-lock/window checks, their native proof, Reality source seal and canonical plan; they do not authorize new DEE-1133 semantic work.

Root admits this sole-plan checkpoint followed by a genuine normal merge of exactf01, with no rebase/reset and no other edits. Every DEE-1133 production/native/test/manifest blob from6640 must remain exact; net delta versusf01 remains sixteen admitted nonplan paths plus this plan. Verify all224SQL/journal and command93/application pure11/Understanding pure49 identities unchanged, then serial mapped integration readiness and an immutable freeze. Native95 remains unexecuted. The externally reviewed runner draft stays ungranted until final accepted-base/head binding, independent disposition and root one-attempt resource grant; no DB/native/push/publication is admitted by this merge checkpoint.

## Native replay-envelope expectation correction admission — 2026-09-27

The genuinely integrated, clean executable `b701539f65947e84e803150773d619ed2ea182c0` passed twelve serial non-DB checks, including303 focused assertions/13files/zero skips, at `18:51:38.980088–18:53:22.559743Z`; exact readiness remains in `parallel-runtime-owner/dee1133-integrated-checks-b701539f/`,42-artifact freeze `94a261e4b51376f3b6fcd58409ea17b1fc5a3840be5a1a8694378f65c6a4e600`. Root then separately granted the reviewed full95 native attempt on that immutable source.

Actual native execution at `19:04:00.286–19:16:55.937Z` returned **94 PASS / 1 FAIL / zero skips** across the two complete files. The sole new same-holder CLI case failed at line621: full public replay was compared with raw stored JSON lacking its root digest. The exact return-key assertion passed; the only received/expected data difference is root completion.contentDigest. Existing `encodeBody` intentionally omits that field, `decodeBody` restores the separately stored digest and verifies the seal and bytes, and both acceptedf01 and b701 public owners return the sealed completion. This is a new test expectation defect, not evidence of changed production return semantics. Assertions after that failure and its final marker remain unproved by this attempt.

Original251-artifact native freeze `parallel-runtime-owner/dee1133-native-bound-b701539f/results-1905/RESULTS-FREEZE.json` SHA `6abbaf3499f3ac34dfc7d990890a398daa4e238ffa4ed8d2a2a379d15461ea31` retains the full RED. Source remained unchanged, teardown passed and all clients closed; FHV did not execute, the fresh database remains retained, and there was no retry. Read-only diagnosis is retained in `parallel-runtime-owner/dee1133-native1905-return-envelope-diagnosis/`.

Root admission `parallel-runtime-owner/dee1133-native-bound-b701539f/root-native-expectation-correction-admission.json` SHA `201a4ddc5abfd816cbfaeabb75ade8be05559586b84b7f5a901fac154d2544fc` permits only this plan checkpoint followed by the existing native test path. Keep exact return keys and full deep equality against the sealed expected `{...body, contentDigest: String(row.content_digest)}`; additionally require the raw JSON body to lack root contentDigest and independently hash its actual UTF8 bytes to the separate stored column. Preserve all other assertions,95 titles, nine-marker protocol, old45+24 cases, production/SQL and all335 source pins except this native file's hash. No decoder change, partial comparison, production helper oracle or new API is admitted.

After a coherent test-only commit, run only native-file ESLint, typecheck, canon and PR governance serially under the granted LOCALHEAVY slot. Preserve the previous production readiness as actualb701 evidence, prove all other nonplan entries unchanged and prepare an identity-only successor binding with identical runner bytes. Source/binding review and a fresh concrete root grant remain necessary before another full95/224/FHV81 execution; this amendment grants no database, native, publication or merge action.

## Accepted local native result and publication handoff — 2026-09-27

Clean executable `b99cc34ab09739f8bbe7ea303206307af4f95d3b`, tree `5e4781f13127b30ac8712ede2deab1b761ae3126`, contains only the admitted native expectation correction after sole-planf80f. Inverse restoration reproduces the complete b701 native file; every other nonplan entry and334 of335 runner pins are unchanged. Four scoped checks actually passed onb99 at `19:24:26.747327–19:24:53.613427Z`: native-file ESLint, typecheck, canon and PR governance. Their15-artifact freeze is `bf461d35842c0a914a8684732f40c81c05d1fbaf201a91f1cd434c4858b02028`. The broader303 focused assertions/13files/zero skips and twelve readiness checks remain attributed to actualb701 and carried by unchanged production bytes. Independent correction review `milestone-audits/DEE1133-native-expectation-b99cc34a/REPORT.md` SHA `f69a1731f6d93e8c286f27b582afe000e0770f4818e5aa4df209647dce7b3673`, freeze `4112077ca2f0cd977877b4177668b5c017ef26d941596405e207a764aaf45e94`, accepted that finite correction and identical runner binding.

Root separately granted one fresh application-only execution on immutableb99. The actual unfiltered invocation at **19:29:20.158–19:42:17.558UTC passed95/95 in exactly two files, with zero failures/skips/todo**:71 application cases including all45 prior cases, plus the unchanged24 Understanding cases. It exited0 with no timeout, signal or retry. All nine composite markers match their unique passed cases. The corrected same-holder CLI case now reaches full sealed public replay, evaluation digest, audit-holder/count and repeated-consumption assertions. Its twelve claims and source-onlyB completion/consumption share the actual holder tuple. Original1905RED94/1, its missing final marker/FHV and all earlier local failures remain unchanged historical evidence.

Natural32 composite evidence is actual62,166-byte registration,459 statements including finalization,961,618 unique accounted bytes and five transactions. Bodies0/1/3 were read with predecessor2 metadata only; actual completion/receipt projections measured85,213/5,605bytes and were admitted before receipt persistence. Raw whole-case duration14,606.705208ms is a conservative invocation wall-time upper bound including fixture work, below60,000ms; it does not replace the unchanged production deadline. The4,000,000-byte application maximum remains inside the shared67,108,864-byte ledger by frozen source and passing assertions, without a separately emitted component counter. The retained DEE1132 history case separately measured333/120 statements and654,150/655,091 unique bytes.

Real process-death controls preserve completion/consumption prefixes0/0,1/0 and1/1 with their exact backend-closure/replay rules. Both composite and public no-op insertion controls refuse orphan receipts and recover after fault removal/actual expiry. Late acknowledgment is explicitly a simulated monotonic120001 after a real completion COMMIT, not an actual120-second wait; induced statement exhaustion adds324 real SELECTs on the original ledger, retains reserved rollback at512 and refuses the next business query. That induced load is separate from natural32 capacity.

All5,531 source entries were unchanged throughout the run. All224 actual migration hashes/timestamps before/after match the bound SQL/journal and acceptedf01. Schema-only FHV ran at `19:42:17.605–19:42:17.918Z`, exit0, with81 read-only SELECTs, exact fixture database/role/PostgreSQL160014 and closed client. Entire postmigration/teardown posture matched; no fault/disabled-trigger residue or remaining clients persisted. Historical bootstrap was not rerun: its original222→unchanged27-control→224 result stays attributed to its historical receipts, carried by229 identical source paths. These are224SQL plus the bootstrap/prelude/seed/journal/schema sources, not229 migrations.

The257-artifact native freeze `parallel-runtime-owner/dee1133-native-bound-b99cc34a/results-1928/RESULTS-FREEZE.json` SHA `03a3c358ec6cc25a26ba2fd366dd20f2814bc3968e287892d7950a0a4d1a26b6` retains raw native JSON SHA `0edfe84de7c9fc99fec8bd43e9a67cd74ca9d9ead691807eb14d21b2fa4e2ecc`. Independent outcome report `milestone-audits/DEE1133-native-b99cc34a-1928/REPORT.md` SHA `18fe508a38965e59d0c63b7bfd09b889519d120eaa182dfd33e3a9bef8c32424`, four-artifact freeze `f49711ec0c93ab3368e4ab702626b0722ecc54c2bfbdb55a608394397cef6dcc`, verified all257 pins and accepted the finite local scope. Root final adoption `parallel-runtime-owner/dee1133-native-bound-b99cc34a/root-final-native-adoption.json` SHA `79c6456efb56ffead2ad2fd2c8b80adc390e10775c4ba724ee7fa64d3ae46950` accepts WP-1/WP-2 and releases only this publication bookkeeping step.

WP-3 remains open: validate this sole-plan carry, prove all5,530 nonplan entries equalb99, then root performs rendered-body preflight and one PR. PR metadata remains null until actual creation; exact published-head GitHub full units/strict25 and all required/applicable checks, fresh review/base/blocker checks and root merge admission remain future. No additional executable/native/build/unit rerun is required solely for plan bytes. This result is local synthetic software proof and schema compatibility; it supplies no scientific/feed/host/account/venue/restricted-role qualification, unattended P10–P12/full23-stage completion, new policy or live/capital activation.
