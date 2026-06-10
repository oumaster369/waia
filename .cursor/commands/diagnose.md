# /diagnose

Investigate **production or preview deploy** issues using Cloudflare MCP plugins. Use **Agent Mode** or **Ask Mode** for read-only triage.

## When to use

- Cloudflare Worker/Pages deploy failed or regressed after merge.
- Runtime errors in production or PR preview Worker.
- Need build logs, observability keys, or worker configuration without leaving Cursor.

## MCP servers (Cursor plugins)

| Server id | Use for |
|-----------|---------|
| `plugin-cloudflare-cloudflare-builds` | List builds, fetch build logs |
| `plugin-cloudflare-cloudflare-observability` | Query worker observability, list workers |
| `plugin-cloudflare-cloudflare-bindings` | KV, D1, R2, Hyperdrive bindings |
| `plugin-cloudflare-cloudflare-docs` | Search Cloudflare documentation |

## What you must do

1. Identify target: production (`main` / `waia.life`) vs PR preview (`waia-app-pr-<N>` per [`cloudflare-preview.yml`](../../.github/workflows/cloudflare-preview.yml)).
2. **Builds:** `workers_builds_list_builds` → `workers_builds_get_build_logs` for the failing build.
3. **Runtime:** `workers_list` → `query_worker_observability` for recent errors/latency.
4. **Bindings:** verify D1/KV/R2/Hyperdrive if persistence or env errors suspected.
5. Correlate with repo: `wrangler.jsonc`, [`docs/cloudflare-deploy.md`](../../docs/cloudflare-deploy.md), [`docs/cloudflare-env-vars.md`](../../docs/cloudflare-env-vars.md).
6. Output a **Diagnose Report**:
   - Symptom
   - Evidence (log excerpts, build id)
   - Likely cause
   - Suggested fix scope (new `dee-*` issue with correct execution label)
   - Whether human deploy action is required

## Hard rules

- **No production deploys** from this command unless the user explicitly requests and risk tier allows.
- SQLite/file-DB limitations on Workers are known — see [`docs/cloudflare-preview-deploys.md`](../../docs/cloudflare-preview-deploys.md).
- T3/T4 infra changes → escalate per [`RISK-TIERS.md`](../../docs/waia-governance/RISK-TIERS.md).
