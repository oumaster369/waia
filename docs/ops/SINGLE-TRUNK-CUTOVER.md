# Single-trunk main cutover (DEE-511)

Human-only migration cutover for repository settings **and** Cloudflare production semantics.

**Agents must not** merge PR `#456`, run cutover `--confirm`, mutate Cloudflare, or mutate the Execution Server.

## Why Cloudflare must be resolved BEFORE merge

Live GitHub evidence during DEE-511 showed an active **Cloudflare Workers Builds** Git integration check for Worker **`waia-app`**. That proves the repository is connected to Cloudflare’s Git integration.

The configured Cloudflare **Production branch** is not known from repository code alone. If that Production branch is already `main`, Human squash-merge of PR `#456` into `main` may itself trigger a production build/deployment.

Therefore the Architect must inspect live Cloudflare values and select Contract A or B **before** clicking Merge.

## Mandatory order

1. PR `#456` fresh blocking GitHub CI fully green.
2. Human performs **READ-ONLY** Cloudflare Workers Builds preflight (Dashboard inspection only — do not mutate).
3. Human records Production branch, non-production branch builds enabled/disabled, production deploy command, and non-production deploy command.
4. Architect explicitly selects **Contract A** or **Contract B**.
5. **Only after that decision** may Human squash-merge PR `#456` to `main`.
6. Human runs GitHub cutover dry-run (`apply-single-trunk-cutover.sh`).
7. Human runs GitHub cutover `--confirm` (only when `CUTOVER_PREFLIGHT_READY=true`).
8. Human runs full post-cutover verification (`verify-single-trunk-cutover.sh`).

If verification after step 7 fails, GitHub cutover is **NOT** complete. Use Human-authorized rollback:

```bash
./scripts/github/rollback-single-trunk-cutover.sh --confirm
```

Rollback is never auto-executed.

## Cloudflare Workers Builds — mandatory Human preflight (BEFORE merge)

**Do not mutate Cloudflare during this gate.** Inspect read-only:

Cloudflare Dashboard → **Workers & Pages** → **`waia-app`** → **Settings** → **Builds** / branch control

Record into operator-local path (outside the repo):

`${WAIA_CUTOVER_STATE_DIR:-$HOME/.waia/single-trunk-cutover}/cloudflare-preflight.json`

Human-safe helper (writes only values you supply — does not scrape Cloudflare):

```bash
./scripts/github/record-cloudflare-preflight.sh \
  --recorded-by "human-operator" \
  --production-branch "<from dashboard>" \
  --non-production-branch-builds true|false \
  --production-deploy-command "<from dashboard>" \
  --non-production-deploy-command "<from dashboard>" \
  --architect-contract A|B
```

`architect_contract` must be exactly one of:

### Contract A — `main` is intentionally the Cloudflare production branch

Human squash merge to `main` is also the Human authorization that causes Workers Builds to perform the **production** deployment. Merge of PR `#456` is therefore an explicit production deploy authorization.

### Contract B — merge-to-main and production deployment must remain separate

If current Cloudflare settings would deploy `main` on merge, the required Cloudflare configuration change must occur as a **separate explicit Human Cloudflare gate BEFORE merging PR `#456`**. Do not silently pick A.

**The Architect must see the live Cloudflare values and choose A or B.** Repository automation must not choose for them.

`verify-single-trunk-cutover.sh` (full mode) requires a valid recorded Contract A|B. `--github-only` skips the Cloudflare file check for the immediate post-mutation GitHub verify inside apply `--confirm`, but full cutover completion still requires the pre-merge record.

## GitHub cutover commands

```bash
# Read-only dry-run — prints PASS/FAIL for every fail-closed precondition
./scripts/github/apply-single-trunk-cutover.sh

# Live mutation ONLY when CUTOVER_PREFLIGHT_READY=true
./scripts/github/apply-single-trunk-cutover.sh --confirm

# Prove post-cutover GitHub state + Cloudflare Human gate
./scripts/github/verify-single-trunk-cutover.sh

# Rollback settings + every affected ruleset from operator-local snapshot
./scripts/github/rollback-single-trunk-cutover.sh
./scripts/github/rollback-single-trunk-cutover.sh --confirm
```

### Fail-closed GitHub preflight (required before any mutation)

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

After mutation, apply runs `verify-single-trunk-cutover.sh --github-only` and **fails closed** if verification fails (no swallowed failures).

### Operator-local snapshot (deterministic rollback)

On successful `--confirm` (before deletes), apply writes a **schema v2** snapshot to:

`${WAIA_CUTOVER_STATE_DIR:-$HOME/.waia/single-trunk-cutover}/pre-cutover-state.json`

This path is **outside the repository** (cannot be accidentally committed) and survives working-tree changes. It stores full ruleset GET payloads plus stripped restore bodies for every ruleset the cutover will delete. Rollback recreates those rulesets automatically — **no manual ruleset recreation**.

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
