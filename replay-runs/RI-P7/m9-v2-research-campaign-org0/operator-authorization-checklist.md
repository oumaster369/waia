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

## v0.1.7 content-bound authorization checklist (DEE-398 / ADR-0022)

- [ ] `pnpm trader:m9:digest -- --verify-scope` run on the same host/repo root/stored bars/sidecar path that will run the campaign
- [ ] `blindScope.blindDigest` is a real 64-char hex digest (computed from stored bars, not a placeholder)
- [ ] `blindScope.sidecarContentDigest` is a real digest, or `"none"` if genuinely no sidecar is used — never `null`
- [ ] `--require-provider-fusion=1`, `--enable-guardian-exits=1`, and `--provider-sidecar-path=<v2 sidecar>` all set on the campaign command (the campaign now refuses to start otherwise)
- [ ] If a prior dataset row exists under the same `--dataset-name`, confirmed it is a genuine REUSE (identical stored bars) — not a `M9_DATASET_CONTENT_CONFLICT`
- [ ] Digests generated immediately before the campaign command, with no bar/sidecar changes in between
