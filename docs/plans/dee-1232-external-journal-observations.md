---
integrationIssue: DEE-1232
integrationTitle: "Bounded external HTX journal observations and local durable storage"
branch: dee-1232-external-journal-observations
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [targeted-unit, lint, typecheck, build]
approvalGates: [plan-approved, integration-ready, human-merge]
state:
  status: in-progress
  currentWorkPackage: WP-DURABLE-STORAGE
  completedWorkPackages: [WP-1, WP-DURABLE-STORAGE]
  remainingWorkPackages: [WP-QUALIFIED-SOURCE, WP-MIGRATION-RUNTIME]
  prNumber: 763
  prUrl: https://github.com/oumaster369/waia/pull/763
  lastValidatedGitSha: bdffaf29e78ec63d90f7e06144f191a020b394cc
  lastValidationAt: 2026-10-08
  blockedReason: null
  nextAction: "Publish the qualified local package in existing draft PR763; qualify source delivery/current binding and correctly ordered migration/runtime admission before activation."
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
- Separate terminal quarantine records carry trusted source scope, generation/offset/length and a digest of bounded malformed bytes without retaining raw content. Oversized records finish only at LF or explicitly closed EOF, carry their final byte length and a null digest because earlier discarded bytes are not retained. Unfinished-line diagnostics and non-consuming configuration/limit faults are never terminal records.
- Whitelisted event normalization for the statically inspected writer keys (`kind`, futures `contract`, spot `coin`); `coin` remains a base asset, not an invented quote pair. `event` is a compatibility alias, `type` is a legacy event alias only when canonical event keys are absent, and `symbol` is a compatibility alias for the contract field. Conflicting `kind`/`event` or `contract`/`symbol` values suppress the row. An untrusted or absent market remains `unknown` unless supplied by the trusted source descriptor.
- Estimated source PnL remains explicitly external and never becomes a canonical fill, realized result, or billing input.
- Synthetic hostile-input and framing tests.

## Parser package exclusions

No durable cursor, concurrent writer protocol, DB/schema/migration, importer route, UI, network/API access, credential use, venue/account binding proof, current-key verification, trade control, or canonical fill/reality/billing admission. No real journal or account data is committed.

## Acceptance

- Synthetic futures records using `kind` and `contract`, and spot records using `kind` and `coin`, normalize to the trusted market scope. Spot records without a payload `market` stay spot only when the separate trusted source descriptor says spot; `coin` is emitted as an asset field.
- A trusted futures scope rejects `coin`; a trusted spot scope rejects `contract` and its `symbol` alias; a row with both contract and coin forms is rejected. An `unknown` source remains explicitly unknown and all output remains an external observation, not market-verified truth.
- Conflicting `kind`/`event` or `contract`/`symbol` aliases produce sanitized diagnostics and no observation. With canonical `kind` present, spot `type` order details such as `limit` never replace the event kind.
- Append framing preserves byte offsets and record hashes, withholds partial UTF-8 rows, discards oversized rows through LF across chunks, and rejects duplicate JSON keys, malformed UTF-8/JSON, hostile scope/cursor objects, and configured bound overrides safely.
- Accepted observations plus terminal quarantines share the bounded record budget. A rejected batch returns the original cursor and neither record kind, including after restart, discard recovery and a reduced line limit; retrying a smaller chunk cannot silently lose or duplicate a rejected record. Whole-file and split-chunk framing produce identical terminal provenance.
- Large numeric order identifiers preserve their original digits. Late event timestamps retain file order and do not control cursor advancement.
- Estimated external PnL remains explicitly non-canonical; output includes only whitelisted fields. This slice does not claim complete historical field coverage or any production import guarantee.
- Run targeted Vitest and formatting checks plus repository lint, typecheck and build for PR readiness. The full unit suite is authoritative in PR CI and is not repeated locally solely to duplicate it.

## Open before production use

1. Apply the locally qualified durable storage only after ordered migration/runtime admission; connect it to a separately qualified source reader and supervised generation recovery.
2. Current venue proof binding trusted source to WAIA organization/account, HTX UID, market, API mode, and credential revision.
3. Event schema/version compatibility against an authorized live delivery contract.
4. Identity and coverage reconciliation against venue order/fill identifiers before any confirmed display status.

## State

The parser package was qualified at `6247cf85d0ab517d5d75bd1a8e7b9f0a1f082158`. Its implementation and tests are unchanged and are not re-run solely to duplicate accepted evidence. Passing parser or storage tests does not satisfy DEE-1232 production acceptance.

## WP-DURABLE-STORAGE — bounded local implementation

Root approved this successor on 8 October 2026 after the ordinary merge of current main into the existing worktree at `bdffaf29e78ec63d90f7e06144f191a020b394cc`. Scope is three dedicated sources/generations/append-only-records tables, a pure immutable preparation boundary and an explicitly injected PostgreSQL repository. No account-observation snapshot/pointer, canonical fill, Reality, Billing, PnL or trading route changes.

