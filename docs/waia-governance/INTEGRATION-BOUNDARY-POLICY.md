# Integration boundary policy

**Owner:** Architect · **Status:** Canonical

Defines **when a PR exists**, how integration batches split, agent action classification, branch synchronization, and post-merge state reconciliation. Complements [`LIFECYCLE.md`](LIFECYCLE.md) and [`PR-PROTOCOL.md`](PR-PROTOCOL.md).

---

## Core invariant

**One integration Linear issue = one canonical plan = one primary branch = one PR = one merge event** to **`main`**.

`linear-done.yml` closes the single `**Linear:**` id on first merge. A second PR on the same issue would orphan remaining work. When work must split, spawn a **new integration batch** (own Linear issue, plan, branch, PR, explicit `dependsOn`).

**Multi-work-package / Includes:** several coherent work packages and child issues under `**Includes:**` may land in **one** integration batch / one PR when the integration-ready contract holds. Preserve the splitting criteria below when batches are not coherent.

---

## PR = integration boundary

- Local commits at meaningful checkpoints; branch may be pushed repeatedly with **no PR** yet.
- **No PR** until the integration-ready contract (below) holds.
- **One PR mandatory** once integration-ready — base **`main`**.

---

## Integration-ready contract

All must hold before opening a PR:

1. Approved scope complete; plan acceptance criteria met.
2. Required local validation green: `pnpm lint && pnpm typecheck && pnpm build` + targeted tests for changed surfaces (+ `pnpm test:e2e` when UI). Full unit suite is authoritative in GitHub PR CI — do not require a redundant full local `pnpm test --run` solely to duplicate CI.
3. Required Execution Server validation green when applicable (read-only for agents).
4. Evidence classified/stored per [`EVIDENCE-POLICY.md`](EVIDENCE-POLICY.md) when that standard exists.
5. Docs updated; no unresolved temp artifacts.
6. Branch synchronized with `origin/main` (§Branch sync).
7. PR body prepared from canonical plan + evidence.
8. Linear relationship correct: `**Linear:**` integration id; optional `**Includes:**` child ids; `**Deferred:**` for undelivered children.

---

## When work must split

Do **not** open a second PR on the same integration issue. Instead create a new batch with its own Linear issue, plan, branch, PR, and `dependsOn` the preceding batch when:

- independent deployability;
- different risk tiers;
- infra separated from docs/app;
- prerequisite for parallel work;
- unreviewable diff;
- different approval/human gate;
- reversible intermediate value.

Never split merely because a plan has several steps — those are work-packages inside one PR.

**Reviewability:** target ~800 changed lines or ~20 files (excluding generated/lockfiles) per batch; exceed only with explicit split rationale.

**Stale branches:** if unmerged >5 working days, record blocked reason and request operator direction.

---

## Branch synchronization (hook-safe)

`.cursor/hooks/guard-shell.sh` blocks force-push and direct push to `main` (and frozen `dev`).

| Phase | Policy |
|-------|--------|
| **Before first remote push** | Rebase onto current `origin/main` allowed. |
| **After branch pushed** | **Merge, not rebase:** `git fetch origin && git merge --no-edit origin/main`; resolve conflicts; re-run targeted validation; push normally. |
| **Never** | Force-push; bypass guard-shell; destructively reset a published branch. |

Synchronize before declaring integration-ready. If PR exists and `main` changes materially, merge `origin/main` again and re-run validation.

---

## AUTO / CONFIRM / HUMAN-ONLY

### AUTO — execute without stopping

Repository inspection; safe read-only diagnostics; documentation/code on feature branch; local tests/build; feature-branch commits/push; PR body preparation; **one PR to `main` when integration-ready**; updating non-sensitive canonical-plan `state` frontmatter.

### CONFIRM — stop and ask

New Linear integration issue (unless pre-authorized); scope change; batch split/merge beyond approved plan; plan promotion to `state.status: approved`; ambiguous child completion; PR when criteria partially met; constitutional governance edits; branch-protection/CI changes; unapproved schema change.

### HUMAN-ONLY — never perform

Merge; direct push to `main` (or frozen `dev`); production deploy; Execution Server sync/build/deploy/rollback; live trading; secret mutation; destructive data ops; weakening hooks, rulesets, tests, CI, tenant isolation, or security gates; creating production release tags.

---

## Minimal operator checkpoints

Normal low-risk batch: **scope approval** + **merge approval** only.

1. **Scope approval** — issue, plan, tier, surfaces, acceptance criteria.
2. **Exceptional runtime/architecture** — Execution Server mutation, T3/T4, DB migration, constitutional change, live external ops.
3. **Merge approval** — human reviews integration-ready PR and squash-merges to `main`.
4. **Production/live-operation** — explicit Human release tag of a `main` SHA, host deploy, live AI-TRADER, market credentials.

---

## Post-merge state reconciliation

Composer must **not** write status-only commits or second PRs after human merge.

- **Before merge:** canonical plan may show `state.status: in-review` + `prNumber`/`prUrl`.
- **Effective merged:** `in-review` + GitHub PR merged + squash commit on `origin/main` + Linear `Done` ⇒ batch effectively complete.
- **Normalization:** stale `in-review` may become `merged` only in a later authorized PR or future reconciliation automation — never by direct push to `main` or second PR on the completed issue.

Roadmap batch status, Gap Registry disposition, and post-merge evidence follow the same rule: prepare before merge when deterministic; else reconcile in the next authorized batch.

After merge, developers/agents sync: `git checkout main && git pull --ff-only origin main`.

---

## PR template fields

| Field | Validated | Auto-closed on merge |
|-------|-----------|----------------------|
| `**Linear:**` | Yes | Yes (integration issue only) |
| `**Includes:**` | No | No |
| `**Deferred:**` | No | No |
| `**Parent:**` | No | No |

Child completion verified at integration-ready review against plan `includedIssues` manifest.
