# GitHub repository rulesets

Version-controlled definition for canonical **`main`** branch protection under single-trunk DEV OS. Local [`.cursor/hooks/guard-shell.sh`](../../.cursor/hooks/guard-shell.sh) only protects the developer machine — these rulesets enforce the same posture on GitHub for all contributors and cloud/background agents.

**Live GitHub settings mutation is Human-only.** Prefer the cutover scripts for the one-time migration:

```bash
./scripts/github/apply-single-trunk-cutover.sh          # dry-run (default)
./scripts/github/apply-single-trunk-cutover.sh --confirm # Human-authorized mutation
./scripts/github/verify-single-trunk-cutover.sh
```

## Apply (maintainer, after cutover or rule changes)

Prerequisites: [`gh`](https://cli.github.com/) authenticated with repo admin.

```bash
./scripts/github/apply-branch-rulesets.sh
./scripts/github/configure-merge-settings.sh
```

The apply script **upserts** the ruleset named `WAIA main protection` from [`main-protection.json`](main-protection.json).

Legacy dual-branch file [`dev-main-protection.json`](dev-main-protection.json) is retained only as historical reference and must not be re-applied after cutover.

## Required status checks

Must match job `name:` values in [`.github/workflows/ci.yml`](../workflows/ci.yml) and [`.github/workflows/pr-governance.yml`](../workflows/pr-governance.yml):

| Check context | CI job |
|---------------|--------|
| `lint` | lint |
| `typecheck` | typecheck |
| `unit tests` | unit tests |
| `build` | build |
| `e2e tests` | e2e tests |
| `PR governance` | PR governance |

If CI job names change, update **both** the workflows and `main-protection.json`, then re-run the apply/cutover script.

Approval count is **0** to match the single-operator repository reality (PR requirement still blocks direct pushes; Human merge remains mandatory). Do not silently raise this without an available second reviewer.

## Frozen `dev`

After cutover, `dev` remains as a frozen rollback reference until a later Human-only retirement step. It must not receive normal integration PRs.
