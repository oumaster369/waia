# Operator Authorization Checklist

**Issue:** DEE-384 / DEE-385 · **Campaign date:** 2026-07-05 · **Closure:** 2026-07-06

- [x] Architect approved M9 Build merge on `dev`
- [x] Execution Server host identified; no concurrent RI campaigns (verified at launch)
- [x] Postgres RI migrations verified (0064–0066)
- [x] HTX bars ≥ 129600 confirmed (129602)
- [x] Strategy version bumped across retries (`0.1.1` → `0.1.6`); candidate preflight passed per attempt
- [x] `--operator-campaign-authorization` digest signed and verified
- [x] Blind digest prepared; **blind not consumed** on final blocked attempt
- [x] Vault directory used; no success-bundle JSON sealed
- [x] Confirmed: no promotion, no live, no discovery CLI
- [x] Process cleanup plan (`m9-campaign-run.log`, no background jobs)

## Outcome

Campaign blocked by **`M9_BLOCKED_BY_ACCOUNTING_DEFECT`**. Authorization record: `operator-authorization-record.json` (final: `0.1.6`).

## Digest computation

Use `computeM9CampaignAuthorizationDigest` / `computeM9BlindAuthorizationDigest` from
`lib/trader/research/m9-operator-authorization.ts` with the exact campaign scope fields
(org, strategy, version, symbol, interval, vault dir, dataset name for blind).
