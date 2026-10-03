---
integrationIssue: DEE-1232
integrationTitle: "Bounded external HTX journal observations parser"
branch: dee-1232-external-journal-observations
riskTier: T2
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [targeted-unit, lint, typecheck, build]
approvalGates: [plan-approved, integration-ready, human-merge]
state:
  status: in-progress
  currentWorkPackage: WP-1
  completedWorkPackages: []
  remainingWorkPackages: [WP-1]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Publish independently reviewed offline parser in a draft PR; continue durable source/cursor and native binding acceptance without claiming issue completion."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1232 external journal observations

## Goal

Provide a self-contained pure server-side parser boundary for a future importer of external HTX executor JSONL. It produces versioned, whitelisted observations with trusted source scope and byte-level provenance. This package is observation-only and does not establish source authenticity or canonical trading facts.

## Included

- Incremental LF framing with absolute byte offsets, stable caller-supplied source generation identity, SHA-256 of exact record bytes, bounded chunk/line/event work, incomplete-tail withholding, and discard-through-LF recovery for overlong unterminated rows.
- A bounded JSON reader rejects duplicate/prototype keys and preserves numeric lexemes so large numeric order IDs do not round through binary floating point.
- UTF-8 and JSON diagnostics containing only code, byte offset, and byte length.
- Whitelisted event normalization for the statically inspected writer keys (`kind`, futures `contract`, spot `coin`); `coin` remains a base asset, not an invented quote pair. `event` is a compatibility alias, `type` is a legacy event alias only when canonical event keys are absent, and `symbol` is a compatibility alias for the contract field. Conflicting `kind`/`event` or `contract`/`symbol` values suppress the row. An untrusted or absent market remains `unknown` unless supplied by the trusted source descriptor.
- Estimated source PnL remains explicitly external and never becomes a canonical fill, realized result, or billing input.
- Synthetic hostile-input and framing tests.

## Excluded

No durable cursor, concurrent writer protocol, DB/schema/migration, importer route, UI, network/API access, credential use, venue/account binding proof, current-key verification, trade control, or canonical fill/reality/billing admission. No real journal or account data is committed.

## Acceptance

- Synthetic futures records using `kind` and `contract`, and spot records using `kind` and `coin`, normalize to the trusted market scope. Spot records without a payload `market` stay spot only when the separate trusted source descriptor says spot; `coin` is emitted as an asset field.
- A trusted futures scope rejects `coin`; a trusted spot scope rejects `contract` and its `symbol` alias; a row with both contract and coin forms is rejected. An `unknown` source remains explicitly unknown and all output remains an external observation, not market-verified truth.
- Conflicting `kind`/`event` or `contract`/`symbol` aliases produce sanitized diagnostics and no observation. With canonical `kind` present, spot `type` order details such as `limit` never replace the event kind.
- Append framing preserves byte offsets and record hashes, withholds partial UTF-8 rows, discards oversized rows through LF across chunks, and rejects duplicate JSON keys, malformed UTF-8/JSON, hostile scope/cursor objects, and configured bound overrides safely.
- Large numeric order identifiers preserve their original digits. Late event timestamps retain file order and do not control cursor advancement.
- Estimated external PnL remains explicitly non-canonical; output includes only whitelisted fields. This slice does not claim complete historical field coverage or any production import guarantee.
- Run targeted Vitest and formatting checks plus repository lint, typecheck and build for PR readiness. The full unit suite is authoritative in PR CI and is not repeated locally solely to duplicate it.

## Open before production use

1. Durable cursor transaction, concurrency control, restart/replay rules, and source rotation/truncation recovery.
2. Current venue proof binding trusted source to WAIA organization/account, HTX UID, market, API mode, and credential revision.
3. Event schema/version compatibility against an authorized live delivery contract.
4. Identity and coverage reconciliation against venue order/fill identifiers before any confirmed display status.

## State

This plan covers only the isolated parser and framing tests. Passing its tests does not satisfy DEE-1232 production acceptance.
