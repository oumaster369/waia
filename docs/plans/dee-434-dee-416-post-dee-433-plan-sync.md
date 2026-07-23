---
integrationIssue: DEE-434
integrationTitle: "AI-TRADER: Reconcile DEE-416 plan after DEE-433 release defect"
branch: dee-434-dee-416-post-dee-433-plan-sync
riskTier: T2
prPolicy: one-pr
executionSurfaces: [local, cursor-agent, github-actions]
requiredValidation: [validate-canon, lint, typecheck, unit, build, validate-pr-governance]
approvalGates: [human-scope-approved, integration-ready, human-merge]
parentIssue: DEE-416
dependsOn: [DEE-433]
affectedCanonicalPlan:
  - docs/plans/dee-416-ai-trader-historical-validation-operations-and-observability.md
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-progress
  currentTask: reconcile post-DEE-433 release/T4 truth in parent canonical plan
  baseGitSha: e3598756c646fd25d047a665188077f25a07b5d3
  executionServerSurface: none
  releaseAuthorization: none
  t4Authorization: none
  blockedReason: null
  nextAction: "Update parent plan, validate, open docs-only PR to dev, move DEE-434 to In Review"
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
  groomedAt: "2026-07-23"
---

# DEE-434 — Post-DEE-433 canonical plan reconciliation

## Context

PR #417 / DEE-433 corrected the FHV observer systemd StartLimit section placement and merged to `dev` as squash commit `e3598756c646fd25d047a665188077f25a07b5d3`. The parent DEE-416 canonical operations plan still described a direct T4 path against production release `6e617461…`, which is blocked by the proven Phase B4 release defect and the preserved old T4 run evidence.

## Goal

Reconcile `docs/plans/dee-416-ai-trader-historical-validation-operations-and-observability.md` so operators cannot reuse the old blocked release, old T4 run, or its artifacts, and cannot proceed to T4 before a new Human-approved dev→main release, tag-peel proof, GitHub Release verification, and mandatory main→dev back-sync.

## Scope

- Update only the parent DEE-416 canonical operations plan.
- Record PR #416 and PR #417 merge truth.
- Record old blocked T4 evidence as preserved, non-reusable blocked evidence.
- Correct active terminal classification and Human gate sequence.
- Leave downstream dataset, control-replay, holdout, and full-validation gates closed.

## Do NOT

- Touch runtime code, tests, workflows, or governance documents.
- Create a release PR, tag, or GitHub Release.
- Connect to or mutate the Execution Server.
- Authorize T4 or define a new `EXECUTION_SERVER_TARGET_SHA`.
- Mark DEE-416 or DEE-424 Done.

## Acceptance criteria

- Parent plan reflects post-#417 GitHub and Linear truth.
- Old release/run/artifacts explicitly prohibited from reuse.
- New release promotion and mandatory back-sync precede any fresh T4 attempt.
- `NEXT_T4_EXECUTION_SERVER_TARGET_SHA` remains `NOT_RESOLVED`.
- Canonical validation and PR governance pass.
- Exactly one docs-only PR to `dev`.

## Validation

```bash
corepack pnpm@10 validate:canon
corepack pnpm@10 lint
corepack pnpm@10 typecheck
corepack pnpm@10 test --run
corepack pnpm@10 build
PR_TITLE="DEE-434 docs(plan): reconcile DEE-416 after DEE-433 merge" \
PR_BRANCH="dee-434-dee-416-post-dee-433-plan-sync" \
PR_BASE=dev \
./scripts/linear/preflight-pr-governance.sh --body-file .cursor/pr-body-DEE-434.md
```

## WP-1 — Parent plan reconciliation

- Add DEE-433 and completed PR #416 / PR #417 entries to parent frontmatter and completed work.
- Replace active post-merge snapshot, blocked T4 evidence, release identity fields, Human gate sequence, terminal classification, and STOP conditions.
- Preserve historical sections as historical evidence only.
