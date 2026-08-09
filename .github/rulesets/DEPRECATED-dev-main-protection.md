# DEPRECATED — dual-branch ruleset

This directory retains [`dev-main-protection.json`](dev-main-protection.json) **only** for:

1. Historical evidence of the pre–DEE-511 `dev` + `main` protection model
2. Input to [`rollback-single-trunk-cutover.sh`](../../scripts/github/rollback-single-trunk-cutover.sh)

**Do not apply** `dev-main-protection.json` after single-trunk cutover.

Canonical ruleset: [`main-protection.json`](main-protection.json) (`WAIA main protection`).
