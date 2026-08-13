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
