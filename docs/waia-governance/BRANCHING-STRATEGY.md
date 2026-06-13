# Branching strategy — WAIA

## Canonical branch name

**`dee-<NN>-<slug>`** where `<NN>` is the Linear issue number (zero-padded to two digits when <100, e.g. `dee-07-...` or `dee-37-...`) and `<slug>` is kebab-case describing the goal — matches [`AGENTS.md`](../../AGENTS.md) exemplar.

## Base and target

- Integration: **`dev`** (protected — no direct push).  
- Production: **`main`** (protected — no direct push; deploy per Cloudflare docs).

## Server-side protection

Local [`.cursor/hooks/guard-shell.sh`](../../.cursor/hooks/guard-shell.sh) is not sufficient for cloud/background agents. Maintainers apply GitHub rulesets from [`.github/rulesets/dev-main-protection.json`](../../.github/rulesets/dev-main-protection.json):

```bash
./scripts/github/apply-branch-rulesets.sh
./scripts/github/configure-merge-settings.sh
```

Required CI checks: `lint`, `typecheck`, `unit tests`, `build`, `e2e tests` (see [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)).

## Merge strategy (by PR class)

WAIA merges depend on the PR **class**. This is deliberate: squash keeps `dev` history clean per atomic issue, but squash **cannot preserve a second parent**, so release-promotion and back-sync PRs **must** use a real merge commit or `dev`/`main` ancestry silently drifts (see [`FAILURE-PATTERNS.md`](FAILURE-PATTERNS.md) FP-010).

| PR class | Branch → base | Merge method | Why |
|----------|---------------|--------------|-----|
| **Feature / fix / governance** | `dee-<NN>-<slug>` → `dev` | **Squash and merge** | One commit per atomic `dee-*` issue. |
| **Release promotion** | `dee-<NN>-release-promote-<slug>` (or `dev`) → `main` | **Create a merge commit** | Preserve `dev` ancestry in `main`. |
| **Release back-sync** | `dee-<NN>-release-back-sync-<slug>` → `dev` | **Create a merge commit** | Preserve `main` ancestry in `dev` after a squash-promoted release. |

**Hard rule:** never **squash** a release-promotion or back-sync PR. Squashing drops the second parent and re-introduces ancestry drift.

### Repository setting

Both squash and merge-commit must be **available** in repo settings so humans can pick the correct method per class. Maintainers apply this via [`configure-merge-settings.sh`](../../scripts/github/configure-merge-settings.sh) (`allow_squash_merge=true`, `allow_merge_commit=true`, squash remains the default title/message). Rebase merges stay disabled. **Consequence:** because merge commits are enabled repo-wide, humans must consciously keep using **Squash** for feature PRs — only release/back-sync PRs use **Create a merge commit**. Rolling this out is a one-time admin action and requires Architect approval.

## Legacy / exceptions

`feature/<scope>-<slug>` may exist historically. **New** agent work should adopt `dee-*`. **Architect-approved** exceptions (document in PR body): long-running collaboration with external fork naming, hotfix per [`HUMAN-OVERRIDE.md`](HUMAN-OVERRIDE.md).

## Forbidden operations

- Force-push to `main` / `dev`  
- Rewrite shared history on integration branches  
- Commits containing secrets (see [`AGENTS.md`](../../AGENTS.md))

## Commits

Prefer Conventional Commits for human readability; embed Linear id in message as `DEE-NN …` per [`AGENTS.md`](../../AGENTS.md).

## Contradiction tracking

Until commands fully align, contradictions are documented in [`FAILURE-PATTERNS.md`](FAILURE-PATTERNS.md) **FP-001**.
