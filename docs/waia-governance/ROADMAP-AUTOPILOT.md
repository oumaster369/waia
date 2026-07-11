# Roadmap autopilot preparation

**Owner:** Architect · **Status:** Canonical (preparation only) · **Slice:** vNext H · **Linear:** DEE-410

Defines the **contract** for future roadmap autopilot: how an orchestrator would select integration batches, drive status transitions, prevent duplicate work, resume after failure, and reconcile gap/roadmap state **without** violating the PR = integration boundary invariant.

**This slice authorizes documentation only.** No orchestrator runtime, scheduler, webhook handler, or automation script ships here.

**Related:**

- [`INTEGRATION-BOUNDARY-POLICY.md`](INTEGRATION-BOUNDARY-POLICY.md) — PR boundary, post-merge reconciliation, AUTO/CONFIRM/HUMAN-ONLY
- [`LIFECYCLE.md`](LIFECYCLE.md) — integration batch lifecycle
- [`../roadmaps/ROADMAP-STANDARD.md`](../roadmaps/ROADMAP-STANDARD.md) — batch schema
- [`../gaps/GAP-REGISTRY-STANDARD.md`](../gaps/GAP-REGISTRY-STANDARD.md) — gap disposition
- [`../plans/README.md`](../plans/README.md) — canonical plan `state` primitive
- [`AGENT-AUTO-ADVANCE.md`](AGENT-AUTO-ADVANCE.md) — safe auto-advance within one batch
- [`AUTONOMOUS-EXECUTION-LOOP.md`](AUTONOMOUS-EXECUTION-LOOP.md) — 12-step human-sequenced loop (not a competing runtime)

---

## Purpose

Roadmap autopilot is a **future read-only coordinator** that:

1. Reads roadmap, gap registry, canonical plans, and Linear to propose the **next executable batch**.
2. Surfaces **resume/retry** context when a batch stalls.
3. Enforces **duplicate-batch prevention** before scope approval.
4. Prepares **post-merge gap/roadmap updates** in the batch that *caused* the merge — never via forbidden post-merge Git writes.

Autopilot **does not** merge PRs, mutate production, open Linear issues without CONFIRM, or advance to the next batch without human confirmation after merge ([`POST-MERGE-PROTOCOL.md`](POST-MERGE-PROTOCOL.md)).

---

## Batch-selection policy

Selection runs only when **no integration batch** is `in-progress`, `integration-ready`, or `in-review` for the active program — unless the operator explicitly requests **resume** of a stalled batch.

### Priority order

| Rank | Source | Rule |
|------|--------|------|
| 1 | **Explicit operator directive** | Architect-approved Linear issue or chat instruction overrides autopilot ranking. |
| 2 | **Resume eligible batch** | Canonical plan `state.status` ∈ `in-progress` \| `blocked` with known `nextAction` and green last validation when applicable. |
| 3 | **Roadmap `approved` batch** | Lowest `batchId` / earliest `dependsOn` satisfied in [`../roadmaps/`](../roadmaps/) with `status: approved` and no open `dependsOn` blockers. |
| 4 | **Gap-driven intake** | Open `blocker` or `major` gap in [`../gaps/`](../gaps/) mapped to a roadmap batch with `status: planned` — surface for Architect scope approval (CONFIRM), do not auto-start. |
| 5 | **Linear `Todo`** | Per [`TASK-LIFECYCLE.md`](TASK-LIFECYCLE.md) when issue is already groomed and label-sane. |

### Exclusion rules (never auto-select)

- Batch with `riskTier` T3/T4 unless Architect hold explicitly cleared in issue text.
- Batch whose `dependsOn` references incomplete `batchId` or open Linear blocker.
- Batch with an existing open PR on the same `linearIssue` ([`INTEGRATION-BOUNDARY-POLICY.md`](INTEGRATION-BOUNDARY-POLICY.md) one-PR invariant).
- Batch marked `deferred` on roadmap or `wont-fix` / `deferred` gap without Architect re-approval.
- Work outside [`NON-GOALS.md`](NON-GOALS.md) or constitutional hold.

### Output (read-only)

Proposed selection record — not an execution command:

```yaml
selectionId: SEL-<ISO8601>
program: ROADMAP-<PROGRAM>
batchId: IB-<PROGRAM>-<NN>
linearIssue: DEE-NNN
planPath: docs/plans/dee-NNN-slug.md
reason: depends-on-satisfied | resume-blocked | operator-directive
blockedBy: []   # empty when selectable
riskTier: T0 | T1 | T2
```

---

## Status-transition contract

Autopilot **observes** and **recommends** transitions; only humans/agents in normal lifecycle **perform** them. Three parallel status planes must stay consistent:

