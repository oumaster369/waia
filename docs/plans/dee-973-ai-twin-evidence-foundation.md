---
integrationIssue: DEE-973
integrationTitle: "AI-TWIN — isolated evidence and rights foundation integration"
branch: dee-973-ai-twin-evidence-foundation
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr]
requiredValidation: [lint, typecheck, build, unit, integration, canon, pr-governance]
approvalGates: [plan-approved, independent-review, exact-head-ci]
includedIssues: []
state: { status: in-progress, currentWorkPackage: WP-3, completedWorkPackages: [WP-1, WP-2], remainingWorkPackages: [WP-3], prNumber: null, prUrl: null, lastValidatedGitSha: 96ba716bca0f5a6b875fcd996d2ad31292cfa0bc, lastValidationAt: "2026-09-09T10:27:00Z", blockedReason: null, nextAction: "Finalize independent exact-head review and rendered-body preflight; publish one PR and require current-main exact-head CI before scoped normal squash merge." }
provenance: { createdFrom: DEE-871, gapRegistry: docs/gaps/ai-twin-v1-gap-registry.md, supersedes: null }
---

# DEE-973 — Isolated evidence and rights foundation

## Approved outcome and admission

Deliver one independently useful, disconnected repository foundation with synthetic PostgreSQL evidence for observation -> claim -> Human correction -> current projection -> withdrawal -> exclusion -> dependent live removal -> stale replay denial, while preserving a separately authorized private experience. Pure reference/input contracts support its next integration, but no application caller, real user data, new runtime permission or shared migration is introduced.

This is one new integration boundary under the Human's explicit authorization to maintain AI-TWIN tasks, implement in isolation, minimize coherent PRs and merge own qualified PRs. It separates already prepared reusable code from DEE-871's different shared-runtime and all-v1 gates, as required by INTEGRATION-BOUNDARY-POLICY. It is not a partial PR on DEE-871, an Integration Train or a claim of completed product. T3 reflects the rights/persistence design, while execution remains synthetic and disconnected. Human-only production/biometric/shared integration decisions are not delegated by this plan.

**Pre-adoption source:** own frozen `dee-871-ai-twin-repository` at `cb87f5b62707e47c7f1c22933d18f7ce29e9a39d`. Original code was authored under the dated, committed DEE-871 admissions and Human retention/R1 decisions recorded in that plan. This admission precedes adoption, not that original implementation. Preserve original commits and receipts. New branch starts from verified remote main `90de233a192f9b97fa2d6a1ab0c3c1ba5a72df67`; adopt the exact source, not a moving branch.

**Dependencies:** DEE-963 kernel and DEE-965 lifecycle are merged. DEE-871 remains In Progress and depends on this foundation, not vice versa. No DEE-871/874/875/876 acceptance is discharged by this batch. DEE-868 remains the program parent; no downstream issue is Included/auto-closed.

## Frozen delivered and deferred inventory

| Owned file | Delivered in this batch | Explicitly not delivered |
|---|---|---|
| `docs/ai-twin/AI-TWIN-CANONICAL-ALGORITHM.md` | Human-approved R1 classification addendum | New policy duration or production guarantee |
| `docs/plans/dee-871-ai-twin-epistemic-ledger.md` | Preserved original admissions/receipts plus handoff | DEE-871 completion |
| This plan | One admission, acceptance matrix, full-review/CI/merge receipt | Governance override or new product canon |
| `lib/ai-twin/model/lifecycle.ts` | Two R1 working-memory class additions | New existing-class meaning/renewal service |
| `lib/ai-twin/model/persistence-contracts.ts` | Scoped versioned candidates; export metadata; initial reflection/prediction/outcome; unassessed Formation/Health inputs | Extraction, safety certification, calibration, actual export, computed Formation/Health |
| `lib/ai-twin/model/legacy-quarantine.ts` | Metadata-only no-opt-in planner | Applied quarantine, import or retention exception |
| `lib/ai-twin/model/postgres-repository.ts` | Explicit injected connection, synthetic schema repository and rights closure | Authenticated server adapter, production schema/client, arbitrary real DB support |
| `tests/fixtures/ai-twin-model-repository.sql` | Dedicated empty disposable schema, scoped keys/locking/roles | Shared journal, migration number, RLS qualification or production apply path |
| `tests/integration/ai-twin-model-repository.test.ts` | Opt-in PostgreSQL regression and database/role/run-marker guard; externally verified owned-container binding | Shared/provider/backups/real-user rights proof |
| `tests/unit/ai-twin-model-persistence-contracts.test.ts` | Candidate/export/outcome/unassessed-input negative and positive cases | Semantic evaluator or observed real-world truth |
| `tests/unit/ai-twin-model-lifecycle.test.ts` | R1 exact expiry and authority regression | Physical TTL/backup enforcement |
| `tests/unit/ai-twin-model-legacy-quarantine.test.ts` | Safe metadata inventory and no permission promotion | Historical consent interpretation or import |

