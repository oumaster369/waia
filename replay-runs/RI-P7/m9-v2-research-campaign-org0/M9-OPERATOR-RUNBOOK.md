# M9 Operator Runbook

**Build:** DEE-384 / PR #371 @ `87e5fb83b0961f44185b355115e04a30bc5659f5`  
**Operator phase:** DEE-385  
**Vault:** `replay-runs/RI-P7/m9-v2-research-campaign-org0/`  
**Org-0 UUID:** `3c50b4e9-1138-43a5-a29f-e65088124cfc` (canonical; also set `WAIA_TRADER_ORG0_ORGANIZATION_ID`)

> **Cursor agents:** do not run campaign, blind, HTX backfill, or digest generation without explicit operator authorization in chat.

---

## Preconditions

| # | Requirement | Status (2026-07-05 prep) |
|---|-------------|--------------------------|
| 1 | M9 Build merged to `dev` | ✅ `87e5fb8` |
| 2 | `WAIA_DB_BACKEND=postgres`, `DATABASE_URL_POSTGRES` set | Verify on Execution Server |
| 3 | `WAIA_TRADER_ORG0_ORGANIZATION_ID` set to Org-0 UUID | Required on host (CLI also accepts `--org-id`) |
| 4 | RI migrations **0064–0066** applied | ✅ verified read-only |
| 5 | HTX bars ≥ 129600 for BTC/USDT 1m | ✅ **129602** bars — backfill **not** required |
| 6 | Strategy version **`0.1.1`** (not `0.1.0`) | ✅ slot available (`0.1.0` = rejected) |
| 7 | Operator authorization digests prepared | Pending explicit go/no-go |
| 8 | Vault template-only (no prior `m9-*.json`) | ✅ markdown only |
| 9 | Single foreground process; disk + write perms | ✅ vault writable |

`pnpm trader:m9:campaign` sets `WAIA_TRADER_CLI=1` via `package.json` — no extra export needed for the npm script.

---

## Preflight verification (read-only)

Run from repo root on Execution Server (does not mutate DB or vault):

```bash
# Env presence — never print secret values
for v in WAIA_DB_BACKEND DATABASE_URL_POSTGRES WAIA_TRADER_ORG0_ORGANIZATION_ID; do
  eval "val=\${$v-}"; [ -n "$val" ] && echo "$v=SET" || echo "$v=UNSET"
done

# Process hygiene
pgrep -fl 'm9-v2-research-campaign|trader:ri:campaign' || echo "no conflicting campaign processes"

# Postgres + bars + candidate slot (requires DATABASE_URL_POSTGRES in env)
node -e "
const fs=require('fs'); const postgres=require('postgres');
const crypto=require('crypto');
const ORG0='3c50b4e9-1138-43a5-a29f-e65088124cfc';
const sql=postgres(process.env.DATABASE_URL_POSTGRES,{max:1,prepare:false});
const req=['0064_research_intelligence_substrate','0065_research_intelligence_substrate_rls','0066_strategy_promotion_research_evidence'];
const hash=t=>crypto.createHash('sha256').update(fs.readFileSync('db/migrations_postgres/'+t+'.sql','utf8')).digest('hex');
(async()=>{
  const applied=await sql\`SELECT hash FROM drizzle.__drizzle_migrations\`; const s=new Set(applied.map(r=>r.hash));
  for(const t of req) console.log(t+':', s.has(hash(t))?'APPLIED':'MISSING');
  const [b]=await sql\`SELECT COUNT(*)::int cnt FROM trader_market_bars WHERE organization_id=\${ORG0}::uuid AND symbol='BTC/USDT' AND interval='1m'\`;
  console.log('BTC/USDT 1m bars:', b.cnt, b.cnt>=129600?'OK':'INSUFFICIENT');
  const [c]=await sql\`SELECT status FROM trader_strategy_candidates WHERE organization_id=\${ORG0}::uuid AND strategy_id='mean_reversion_v0' AND strategy_version='0.1.1' LIMIT 1\`;
  console.log('mean_reversion_v0@0.1.1 slot:', c?'OCCUPIED ('+c.status+')':'AVAILABLE');
  await sql.end({timeout:5});
})().catch(e=>{console.error(e.message); process.exit(1);});
"
```

---

## Strategy version

| Version | Postgres | Use for M9 |
|---------|----------|------------|
| `0.1.0` | `rejected` candidate exists | **Do not use** — preflight conflict |
| **`0.1.1`** | slot free | **Recommended** — semver patch; clean audit trail |

Alternative: keep `0.1.0` and pass `--campaign-suffix=<unique>` (version becomes `0.1.0+<suffix>`). Prefer **`0.1.1`** for first institutional campaign clarity.