| Plane | Authority | Terminal pre-merge | Effective merged |
|-------|-----------|----------------------|------------------|
| **Linear** | Agent/human per [`LIFECYCLE.md`](LIFECYCLE.md) | `In Review` | `Done` (via `linear-done.yml` or human) |
| **Canonical plan** `state.status` | Agent commits on feature branch | `in-review` | **Derived** — never written post-merge |
| **Roadmap batch** `status` | Architect-approved batch in `docs/roadmaps/` | `in-progress` | `complete` only after human merge + gap closure |

### Allowed transitions (autopilot may recommend)

```text
planned → approved        # Architect scope approval (CONFIRM)
approved → in-progress    # Plan promoted; work starts
in-progress → blocked     # STOP / validation failure / ambiguous scope
blocked → in-progress     # Blocker cleared; resume
in-progress → integration-ready  # Green validation + acceptance met
integration-ready → in-review    # PR opened; Linear In Review
in-review → (effective complete) # Human merge — derived, not written by autopilot
```

### Forbidden transitions

- `in-review` → `merged` via status-only commit after human merge ([`INTEGRATION-BOUNDARY-POLICY.md`](INTEGRATION-BOUNDARY-POLICY.md) §Post-merge reconciliation).
- Second PR or branch for the same `linearIssue`.
- Auto `Done` without merge event.
- Roadmap `complete` or gap `closed` **before** merge lands on `origin/dev`.

---

## Duplicate-batch prevention

Before recommending `approved → in-progress`, autopilot checks:

| Check | Signal | Action |
|-------|--------|--------|
| **Linear collision** | Another open issue shares same integration scope / `batchId` | STOP — flag duplicate; link existing issue |
| **Branch collision** | `dee-<NN>-*` branch exists with unmerged commits for same `DEE-NN` | Recommend resume, not new branch |
| **Plan collision** | `docs/plans/dee-NN-*.md` exists with `state.status` not `abandoned` | Recommend resume or explicit abandon (CONFIRM) |
| **PR collision** | Open or merged PR references same `**Linear:**` id | Enforce one-PR invariant; never open second |
| **Roadmap double-start** | Two batches reference same `gapId` as `in-progress` | STOP — Architect picks single owner batch |

Duplicate detection is **read-only** (git branch list, Linear API, plan frontmatter parse, roadmap table scan). Remediation always routes through human CONFIRM.

---

## Resume and retry states

### Canonical plan resumption

Primary resumption primitive: `docs/plans/dee-<NN>-<slug>.md` → `state` block ([`../plans/README.md`](../plans/README.md)).

| `state.status` | Meaning | Autopilot recommendation |
|----------------|---------|--------------------------|
| `draft` | Plan not approved | `/plan-feature` + Architect approval |
| `approved` | Scope locked; not started | `/implement` — create branch if missing |
| `in-progress` | Active work packages | Load `currentWorkPackage`; continue `/implement` |
| `blocked` | `blockedReason` set | Surface reason; wait for human unblock |
| `integration-ready` | Green gates; no PR yet | `/prepare-pr` |
| `in-review` | PR open | Wait for human merge; **do not** start next batch |
| `abandoned` | Batch canceled | Exclude from selection; roadmap may revert to `deferred` |

### Retry after validation failure

When `/test-and-fix` fails:

1. Update `state.blockedReason` and `state.nextAction` in-plan (committed on feature branch).
2. Do **not** change Linear to `Done` or roadmap to `complete`.
3. Autopilot re-surfaces same batch at resume rank until validation green.

### Retry after CI failure post-PR

1. Stay `in-review`; fix on same branch; push; re-run validation.
2. Autopilot does not spawn a new batch or PR.

### Human merge wait

After PR opened: autopilot **stops** per [`AGENT-AUTO-ADVANCE.md`](AGENT-AUTO-ADVANCE.md). Next batch selection requires explicit human confirmation ([`POST-MERGE-PROTOCOL.md`](POST-MERGE-PROTOCOL.md) agent completion protocol).

---

## Post-merge gap-update contract

Composer and autopilot **must not** perform forbidden post-merge Git writes ([`INTEGRATION-BOUNDARY-POLICY.md`](INTEGRATION-BOUNDARY-POLICY.md)):

- No status-only commits on `dev` after merge.
- No second PR on the completed integration issue to "fix" roadmap/gap/plan status.

### Prepare-before-merge (preferred)

When outcome is deterministic at PR readiness, the **same integration PR** includes:

| Artifact | Update |
|----------|--------|
| Roadmap batch | `status: complete` (or `in-progress` → `complete` in PR diff) |
| Gap entries | `status: closed`, `batchRef`, `closedAt` |
| Canonical plan | `state.status: in-review` max; `prNumber`/`prUrl` set |
| Evidence | Per [`EVIDENCE-POLICY.md`](EVIDENCE-POLICY.md) when applicable |