Observation/claim/correction, initial hypothesis/relation/need and private source/experience have fixture persistence. Reflection/prediction/outcome, Formation/Health inputs, export metadata and quarantine are pure-only; do not describe these as persisted all-v1 coverage. ModelContext, candidate evidence and export/archive authority remain trusted future adapter inputs. Equality is not authentication. Current/source eligibility is not evidence known at forecast time, Human origin, independence, truth or a transitive acyclic provenance proof.

No mutation of `app/**`, `components/**`, `lib/auth/**`, shared DB clients/schema/journal, Gateway, runtime config, CI, secrets, traffic, deployment, provider accounts or Trader files/issues/PRs/processes/containers/server/data is admitted. Read-only current main/PR/workflow checks are allowed. Trader's MAX=204 and shared-auth PR567 must not be altered or bypassed. No fixture rename/cutover into production.

## Reviewability and rollback rationale

Frozen source has 12 delivered paths including this plan; approximately 3900 added lines before final receipts, of which about 1986 are tests/fixture (779 PG cases, 931 contracts, 120 quarantine, 67 lifecycle, 89 SQL). Remaining code is one 880-line explicit repository, a 720-line contract vocabulary, 99-line quarantine planner and eight additive lifecycle lines; docs preserve source authority. These are one interdependent provenance/rights boundary, not independent product features. Splitting pure helpers away again would multiply dependent PRs while leaving that boundary unqualified.

The ~800-line target is exceeded deliberately, not excused by file count. Publication requires a fresh whole-diff review, explicit file/object accounting, current cumulative units and actual isolated PG qualification. Prior substep approvals are provenance only. If full review finds this boundary unreviewable or not independently valuable, do not publish; retain the source and request a concrete integration decision rather than add more types.

One squash revert removes this disconnected addition; no application imports or production migration/data effects exist to undo. It would remove tests/reference implementations, not erase Human data. No operational rollback, restore or erasure promise follows.

## Work packages

### WP-1 — Freeze, adopt and review

Commit this admission on the new main-based branch, adopt the exact frozen source without changing the original worktree, reconcile DEE-871's frontmatter and add its dated handoff. One integrator owns files. One independent read-only reviewer examines the whole base-to-head diff, including SQL guards, current authority/replay/rights, archive separation, caller/import absence and documentation overclaims. No new vocabulary during integration; only bounded reviewed defects may be fixed.

### WP-2 — Qualify the boundary

Run all four explicit model unit files and the actual20 PostgreSQL scenarios against a new bounded, own disposable Postgres16 fixture. Verify exact container id, loopback port, database, owner role and run marker before any DDL/cleanup. Never use ambient DB variables, .env, provider bootstrap or any shared DB. Negative marker admission must reject before DDL. Cleanup only the verified own temporary target.

Run `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm validate:canon`, `pnpm validate:pr-governance`, and rendered-body preflight. Full unit suite is authoritative once on exact PR HEAD CI, not redundantly local. No UI changed: no new E2E/manual user-journey readiness claim. Required CI E2E remains unchanged.

### WP-3 — One qualified PR and closeout

Before push/publication inspect existing CI/upload behavior and confirm it grants no production traffic/deploy/apply. Create one PR to main only after complete acceptance, full review and local readiness. Bind body to this issue alone; DEE-871 and downstream remain Deferred/open. Reconcile main/HEAD/checks before ordinary squash merge under the user's explicit scoped own-PR authority; never use admin/force or bypass checks. Do not operate another PR or reuse Trader's bounded authority. Any new reserved ambiguity stops merge.

After merge, fetch/verify exact squash containment, required PR checks and expected workflow behavior without duplicate full tests. Close only DEE-973 with evidence; keep DEE-871 open and record precisely which foundation landed. No release tag, production migration, deployment, cleanup of other worktrees or automatic wakeup.

## Acceptance matrix

1. Exact adopted code provenance and complete twelve-file inventory; whole-diff independent review and reviewability admission, zero unresolved blocking findings.
2. Persist/reopen/correct/current projection and scoped idempotency proven; changed-content replay and stale versions denied.
3. Current consent change/withdrawal serializes with writes; immediate exclusion survives cleanup failure; dependent content/links/receipts are removed on retry; stale replay remains denied.
4. Independently authorized private experience survives unrelated modelling withdrawal, but not its own source/authority removal; no archive-to-modelling/disclosure promotion.
5. Exact synthetic fixture identity and least privilege checked. Passing skipped tests is not PG proof; trusted application-scope filtering is not full production RLS/auth.
6. Pure input/export/quarantine/R1 contracts verified without truth/readiness/authority inference; current policy vs source/evidence eligibility remains distinct.
7. Local readiness, canon/governance and required exact-head PR CI green; base freshness, import and shared-surface non-mutation verified.
8. No false parent completion, production rollout or new Human decision implied.