---

## Authorization digests (v0.1.7 — content-bound, DEE-398 / ADR-0022)

Digests are SHA-256 of canonical JSON scope (`lib/trader/research/m9-operator-authorization.ts`).

**Blind authorization is now content-bound, not label-bound.** The blind scope carries the
sealed blind-split bar-content digest (`blindDigest`) and a normalized `sidecarContentDigest`
(always a real digest or the `"none"` sentinel — never `null`/absent). `datasetName` is still
present for provenance/audit only; it is **not** the integrity anchor. Both
`pnpm trader:m9:digest` and the campaign build this scope through the **same canonical
builder** (`buildM9BlindAuthorizationScope`), so the digest you review is provably the one the
campaign will authorize — as long as the stored bars have not changed between the two commands.
The orchestrator independently re-seals and re-verifies this content at runtime; any drift
fails closed with `M9_BLIND_AUTHORIZATION_CONTENT_MISMATCH` before any dataset write or backtest
work.

**Repeat M9 v0.1.7 run profile is now enforced, not optional.** The campaign refuses to start
(before any file/DB write) unless **all three** are present: `--require-provider-fusion=1`,
`--enable-guardian-exits=1`, and a v2 provider sidecar (`--provider-sidecar-path=<path>` or the
default vault path). This replaces the earlier "recommended" posture — an authorized run can no
longer silently omit any of these three gates.

**Critical — host and path:** Generate digests on the **same Execution Server host** and from the **same repo root/path** that will run the campaign, **after the same stored bars are in place** — `pnpm trader:m9:digest` now performs a read-only Postgres bar lookup to compute `blindDigest`, so it must see the same bars the campaign will see. **Never generate digests on a laptop for a remote execution.** `vaultDir` in scope is the absolute `path.resolve()` of `--vault-dir`; a path mismatch causes digest rejection at CLI start.

**Critical — command lock (not in digest scope):** The authorized campaign must use **`--enable-guardian-exits=1`**, **`--require-provider-fusion=1`**, and a v2 sidecar, and **no** portfolio overrides (`--starting-balance-usdt`, `--max-risk-per-trade-pct`, etc.) unless explicitly architect-approved. Document any approved overrides in `VALIDATION.md`.

| Field | M9 v0.1.7 campaign value |
|-------|-------------------------|
| `organizationId` | `3c50b4e9-1138-43a5-a29f-e65088124cfc` |
| `strategyId` | `mean_reversion_v0` |
| `strategyVersion` | `0.1.7` (bump further per retry) |
| `symbol` | `BTC/USDT` |
| `interval` | `1m` |
| `vaultDir` | `<absolute path>/replay-runs/RI-P7/m9-v2-research-campaign-org0` |
| `metricsSchemaVersion` | `2.0.0` |
| `campaignSuffix` | omit (no `--campaign-suffix` flag) |
| `datasetName` (blind only, provenance) | `m9-v2-research-campaign-org0` |
| `blindDigest` (blind only, integrity anchor) | computed from stored bars — see Step 1/2 below |
| `sidecarContentDigest` (blind only) | real digest of the v2 sidecar, or `"none"` if no sidecar |

### Step 1 — Verify scope (no digest output yet)

Run on the **Execution Server** from the **same repo root** as the campaign, with the same bars already stored and the same `--provider-sidecar-path` (or default vault path) the campaign will use:

```bash
cd <WAIA_REPO_ROOT>
pnpm trader:m9:digest -- --verify-scope
```

Review JSON output. Confirm `vaultDir` is the **absolute** path on this host, and that `blindScope.blindDigest` / `blindScope.sidecarContentDigest` look correct (non-empty 64-char hex, or `"none"` for no sidecar). If any field is wrong, **stop** — fix flags/bars/sidecar before generating digests.

Optional overrides (must match campaign command exactly):

```bash
pnpm trader:m9:digest -- --verify-scope \
  --strategy-version=0.1.7 \
  --vault-dir=./replay-runs/RI-P7/m9-v2-research-campaign-org0
```

### Step 2 — Generate digests (only after explicit operator go/no-go in chat)

Run on the **same host, repo root, stored bars, and sidecar path** as Step 1:

```bash
pnpm trader:m9:digest -- --generate-digests
```

Copy `CAMPAIGN_DIGEST=` and `BLIND_DIGEST=` lines to secure scratch pad. **Do not run this step during preparation** — only at authorization time. **If the stored bars or sidecar change after this step, the digest is stale — regenerate before running the campaign.**

Required CLI flags:

