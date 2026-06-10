# GitHub repository rulesets

Version-controlled definitions for **`dev`** and **`main`** branch protection. Local [`.cursor/hooks/guard-shell.sh`](../../.cursor/hooks/guard-shell.sh) only protects the developer machine — these rulesets enforce the same posture on GitHub for all contributors and cloud/background agents.

## Apply (maintainer, once per repo or after rule changes)

Prerequisites: [`gh`](https://cli.github.com/) authenticated with `repo` + `admin:repo_hook` (or org admin).

```bash
./scripts/github/apply-branch-rulesets.sh
./scripts/github/configure-merge-settings.sh
```

The apply script **upserts** the ruleset named `WAIA dev + main protection` from [`dev-main-protection.json`](dev-main-protection.json).

## Required status checks

Must match job `name:` values in [`.github/workflows/ci.yml`](../workflows/ci.yml):

| Check context | CI job |
|---------------|--------|
| `lint` | lint |
| `typecheck` | typecheck |
| `unit tests` | unit tests |
| `build` | build |
| `e2e tests` | e2e tests |

If CI job names change, update **both** `ci.yml` and `dev-main-protection.json`, then re-run the apply script.

## Advisory PR governance

[`.github/workflows/pr-governance.yml`](../workflows/pr-governance.yml) adds non-blocking comments when branch names or Linear IDs are missing — complements server-side rulesets.
