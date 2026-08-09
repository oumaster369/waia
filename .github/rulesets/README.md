# GitHub repository rulesets

Version-controlled definition for canonical **`main`** branch protection under single-trunk DEV OS. Local [`.cursor/hooks/guard-shell.sh`](../../.cursor/hooks/guard-shell.sh) only protects the developer machine — these rulesets enforce the same posture on GitHub for all contributors and cloud/background agents.

**Live GitHub settings mutation is Human-only.** Prefer the cutover scripts for the one-time migration:

```bash
./scripts/github/apply-single-trunk-cutover.sh          # dry-run + fail-closed preflight PASS/FAIL
./scripts/github/apply-single-trunk-cutover.sh --confirm # Human-authorized mutation (preflight must pass)
./scripts/github/verify-single-trunk-cutover.sh
./scripts/github/rollback-single-trunk-cutover.sh
```

See [`docs/ops/SINGLE-TRUNK-CUTOVER.md`](../../docs/ops/SINGLE-TRUNK-CUTOVER.md) for Cloudflare Human gate requirements.

## Apply (maintainer, after cutover or rule changes)

Prerequisites: [`gh`](https://cli.github.com/) authenticated with repo admin.

```bash
./scripts/github/apply-branch-rulesets.sh
./scripts/github/configure-merge-settings.sh
```

The apply script **upserts** the ruleset named `WAIA main protection` from [`main-protection.json`](main-protection.json).

Legacy dual-branch file [`dev-main-protection.json`](dev-main-protection.json) is retained only for historical/rollback documentation reference. Live rollback uses the **operator-local full snapshot** written at cutover (`$HOME/.waia/single-trunk-cutover/`), not this file alone.

## Required status checks (merge-blocking)

Must match job `name:` values in [`.github/workflows/ci.yml`](../workflows/ci.yml) and [`.github/workflows/pr-governance.yml`](../workflows/pr-governance.yml):

| Check context | Classification |
|---------------|----------------|
| `lint` | Mandatory merge blocker |
| `typecheck` | Mandatory merge blocker |
| `unit tests` | Mandatory merge blocker |
| `build` | Mandatory merge blocker |
| `e2e tests` | Mandatory merge blocker |
| `PR governance` | Mandatory merge blocker |
| `tenant isolation gate` | Mandatory merge blocker (tenant isolation / ADR-0007) |

**Not** standing ruleset contexts (do not weaken them where their own contracts apply; do not blindly require on every PR): Cloudflare preview/bundle, Workers Builds, FHV/IDHPS gates, path-filtered postgres-integration.

If CI job names change, update **both** the workflows and `main-protection.json`, then re-run the apply/cutover script.

Approval count is **0** to match the single-operator repository reality (PR requirement still blocks direct pushes; Human merge remains mandatory). Do not silently raise this without an available second reviewer.

## Frozen `dev`

After cutover, `dev` remains as a frozen rollback reference until a later Human-only retirement step. It must not receive normal integration PRs.
