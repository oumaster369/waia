---
integrationIssue: DEE-1161
integrationTitle: "AI-TRADER: refuse live dispatch while exact signer authority is unavailable"
parentIssue: DEE-1156
branch: dee-1161-signer-authority-refusal
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, isolated-postgres, github-pr-ci]
requiredValidation: [lint, typecheck, build, targeted-unit, native-postgres, validate-canon, consumer-graphs, independent-review, required-ci]
approvalGates: [user-authorized-engineering, independent-review, required-ci, no-live-activation, no-production-0229]
state:
  status: in-progress
  completedWorkPackages: [WP-1]
  remainingWorkPackages: [WP-2]
  nextAction: "Complete independent review and exact-head required PR CI; no publication or production rollout yet."
provenance:
  createdFrom: "2026-10-01 user-authorized audit; source main 4f54d9cd"
  supersedes: null
---

# DEE-1161 — fail closed until signer authority exists

## Scope

The startup connector can retain credential A while Execution V2 checks requested credential B. Current Risk-account records and stored credential permission metadata do not establish an independently qualified exact signer tuple or a revision/mutation fence. This prerequisite closes the permissive fallback; it does not issue that missing authority. Parent DEE-1156 remains open.

## WP-1 — admission and recovery

After preserving all existing concrete live-gate refusals, otherwise-valid live facts return `SIGNER_BINDING_UNAVAILABLE`. The existing shared gate must enforce this through the public submission service, mandatory direct transactional bind and final pre-POST recheck. The public preliminary hook defers only this missing-signer reason to the mandatory bind; resolving that hook is not authorization. Bind runs the existing intrinsic allowance terminalizer first, so a killed or expired allowance remains terminalized, then returns the missing-signer refusal before its effect savepoint. Concrete credential faults retain their original immediate refusal/kill handling. There is no new caller-provided approval flag or inferred account identity. Fresh refusal creates no authority/effect and consumes no issued allowance. Existing concrete credential faults still persist their organization kill switch.

For an already-bound live attempt, this missing-authority reason must record `RECONCILIATION_REQUIRED` with `postSent:false`, retain the reservation and prevent a retry POST. It must not invent an exchange rejection or misclassify a credential as revoked. Mock and paper admission are unchanged. No credentials are decrypted and no venue/network order or production migration is performed.

## WP-2 — evidence

Retain a RED counterexample against the original live gate. Run actual local PostgreSQL cases with otherwise-valid synthetic facts through the full public service, direct bind and recovery, observing zero connector calls, unchanged fresh allowance/authority tables and held reservation on recovery. Preserve concrete bad-credential kill and mock/paper regressions. Refresh affected source pins without weakening graph admission; run required local readiness, native tests and independent review, then complete all required PR checks before merge.

## Acceptance

No current V2 live request can reach the connector using metadata-only admission. The missing authority is explicit, fresh requests have no execution side effects, and recovery truthfully retains already-bound reservations. This is a safe interim refusal, not selective signer binding, a rotation/revocation fence, production rollout, live readiness or closure of DEE-1156.

## Current validation evidence — 2026-10-01

- Preserved original-source RED evidence: otherwise-valid public live submit did not refuse missing signer authority and the final recheck reached the synthetic POST callback; the separate ISSUED allowance kill-terminalization regression passed. The focused gate unit regression also failed on the original reason set. These are synthetic local fixtures, not venue tests.
- Fresh isolated PostgreSQL 16.14 run of the complete `tests/integration/postgres-execution-v2.test.ts`: 70 passed, 0 failed, 0 skipped. The source and owned-test file hashes are recorded in `audit-ai-trader-2026-10-01/dee1161-signer-red/green4-final-receipt.json` outside the repository. It covers public submit, direct bind, kill terminalization, and existing-live no-POST recovery; no credentials or exchange calls were used.
- After PR726 merged, this branch was rebased onto main `2589bb3a`; all four owned production files and the native test remain byte-identical to the 70-case proof. That native evidence is inherited, not a fresh run on the rebased base.
- Focused live-gate, pre-POST, and signer-authority unit files: 43 passed, 0 failed or skipped on the rebased tree.
- `pnpm lint`, `pnpm typecheck`, `pnpm build`, and canonical-document validation exited 0 on the rebased tree. Both consumer graphs passed: Reality inventory 163 sources / 151 consumers / 26 connector references; Execution V2 reported no violations. The inherited new consumer path and the four changed production-file pins match current bytes; discovery rules and path digests are preserved.
- Independent review is complete. Exact-head GitHub CI is required after the rebased PR update. No production change, live activation, venue request, or migration 0229/0230 was performed.