Human merge then lands gap/roadmap truth atomically with code/docs.

### Reconcile-in-next-batch (when not deterministic)

When post-merge state cannot be known at PR open (e.g., child `**Deferred:**` work, flaky external gate):

1. Record **intent** in PR body: which gaps/batches will close on merge.
2. Effective completion = PR merged + Linear `Done` + stated criteria met.
3. Stale roadmap `in-progress` or open gap → normalized only in the **next authorized** integration batch or future reconciliation automation — never direct push to `dev`.

### Autopilot role (future)

Read merged PR + `origin/dev` + Linear `Done` → emit **reconciliation proposal** YAML for the *next* batch's PR body. Still no post-merge commit.

---

## Proposed orchestration interfaces (read-only, future phase)

Interfaces are **specification stubs** for a future activation slice (requires ADR-0024+ and Architect gate). All methods are **read-only** unless noted CONFIRM.

### `RoadmapSelector`

```typescript
interface RoadmapSelector {
  /** Returns ranked selection candidates; does not mutate. */
  proposeNextBatch(input: {
    programId: string;
    operatorDirective?: string; // DEE-NN or batchId
  }): Promise<SelectionRecord[]>;

  /** True when duplicate-batch checks fail. */
  detectDuplicate(batch: { linearIssue: string; batchId: string }): Promise<DuplicateReport>;
}
```

### `BatchStateReader`

```typescript
interface BatchStateReader {
  readPlan(integrationIssue: string): PlanState | null;
  readRoadmapBatch(batchId: string): RoadmapBatch | null;
  readGap(gapId: string): GapEntry | null;
  readLinear(issueId: string): LinearSnapshot;
}
```

### `ResumeAdvisor`

```typescript
interface ResumeAdvisor {
  /** Highest-priority resumable batch, if any. */
  proposeResume(): Promise<SelectionRecord | null>;

  /** Human-readable unblock steps from plan blockedReason. */
  explainBlocked(planPath: string): Promise<string>;
}
```

### `ReconciliationProposer`

```typescript
interface ReconciliationProposer {
  /** After merge event observed — proposes doc edits for *next* PR. */
  proposeGapRoadmapUpdates(merged: {
    linearIssue: string;
    mergeCommitSha: string;
  }): Promise<ReconciliationDraft>; // not applied automatically
}
```

### Data sources (read-only)

| Source | Access |
|--------|--------|
| `docs/roadmaps/*.md` | Parse frontmatter + batch table |
| `docs/gaps/*.md` | Parse gap entries |
| `docs/plans/dee-*.md` | Parse `state` |
| Linear MCP | `get_issue`, `list_issues` |
| GitHub | Branch list, PR merged state (no merge API) |

---

## Next-phase boundary — NO orchestrator code

**Slice H stops here.** The following are **explicitly out of scope** until a future Architect-approved activation slice (ADR-0024 proposed in [`../adr/README.md`](../adr/README.md)):

| Out of scope | Rationale |
|--------------|-----------|
| Orchestrator daemon, cron, or background worker | Would imply autonomous scope beyond [`AGENT-CHARTER.md`](AGENT-CHARTER.md) |
| `scripts/**` autopilot implementation | Preparation doc only |
| GitHub Action that selects/issues batches | CONFIRM + human gate per batch |
| Auto Linear issue creation | [`INTEGRATION-BOUNDARY-POLICY.md`](INTEGRATION-BOUNDARY-POLICY.md) CONFIRM |
| Auto `gh pr merge` / auto-merge | HUMAN-ONLY |
| Post-merge bot commits to `dev` | Forbidden §Post-merge reconciliation |
| Cursor command `/autopilot` implementation | Future slice after ADR |

**Activation prerequisites (future):** ADR-0024 accepted, T2 Architect approval, regression tests for duplicate detection, explicit NON-GOALS review, and demo of read-only `RoadmapSelector` against fixture roadmaps.

---

## Traceability

| Artifact | Link |
|----------|------|
| Integration boundary | [`INTEGRATION-BOUNDARY-POLICY.md`](INTEGRATION-BOUNDARY-POLICY.md) |
| Lifecycle | [`LIFECYCLE.md`](LIFECYCLE.md) |
| Roadmap schema | [`../roadmaps/ROADMAP-STANDARD.md`](../roadmaps/ROADMAP-STANDARD.md) |
| Gap schema | [`../gaps/GAP-REGISTRY-STANDARD.md`](../gaps/GAP-REGISTRY-STANDARD.md) |
| Plan schema | [`../plans/README.md`](../plans/README.md) |
| Future ADR slot | [`../adr/README.md`](../adr/README.md) — ADR-0024 (proposed) |

*Last updated: 2026-07-10 — vNext Slice H (preparation only).*