## Validation receipt

Adoption and local qualification completed; authoritative PR CI, final review receipt and merge remain pending. Source substeps alone are not integration readiness.

### 2026-09-09 — Whole-review bounded defect admission

The independent reviewer read all eleven frozen source paths and reran 180 units. Two P2 defects block publication: hypothesis writes/retries do not enforce their ended `validUntil`; generic model reads with `private_archive` can disclose archive timestamps. Add PostgreSQL regressions before fixes, then enforce the same current interval on writes and retries and deny model archive access on generic surfaces. Review related cross-purpose archive rights timestamps as part of this same privacy defect, not a new feature. No other vocabulary or runtime integration is admitted.

Qualification wording: the test validates container-id format and database/role/run marker. The integrator must separately inspect the actual owned container-to-loopback-port-to-marker binding; the suite alone does not establish Docker identity. Frozen source accounting is 1707 library lines, 1897 test lines, 89 SQL fixture lines and 214 documentation lines added (3907 total); tests plus fixture are about 51%.

### 2026-09-09 — Integration qualification at implementation 96ba716b

- Actual PostgreSQL RED reproduced both P2 defects (three failures, sixteen existing passes). A separate added cross-purpose private-clock regression reproduced the second defect's side channel (one failure, nineteen deliberately unselected). The fixes gate ended hypothesis intervals before retries; generic model archive access requires a Human; private-source/experience rights cannot shift the modelling clock, while cross-purpose observation deletion fences remain enforced.
- Final current run: **200/200 passed**, consisting of twenty actual PostgreSQL scenarios and 180 focused units (88 contracts, 43 lifecycle, 35 ledger, 14 quarantine). No skipped PostgreSQL scenario was counted as passing.
- External setup inspected exact own container `0b99fd2fdab11e567b48ba33896ac9ef2331e994da82901ad0a989b9ad7b8040`, image `sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777`, owner label `ai-twin-dee973-20260909-review`, loopback port51549, empty mounts and tmpfs storage. SQL separately confirmed dedicated database/role and the run marker before DDL. Wrong-marker admission failed before DDL; post-check showed no fixture schema and zero service/browser fixture roles. Only that exact owned container was then removed. No persistent user data or other containers were touched.
- Required `pnpm lint` passed with 307 existing repository warnings and zero errors; changed-file lint, `pnpm typecheck`, diff check, canonical validator (152 files plus regressions/release identity) and PR-governance regressions passed. `pnpm build` passed with an explicit own SQLite path after sandbox loopback denial required a scoped retry. No source error was hidden; no full local unit suite was duplicated. No UI change, local E2E or real-user scenario claim.
- Twelve admitted paths only; no imports of the new repository/contracts/quarantine from application components or other runtime library paths. Shared auth/schema/journal/CI/configuration and Trader are unchanged. Only DEE-871/876 evidence comments and the new DEE-973 issue/dependency were updated; their completion was not inferred.
- Read-only publication preflight: GitHub repository secret names contain no Cloudflare credentials; run34337578416 explicitly skipped preview deployment. The Cloudflare WAIA settings page showed both production and branch commands as `wrangler versions upload`, not traffic deployment; main is the production branch, non-production builds enabled. No settings, secrets or triggers changed. Per [Cloudflare version/deployment semantics](https://developers.cloudflare.com/workers/versions-and-deployments/), uploading and activating are separate. PR/merge may produce an inactive version; it does not authorize a production promotion. Recheck exact PR checks/current main before merge.

Independent final code review accepted exact `96ba716bca0f5a6b875fcd996d2ad31292cfa0bc`, closing both P2 findings including the private clock case; no unresolved concrete P1/P2. Reviewer independently reran 180 units and diff check, verified twelve admitted paths (4108 additions/five deletions before this receipt), and did not run PostgreSQL. This final documentation-only receipt inherits the reviewed code unchanged. Read-only pre-publication Cloudflare active deployment was `286d061d`, label `PRODUCTION_90DE233A_PR566_IDLE_INSTALLATION`, at 100%; branch/main build versions visible separately. Do not promote them.

The fixture demonstrates a complete disconnected evidence/rights scenario, not production authentication/RLS, physical TTL or backup erasure, actual export/durable legacy inheritance, ingestion/calibration, Formation/Health evaluation or full v1 readiness. Those remain explicitly deferred to the existing tasks. Final PR/merge outcomes are recorded in DEE-973 and the PR so a documentation-only receipt does not create another integration PR.
