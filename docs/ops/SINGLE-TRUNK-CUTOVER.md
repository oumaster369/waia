# Single-trunk main cutover (DEE-511)

Human-only live GitHub settings cutover **after** the repository-side migration PR merges to `main`.

**Agents must not** run `--confirm`, mutate Cloudflare, or mutate the Execution Server.

## Mandatory order

1. Human squash-merges PR `#456` (`dee-511-waia-single-trunk-main` → `main`).
2. Human runs fail-closed GitHub cutover dry-run, then `--confirm` (only when preflight READY).
3. Human completes **Cloudflare Workers Builds preflight** (read-only Dashboard inspection) and records the Architect contract.
4. Human runs full `verify-single-trunk-cutover.sh` (GitHub + Cloudflare gate).

GitHub settings cutover and Cloudflare production semantics are **separate Human gates**. Do not treat GitHub cutover alone as production-complete.

## GitHub cutover commands

```bash
# Read-only dry-run — prints PASS/FAIL for every fail-closed precondition
./scripts/github/apply-single-trunk-cutover.sh

# Live mutation ONLY when CUTOVER_PREFLIGHT_READY=true
./scripts/github/apply-single-trunk-cutover.sh --confirm

# Prove post-cutover GitHub state (+ Cloudflare Human gate unless --github-only)
./scripts/github/verify-single-trunk-cutover.sh

# Rollback settings + every affected ruleset from operator-local snapshot
./scripts/github/rollback-single-trunk-cutover.sh
./scripts/github/rollback-single-trunk-cutover.sh --confirm
```

### Fail-closed preflight (required before any mutation)

`--confirm` re-runs the same authoritative preflight and **refuses mutation** unless all pass, including:

- repo is exactly `oumaster369/waia`
- authenticated principal has repository `admin=true`
- fresh `git fetch origin --prune`
- live `refs/heads/main` and `refs/heads/dev` exist
- GitHub `default_branch` is still pre-cutover `dev`
- PR `#456` is `MERGED`, base=`main`, head=`dee-511-waia-single-trunk-main`
- PR merge/squash commit is contained in current `origin/main`
- no open PRs targeting `dev` / no ambiguous open cutover PRs
- legacy rulesets `WAIA dev + main protection`, `dev`, and `main` each exist exactly once with full detail fetchable
- canonical `WAIA main protection` is not already present
- merge settings are readable

### Operator-local snapshot (deterministic rollback)

On successful `--confirm`, apply writes a **schema v2** snapshot to:

`${WAIA_CUTOVER_STATE_DIR:-$HOME/.waia/single-trunk-cutover}/pre-cutover-state.json`

This path is **outside the repository** (cannot be accidentally committed) and survives working-tree changes. It stores full ruleset GET payloads plus stripped restore bodies for every ruleset the cutover will delete. Rollback recreates those rulesets automatically — **no manual ruleset recreation**.

## Cloudflare Workers Builds — mandatory Human preflight

Live GitHub evidence during DEE-511 showed an active **Cloudflare Workers Builds** check for Worker **`waia-app`**. That proves the repository is connected to Cloudflare’s Git integration. It does **not** by itself prove that a PR-head build mutated production.

**Do not mutate Cloudflare during DEE-511 cutover.** Inspect read-only:

Cloudflare Dashboard → **Workers & Pages** → **`waia-app`** → **Settings** → **Builds** / branch control

Record at minimum into:

`${WAIA_CUTOVER_STATE_DIR:-$HOME/.waia/single-trunk-cutover}/cloudflare-preflight.json`

```json
{
  "recorded_at": "ISO-8601",
  "recorded_by": "human-operator",
  "worker": "waia-app",
  "production_branch": "<from dashboard>",
  "non_production_branch_builds_enabled": true,
  "production_deploy_command": "<from dashboard>",
  "non_production_branch_deploy_command": "<from dashboard>",
  "architect_contract": "A"
}
```

`architect_contract` must be exactly one of:

### Contract A — `main` is intentionally the Cloudflare production branch

Human squash merge to `main` is also the Human authorization that causes Workers Builds to perform the **production** deployment. Single-trunk semantics remain coherent only if the Architect accepts that merge-to-main **is** the production deploy authorization.

### Contract B — merge-to-main and production deployment must remain separate

The Cloudflare production-branch configuration / Git integration must be changed under a **separate explicit Human Cloudflare gate** before treating single-trunk cutover as complete. Do not silently pick A.

**The Architect must see the live Cloudflare values and choose A or B.** Repository automation must not choose for them. `verify-single-trunk-cutover.sh` reports `CLOUDFLARE_HUMAN_GATE=unresolved` until the record above exists with contract `A` or `B`.

## What GitHub cutover does

- Sets `default_branch=main`
- Squash-only merge settings; disables merge-commit, rebase, auto-merge (typed JSON booleans)
- Creates `WAIA main protection` from `.github/rulesets/main-protection.json` (includes **`tenant isolation gate`**)
- Deletes obsolete dual-branch rulesets only after full snapshot capture
- Does **not** delete `refs/heads/dev`

## Later Human-only `dev` retirement

After at least one successful normal single-trunk integration cycle **and** Cloudflare contract recorded:

1. Confirm no open PR targets `dev`
2. Confirm no workflow/canon depends on `dev`
3. Preserve an archival tag/reference (e.g. `archive/dev-pre-single-trunk-<sha>`)
4. Delete `dev` only after explicit Human approval
