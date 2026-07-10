# Canonical integration plans

Committed integration plans live here. Each file is the **single state primitive** for one integration batch: identity, Linear manifest, execution surfaces, validation, approval gates, and resumable `state`.

Draft scratch plans remain in `.cursor/plans/` (gitignored).

---

## Bootstrap → canonical transition

| Phase | Plan source |
|-------|-------------|
| Before Slice C merged | Master Build program + Linear issue + branch + commits + PR ([`LIFECYCLE.md`](../waia-governance/LIFECYCLE.md) bootstrap) |
| After Slice C merged | `docs/plans/dee-<NN>-<slug>.md` per integration issue |

The vNext master Build program remains **program architecture**; these files hold **mutable per-task operational state**.

---

## File naming

`docs/plans/dee-<NN>-<slug>.md` — must match branch `dee-<NN>-<slug>`.

Archived plans: `docs/plans/archive/dee-<NN>-<slug>.md` when superseded or abandoned.

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

## Future slice plan creation (vNext backlog)

After the Linear integration issue exists for each remaining vNext slice, promote one plan file:

| Slice | Suggested path |
|-------|----------------|
| G | `docs/plans/dee-<NN>-devos-spec-gap-foundation.md` |
| D1 | `docs/plans/dee-<NN>-devos-exec-surfaces.md` |
| D2 | `docs/plans/dee-<NN>-devos-exec-server-tooling.md` |
| E | `docs/plans/dee-<NN>-devos-evidence-m9.md` |
| F | `docs/plans/dee-<NN>-devos-model-operator.md` |
| H | `docs/plans/dee-<NN>-devos-autopilot-prep.md` |

Do not pre-create all plans in Slice C — define the path only; create each plan when its issue is approved.

---

## Commands

| Command | Plan behavior |
|---------|---------------|
| `/plan-feature` | Draft → `.cursor/plans/`; promote on approval |
| `/implement` | Load `docs/plans/<branch>.md` by `integrationIssue`; fallback newest `.cursor/plans/` draft |
| `/test-and-fix` | Update `lastValidatedGitSha` / evaluate integration-ready |
| `/prepare-pr` | Body from plan; enforce one PR per issue |

See [`INTEGRATION-BOUNDARY-POLICY.md`](../waia-governance/INTEGRATION-BOUNDARY-POLICY.md) and [`LIFECYCLE.md`](../waia-governance/LIFECYCLE.md).
