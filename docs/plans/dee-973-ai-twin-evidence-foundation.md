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
state: { status: in-progress, currentWorkPackage: WP-1, completedWorkPackages: [], remainingWorkPackages: [WP-1, WP-2, WP-3], prNumber: null, prUrl: null, lastValidatedGitSha: null, lastValidationAt: null, blockedReason: null, nextAction: "Adopt exact frozen source after this admission; whole-diff review and isolated qualification before one PR." }
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
| `tests/integration/ai-twin-model-repository.test.ts` | Opt-in actual PostgreSQL regression and exact fixture identity guard | Shared/provider/backups/real-user rights proof |
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

Run all four explicit model unit files and the actual16 PostgreSQL scenarios against a new bounded, own disposable Postgres16 fixture. Verify exact container id, loopback port, database, owner role and run marker before any DDL/cleanup. Never use ambient DB variables, .env, provider bootstrap or any shared DB. Negative marker admission must reject before DDL. Cleanup only the verified own temporary target.

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

Pending adoption and whole-package checks. Source substeps are not integration readiness. The upcoming current receipt must distinguish independently rerun checks from integrator evidence and list any unexecuted checks explicitly.
