# M9 Validation Record

**Issue:** DEE-384  
**Status:** TEMPLATE — fill after operator campaign (post-merge)

## Campaign metadata

| Field | Value |
|-------|-------|
| Merge SHA on `dev` | _pending_ |
| Campaign run date | _pending_ |
| Operator | _pending_ |
| Strategy | _pending_ |
| Strategy version | _pending_ |
| Vault directory | `replay-runs/RI-P7/m9-v2-research-campaign-org0/` |

## Preflight (operator)

- [ ] HTX bars ≥ 129600 confirmed
- [ ] Candidate version bumped; no duplicate row
- [ ] Authorization digests verified
- [ ] Fresh vault; no prior artifact mutation
- [ ] Single foreground process; log captured to `m9-campaign-run.log`

## Evidence bundle

- [ ] `m9-campaign-manifest.json` digest links resolve
- [ ] Research evidence provenance IDs exist in Postgres
- [ ] PKA re-serialize digest matches manifest
- [ ] `m9-v2-metrics-export.json`: v2 schema; aggregate == sum(byRegime)
- [ ] `closedTrades + markToCloseTrades > 0` on validation window
- [ ] `m9-lifecycle-trace.json` present; parity passed
- [ ] `m9-guardian-reason-sample.json` present (if guardian enabled)
- [ ] Regime coverage outcome documented (pass or fail)
- [ ] `promotionAttempted: false` in manifest

## PnL reconciliation

_Document validation vs blind PnL, portfolio starting balance, and forced-flat marks._

## Outcome

| Result | Notes |
|--------|-------|
| Campaign | _pass / fail_ |
| Regime gate | _pass / fail_ |
| Blind consumed | _yes / no_ |
| Architect acceptance | _pending_ |

## Cross-links

- M3 guardian: `replay-runs/RI-P7/m3-guardian-org0/VALIDATION.md`
- M4 dynamic SL/TP: `replay-runs/RI-P7/m4-dynamic-sl-tp-org0/VALIDATION.md`
- M0 v2 forensics: `replay-runs/RI-P7/closed-trade-attribution-forensics-org0/VALIDATION.md`