- `--operator-campaign-authorization=<CAMPAIGN_DIGEST>`
- `--operator-blind-authorization=<BLIND_DIGEST>` (**single-use blind holdout**; content-bound to `blindDigest` — the campaign fails closed with `M9_BLIND_AUTHORIZATION_CONTENT_MISMATCH` if the sealed content at run time differs from what was authorized)

On start, the CLI runs all fail-fast preflights (run profile, campaign authorization, content-bound blind authorization, candidate slot availability) **before** writing anything — `operator-authorization-record.json` is only written to the vault once every preflight has passed.

---

## Dataset reuse / conflict (v0.1.7 — DEE-398 / ADR-0022)

`--dataset-name` is no longer an unconditional insert. On each run the pipeline seals the
stored bars and resolves the dataset by `(organizationId, datasetName)`:

| Outcome | Meaning | Operator action |
|---------|---------|------------------|
| **CREATE** | No dataset row exists yet for this name | Normal first run — proceeds |
| **REUSE** | An existing row has identical train/validation/blind digests and bar counts | Normal retry with a bumped `--strategy-version` — proceeds, no duplicate row |
| **CONFLICT** | An existing row has the same name but *different* sealed content | Pipeline throws `M9DatasetContentConflictError` (`M9_DATASET_CONTENT_CONFLICT`) before any backtest work — **use a new `--dataset-name`**, or confirm the stored bars actually match the prior run's before retrying |

This replaces the previous raw Postgres unique-violation failure mode on same-name retries.

## Campaign command

Run in **foreground only** — no background jobs, no Worker cron.

**Log safety:** first attempt may overwrite `m9-campaign-run.log`; retries must use `tee -a` or a timestamped log file so prior attempts are preserved.

```bash
cd <WAIA_REPO_ROOT>
set -a && source .env.local && set +a
export WAIA_TRADER_ORG0_ORGANIZATION_ID=3c50b4e9-1138-43a5-a29f-e65088124cfc

# v0.1.7 attempt — all three run-profile flags below are now REQUIRED; the campaign
# refuses to start (before any write) if any is missing:
pnpm trader:m9:campaign -- \
  --org-id=3c50b4e9-1138-43a5-a29f-e65088124cfc \
  --strategy-id=mean_reversion_v0 \
  --strategy-version=0.1.7 \
  --metrics-schema-version=2.0.0 \
  --operator-campaign-authorization=<CAMPAIGN_DIGEST> \
  --operator-blind-authorization=<BLIND_DIGEST> \
  --vault-dir=./replay-runs/RI-P7/m9-v2-research-campaign-org0 \
  --enable-guardian-exits=1 \
  --require-provider-fusion=1 \
  --provider-sidecar-path=./replay-runs/RI-P7/m9-v2-research-campaign-org0/m9-provider-sidecar.json \
  2>&1 | tee replay-runs/RI-P7/m9-v2-research-campaign-org0/m9-campaign-run.log

# Retry (append — do not overwrite):
# ... | tee -a replay-runs/RI-P7/m9-v2-research-campaign-org0/m9-campaign-run.log

# Or timestamped per attempt:
# LOG=replay-runs/RI-P7/m9-v2-research-campaign-org0/m9-campaign-run-$(date -u +%Y%m%dT%H%M%SZ).log
# ... | tee "$LOG"
```

**Required (v0.1.7 run profile, enforced by `assertM9V017RunProfile` — refuses to start otherwise):** `--enable-guardian-exits=1`, `--require-provider-fusion=1`, a v2 provider sidecar. **Forbidden unless architect-approved:** portfolio override flags (see below).

Optional portfolio overrides (research path — **not** `PAPER_LOOP_*`; **architect approval required for first institutional campaign**):

- `--starting-balance-usdt=1000000.00`
- `--max-risk-per-trade-pct=0.10`
- `--default-stop-distance-pct=0.02`

Default `--oos-bar-count=20` (not part of authorization scope).

---

## Success artifacts

| File | Purpose |
|------|---------|
| `operator-authorization-record.json` | Scope + digests (written at CLI start) |
| `m9-research-evidence.json` | Promotion gate input |
| `m9-production-knowledge-asset.json` | Immutable MKB artifact |
| `m9-v2-metrics-export.json` | v2 aggregate + byRegime |
| `m9-lifecycle-trace.json` | Lifecycle parity export |
| `m9-guardian-reason-sample.json` | Guardian sample (when `--enable-guardian-exits=1`) |
| `m9-campaign-manifest.json` | Cross-links digests, paths, `promotionAttempted: false` |
| `m9-campaign-run.log` | Operator tee log |

---

## Process hygiene

