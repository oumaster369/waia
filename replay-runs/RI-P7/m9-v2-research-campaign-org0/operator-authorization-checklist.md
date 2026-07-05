# Operator Authorization Checklist (template)

**Issue:** DEE-384 · **Do not fill during Build**

- [ ] Architect approved M9 Build merge on `dev`
- [ ] Execution Server host identified; no concurrent RI campaigns
- [ ] Postgres RI migrations verified (0064–0066)
- [ ] HTX bars ≥ 129600 confirmed
- [ ] Strategy version bumped; candidate preflight passed
- [ ] `--operator-campaign-authorization` digest signed and verified
- [ ] Understand blind is single-use; `--operator-blind-authorization` prepared separately
- [ ] Fresh vault directory; prior PKA/evidence read-only
- [ ] Confirmed: no promotion, no live, no discovery CLI
- [ ] Process cleanup plan (`m9-campaign-run.log`, no background jobs)

## Digest computation

Use `computeM9CampaignAuthorizationDigest` / `computeM9BlindAuthorizationDigest` from
`lib/trader/research/m9-operator-authorization.ts` with the exact campaign scope fields
(org, strategy, version, symbol, interval, vault dir, dataset name for blind).
