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

## Merge strategy

- **Squash merge** into `dev` (one commit per atomic `dee-*` issue).
- Configure via `configure-merge-settings.sh` or GitHub → Settings → Pull Requests.

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