| Rule | Action |
|------|--------|
| Single process | One foreground CLI; no `&` daemon |
| Timeout wrapper | Use `timeout 4h` on Linux if supported |
| Post-run check | `pgrep -fl 'm9-v2-research-campaign'` should be empty |
| Exit codes | `0` = success + regime OK; `1` = regime fail or pipeline error |
| Orphans | Kill stale `node`/`tsx` only when operator explicitly requests |
| Log retention | First run: `tee` to `m9-campaign-run.log`; retries: `tee -a` or timestamped `m9-campaign-run-<UTC>.log` |

---

## Failure recovery

Three outcomes — operator must distinguish via log + vault contents:

### 1. Early regime failure (`ResearchPipelineRegimeFailureError`)

- **Vault:** `m9-research-rejection-record.json`, `m9-evolution-cycle-mvp.json`
- **Postgres:** candidate → `rejected`
- **Blind:** may be consumed — check rejection record `blindConsumed`
- **Replay:** use rejection record IDs + `m9-campaign-run.log`; do not mutate files
- **Next run:** bump strategy version (e.g. `0.1.2`) + **new blind digest**

### 2. Pipeline completed but regime gate failed (exit `1`, full bundle written)

- **Vault:** success artifacts **plus** manifest with `regimeSatisfiesRequirement: false`
- **Do not** edit evidence/PKA/manifest — treat as sealed failure bundle
- Document in `VALIDATION.md`; architect reviews before retry

### 3. Crash / uncaught error before pipeline completion

- **Vault:** may contain only `operator-authorization-record.json`
- **Action:** capture log + stderr; inspect Postgres for partial candidate; **do not** assume blind state — query rejection/evidence tables if row exists
- **Retry:** new authorization digests required

**Always:**

- Never edit success artifacts in place after write
- Never re-run blind without new `--operator-blind-authorization`
- Fill `VALIDATION.md` for pass **and** fail
- Mark DEE-385 In Review when vault + validation ready for architect

---

## Mock vs paper

Research campaign uses **mock ledger** for window isolation. Evidence `executionMode: backtest`. Forward paper soak (`PAPER_LOOP_*`) is a separate ledger — do not conflate.

---

## Campaign vault sealing (PR2+)

Every campaign exit — **success**, **governed reject**, or **crash** — must leave **`m9-campaign-operator-diagnostics.json`** in the vault.

| `outcomeKind` | Required vault artifacts |
|---------------|--------------------------|
| `success` | `m9-campaign-manifest.json` + operator diagnostics (inventory snapshot, `parityStatus: ok`) |
| `governed_reject` | rejection record + evolution cycle + operator diagnostics |
| `crash` | rejection record + evolution cycle + operator diagnostics (best-effort inventory snapshot) |

Operator diagnostics fields (v1 additive): `outcomeKind`, `parityStatus`, `inventorySnapshot`, error fields (crash/reject only).

A campaign is **not complete** until the vault contains the success manifest **or** sealed failure bundle **plus** operator diagnostics.

---

## Forbidden

- Promotion FSM / live enable
- M8 discovery CLI
- Mutating sealed dee-371 / prior RI vault JSON
- Running campaign from Cursor agents without explicit operator authorization in chat
- HTX backfill during active ceremony (bars already sufficient)

---

## Quick reference

- **Ceremony checklist:** `M9-OPERATOR-CEREMONY.md`

---

## Post-campaign closure (2026-07-06)

The operator campaign **did not succeed**. Official blocker: **`M9_BLOCKED_BY_ACCOUNTING_DEFECT`**.

| Failure class | M9 outcome |
|---------------|------------|
| Early regime / post-run regime | **No** — not the blocker |
| Accounting / PnL reconciliation | **Yes** — `PaperPnLReconciliationError` |
| Success evidence bundle | **Not produced** |

Final error (attempt `0.1.6`):

```
[trader/paper/pnl] sell quantity 0.00866055 exceeds open quantity 0.00731991
```

**Do not** patch ad hoc in the vault or mutate Postgres candidate rows to simulate success.

**Closure docs:** `M9-ENGINEERING-CLOSURE.md`, `VALIDATION.md`, `M9-FORENSIC-REPORT.md`, `M9-CAMPAIGN-EXECUTION-RECORD.md`.

**Next engineering step (approved roadmap only):** See `../AI-TRADER-ENGINEERING-STATUS.md`. PR2 (DEE-398 — content-bound authorization + dataset idempotency, ADR-0022) is complete; Repeat **M9 v0.1.7** remains **BLOCKED** pending the final architectural re-audit, and is mandatory before PR3.
- **Post-campaign acceptance:** `VALIDATION.md`
- **Linear:** DEE-385
