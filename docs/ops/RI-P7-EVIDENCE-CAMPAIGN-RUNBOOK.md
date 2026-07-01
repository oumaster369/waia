# RI-P7 — Evidence Campaign Operator Runbook

**Linear:** DEE-401 (RI-P7) · **Package:** Batch H  
**Authority:** [AI-TRADER Research Intelligence Program](../ai-trader/AI-TRADER-RESEARCH-INTELLIGENCE-PROGRAM.md) · [RI-P7 plan](../../.cursor/plans/ri_p7_execution_d2ccef43.plan.md)

> **Operator / Architect.** Produces real HTX evidence + first Production Knowledge Asset. **Does not** execute HC-3.5, HC-4, or live enable.

---

## Prerequisites

| # | Requirement |
|---|-------------|
| 1 | DEE-363 merged on `dev`; migrations 0064–0066 applied |
| 2 | `WAIA_DB_BACKEND=postgres` + `DATABASE_URL_POSTGRES` on execution host |
| 3 | Org-0 UUID known (operator vault) |
| 4 | HTX API reachable (public klines — no credentials required) |

---

## Step 1 — Paginated HTX backfill

```bash
WAIA_DB_BACKEND=postgres \
DATABASE_URL_POSTGRES='<vault-url>' \
pnpm trader:htx:backfill -- \
  --org-id='<ORG0_UUID>' \
  --symbol=BTC/USDT \
  --period=1min \
  --target-bars=43200
```

**Target:** ≥43,200 bars (~30 days). Recommended: `--target-bars=129600` (~90 days).

---

## Step 2 — Track A evidence + PKA (HC-3.5 drill)

```bash
WAIA_DB_BACKEND=postgres \
DATABASE_URL_POSTGRES='<vault-url>' \
pnpm trader:ri:campaign -- \
  --org-id='<ORG0_UUID>' \
  --track=a \
  --oos-bar-count=20 \
  --vault-dir=./replay-runs/RI-P7
```

**Outputs:**

| File | Purpose |
|------|---------|
| `track-a-research-evidence.json` | Promotion gate input |
| `track-a-production-knowledge-asset.json` | Immutable MKB product artifact |
| `campaign-manifest.json` | Cross-links `knowledgeId`, digests, MKB ids |

---

## Step 3 — Optional Track B (trend_momentum research)

```bash
pnpm trader:ri:campaign -- \
  --org-id='<ORG0_UUID>' \
  --track=b \
  --vault-dir=./replay-runs/RI-P7
```

Document pass or fail in manifest. Track B is **not** promoted at HC-3.5.

---

## Step 4 — Single-strategy pipeline (alternative to campaign)

```bash
pnpm trader:research:pipeline -- \
  --org-id='<ORG0_UUID>' \
  --strategy-id=mean_reversion_v0 \
  --strategy-version=0.1.0 \
  --oos-bar-count=20 \
  --build-pka \
  --out=./evidence.json \
  --pka-out=./pka.json
```

---

## Vault layout (canonical)

```
replay-runs/RI-P7/
  campaign-manifest.json
  track-a-research-evidence.json
  track-a-production-knowledge-asset.json
  track-b-research-evidence.json          # optional
  track-b-production-knowledge-asset.json # optional
  human-knowledge-disposition-track-a.json # Gate 1 — Architect only
```

---

## STOP gates

- If Track A `regimeCoverage.satisfiesRequirement !== true`: **STOP** — escalate to Architect (extend window, do not synthetic-cliff).
- If PKA digest mismatch on re-serialize: **STOP** — fix builder before HC-3.5 prep.
- **Never** edit sealed PKA JSON after Gate 1 disposition.

---

## Related

| Document | Role |
|----------|------|
| [HC-3.5 Checklist](DEE-340-BP10-L2.5-HC3.5-OPERATOR-CHECKLIST.md) | Steps 1b/1c |
| [Gate 1 Disposition Template](RI-P7-GATE1-DISPOSITION-TEMPLATE.md) | Architect Gate 1 |
