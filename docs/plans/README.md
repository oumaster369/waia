# Canonical integration plans

Committed integration plans live here. Each file is the **single state primitive** for one integration batch: identity, Linear manifest, execution surfaces, validation, approval gates, and resumable `state`.

Draft scratch plans remain in `.cursor/plans/` (gitignored).

---

## Bootstrap → canonical transition

| Phase | Plan source |
|-------|-------------|
| Historical (pre–Slice C) | Master Build program + Linear issue + branch + commits + PR |
| Current (post–Slice C) | `docs/plans/dee-<NN>-<slug>.md` per integration issue ([`LIFECYCLE.md`](../waia-governance/LIFECYCLE.md)) |

The vNext master Build program remains **program architecture**; these files hold **mutable per-task operational state**.

---

## File naming

`docs/plans/dee-<NN>-<slug>.md` — must match branch `dee-<NN>-<slug>`.

Archived plans: `docs/plans/archive/dee-<NN>-<slug>.md` when superseded or abandoned.

Human ratification addenda and plan amendments are **not** integration plans. They live beside the parent plan as:

`docs/plans/dee-<NN>-<slug>-(addendum|amendment)-vN.md`

They must not carry the full integration-plan frontmatter/`state` schema. Canonical-doc validation classifies this filename pattern as an addendum: require a `##` body heading; if YAML frontmatter is present, `kind` must be `ratification-addendum` or `plan-amendment`. Do not treat an addendum as a second integration batch.

---

## Frontmatter schema

```yaml
---
integrationIssue: DEE-XXX
integrationTitle: "..."
branch: dee-XXX-slug
riskTier: T2
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [lint, typecheck, unit, build]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues:
  - id: DEE-YYY
    role: work-package
    completionPolicy: manual-at-integration-ready
    status: pending
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: draft | approved | in-progress | integration-ready | in-review | blocked | abandoned
  currentWorkPackage: WP-1
  completedWorkPackages: []
  remainingWorkPackages: [WP-1]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "..."
provenance:
  createdFrom: chat | roadmap-batch
  gapRegistry: null
  supersedes: null
---
```

**Status rules:** `state.status` is the **only** status field (no top-level `status:`). Maximum pre-merge status: `in-review`. Effective `merged` is **derived** after human merge — see [`INTEGRATION-BOUNDARY-POLICY.md`](../waia-governance/INTEGRATION-BOUNDARY-POLICY.md) §Post-merge reconciliation.

## Optional AI-TRADER Integration Train manifest

Ordinary single-issue plans use no additional manifest. A multi-issue AI-TRADER train owns exactly one adjacent machine-verifiable file:

`docs/plans/dee-<NN>-<slug>.integration-train.json`

The file uses `schemaVersion: "waia-trader-integration-train/v1"` and the contract in [`INTEGRATION-BOUNDARY-POLICY.md`](../waia-governance/INTEGRATION-BOUNDARY-POLICY.md). It has two truthful lifecycle forms:

1. **`status: "admitted"` before child implementation** — enumerates every planned child, dependency evidence, scope, expected file/schema surfaces, coherent tier/Human-gate status, expected acceptance/tests, and contiguous ordered execution waves. Unlisted work is not admitted. Commit this form before any child implementation.
2. **`status: "frozen"` before PR publication** — contains only delivered children plus explicitly deferred/excluded children, retains each delivered child's admitted fields, and adds exact child→commit/file/test/acceptance mappings, cumulative checks after every admission, and complete-diff freeze/final-review requirements. `preImplementationAdmission` binds the predecessor manifest's Git commit, repository-relative path, and SHA-256 digest.

Validate admission form with:

```bash
./scripts/linear/validate-integration-train-manifest.sh <path> DEE-NN admission
```

Validate frozen form with the default `frozen` phase. In branch/PR validation, the verifier loads the historical admitted file from Git, checks its digest/inventory, proves every delivered commit is after admission and within the exact head history, compares each child commit's changed files with `actualFiles`, requires those files to match admitted expected surfaces, and closes the complete PR diff/commit range over mapped children plus only the adjacent plan/manifest. `validate:canon` accepts either durable lifecycle schema after squash; PR governance performs the full history proof and also binds the frozen SHA-256 digest plus exact PR base/head/review head. The recommended delivered set is 2–5 children. More than five requires an explicit split rationale; this is reviewable, not a silent fixed cap.

---

## Promotion path

1. `/plan-feature` writes draft to `.cursor/plans/`.
2. Human approves (CONFIRM) → promote to `docs/plans/<branch>.md` with `state.status: approved`.
3. `/implement` resolves plan by `integrationIssue` matching current branch.
4. Composer updates `state` after each work package and validation run (committed with related changes).
5. `/prepare-pr` derives PR body from plan + evidence; records `prNumber`/`prUrl`; sets `state.status: in-review`.

Secrets never enter plans. Review before commit.

---

## New integration batches

vNext DEV OS integration (Slices A–H) completed 2026-07. For new work, create `docs/plans/dee-<NN>-<slug>.md` when the Linear integration issue is approved — one file per integration batch, following the schema above.

---

## Commands

| Command | Plan behavior |
|---------|---------------|
| `/plan-feature` | Draft → `.cursor/plans/`; promote on approval |
| `/implement` | Load `docs/plans/<branch>.md` by `integrationIssue`; fallback newest `.cursor/plans/` draft |
| `/test-and-fix` | Update `lastValidatedGitSha` / evaluate integration-ready |
| `/prepare-pr` | Body from plan; enforce one PR per issue |

See [`INTEGRATION-BOUNDARY-POLICY.md`](../waia-governance/INTEGRATION-BOUNDARY-POLICY.md) and [`LIFECYCLE.md`](../waia-governance/LIFECYCLE.md).
