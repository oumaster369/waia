# Branching strategy — WAIA

## Canonical trunk

**Single trunk:** **`main`** is the only long-lived integration and production branch.

- Feature/fix/governance work lands via PR → **`main`** (**squash** merge; Human by default, with only the bounded AI-TRADER implementation exception in [`AI-TRADER-BOUNDED-MERGE-AUTHORITY.md`](AI-TRADER-BOUNDED-MERGE-AUTHORITY.md)).
- Official release = explicit Human **workflow_dispatch** tag/release of an exact **`main` SHA** (not a branch-promotion ceremony).
- **`dev` is retired/frozen** in this migration: still present on the remote for one successful single-trunk cycle, then Human retirement. **Not** an active integration base. Do not open new feature PRs to `dev`. Do not treat `dev` → `main` promotion or `main` → `dev` back-sync as active workflow.

## Canonical branch name

**`dee-<NN>-<slug>`** where `<NN>` is the Linear issue number (zero-padded to two digits when <100, e.g. `dee-07-...` or `dee-37-...`) and `<slug>` is kebab-case describing the goal — matches [`AGENTS.md`](../../AGENTS.md) exemplar.

Branch from current **`origin/main`**:

```bash
git fetch origin
git checkout main && git pull --ff-only origin main
git checkout -b dee-<NN>-<slug>
```

## Base and target

- Trunk / PR base: **`main`** (protected — no direct push; production deploy and Execution Server mutation remain Human-only).
- Frozen legacy: **`dev`** — do not use as PR base for new work; Human deletes after one successful single-trunk cycle (out of band for this doc).

## Server-side protection

Local [`.cursor/hooks/guard-shell.sh`](../../.cursor/hooks/guard-shell.sh) is not sufficient for cloud/background agents. Maintainers apply GitHub rulesets from [`.github/rulesets/main-protection.json`](../../.github/rulesets/main-protection.json):

```bash
./scripts/github/apply-branch-rulesets.sh
./scripts/github/configure-merge-settings.sh
```

Required CI checks on PR HEAD (canonical **merge-blocking** ruleset contexts):

| Context | Classification |
|---------|----------------|
| `lint` | Mandatory merge blocker |
| `typecheck` | Mandatory merge blocker |
| `unit tests` | Mandatory merge blocker |
| `build` | Mandatory merge blocker |
| `e2e tests` | Mandatory merge blocker |
| `PR governance` | Mandatory merge blocker |
| `tenant isolation gate` | Mandatory merge blocker (release-blocking / tenant isolation — ADR-0007; DEV OS architecture) |

**Not** blindly ruleset-required (informational, preview, path-filtered, or program-gated): Cloudflare preview/bundle jobs, Workers Builds, FHV/IDHPS gates, postgres-integration (path-filtered). Those may still run on PRs and may be required by their own governing contracts without being standing trunk ruleset contexts.

Full unit suite is **authoritative in GitHub PR CI** — local work packages use targeted validation; do not require a redundant full local unit suite solely because CI already gates the PR. After merge, unchanged content must not re-run the full unit suite solely due to push/merge into `main`.

Human cutover after DEE-511: [`docs/ops/SINGLE-TRUNK-CUTOVER.md`](../ops/SINGLE-TRUNK-CUTOVER.md).

## Merge strategy

| PR class | Branch → base | Merge method | Why |
|----------|---------------|--------------|-----|
| **Feature / fix / governance** | `dee-<NN>-<slug>` → `main` | **Squash and merge** | One commit per integration batch on the trunk. |

**Hard rule:** Human merge is the default. After DEE-653 is Human-merged, the acting AI-TRADER Program Controller may squash-merge only an exact-head-admitted Step 0–22 implementation PR under [`AI-TRADER-BOUNDED-MERGE-AUTHORITY.md`](AI-TRADER-BOUNDED-MERGE-AUTHORITY.md). All other agents and PRs remain no-merge. There is **no** active release-promotion or back-sync PR class.

### Historical note (dual-branch era)

Before single-trunk migration (DEE-511), WAIA used `dev` as integration and `main` as production, with merge-commit promotion/back-sync to preserve ancestry (see [`FAILURE-PATTERNS.md`](FAILURE-PATTERNS.md) **FP-010**, historical). That ceremony is **superseded** and must not be revived as routine workflow.

### Repository setting

Squash merge remains the default for trunk PRs. Maintainers apply merge availability via [`configure-merge-settings.sh`](../../scripts/github/configure-merge-settings.sh). Rebase merges stay disabled. Force-push to `main` remains forbidden.

## Legacy / exceptions

`feature/<scope>-<slug>` may exist historically. **New** agent work should adopt `dee-*`. **Architect-approved** exceptions (document in PR body): long-running collaboration with external fork naming, hotfix per [`HUMAN-OVERRIDE.md`](HUMAN-OVERRIDE.md).

## Forbidden operations

- Force-push to `main` (or frozen `dev`)
- Direct push to `main` (or frozen `dev`)
- Rewrite shared history on the trunk
- Commits containing secrets (see [`AGENTS.md`](../../AGENTS.md))
- Treating `dev` as the integration base for new work
- Reviving `dev` → `main` promotion / `main` → `dev` back-sync as active workflow

## Commits

Prefer Conventional Commits for human readability; embed Linear id in message as `DEE-NN …` per [`AGENTS.md`](../../AGENTS.md).

## Contradiction tracking

Until commands fully align, contradictions are documented in [`FAILURE-PATTERNS.md`](FAILURE-PATTERNS.md) **FP-001**.
