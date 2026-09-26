---
integrationIssue: DEE-1128
integrationTitle: "Preserve paper sufficiency and scoped Guardian boundaries"
branch: dee-1128-paper-sufficiency-guardian-boundary
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation: [lint, typecheck, unit, native-postgres, build, canon, pr-governance, integration-train-manifest]
approvalGates: [plan-approved, t3-scope-preauthorized, integration-ready, bounded-controller-merge]
includedIssues:
  - id: DEE-1118
    role: work-package
    completionPolicy: manual-at-integration-ready
    status: in-progress
  - id: DEE-1119
    role: work-package
    completionPolicy: manual-at-integration-ready
    status: in-progress
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-progress
  currentWorkPackage: WP-3
  completedWorkPackages: [WP-1, WP-2]
  remainingWorkPackages: [WP-3]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: 72609d445d6affe7c2ee42b655d7ea535d6f53e9
  lastValidationAt: "2026-09-26T21:53:18.463125Z"
  blockedReason: null
  nextAction: "Review final metadata delta, validate frozen manifest and root rendered preflight, then publish for all required exact-head CI; retain reserved main until train merge."
provenance:
  authoritativeBase: 9d2a97768d34738a412f6a02a6dd31b35fbe2ef6
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1128 — paper sufficiency and scoped Guardian boundaries

