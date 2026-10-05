---
integrationIssue: DEE-1235
integrationTitle: "Explain HTX permission refusal during partner connection"
branch: dee-1235-connect-permission-error
riskTier: T2
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [targeted-unit, mounted-e2e, lint, typecheck, build, canon, pr-governance]
approvalGates: [independent-review, exact-head-ci, fresh-merge-admission]
state:
  status: implementing
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  nextAction: "Validate the exact refusal and successful Read-only path, review, then prepare the bounded corrective release."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1235 — explain HTX permission refusal

## Confirmed problem

On 5 October a partner reported a generic connection failure and the Human confirmed a Read + Trade key. The deployed HTX validator accepts that permission set, but credential storage rejects it when the existing organization live switch is not enabled. The rejection appears as INTERNAL_ERROR. No newly stored credential was observed during incident triage. The reported account identity has not independently been correlated to a server request, so unrelated authentication events are not incident proof.

## Bounded correction

After the existing current live-state read, classify the already-required refusal as READ_ONLY_KEY_REQUIRED before calling storage. Keep the original service storage guard intact. Give a clear Russian explanation that this connection requires a separate key with Read only and that an existing trading key must remain unchanged. Do not suggest enabling live trading to bypass this refusal.

No credential admission expansion, schema change, role/grant change, live enablement, exchange mutation, collector behavior, replacement behavior, or secret exposure is authorized by this correction. Permission metadata still comes from HTX validation, never a client-supplied assertion. Existing enabled-live behavior remains unchanged.

## Acceptance

- A validated Read + Trade key with live disabled/absent receives the dedicated safe client error, with no credential insert, replacement, revoke, or credential audit write.
- A Read-only key still reaches normal encrypted storage and metadata-only success.
- Mounted cabinet shows the specific guidance, clears submitted secrets, refreshes metadata once and never automatically resubmits keys.
- Existing trade-scope storage and tenant isolation checks remain effective.
- Focused unit, mounted Chromium, typecheck, lint, build, canonical and graph checks pass; independent review covers the final bytes.

Full local unit is intentionally not repeated; full applicable checks run in PR CI. A local synthetic success is not a claim that the partner connected in production. Actual storage and cabinet observation acceptance remain tracked by DEE-1227.

## Integration and migration memory

One T2 correction based on deployed/main 4fb4be88. Frozen PR762 and the local Overview delta remain separate and unchanged. No new infrastructure or pending rollout is admitted. Production migrations 0229 and 0230 are already applied; inventory0231 remains deferred. Production PAPER_LOOP_ENABLED=0 remains mandatory.
