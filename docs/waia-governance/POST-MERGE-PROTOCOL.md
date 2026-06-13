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

## `dev` → `main`

Human-driven promotion for Cloudflare production per [`docs/cloudflare-deploy.md`](../cloudflare-deploy.md); not automated agents.

On push to **`main`**, [`.github/workflows/release.yml`](../../.github/workflows/release.yml) creates a dated GitHub Release with `DEE-NN` changelog ([`scripts/github/generate-release-notes.sh`](../../scripts/github/generate-release-notes.sh)).
