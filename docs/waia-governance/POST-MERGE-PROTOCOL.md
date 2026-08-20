# Post-merge protocol

After PR merges to **`main`**:

## Developer/agent hygiene

```bash
git fetch origin --prune
git checkout main && git pull --ff-only origin main
```

Delete local feature branch if done. Sync local tracking with **`origin/main`** — that tip is the new canonical state.

## Verify CI expectations

Observe GitHub Actions on the merge commit / PR HEAD checks already required for merge; escalate flakes via [`FAILURE-PATTERNS.md`](FAILURE-PATTERNS.md). Do not re-run a full unit suite locally solely because content was already validated on the PR.

## Linear

Move issue **`Done`** (or board terminal success) plus abbreviated **five-memory** closeout (see [`DOCUMENTATION-STANDARDS.md`](DOCUMENTATION-STANDARDS.md) + [`LINEAR-GOVERNANCE.md`](LINEAR-GOVERNANCE.md)).

Link merged PR URL.

**Automation:** when repository secret `LINEAR_API_KEY` is set, [`.github/workflows/linear-done.yml`](../../.github/workflows/linear-done.yml) transitions `DEE-NN` to **Done** on merge to `main` when the PR body declares the default auto-close lifecycle (explicit `**Linear:** \`DEE-NN\`` with no keep-open contract). Humans still paste five-memory closeout when semantics warrant it.

**Integration Trains:** automation still closes only the explicit Integration Batch issue. After fetching `origin/main` and proving the exact squash SHA is contained, reconcile the frozen manifest one child at a time: mark Done only each `includedChildren` issue whose commits/files/tests/acceptance evidence are delivered by that merged head; link the merged PR/squash SHA. Never close `deferredChildren`, removed, blocked, failed, unlisted, or falsely claimed work. A manifest/Linear/head mismatch is a STOP.

**Keep-open PRs:** when the merged PR body includes validated **`Linear completion: keep-open`** plus a non-empty **`Linear completion reason:`**, automation intentionally skips the Done transition. Verify the parent/integration issue remains **In Progress** during post-merge reconciliation — no manual Done transition is required for that skip.

## Tracker / docs

If runtime/migration semantics changed:

- Sentence-level update expectation is recorded in trackers per [`DOCUMENTATION-STANDARDS.md`](DOCUMENTATION-STANDARDS.md).  
- Operators still edit [`../migrations/DEE-64-TRACKER.md`](../migrations/DEE-64-TRACKER.md) explicitly in owning issues — governance text does **not auto-edit** trackers.

### Semantic consistency (quick)

If the merged PR **changed product or governance meaning** (same classes as semantic-impact signals in [`PR-PROTOCOL.md`](PR-PROTOCOL.md)): **once**, sanity-check affected **product hubs** (`docs/product/**`), [`GLOSSARY.md`](GLOSSARY.md), and `docs/waia-governance/**` for obvious contradictions; open the smallest follow-up if something was missed. Purpose: catch drift after merge—not a staged review ritual.

## Official release (explicit tag — not branch promotion)

**Release is not a `dev` → `main` promotion.** After work is on `main`, an official release is an explicit **Human** `workflow_dispatch` (or equivalent) that tags/releases an **exact `main` SHA**.

- Agents never create production release tags or mutate production / Execution Server.
- There is **no** mandatory `main` → `dev` back-sync — `dev` is frozen/retired pending Human deletion after one successful single-trunk cycle ([`BRANCHING-STRATEGY.md`](BRANCHING-STRATEGY.md)).

Historical dual-branch promotion/back-sync ceremony is superseded (see [`FAILURE-PATTERNS.md`](FAILURE-PATTERNS.md) **FP-010** historical).

## Agent completion protocol (every task)

Cursor/agents close **every** task with a deterministic report and then **stop** by default. The acting AI-TRADER Program Controller may instead merge and continue only for a DEE-653-eligible Step 0–22 implementation PR and only after producing the exact-head admission and post-merge receipt required by [`AI-TRADER-BOUNDED-MERGE-AUTHORITY.md`](AI-TRADER-BOUNDED-MERGE-AUTHORITY.md). The report must include:

1. Linear issue (`DEE-NN`) and status
2. Branch name
3. PR URL (base **`main`**)
4. CI status
5. Governance status
6. **Merge disposition** — exact Human instruction (**Squash and merge** to `main`) by default; or, for an admitted DEE-653 exception, the controller's pre-merge head/base SHAs, admission result, resulting squash SHA, and post-merge containment proof. Integration Trains also report the frozen manifest digest and delivered/deferred child reconciliation.
7. Post-merge verification — sync `origin/main` (`git checkout main && git pull --ff-only origin main`)
8. Whether an **explicit Human release tag** of the resulting `main` SHA is recommended (optional; never auto-executed)
9. Recommended next task, or the next dependency-unblocked DAG node actually selected under the DEE-653 exception

Agents may **recommend** the next implementation issue, an explicit release tag, a production SQL step, or a governance follow-up, and must normally **wait for explicit human confirmation** before starting the next task. The sole exception is the acting AI-TRADER Program Controller after a complete DEE-653 merge/reconciliation receipt; it may select only the next dependency-unblocked Step 0–22 node. Production/release/Execution Server and all other Human-only gates still stop. Do **not** recommend release promotion or back-sync as routine workflow.
