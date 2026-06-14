# DEE-220 — AI-TRADER master key runbook (operator)

T4 provisioning, disaster recovery, and production-readiness verification for the AI-TRADER `MasterKeyProvider` seam.

**Authority:** [DEE-220 Linear contract](https://linear.app/deepsense/issue/DEE-220/at-e14a-fg-key-management), [AI-TRADER-SECURITY.md §3–4](../ai-trader/AI-TRADER-SECURITY.md), [wrangler.jsonc](../../wrangler.jsonc).

**Rules:** Do **not** paste master key material into Linear, tickets, or git. Document **environment name + git SHA** in sign-off blocks only.

---

## 1. Security §4 reconciliation (Workers runtime)

| Allowed | Forbidden |
|---------|-----------|
| Master key read **only** via `lib/trader/security/**` on the OpenNext Worker (`createMasterKeyProvider()` → Secrets Store binding) | Master key in browser bundles, `NEXT_PUBLIC_*`, API responses, or logs |
| Server-side DEK wrap/unwrap for future credential connect (DEE-196) | Per-Worker plaintext env as **production** master key |
| Short-lived in-memory use per request | DEE-196 or other modules importing `env.AI_TRADER_MASTER_KEY` directly |

**Execution-host note:** The off-Cloudflare execution service (Master Spec Phase 6+) requires a **separate KMS path**. It must not read Cloudflare Secrets Store. Track under DEE-175 follow-on.

---

## 2. One-time provisioning (production)

### A. Generate master key (off-repo)

```bash
openssl rand -base64 32
```

Store output in password manager / split custody — **offline encrypted backup (mandatory)**.

### B. Create Secrets Store (Cloudflare account)

```bash
npx wrangler secrets-store store create waia-ai-trader-secrets --remote
# Record STORE_ID from output for step D below
```

### C. Upload production secret (Workers scope)

```bash
npx wrangler secrets-store secret create <STORE_ID> \
  --name ai-trader-master-key-v1 \
  --scopes workers \
  --remote
# Paste base64 master key when prompted
```

### D. Bind Worker

**Add** the following block to `wrangler.jsonc` (not present in git until real `store_id` exists — placeholder values break Workers Builds):

```jsonc
"secrets_store_secrets": [
  {
    "binding": "AI_TRADER_MASTER_KEY",
    "store_id": "<WAIA_SECRETS_STORE_ID>",
    "secret_name": "ai-trader-master-key-v1"
  }
]
```

Replace `<WAIA_SECRETS_STORE_ID>` with the store ID from step B, commit if desired, then deploy production Worker/Pages with binding.

### E. Production readiness env

| Variable | Production value |
|----------|------------------|
| `WAIA_DEPLOYMENT_TIER` | `production` (or rely on `CF_ENVIRONMENT=production`) |
| `AI_TRADER_MASTER_KEY_MODE` | **unset** (never `dev`) |

Verify: `MasterKeyProvider.isProductionReady() === true` **only** on production deploy.

---

## 3. Staging / preview separation

| Environment | Master key | `isProductionReady()` | Real HTX creds |
|-------------|------------|----------------------|----------------|
| **Production** | `ai-trader-master-key-v1` in prod store | `true` when binding OK | Blocked until DEE-196 Done |
| **Staging** | **Separate** secret value (never copy prod key) | `false` | **Never** |
| **Preview** | Staging secret or none | `false` | **Never** |
| **Local** | `AI_TRADER_MASTER_KEY_DEV` in `.dev.vars` | `false` | **Never** |

---

## 4. RBAC (Secrets Store)

Minimum roles:

- **Secrets Store Admin** — create/store secrets
- **Secrets Store Deployer** — bind secrets to Workers
- API tokens: `Secrets Store Write` only where needed (least privilege)

Audit Cloudflare account audit logs for secret create/update/delete.

**Open beta note:** Cloudflare Secrets Store is open beta (2026); accept vendor risk at T4 merge. Unavailable on Cloudflare China Network.

---

## 5. Disaster recovery

### Irrecoverable-loss statement

If the master key is **lost** and no offline backup exists, **all envelope-encrypted exchange credentials are permanently unrecoverable**. Users must re-connect exchange API keys.

### Offline backup (mandatory)

1. Encrypt master key backup (password manager / split custody / HSM export).
2. Store **outside** Cloudflare and git.
3. Record backup location in Architect ops vault (not in repo).

### Recovery procedure

1. Retrieve offline backup.
2. Restore to Secrets Store: `wrangler secrets-store secret create … --name ai-trader-master-key-v1 --remote` (or update per Cloudflare docs).
3. Deploy binding; run staging round-trip test (`encryptDataKey` → `decryptDataKey`) with synthetic DEK.
4. Promote to production only after Architect sign-off.

### Leak / compromise procedure

1. Do **not** delete old secret until DEE-196c re-wrap completes (future).
2. Create `ai-trader-master-key-v2`, deploy dual bindings (DEE-196c).
3. Force credential re-connect for all orgs.
4. Review Core audit stream for anomalous credential access.

---

## 6. Key rotation (DEE-196c — out of DEE-220 scope)

| Rule | Detail |
|------|--------|
| **No in-place overwrite** of `v1` while credentials exist | Create `ai-trader-master-key-v2` |
| **Dual-secret overlap** | Both v1 and v2 registered until all DEKs re-wrapped |
| **Ownership** | Batch re-wrap + retirement = **DEE-196c** |

DEE-220 ships version map extensibility (`wrapped.keyVersion` → secret name).

---

## 7. Pre-credential-storage sign-off checklist

Before **any real HTX credential** is persisted (requires DEE-196):

- [ ] Production Secrets Store provisioned; `store_id` in `wrangler.jsonc`
- [ ] Offline backup recorded (location documented off-repo)
- [ ] Staging/preview use **non-production** master key
- [ ] Production deploy: `isProductionReady() === true`
- [ ] Preview deploy: `isProductionReady() === false`
- [ ] DEE-220 merged + Linear Done
- [ ] DEE-196 envelope persistence + gate + RLS + tenant tests + audit (separate issue)

**Architect sign-off block:**

| Field | Value |
|-------|-------|
| Environment | production |
| Git SHA | |
| STORE_ID | |
| Offline backup location (reference only) | |
| Operator | |
| Date | |

---

## 8. Local developer setup

```bash
# .dev.vars (gitignored)
AI_TRADER_MASTER_KEY_DEV="$(openssl rand -base64 32)"
AI_TRADER_MASTER_KEY_MODE=dev
WAIA_DEPLOYMENT_TIER=local
```

Run unit tests only (synthetic DEKs):

```bash
pnpm test --run tests/unit/trader-master-key-provider.test.ts
```

---

## Related

- [cloudflare-env-vars.md](../cloudflare-env-vars.md)
- [cloudflare-deploy.md](../cloudflare-deploy.md)
- [AI-TRADER-SECURITY.md](../ai-trader/AI-TRADER-SECURITY.md)
