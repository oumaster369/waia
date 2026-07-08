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

**v0.1.7 (DEE-398 / ADR-0022): blind authorization is content-bound, not label-bound.** The
blind scope carries `blindDigest` (sealed blind-split bar-content digest) and a normalized
`sidecarContentDigest` — `pnpm trader:m9:digest` reads the stored bars (read-only) to compute
them via the same canonical builder the campaign uses. Generate digests only when the stored
bars and sidecar are in their final, campaign-ready state.

1. Confirm campaign scope matches runbook exactly (org, strategy, **`0.1.7`** (bump per retry), symbol, interval, vault path, metrics `2.0.0`, dataset `m9-v2-research-campaign-org0`).
2. Confirm campaign command includes **`--enable-guardian-exits=1`**, **`--require-provider-fusion=1`**, a v2 `--provider-sidecar-path`, and **no** `--starting-balance-usdt` / portfolio overrides unless architect-approved. The campaign now refuses to start if any of the first three is missing.
3. Run **digest scope verification** on **this host**: `pnpm trader:m9:digest -- --verify-scope` — confirm absolute `vaultDir` matches this machine's repo path, and `blindScope.blindDigest` / `sidecarContentDigest` look correct (real values, not placeholders).
4. Post **explicit go/no-go in chat** (include operator name + date).
5. Run **digest generation** on **this host**: `pnpm trader:m9:digest -- --generate-digests`. Copy both 64-char hex digests.
6. Paste digests into the final campaign command. **Do not reuse digests if any scope field, the stored bars, or the sidecar changes** — the campaign fails closed with `M9_BLIND_AUTHORIZATION_CONTENT_MISMATCH` on any content drift.

---

## C. Launch (foreground only)

**Log safety:** first attempt may use a fresh log file; **retries must not overwrite** prior logs — use `tee -a` or a timestamped log path (see runbook).

```bash
cd <WAIA_REPO_ROOT>
set -a && source .env.local && set +a   # or export vars on Execution Server
export WAIA_TRADER_ORG0_ORGANIZATION_ID=3c50b4e9-1138-43a5-a29f-e65088124cfc

# v0.1.7 attempt (clean log) — --enable-guardian-exits=1, --require-provider-fusion=1, and a
# v2 --provider-sidecar-path are all required; the campaign refuses to start if any is missing:
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

---

## F. Post-campaign outcome (2026-07-06)

| Result | Status |
|--------|--------|
| Campaign CLI | **Failed** (exit `1`) |
| Blocker | **`M9_BLOCKED_BY_ACCOUNTING_DEFECT`** |
| Final strategy version | `0.1.6` |
| Success bundle | **Not produced** |
| Blind consumed | **No** |

**Closure:** `M9-ENGINEERING-CLOSURE.md` · **Forensics:** `M9-FORENSIC-REPORT.md` · **Retries:** `M9-CAMPAIGN-EXECUTION-RECORD.md`

**Next:** See `../AI-TRADER-ENGINEERING-STATUS.md` — PR1 → PR2 (complete, DEE-398 / ADR-0022) → Repeat M9 v0.1.7 (BLOCKED pending final re-audit) → Gate A.
