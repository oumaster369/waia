# Post-merge protocol

After PR merges to **`dev`**:

## Developer/agent hygiene

```bash
git checkout dev && git pull --ff-only origin dev
```

Delete local feature branch if done.

## Verify CI expectations

Observe GitHub Actions on merge commit; escalate flakes via [`FAILURE-PATTERNS.md`](FAILURE-PATTERNS.md).

## Linear

Move issue **`Done`** (or board terminal success) plus abbreviated **five-memory** closeout (see [`DOCUMENTATION-STANDARDS.md`](DOCUMENTATION-STANDARDS.md) + [`LINEAR-GOVERNANCE.md`](LINEAR-GOVERNANCE.md)).

Link merged PR URL.

**Automation:** when repository secret `LINEAR_API_KEY` is set, [`.github/workflows/linear-done.yml`](../../.github/workflows/linear-done.yml) transitions `DEE-NN` to **Done** on merge to `dev` (parsed from PR title/body/branch). Humans still paste five-memory closeout when semantics warrant it.

## Tracker / docs

If runtime/migration semantics changed:

- Sentence-level update expectation is recorded in trackers per [`DOCUMENTATION-STANDARDS.md`](DOCUMENTATION-STANDARDS.md).  
- Operators still edit [`../migrations/DEE-64-TRACKER.md`](../migrations/DEE-64-TRACKER.md) explicitly in owning issues — governance text does **not auto-edit** trackers.

### Semantic consistency (quick)

If the merged PR **changed product or governance meaning** (same classes as semantic-impact signals in [`PR-PROTOCOL.md`](PR-PROTOCOL.md)): **once**, sanity-check affected **product hubs** (`docs/product/**`), [`GLOSSARY.md`](GLOSSARY.md), and `docs/waia-governance/**` for obvious contradictions; open the smallest follow-up if something was missed. Purpose: catch drift after merge—not a staged review ritual.

## `dev` → `main` (release promotion)

Human-driven promotion for Cloudflare production per [`docs/cloudflare-deploy.md`](../cloudflare-deploy.md); not automated agents.

Release-promotion PRs **must be merged with "Create a merge commit", never squash** (see [`BRANCHING-STRATEGY.md`](BRANCHING-STRATEGY.md) and [`PR-PROTOCOL.md`](PR-PROTOCOL.md)) so `dev` ancestry is preserved in `main`.

On push to **`main`**, [`.github/workflows/release.yml`](../../.github/workflows/release.yml) creates a dated GitHub Release with `DEE-NN` changelog ([`scripts/github/generate-release-notes.sh`](../../scripts/github/generate-release-notes.sh)).

## Mandatory `main` → `dev` back-sync (after every release)

A release promotion to `main` leaves `main` ahead of `dev`. **Immediately** open a back-sync PR so the divergence never accumulates:

1. Branch from `origin/dev`: `dee-<NN>-release-back-sync-<slug>`.
2. `git merge --no-ff origin/main -m "DEE-NN chore(release): back-sync main into dev after <release>"`.
3. Open PR to `dev`. **Merge with "Create a merge commit", never squash.**
4. After merge, verify ancestry is repaired:

```bash
git fetch origin --prune
git merge-base --is-ancestor origin/main origin/dev && echo "main IS ancestor of dev (REPAIRED)"
git rev-list --left-right --count origin/dev...origin/main   # right side must be 0
```

If a back-sync is squash-merged, ancestry is **not** repaired and the next release compounds the drift (this is exactly what FP-010 in [`FAILURE-PATTERNS.md`](FAILURE-PATTERNS.md) tracks).

## Agent completion protocol (every task)

Cursor/agents close **every** task with a deterministic report and then **stop** — they never merge. The report must include:

1. Linear issue (`DEE-NN`) and status
2. Branch name
3. PR URL
4. CI status
5. Governance status
6. **Exact human merge instruction** (squash for feature PRs; "Create a merge commit" for release-promotion/back-sync PRs)
7. Post-merge verification commands
8. Whether a **release promotion** (`dev → main`) is now appropriate
9. Whether a **`main → dev` back-sync** is now required (always true right after a release promotion)
10. Recommended next task

Agents may **recommend** the next implementation issue, a release promotion, a back-sync, a production SQL step, or a governance follow-up — but must **wait for explicit human confirmation** before starting the next task. Agents must never `gh pr merge` or auto-merge ([`AGENT-AUTO-ADVANCE.md`](AGENT-AUTO-ADVANCE.md)).