Owned implementation files:

- `lib/trader/external-journal/storage-contract.ts`: typed registry/lease snapshots, canonical metadata hashes, qualified-parser-owned record preparation, terminal quarantine handling and strict bounded refusal behavior. Callers cannot pass arbitrary normalized payloads. Raw chunks are not retained; the existing bounded pending cursor can contain partial source bytes.
- `lib/trader/external-journal/postgres-repository.ts`: restricted-login posture, current credential/source checks, credential/source/generation lock order, database-time leases, atomic records plus complete cursor CAS, exact retained-receipt replay and safely fenced integrity suspension.
- `tests/fixtures/external-journal-storage-contract.sql`: **UNNUMBERED LOCAL TEST CONTRACT ONLY**; three FORCE/ON RLS relations, separate NOLOGIN importer role, metadata-only credential access, assignment by `session_user`, acyclic policies, source lock-only privilege with importer-update refusal, nested payload whitelist and immutable record guards.
- `tests/unit/external-journal-storage-contract.test.ts`: preparation, restart, terminal quarantine, frozen snapshot, source-integrity refusal, EOF-only close, hostile getter/iterator and byte-commitment cases.
- Root separately owns `tests/integration/external-journal-storage-postgres.test.ts` and its isolated native PostgreSQL fixture/proof. Storage implementation itself never starts a database or reads a connection from the environment.

The repository exports `load`, `claim`, `commit` and `suspend`. Known refusals are explicit; a transaction/connection exception reports `EXTERNAL_JOURNAL_STORAGE_OUTCOME_UNKNOWN`, because a lost COMMIT acknowledgement cannot prove rollback. Reconcile the same prepared input: an exact retained receipt and exact records can return REPLAYED; a later cursor without that retained receipt is REPLAY_UNRESOLVED. Changed bytes/payload at a retained identity refuse and suspend only the current owned generation, never a successor worker. A conflicting retry against an already CLOSED generation remains refused with `generationSuspended: false`; CLOSED already prohibits consumption. Oversized quarantine NULL hashes do not establish historical byte identity; only the exact prepared batch byte commitment proves retry of that same input.

Preparation rejects accessors/proxies, snapshots caller metadata, copies typed bytes through intrinsic operations and refuses shared buffers. It never accepts caller records. An ordinary empty no-progress read refuses; independently evidenced EOF can close an empty or newline-terminated ACTIVE generation with an atomic cursor-version transition.

### Acceptance and current status

Implementation is locally qualified on 8 October. The 22 new preparation tests and 26 distinct native PostgreSQL 17 cases passed; full lint (zero errors, 337 existing warnings), typecheck and fresh build passed. The unchanged parser suite was not replayed. Independent implementation review resolved four findings and inspected final native deltas. Native proof uses two real restricted LOGINs with verified TLS on a disposable loopback-only database; none of these results is production/source-delivery acceptance. Native acceptance must use real restricted LOGINs against a newly owned isolated service; superuser `SET ROLE` does not prove assignment isolation. Required native cases include cross-login/source denial, stale/revoked binding, lease race/expiry, failed-insert rollback, final-CAS rollback, exact ambiguous retry, conflicting retry, no secret-column/registry-update/record-update/truncate access, and complete pending/discard restart.

**Migration HOLD:** current main has 232 Drizzle entries through `0231`; PR759's future `0232` remains reserved/HOLD. This package allocates no number and changes neither `db/schema.postgres.ts` nor either migration journal. Final schema/migration packaging must await root's correct integration ordering and separate migration admission.

**Runtime/source HOLD:** no source reader, live journal channel, enrollment verifier, credential/key access, archive execution or production integration is implemented. `sourceEvidence.prefixVerified` is an explicit input contract for a future qualified source reader, not cryptographic proof or a newly established live source. Its `observedAtMs` is in the database clock domain; host `Date.now()` is not assumed synchronized, and future evidence is strictly refused. A future reader must qualify that clock mapping. File identity alone cannot prove an unchanged prefix; truncation/rotation refusal and current key/UID/API-mode binding still require independently qualified source evidence. Enrollment and generation creation remain operator-owned. No live history, complete history, day PnL, stop protection or production readiness claim follows from this package.

Native validation additionally exercised source re-verification while a commit waited, a conflicting old retry while a successor lease remained live, a direct nested-payload violation reaching SQL CHECK 23514 under a valid importer lease, and source-proof expiry during insertion while the collection lease remained live. Earlier setup/test-fixture failures are retained separately. The final 26-case result is composed from the initial 22-case pass and four added-case passes; unchanged tests were not repeatedly run.
