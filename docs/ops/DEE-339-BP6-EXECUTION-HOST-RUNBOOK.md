# DEE-339 — BP-6 Isolated Execution Host + Production Secrets Store Binding

**Linear:** [DEE-339](https://linear.app/deepsense/issue/DEE-339/p8-new-12-isolated-execution-host-infrastructure-off-cloudflare) · **Package:** BP-6 · **Milestone:** M9 — Org-0 Live Ready  
**Audit type:** Infrastructure operator runbook (health scaffold + secret binding boundaries)  
**Git baseline:** `dev` after BP-5 (PR #312 / merge `55598f9`)

> **BP-6 scope.** Infrastructure boundary only. **Does not** enable live trading, execution loops, HTX sessions, or BP-7 dispatch.

---

## 1. Architectural boundaries (ratified)

| Boundary | Rule |
|----------|------|
| **Worker master key** | Cloudflare Secrets Store → binding `AI_TRADER_MASTER_KEY` → `createMasterKeyProvider()` ([DEE-220 runbook](./DEE-220-MASTER-KEY-RUNBOOK.md)). **Do not change factory behavior in BP-6.** |
| **Execution host secrets** | Runtime injection by operator at deploy time only. **Must not** read Cloudflare Secrets Store. Separate KMS path ([DEE-220 §1](./DEE-220-MASTER-KEY-RUNBOOK.md)). |
| **Services directory** | Exactly one service: `services/ai-trader-execution-host/` (health endpoint only). |
| **Cloudflare Worker** | Slow-state + credential ops only. No execution engine on Workers ([Master Spec §4](../ai-trader/AI-TRADER-MASTER-SPEC-v2.md)). |

---

## 2. Execution host — provision checklist

### A. Host (off-Cloudflare)

1. Provision isolated VPS/VM (single tenant, Org-0 path).
2. Restrict egress: HTX API endpoints (+ documented control-plane only when BP-7+ requires it).
3. No master key in image, git, or committed env files.

### B. Container build (repo artifact)

```bash
docker build -t waia-execution-host:bp6 services/ai-trader-execution-host/
docker run --rm -p 8080:8080 waia-execution-host:bp6
curl -sf http://127.0.0.1:8080/health
# Expect: {"status":"ok","service":"ai-trader-execution-host"}
```

4. Verify image history contains no secret env layers: `docker history waia-execution-host:bp6`
5. Graceful shutdown: `docker stop` sends SIGTERM; container exits 0.

### C. Runtime secret injection (operator)

- Inject execution-host secrets **at deploy/runtime** via orchestrator (file mount, sealed env from host KMS, etc.).
- **Never** bake into Dockerfile `ENV` or COPY secret files into the image.
- Document injection location in Architect ops vault (off-repo reference only).

---

## 3. Worker — production Secrets Store binding

Follow [DEE-220-MASTER-KEY-RUNBOOK.md §2](./DEE-220-MASTER-KEY-RUNBOOK.md) in full:

1. Generate master key offline (`openssl rand -base64 32`); store encrypted backup off-repo.
2. Create Secrets Store: `npx wrangler secrets-store store create waia-ai-trader-secrets --remote`
3. Upload secret `ai-trader-master-key-v1` (Workers scope).
4. **Only with real `STORE_ID`:** add to [wrangler.jsonc](../../wrangler.jsonc):

```jsonc
"secrets_store_secrets": [
  {
    "binding": "AI_TRADER_MASTER_KEY",
    "store_id": "<WAIA_SECRETS_STORE_ID>",
    "secret_name": "ai-trader-master-key-v1"
  }
]
```

**Do not commit placeholder `store_id`** — breaks Workers Builds.

5. Production env: `WAIA_DEPLOYMENT_TIER=production`; `AI_TRADER_MASTER_KEY_MODE` **unset**.
6. Verify: `createMasterKeyProvider()` → `isProductionReady() === true` on production deploy.

---

## 4. BP-6 acceptance (operator sign-off)

| Gate | Requirement |
|------|-------------|
| Execution host | Container builds; `/health` returns 200; SIGTERM graceful exit |
| Secret residency | No master key in git / image / browser / `wrangler.jsonc` vars / logs |
| Worker binding | Production Secrets Store provisioned; real binding deployed (when cred storage is next) |
| Scope | No live orders; no BP-7 code; `createMasterKeyProvider()` behavior unchanged |
| Linear | DEE-339 Done only after PR merge + post-merge audit |

**Architect sign-off block:**

| Field | Value |
|-------|-------|
| Environment | production (Worker binding) + execution host staging/prod |
| Git SHA | |
| Secrets Store STORE_ID | |
| Execution host host/id | |
| Offline master key backup ref | (off-repo) |
| Operator | |
| Date | |

---

## 5. Explicit non-authorizations

BP-6 **does not**:

- Authorize live HTX orders (BP-7)
- Enable org-level live-enable
- Start websocket loops or execution runtime
- Modify strategy promotion / validation gate state

---

## Related

- [DEE-220 Master Key Runbook](./DEE-220-MASTER-KEY-RUNBOOK.md)
- [AI-TRADER Security §4](../ai-trader/AI-TRADER-SECURITY.md)
- [ADR-0006 Repository strategy](../adr/0006-ai-trader-repository-strategy.md)
