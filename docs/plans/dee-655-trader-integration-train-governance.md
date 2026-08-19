---
integrationIssue: DEE-655
integrationTitle: "AI-TRADER — Formalize bounded Trader Integration Train governance"
branch: dee-655-trader-integration-train-governance
riskTier: T1
prPolicy: one-integration-pr
executionSurfaces: [local, linear, github-pr]
requiredValidation: [pr-governance, canon, lint, typecheck, build, authoritative-pr-ci]
approvalGates:
  - human-scope-ratified
  - plan-approved
  - independent-adversarial-review
  - integration-ready
  - human-merge
includedIssues: []
deferredIssues: [DEE-620]
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: integration-ready
  currentWorkPackage: null
  completedWorkPackages: [WP-1, WP-2, WP-3]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: "2026-08-19"
  blockedReason: null
  nextAction: "Commit the frozen governance diff, obtain independent adversarial review of that exact head, then open one Human-merge-only PR."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-655 — Trader Integration Train governance

## Authority and baseline

- Human Architect authorization: 2026-08-19 delegation for the exact bounded Integration Train contract recorded in DEE-655.
- Parent/program authority: DEE-601; bounded merge authority to preserve: DEE-653.
- Verified base: `origin/main@37e104b577954e90f28bc720a758c67d76bc06d9`, exactly PR #469 / DEE-654.
- This is a single-issue governance batch. It does not itself use an Integration Train manifest and does not start DEE-620 or any downstream implementation.
- T1 is required by the T0 meaning caveat: the files are documentation/process code, but the amendment changes governance meaning.

## Goal

Make bounded multi-issue AI-TRADER implementation batches explicit and fail-closed without expanding DEE-653 beyond batching, weakening any gate, or invalidating the existing single-issue PR path.

## Rule map

| Existing rule | Current owner | Amendment |
|---|---|---|
| One integration issue owns one plan/branch/PR/merge | `INTEGRATION-BOUNDARY-POLICY.md`, `LIFECYCLE.md`, `AGENTS.md` | Preserve it; name that owner the Integration Batch issue for train mode. |
| Coherent `Includes` children may share a PR | `INTEGRATION-BOUNDARY-POLICY.md`, `PR-PROTOCOL.md` | Replace the unvalidated allowance, for Trader autonomous-merge eligibility only, with a frozen versioned manifest and exact evidence map. |
| Plan `includedIssues` is the child manifest | `docs/plans/README.md` | Add an optional Integration Train JSON manifest owned by the plan; ordinary single-issue plans remain unchanged. |
| PR metadata is machine checked | `validate-pr-linear-id.sh`, preflight, `pr-governance.yml` | Bind manifest digest and exact PR base/head/review head; compare `Includes`/`Deferred` with the manifest. |
| Parallel issues use isolated worktrees | `.cursor/commands/parallel-implement.md` | Add train mode: at most two implementation tasks, no dependency/overlap/authority-schema/migration collision, serialized admission. |
| DEE-653 exact-head merge exception | `AI-TRADER-BOUNDED-MERGE-AUTHORITY.md` | Admit only manifest-valid Step 0–22 implementation trains; preserve all reserved/Human-only exclusions. |
| Only explicit Linear id auto-closes | `linear-done.yml`, `POST-MERGE-PROTOCOL.md` | Preserve automatic integration-issue closure; controller manually closes only manifest-delivered children after the merged-head proof. |
| Split on tier/gate/review/rollback incoherence | `INTEGRATION-BOUNDARY-POLICY.md` | Make this a pre-PR fail-closed train admission rule; recommend 2–5 children, with larger batches requiring explicit reviewability rationale. |

No Product Constitution, Step 0–22 algorithm, Trader runtime, schema, migration, holdout, security, production, capital, or Execution Server surface is in scope.

## Split rationale

The amendment exceeds the usual ~20-file review target because the existing issue→plan→branch→PR contract is intentionally repeated across the root router, canonical lifecycle/boundary/merge documents, PR template/commands, two GitHub workflows, and their shared validators/tests. Splitting would temporarily publish either policy without enforcement or enforcement without canonical instructions, which is a contradictory governance state and not reversible intermediate value. The change remains one narrow invariant, one new validator with fixtures, one rollback boundary, no runtime/business logic, and no mixed risk/Human gate.

## Work packages

### WP-1 — Canonical contract and manifest schema

- Define train admission, concurrency, serialization, freeze, removal, reconciliation, and split rules.
- Extend the canonical plan schema with an optional versioned Integration Train JSON manifest.
- Update the root router and directly conflicting process guidance only.

### WP-2 — Machine-verifiable PR governance

- Add a dedicated manifest validator.
- Wire train mode into the existing PR validator/preflight and GitHub exact base/head environment.
- Preserve backward-compatible single-issue validation.

### WP-3 — Freeze, validate, review, and PR

- Run targeted governance/canon tests, lint, typecheck, and build.
- Freeze the complete diff and obtain independent adversarial review against the exact commit.
- Open one PR to `main`; this governance-authority amendment remains Human-merge-only under the current DEE-653 reserved-surface rule.

## Acceptance

1. Single-issue PR bodies continue to pass without a train manifest.
2. A train PR cannot pass governance unless its frozen manifest is cryptographically bound to a valid committed admitted predecessor, digest-bound, exact-base/head/review-head-bound, scope/tier/gate coherent, and its delivered/deferred child lists exactly match the PR body.
3. Included children carry non-empty dependency, scope, expected/actual surface, commit, acceptance, and test evidence; Git proves the delivered commits are post-admission, reachable, in-range, changed-file-exact, inside admitted surfaces, and close the complete PR diff/commit range; deferred children cannot claim completion or remain a dependency of delivered work.
4. Contiguous dependency-ordered waves contain at most two children. Parallel pairs fail on dependency, expected/actual overlap, competing migration, shared canonical identity, shared authority schema, or mutual invalidation.
5. Full-diff freeze, cumulative checks, final serialized integration, squash merge, independent review, zero findings, and fresh DEE-653 admission are mandatory.
6. Human-only/reserved surfaces remain ineligible and no governance PR self-authorizes its merge.
7. Regression tests cover every case named in DEE-655 acceptance.

## Validation

- `pnpm validate:pr-governance`
- `pnpm validate:canon`
- targeted shell syntax and manifest fixtures
- `pnpm lint`
- `pnpm typecheck`
- `pnpm build`
- rendered DEE-655 PR-body preflight
- authoritative GitHub PR CI on the exact head
- independent adversarial review after diff freeze

## Rollback

One revert PR removes the additive train mode and restores the prior unvalidated `Includes` behavior. No production or runtime state changes on merge.
