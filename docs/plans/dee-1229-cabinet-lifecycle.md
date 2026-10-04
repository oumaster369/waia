---
integrationIssue: DEE-1229
integrationTitle: "Personal account connection lifecycle"
branch: dee-1229-cabinet-lifecycle
riskTier: T2
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [targeted-unit, mounted-e2e, lint, typecheck, build, canon, pr-governance]
approvalGates: [independent-review, exact-head-ci, fresh-merge-admission]
state:
  status: in-review
  prNumber: 764
  prUrl: https://github.com/oumaster369/waia/pull/764
  lastValidatedGitSha: c94d69cb69db3c999f5f4d692f6e4fd34d5fda2b
  nextAction: "Verify concurrent-tab recovery fixes, pass all applicable CI, and refresh exact-head independent review including inline review threads before merge admission."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1229 — personal account connection lifecycle

## Problem and scope

The cabinet currently picks the first active credential and cannot expose the existing DEE-779 replacement and disconnect operations. A user with multiple connections cannot choose which account to inspect. The cabinet also does not explain the distinction between replacing a WAIA connection and changing an API key on HTX.

Implement a stable account selector, explicit replacement and disconnect controls, Russian lifecycle labels and errors, and pending-operation isolation. Use the existing authenticated server contracts and their optimistic replacement guard. Preserve history and masked secrets. No database, authentication, trading authority, exchange mutation, or visible organization configuration changes.

## User behavior

- Registration and connection stay within the personal cabinet; no organization setup step.
- Selecting an account selects only that account's stored observation. A delayed response from the previous selection cannot change the current view.
- Adding a connection does not silently replace an existing active credential. Explicit replacement supplies the selected credential ID to the existing server guard.
- Replacing or disconnecting changes WAIA's stored connection only. It does not revoke the HTX API key or stop an external executor. The replaced record remains in history.
- One active key per organization, venue and account remains the server contract. This change does not add a second simultaneous observation key or authorize trading.
- After a timeout or partial enrollment error, refresh metadata once without attributing another tab's new credential to this request. An active replacement retains its requested account; an ambiguous new connection or revoked-account reconnect requires an explicit account choice, even if only one account is returned. Do not automatically resubmit secret-bearing requests.
- Disconnect confirmation is bound to the exact credential ID. A replacement on another tab requires fresh confirmation before that replacement can be disconnected. Replacement editing and disconnect confirmation cannot remain open together.
- Secret inputs clear after successful submission, cancellation or changing the target; never enter browser persistence, URLs, logs or snapshots.

## Acceptance

Targeted tests cover selection, duplicate clicks, delayed completion after selection/unmount, active/revoked states, replacement target, cancellation, list failures and partial connection outcomes. Local browser fixtures cover mobile layout, keyboard interaction and the confirmation flow. Client request tests assert exact replacement and revoke requests, same-origin credentials, safe errors and no secret echoes.

Run scoped tests, lint, typecheck and build. Full unit validation belongs to PR CI. Independent review must inspect the exact final commit. A blocked authenticated production browser session is not evidence of production UI acceptance and must not be bypassed.

## Integration and remaining work

Risk tier T2: credential lifecycle UI and existing API consumers. No migration; production migration 0229 remains unchanged and 0230 remains deferred. Single-issue PR from `dee-1229-cabinet-lifecycle` to `main`.

DEE-1231 owns V5 data qualification and deployment. Simultaneous active observation and trading credentials inside WAIA require a separate purpose-bound design and security review. This UI change neither resolves that future launch requirement nor closes research, runtime or live-launch parent tasks.
