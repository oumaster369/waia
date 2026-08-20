# Integration boundary policy

**Owner:** Architect · **Status:** Canonical

Defines **when a PR exists**, how integration batches split, agent action classification, branch synchronization, and post-merge state reconciliation. Complements [`LIFECYCLE.md`](LIFECYCLE.md) and [`PR-PROTOCOL.md`](PR-PROTOCOL.md).

---

## Core invariant

**One integration Linear issue = one canonical plan = one primary branch = one PR = one merge event** to **`main`**.

`linear-done.yml` closes the single `**Linear:**` id on first merge. A second PR on the same issue would orphan remaining work. When work must split, spawn a **new integration batch** (own Linear issue, plan, branch, PR, explicit `dependsOn`).

**Multi-work-package / Includes:** several coherent work packages may land in **one** integration batch / one PR when the integration-ready contract holds. For an AI-TRADER multi-issue batch to qualify for the DEE-653 controller path, `**Includes:**` is only a projection of the frozen Integration Train manifest below; it is not authority by itself.

## AI-TRADER Integration Train contract

An **Integration Batch issue** owns one canonical plan, one integration branch, one PR, one exact-head admission, and one squash merge. Its child implementation issues remain atomic, independently traceable, independently testable Linear contracts, but they do not each require a PR.

Before any child implementation is admitted to train mode, the canonical plan and its versioned manifest file at `docs/plans/dee-<NN>-<slug>.integration-train.json` must enumerate every proposed included child with dependency evidence, scope, expected file/schema surfaces, risk tier, Human-gate status, expected acceptance/validation evidence, and a contiguous positive-integer execution `wave`. Commit that valid `status: admitted` form before any child implementation. That immutable Git commit/path/digest is the admission inventory; no unlisted child may start or join the train.

Before PR publication, update that same manifest to the final delivered/deferred inventory, set it to **frozen**, bind `preImplementationAdmission` to the admitted predecessor's exact Git commit/path/SHA-256 digest, and validate it with [`validate-integration-train-manifest.sh`](../../scripts/linear/validate-integration-train-manifest.sh). The verifier loads and validates that historical file, requires exact admitted→frozen inventory closure, and proves every delivered commit is after admission and within the exact PR history. The frozen form records, for every delivered child:

- Linear id, complete scope, blocker/dependency evidence, expected file or schema surfaces, actual files, coherent risk tier, and Human-gate status;
- exact integrated commits, reviewed files/diff, child acceptance evidence, and child-specific tests; `actualFiles` must exactly equal the changed-file union of those reachable commits and every actual file must fall within that child's admitted expected surfaces;
- serialized or parallel execution disposition and the no-overlap/no-invalidation evidence required below.

The manifest also records deferred/excluded children with a reason and `completionClaimed: false`, cumulative targeted checks after each admitted child, complete-diff freeze, final independent-review requirement, concurrency limit, and serialized final integration/merge.

### Size and concurrency

- **Recommended size:** 2–5 delivered children. One child uses the ordinary single-issue flow. More than five is not silently forbidden, but requires an explicit `splitRationale` proving reviewability under the existing ~800-line/~20-file target, coherent risk/Human gates, and one rollback boundary.
- At most **two** implementation tasks may run concurrently, each in an isolated worktree and child branch. Contiguous numbered waves encode the complete execution order: a one-child wave is serialized; a two-child wave is one declared parallel group; no wave may contain more than two children. Every included dependency must occur in an earlier wave. Final integration and merge are always serialized.
- Dependent or overlapping children must be serialized. Competing migrations, shared canonical identities, shared authority schemas, or diffs that can invalidate one another must be serialized even if their file lists appear disjoint.
- A declared parallel pair must have no dependency edge, no overlapping expected file/schema surface or actual file, no competing migration, no shared canonical identity/authority schema, and no mutual invalidation risk. Missing or uncertain evidence means serialize or split.

### Admission, freeze, and removal

1. Integrate only reviewed commits/diffs. Map each child to its exact integrated commits, files, acceptance evidence, and tests.
2. After every child admission, run cumulative targeted validation for the entire integration branch state reached so far.
3. A failed or blocked child may be removed without invalidating other independent children. Before PR publication, remove its diff, move it to `deferredChildren` with `completionClaimed: false`, re-run affected cumulative checks, and freeze a new manifest digest. Never report excluded work as delivered.
   A remaining delivered child may not depend on a deferred/removed child; if it does, defer it too or split/re-plan the batch.
4. Freeze the complete integration diff before authoritative full PR CI and final independent adversarial review. Any material head, base, manifest, or integrated-child change invalidates the affected validation/review/admission evidence.
5. Immediately before squash merge, re-fetch `origin/main` and prove exact base/head freshness, manifest closure, all delivered-child acceptance evidence, zero unresolved findings, required exact-head checks, and current DEE-653 admission.

Train mode must split before PR publication whenever reviewability, risk-tier/Human-gate coherence, dependency/overlap safety, or rollback boundaries fail. It never combines or bypasses Human-only canon/semantic, raw-storage/security, official blind-holdout, strategy/live-capital, production, destructive-operation, security, Execution Server, or T4 gates.

The exact PR base→head diff must close over the union of delivered-child `actualFiles` plus only the Integration Batch's adjacent canonical plan and manifest. Before admission, only those two integration-owned files may differ from the PR base. After admission, every non-plan/manifest commit must be one of the child commits mapped in the frozen manifest. Unlisted implementation files or commits fail closed even when they touch an otherwise listed child surface.

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
8. Linear relationship correct: `**Linear:**` integration id; optional `**Includes:**` child ids; `**Deferred:**` for undelivered children. For an AI-TRADER Integration Train, both child sets exactly match the validated frozen manifest and its digest/base/head/review-head bindings.

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

An Integration Train also splits when its child risk tiers or Human-gate classes are incoherent, a child cannot be removed independently, or one revert cannot restore the pre-batch state safely.

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

### HUMAN-ONLY — never perform by default

Merge; direct push to `main` (or frozen `dev`); production deploy; Execution Server sync/build/deploy/rollback; live trading; secret mutation; destructive data ops; weakening hooks, rulesets, tests, CI, tenant isolation, or security gates; creating production release tags.

**Narrow merge exception:** after DEE-653 itself is Human-merged, the acting AI-TRADER Program Controller may squash-merge only a qualifying Step 0–22 implementation PR under [`AI-TRADER-BOUNDED-MERGE-AUTHORITY.md`](AI-TRADER-BOUNDED-MERGE-AUTHORITY.md). This exception does not authorize direct pushes or any other HUMAN-ONLY action above.

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

For a merged Integration Train, automatic Linear completion still targets only the explicit Integration Batch issue. After proving the squash SHA is contained in `origin/main`, reconcile the frozen manifest manually: close only `includedChildren` delivered by that exact head; leave every `deferredChildren` issue open/blocked/canceled according to its truthful state. Any mismatch is a STOP, not a reason to bulk-close.

---

## PR template fields

| Field | Validated | Auto-closed on merge |
|-------|-----------|----------------------|
| `**Linear:**` | Yes | Yes (integration issue only) |
| `**Includes:**` | Yes in Integration Train mode; otherwise No | No |
| `**Deferred:**` | Yes in Integration Train mode; otherwise No | No |
| `**Parent:**` | No | No |

Child completion is verified against the frozen Integration Train manifest when train mode applies. Ordinary work-package `Includes` remains descriptive and Human-merge-only unless separately authorized.
