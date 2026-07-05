# M9 Operator Ceremony — First Institutional Research Campaign

**Linear:** DEE-385 (operator phase) · parent DEE-384 · **Issue:** PR #371 merged @ `87e5fb8`  
**Vault:** `replay-runs/RI-P7/m9-v2-research-campaign-org0/`  
**Strategy:** `mean_reversion_v0` @ **`0.1.1`** (slot free; `0.1.0` occupied by prior rejected candidate)

> One-page launch checklist. **Do not run the campaign until explicit go/no-go in chat.**

---

## A. Before authorization (operator + architect)

| # | Check | How |
|---|-------|-----|
| 1 | `dev` @ `87e5fb8` or later | `git checkout dev && git pull && git rev-parse HEAD` |
| 2 | No concurrent campaigns | `pgrep -fl 'm9-v2-research-campaign\|trader:ri:campaign'` → empty |
| 3 | Env set (never log secrets) | `WAIA_DB_BACKEND=postgres`, `DATABASE_URL_POSTGRES`, `WAIA_TRADER_ORG0_ORGANIZATION_ID=3c50b4e9-1138-43a5-a29f-e65088124cfc` |
| 4 | Migrations 0064–0066 applied | See runbook §Preflight verification |
| 5 | Bars ≥ 129600 (BTC/USDT 1m) | Current: **129602** — no backfill needed |
| 6 | Candidate slot `0.1.1` free | Postgres preflight — no row for `mean_reversion_v0@0.1.1` |
| 7 | Vault is template-only | No `m9-*.json` in vault yet |
| 8 | Architect confirms scope | No promotion, no live, no M8 discovery, no blind without separate digest |
| 9 | Command lock | `--enable-guardian-exits=1` required; **no** portfolio overrides unless architect-approved |
| 10 | Digest host/path | Digests generated on **this Execution Server** at **this repo root** (see §B) |

---

## B. Authorization (human only — not agents)

**Host rule:** Generate digests on the same Execution Server host and from the same repo root/path that will run the campaign. **Never generate digests on a laptop for a remote execution.**

1. Confirm campaign scope matches runbook exactly (org, strategy, **`0.1.1`**, symbol, interval, vault path, metrics `2.0.0`, dataset `m9-v2-research-campaign-org0`).
2. Confirm campaign command includes **`--enable-guardian-exits=1`** and **no** `--starting-balance-usdt` / portfolio overrides unless architect-approved.
3. Run **digest scope verification** on **this host**: `pnpm trader:m9:digest -- --verify-scope` — confirm absolute `vaultDir` matches this machine’s repo path.
4. Post **explicit go/no-go in chat** (include operator name + date).
5. Run **digest generation** on **this host**: `pnpm trader:m9:digest -- --generate-digests`. Copy both 64-char hex digests.
6. Paste digests into the final campaign command. **Do not reuse digests if any scope field changes.**

---

## C. Launch (foreground only)

**Log safety:** first attempt may use a fresh log file; **retries must not overwrite** prior logs — use `tee -a` or a timestamped log path (see runbook).

```bash
cd <WAIA_REPO_ROOT>
set -a && source .env.local && set +a   # or export vars on Execution Server
export WAIA_TRADER_ORG0_ORGANIZATION_ID=3c50b4e9-1138-43a5-a29f-e65088124cfc

# First attempt (clean log):
pnpm trader:m9:campaign -- \
  --org-id=3c50b4e9-1138-43a5-a29f-e65088124cfc \
  --strategy-id=mean_reversion_v0 \
  --strategy-version=0.1.1 \
  --metrics-schema-version=2.0.0 \
  --operator-campaign-authorization=<CAMPAIGN_DIGEST> \
  --operator-blind-authorization=<BLIND_DIGEST> \
  --vault-dir=./replay-runs/RI-P7/m9-v2-research-campaign-org0 \
  --enable-guardian-exits=1 \
  2>&1 | tee replay-runs/RI-P7/m9-v2-research-campaign-org0/m9-campaign-run.log

# Retry after failure (preserve prior log):
# ... same command ... 2>&1 | tee -a replay-runs/RI-P7/m9-v2-research-campaign-org0/m9-campaign-run.log

# Or timestamped log per attempt:
# LOG=replay-runs/RI-P7/m9-v2-research-campaign-org0/m9-campaign-run-$(date -u +%Y%m%dT%H%M%SZ).log
# ... same command ... 2>&1 | tee "$LOG"
```

Optional: wrap with `timeout 4h` on Linux Execution Server.

---

## D. Immediately after exit

| Exit | Action |
|------|--------|
| `0` | Fill `VALIDATION.md`; verify manifest + PKA digests; mark DEE-385 In Review |
| `1` (regime fail) | Read `m9-campaign-run.log`; inspect rejection or success-bundle artifacts per runbook §Failure recovery; document blind consumed; **do not** edit sealed JSON |
| Crash / throw | Preserve log + `operator-authorization-record.json`; check Postgres candidate row; do not re-run blind without new authorization |

Post-run: `pgrep -fl 'm9-v2-research-campaign'` must be empty.

---

## E. Forbidden

Campaign from Cursor agents without chat authorization · HTX backfill during ceremony · background `&` · promotion/live · M10 work · mutating sealed dee-371 / prior vault JSON

**Full detail:** `M9-OPERATOR-RUNBOOK.md` · **Acceptance:** `VALIDATION.md`
