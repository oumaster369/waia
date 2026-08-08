# Single-trunk main cutover (DEE-511)

Human-only live GitHub settings cutover after the repository-side migration PR merges to `main`.

## Preconditions

1. Migration PR `dee-511-waia-single-trunk-main → main` is Human-squash-merged.
2. No open PRs still targeting `dev` for new work.
3. Operator has `gh` admin on `oumaster369/waia`.

## Commands

```bash
# Read-only dry-run (safe)
./scripts/github/apply-single-trunk-cutover.sh

# Live mutation (Architect/Human authorized)
./scripts/github/apply-single-trunk-cutover.sh --confirm

# Prove post-cutover state
./scripts/github/verify-single-trunk-cutover.sh

# Rollback settings only (does not rewrite git history)
./scripts/github/rollback-single-trunk-cutover.sh
./scripts/github/rollback-single-trunk-cutover.sh --confirm
```

## What cutover does

- Sets `default_branch=main`
- Squash-only merge settings; disables merge-commit, rebase, auto-merge
- Upserts `WAIA main protection` from `.github/rulesets/main-protection.json`
- Retires obsolete dual-branch rulesets by canonical name
- Does **not** delete `refs/heads/dev`

## Later Human-only `dev` retirement

After at least one successful normal single-trunk integration cycle:

1. Confirm no open PR targets `dev`
2. Confirm no workflow/canon depends on `dev`
3. Preserve an archival tag/reference (e.g. `archive/dev-pre-single-trunk-<sha>`)
4. Delete `dev` only after explicit Human approval