Root admitted this exact delivery scope in [DEE-1128](https://linear.app/deepsense/issue/DEE-1128/ai-trader-integrate-paper-sufficiency-veto-and-scoped-guardian), parent DEE-639, on 26 September 2026. The source preparation is frozen as `41b6d0c0a499de2b7a0b8a5f4bf4d66de3514025c98124356205f088c7a10f55` on accepted9d2a. Current-base M01 design review passed (`4fba8e802834bde092c6610d06f78098e666326789f7cb8031240a428e52652e`). The initial two-file admission90e5 contained no child code; root independently checked it and released imports before cc0c54 and72609d. The frozen manifest now maps those new commits and current local/source-review evidence. Design admission, current-source acceptance, final metadata review and authoritative CI remain distinct.

## Authority, delivery boundary and chronology

DEE-1128 is the new integration child under DEE-639, the existing paper/runtime composition
program; root confirmed this parent when creating the issue. Preserve historical child
parentage: DEE1118→DEE596 and DEE1119→DEE639; `Includes` does not silently reparent either or
close their broader program. Root reread current child contracts: both In Progress with no blockers, original parents retained, and no duplicate integration issue. Standing user technical/consolidation authority and root's exact delivery admission are recorded in DEE-1128; current-base independent design review passed, and actual admitted-manifest validation passed before90e5 was committed. Frozen validation remains required before publication.

Original implementations and reviews predate this prospective train. Preserve both frozen
branches: DEE1118 `eeacd6fd0a9a3bce4f421c57a53868e74efba206`, DEE1119
`6e6a5b68e6cdfabba748f9572c07a188fa0853a8`, both based on accepted21a60ec3. Root's new
DEE-1128 admission explicitly supersedes their separate-PR delivery instructions while retaining
both atomic semantic contracts. This changes delivery granularity only. The original authors
cannot supply final independent implementation acceptance; M01 provides nonauthor review.

The new integration branch starts at the exact **current accepted main**. This
preparation is pinned to `9d2a97768d34738a412f6a02a6dd31b35fbe2ef6`. First commit contains
only `docs/plans/dee-1128-paper-sufficiency-guardian-boundary.md` and the adjacent
`.integration-train.json`. Validate the actual admitted inventory and preserve its commit/path/
SHA256 before imports. Only new post-admission import/adaptation/test commits map to children.
Do not merge old child histories, relabel old commits as post-admission, rebase/reset published
work, weaken provenance validation or copy an old admission as if it descended from new main.

The validator requires the **actual PR base to be ancestor of the admission**, not merely the
final head. Reserve the actual base through train merge or wait for pending accepted changes
before admission. If main advances after admission, normal merge alone cannot satisfy that
ancestry. Stop and use the existing compliant successor process; do not launder metadata.

## Goal — one concrete caller-level result

In existing `runPaperCycleOnce`, a rebuilt required NEW_OPPORTUNITY unresolved contradiction
cannot authorize new-entry submission. Independently enabled optional legacy Guardian observes
only the exact account/instrument, validates the entire returned batch before its own recording/
trailing/submission effects, preserves unrelated trailing state and retains real legacy
`execution_v2_required` refusal. Denying entry does not grant or suppress independent protection.

This is not Guardian sufficiency, Guardian V2 qualification, a complete ordinary runtime,
positive protective execution, scientific evidence or live authority. Default paper/bar-close
callers still do not provide the optional Guardian lane; HTR early-return behavior remains.
No new profiles, thresholds, Risk math, trailing/stop formulas, credentials, host scheduling,
source finality, financial policy or capital capability enters this delivery.

## WP-1 — reviewed sufficiency import and fresh cumulative acceptance

After actual admission, import the five DEE1118 files listed in the manifest verbatim from
eeacd6fd. All are disjoint from112 incoming paths between21a60 and9d2a; the production pre-fix
body on9d2a is byte-identical to21a60. Keep mandatory FAIL_UNRESOLVED veto, optional/context/
RECORD_ONLY/REQUIRE_AGREEMENT controls and replay refusal for old false-SUFFICIENT receipts.
Preserve the frozen pre-fix fixture as historical evidence; no receipt rewrite.

At the new mapped import head execute the exact14-file DEE1118 `expectedTests` command in the adjacent manifest (`wave1Scoped14` in the preserved source preparation)
with fresh normal/JSON output and zero failed/skipped assertions. Do not substitute old130/10
or other historical results. Wave2 starts only after this cumulative check passes.

## WP-2 — Guardian import, current proof/inventory union and real joint assertion

Import the seven nonshared DEE1119 files verbatim from6e6a5b68. Retain all current accepted
code; adapt only the four explicitly declared shared files as specified below. DEE1119 also
owns the new acceptance-only `tests/unit/trader-paper-sufficiency-guardian-boundary.test.ts`.
No new production algorithm/helper is admitted. Its fixture dependency on DEE1118 is declared,
so removing/defering1118 also removes/defers this dependent test; never leave a broken import.

The actual joint test must compose the existing sufficiency evaluator, exact receipt replay/
runtime admission, actual paper caller, real Guardian evaluator and real
`createOrderExecutionServiceFromDeps` legacy-refusal boundary with inert ports. An explicit
signal-result fixture at the evaluation-module boundary may force an actionable entry signal;
it must not mock the changed contradiction rule, admission, Guardian evaluator or legacy
Execution refusal and must not claim full Intelligence qualification. Exact org/account/symbol/
timeframe/PIT identities align across inputs.

Required combined matrix:

1. Mixed supported+UNRESOLVED mandatory evidence rebuilds a valid INSUFFICIENT receipt. Actual
   paper caller submits no entry, evaluates the selected lot, leaves unrelated trailing state
   byte-identical, and reaches actual legacy exit refusal with no connector/Risk/order effect.
2. Supported-only control retains existing admission semantics and does not manufacture
   financial authority. Existing optional/context/RECORD_ONLY cases remain separate controls.
3. A foreign account/instrument or mismatched trade on a later returned row refuses the whole
   Guardian batch before any Guardian recorder/trailing/submission mutation even while entry
   is blocked. A correctly empty scoped result is distinct and remains valid.
4. The stored pre-fix false-SUFFICIENT receipt is rejected by exact replay/admission. Do not
   promise Guardian continuation after a thrown invalid receipt; that is distinct from a valid
   INSUFFICIENT receipt.
5. HTR and disabled Guardian retain their early returns and do not acquire a new profile gate.

Run the24-file DEE1119 `expectedTests` command in the adjacent manifest (`wave2Cumulative24` in the source preparation) after the actual wave2 head, including the new joint test.
Keep its claims limited to this optional paper composition; persistent session cleanup and
closed-lot ID reuse remain the original1119 limitations. Absence from a selected subset is not
proof of lot closure; retained unrelated trailing state is intentional.

## Exact shared-file adaptations on accepted9d2a

- `.github/workflows/postgres-integration.yml`: retain current full workflow, canonical3 billing
  lane, all existing19 critical native registrations, serial invocation and `WAIA_POSTGRES_CLI=1`.
  Add the existing Guardian observation suite and the five reviewed1119 trigger paths. Also
  explicitly include the newly admitted joint-test trigger. Do not restore the old whole file.
- `scripts/postgres-validation/assert-capital-test-results.mjs`: add only
  `postgres-guardian-observation-scope.test.ts` to the19 accepted entries. All guard semantics stay.
- `tests/unit/postgres-capital-proof-guard.test.ts`: same20-entry set and exact20 success count;
  preserve every missing/failed/skipped/empty/duplicate negative check.
- `docs/ai-trader/reality-v2-source-consumer-inventory.json`: retain9d2a's source discovery, newly
  added delivery consumer declarations/rules,140 consumers/155 sources/26 connector references
  and all path identities. Recompute only the consumer content digest after the exact paper
  source import through the actual inventory algorithm; do not copy1119's obsolete134-consumer
  digest or erase accepted Execution-report delivery declarations. Source digest and all
  dispositions remain unchanged on this pinned base. Run actual graph checks after integration.

Exactly12 historical child blobs stay byte-identical (5+7); four shared files receive the
explicit additive adaptations. All108 other incoming paths remain byte-identical to9d2a. Original
16 child paths +one1119-owned joint test +two new batch metadata files =**19 expected paths**.
Every extra changed path or substantive source conflict stops for root re-admission/splitting.

## WP-3 — native union, exact closure, independent review and checked delivery

On a separately granted fresh isolated PostgreSQL fixture, apply the actual complete current
journal/auth prelude and execute all **20 mandatory critical suites** in the exact workflow/
guard/unit union. Strict executed-result proof must reject skipped/failed/empty/missing results.
Run unchanged `postgres-information-sufficiency-v2.test.ts` as a **separate extra companion**;
its four historical cases are not a promised current count. Its canonical fixture temporarily
disables its own delete guards during cleanup and restores them in finally; retain that exact
fixture behavior and verify restoration, never introduce a new runtime waiver or repair shared
registry/identity to get a pass. No native work is authorized by this preparation.

Preserve separate canonical3 billing, canonical2 payment and observationPG17 four-suite lanes.
These are different fixtures/proof sets, not a fictional single aggregate execution. Required
current-head CI still executes all applicable gates; source preservation is not a fresh native
receipt. Root coordinates native/heavy resources, full lint/typecheck/build/canon/governance,
Reality/Execution consumer graphs, rendered PR preflight and final M01 complete-diff review.

Freeze final manifest only with new actual mapped commits, their exact path union and fresh
cumulative evidence; admissionReviews must match actual child commits/files. Only batch plan/
manifest commits may remain unmapped. Freeze→preflight→current-base/head CI→independent review
and root exact merge admission retain all existing gates. One integration issue closes
implicitly; only proven delivered children close manually, leaving ancestors/deferred work open.

## Acceptance Criteria

- Exact current main is ancestor of valid two-file admission and every mapped import; original
  authorship/tests remain historical. No fake admission result or original SHA used as new work.
- All12 nonshared child blobs and108 nonshared incoming blobs preserved; only the four enumerated
  shared adaptations and pre-admitted joint test differ.19-path closure is exact on9d2a.
- Fresh wave1 then cumulative wave2 proof succeeds; actual joint caller assertions satisfy the
  five-case matrix without weakening legacy Execution or authority boundaries.
- Actual20-suite native proof plus separately attributed sufficiency companion passes with
  proper fixture/role guards and clean teardown. Existing3/2/4 lanes and full journal preserved.
- New exact inventory content pin passes actual graph checks; no stale digest or missing accepted
  delivery consumer. Full readiness, manifest/provenance validation, M01 review and required CI pass.
- No live permission, production/venue/host/C3, financial effect, profile/scientific policy,
  schema migration or past-record rewrite. Full P10/P11/scientific readiness remains open.

## Reviewability and bounded rollback

Prior16-path implementation is1439 changed lines:337 child-plan lines,240 frozen receipt lines,
107 production changed lines and755 other proof/fixture/inventory lines. New joint test and batch
metadata increase the total; record actual size at freeze. The explicit >800 rationale is two
already independently reviewed small repairs joined at one actual paper consumer with one
failure/result boundary and all required adverse proof retained. No unrelated fixes enter;
M01 reviews the whole new diff. Split if that ceases to be reviewable or joint proof needs scope.

One code-only squash revert restores pre-train behavior, without schema/data reversal. It can
restore known unsafe sufficiency behavior, so affected operational reuse requires deliberate
root/operator handling; do not treat rollback as safe automatic reactivation. It cannot undo
already-created receipts/observations or retained in-memory session state. Preserve evidence and
never reseal/rewrite old receipts. Any real rollback/deployment remains a separately controlled
action, not part of this admission preparation.

## Current-base reservation and accepted consumer closure

This refreshed preparation is pinned to actual accepted main
`9d2a97768d34738a412f6a02a6dd31b35fbe2ef6`, reserved by root for pre-import admission.
PR683/DEE1121 and PR684/DEE1127 are now accepted source, unlike the preserved340-era template.
There are112 incoming paths since the children's21a60 base:108 stay byte-identical and exactly
four shared proof/inventory files receive the declared adaptations. Relative to340,48 paths
changed and44 are additional paths in the complete incoming set. Journal220 (including0219),
all accepted recorded-analysis/PIT and credential-startup bodies, ownership/fences/guards and
separate PG17 executed-result guard remain unchanged. Pending1125 is not a dependency or an
accepted schema. No need to wait for or import it to admit this source-compatible train.

DEE1121 added the OBSERVATIONAL_ONLY_NO_AUTHORITY sufficiency consumer, explicit Understanding
consumer inventory and recorded canonical-source producer/receipt disposition. Preserve all
three current inventory modules and their updated closure tests byte-for-byte. The accepted
sufficiency registry has44 declared consumers plus its separate Guardian lane. These are not
new shared adaptation files. The prior real paper-cycle body remains unchanged since21a60,
so its exact1119 import is still valid. The recorded evaluator calls the actual evaluation
cycle but supplies no sufficiency profile/authority and rejects analytical bundles; importing
1118 must not turn that lane into a new authority path. Wave1 now adds actual recorded evaluator
and early CLI controls plus Understanding/canonical-source closure; sufficiency closure already
belonged to wave1. Wave2 repeats all14 and adds10 Guardian/joint/graph companions,24 total.
The joint assertion stays on the existing optional legacy paper caller, not the new durable
observational entry. It does not claim the durable entry now supports Guardian execution.

Current Reality discovery stays155 source files/140 consumers/26 connector references. Its
accepted consumer content digest includes PR683's script split. After the exact1119 paper
import, recompute only the affected content pin through the existing algorithm; preserve all
path/disposition counts, source pin and accepted delivery rules. No stale340/21a digest copy.
The current capital workflow/guard/unit sets independently match19; add Guardian once for20.
Preserve separate3 billing,2 payment and4 observationPG17 sets and their executed-proof guards.

Immediately before the two-file actual admission commit, root must recheck that this accepted
base is still the actual PR base and ancestor of admission, and the actual current-base review
has passed. Actual manifest validation still precedes commit; root separately verifies that immutable two-file admission before imports. If main advances first, refresh before admission. After admission,
stop on incompatible base/ancestry change rather than relabelling prior imports or metadata.

## Recorded implementation and local acceptance — 26 September 2026

Admission `90e5b97557b569ca91661d76f7f949377e24e46d` is a direct child of reserved9d2a and changes only this plan and manifest. Admitted manifest SHA256: `84a5e81609528d8658f33aee83a458df4c80158976804d218d26271d239bc0a1`. Root verified it and released the import barrier before either mapped child commit.

WP1 `cc0c54dd9b2d5e6c9fc69881b27cffb7279e7cc2` imports exactly five reviewed1118 files. Fresh cumulative199 assertions/14 files passed, zero skips. Only after that pass, WP2 `72609d445d6affe7c2ee42b655d7ea535d6f53e9` imported seven reviewed1119 files, four admitted shared adaptations and the207-line joint test. Fresh cumulative320 assertions/24 files passed, zero skips. The thirteen current joint cases are included in that exact-head cumulative result. Earlier isolated13/1 evidence lacks a separately pinned executed-head/working-byte receipt and is not substituted for current composition proof.

All12 historical nonshared child blobs and108 incoming nonshared paths are byte-identical. Source diff before this metadata supplement:19 paths,2179 additions/20 deletions. The original107 production changed lines remain exact; most volume is historical plans, frozen receipt and validation. The joint test uses actual sufficiency/replay/admission, Guardian/exit math, paper caller and legacy Execution refusal, an explicitly fixed analytical signal result and inert effect ports. It does not prove full Intelligence qualification. Reality remains155 source/140 consumer files and26 connector references; only the consumed paper body changes its content pin.

After source freeze and cumulative pass, root granted exclusive local native/heavy validation. Fresh `waia_dee1121_dee1128_9d2a_author` on PostgreSQL16.14 began with zero public tables. All220 SQL hashes/timestamps matched the accepted journal; no0220 was imported. Native400 assertions/20 mandatory suites and the strict executed guard passed. Separate unchanged sufficiency companion4/1 passed. Both had zero skips. Before/after role attributes, memberships, user-trigger definitions/enabled flags and table RLS flags matched. Teardown: zero other sessions, injected live/recorded faults and disabled public user triggers. This is bounded fixture restoration, not universal ACL/security proof. All clients closed and grants released. Separate canonical3 billing,2 payment and4 PG17 lanes were preserved, not locally rerun or combined into these counts.

On clean72609d, all8 local readiness checks passed: lint, typecheck, build, canon, governance, Execution graph, Reality graph and diff. Initial stale Reality content-pin failure and the external verification order-versus-set correction are retained; no product assertion was relaxed. Raw commands/results and37 hashed artifacts are in `parallel-runtime-owner/dee1128` in the audit directory. Current-source M01 passed both mapped commits and exact file sets; report `milestone-audits/M01/review-DEE1128-9d2a9776.md`, SHA256 `a23171058784bfd53d6222fdf24f6e6b1012d673d755fbc94a00fd3f6eaa72c2`.

Only this plan/manifest change after the tested source. Exact final metadata review, frozen-manifest ancestry/closure validation, root rendered preflight and all current-head CI remain required before merge acceptance. Delivered children in the local mapping are not Linear Done or whole-program completion. Optional Guardian/default-caller absence, retained trailing-state cleanup and closed-lot identity reuse limits remain. No live/scientific/financial/full P10/P11 readiness is claimed.
