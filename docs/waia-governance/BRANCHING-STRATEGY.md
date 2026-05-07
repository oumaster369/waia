# Branching strategy — WAIA

## Canonical branch name

**`dee-<NN>-<slug>`** where `<NN>` is the Linear issue number (zero-padded to two digits when <100, e.g. `dee-07-...` or `dee-37-...`) and `<slug>` is kebab-case describing the goal — matches [`AGENTS.md`](../../AGENTS.md) exemplar.

## Base and target

- Integration: **`dev`** (protected — no direct push).  
- Production: **`main`** (protected — no direct push; deploy per Cloudflare docs).

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
