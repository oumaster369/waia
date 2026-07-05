# M9 Validation Record

**Build issue:** DEE-384 · **Operator issue:** DEE-385  
**Status:** TEMPLATE — fill after operator campaign (post-merge)

---

## Campaign metadata

| Field | Value |
|-------|-------|
| Merge SHA on `dev` | `87e5fb83b0961f44185b355115e04a30bc5659f5` (PR #371) |
| Execution host | _pending_ |
| Campaign run date (UTC) | _pending_ |
| Campaign duration | _pending_ |
| Operator | _pending_ |
| Operator authorization (chat ref) | _pending_ |
| Organization | Org-0 `3c50b4e9-1138-43a5-a29f-e65088124cfc` |
| Strategy | `mean_reversion_v0` |
| Strategy version | `0.1.1` (planned) |
| Symbol / interval | `BTC/USDT` / `1m` |
| Dataset name | `m9-v2-research-campaign-org0` |
| Metrics schema | `2.0.0` |
| OOS bar count | `20` (default) |
| Guardian exits | enabled (`--enable-guardian-exits=1`) |
| Vault directory | `replay-runs/RI-P7/m9-v2-research-campaign-org0/` |
| Builder git SHA (from manifest) | _pending_ |
| CLI exit code | _pending_ |
| Bar count at run (BTC/USDT 1m) | _pending_ (preflight: **129602**) |

---

## Preflight (operator)

- [x] M9 Build merged to `dev` @ `87e5fb8`
- [x] HTX bars ≥ 129600 confirmed (129602 at prep)
- [x] Candidate slot `0.1.1` available (`0.1.0` rejected — not reused)
- [ ] `WAIA_TRADER_ORG0_ORGANIZATION_ID` set on Execution Server
- [ ] Authorization digests verified against scope
- [ ] Fresh vault; no prior `m9-*.json` mutated
- [ ] Single foreground process; log captured (`tee` first run; `tee -a` or timestamped log on retry)
- [ ] Explicit operator go/no-go recorded in chat

---

## Authorization record

- [ ] `operator-authorization-record.json` present
- [ ] Campaign digest matches scope (org, strategy, version, symbol, interval, vault, metrics)
- [ ] Blind digest matches scope + `datasetName`
- [ ] Digests match values passed on CLI

---

## Evidence bundle (success path)

- [ ] `m9-campaign-manifest.json` digest links resolve
- [ ] `promotionAttempted: false` in manifest
- [ ] `regimeSatisfiesRequirement` documented (true/false)
- [ ] Research evidence provenance IDs exist in Postgres
- [ ] PKA re-serialize digest matches manifest
- [ ] `m9-v2-metrics-export.json`: v2 schema; aggregate == sum(byRegime)
- [ ] `closedTrades + markToCloseTrades > 0` on validation window
- [ ] `m9-lifecycle-trace.json` present; parity passed
- [ ] `m9-guardian-reason-sample.json` present (guardian enabled)
- [ ] Regime coverage outcome documented (pass or fail)

---

## Failure bundle (if applicable)

| Artifact | Present | Notes |
|----------|---------|-------|
| `m9-research-rejection-record.json` | _pending_ | Early regime failure |
| `m9-evolution-cycle-mvp.json` | _pending_ | Paired with rejection |
| `m9-campaign-run.log` | _pending_ | Full stderr/stdout tee |
| Postgres candidate status | _pending_ | e.g. `rejected` |
| Blind consumed | _pending_ | yes / no — from rejection or manifest |

_Do not edit sealed JSON after write. Document failure class: early regime / post-run regime / crash._

---

## PnL reconciliation

| Field | Validation window | Blind window | Notes |
|-------|-------------------|--------------|-------|
| Starting balance (USDT) | _pending_ | — | Default 1M unless overridden |
| Realized PnL | _pending_ | _pending_ | |
| Marked PnL (forced-flat) | _pending_ | _pending_ | |
| Portfolio risk settings | _pending_ | — | |

---

## Outcome

| Result | Value | Notes |
|--------|-------|-------|
| Campaign CLI | _pass / fail / crash_ | Exit code _pending_ |
| Regime gate | _pass / fail_ | |
| Blind consumed | _yes / no_ | Single-use — blocks blind retry without new digest |
| Knowledge ID | _pending_ | From manifest/PKA |
| Architect acceptance | _pending_ | Required before M10 |
| DEE-385 status | _pending_ | In Review → Done on acceptance |

---

## Cross-links

- Operator ceremony: `M9-OPERATOR-CEREMONY.md`
- Operator runbook: `M9-OPERATOR-RUNBOOK.md`
- M3 guardian: `replay-runs/RI-P7/m3-guardian-org0/VALIDATION.md`
- M4 dynamic SL/TP: `replay-runs/RI-P7/m4-dynamic-sl-tp-org0/VALIDATION.md`
- M0 v2 forensics: `replay-runs/RI-P7/closed-trade-attribution-forensics-org0/VALIDATION.md`
