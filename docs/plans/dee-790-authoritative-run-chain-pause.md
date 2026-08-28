---
integrationIssue: DEE-790
parentIssue: DEE-755
branch: dee-790-authoritative-run-chain-pause
riskTier: T2
prPolicy: one-integration-pr
---

# DEE-790 — deterministic authoritative-run-chain pause proof

## Admission

- Exact stacked base: PR #514 head `b050f176d0c3aa677de2a10a6fe85b14fb3fa87d` (`dee-781-fhv-deterministic-pause-harness`).
- Dependency order: this train merges only into the DEE-781 branch; PR #514 is then re-reviewed and rerun against `main` before any main merge.
- One isolated test-only branch/worktree, one admission-first manifest, one PR and one squash merge.
- DEE-792 replaces the fourth legacy external timing-race pause consumer with the already-ratified default-off `testOnlyPauseAfterCycles` boundary.
- DEE-791 adds a bounded source/proof check and records focused/full-suite closure.
- No production file, assertion, scientific formula, holdout, security, live or capital semantic may change.

## Required proof

The authoritative-run-chain test must preserve parity, digest, gap, duplicate and evidence-health assertions while removing external polling and pause-request timing. Focused FHV tests, the proof script, literal fresh-migrated full SQLite, exact-head independent review, authoritative CI and DEE-653 must all pass before squash merge.

## Rollback

One revert PR of the squash commit. No deployment, live trading or capital action is authorized.
