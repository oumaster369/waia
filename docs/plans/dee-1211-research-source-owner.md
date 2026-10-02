---
integrationIssue: DEE-1211
integrationTitle: "AI-TRADER: issue and consume observed DEVELOPMENT research source runs"
parentIssue: DEE-1159
branch: dee-1211-research-source-owner
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, isolated-postgres, github-pr-ci]
requiredValidation: [lint, typecheck, build, targeted-unit, native-postgres, validate-canon, consumer-graphs, independent-review, required-ci]
approvalGates: [user-authorized-engineering, independent-review, required-ci, no-production-migration, no-live-activation]
state:
  status: in-progress
  completedWorkPackages: [WP-1, WP-2, WP-3]
  remainingWorkPackages: [WP-4]
  nextAction: "Complete independent acceptance and published-head CI on the actual-main branch. Preserve prior diagnostic-only readers."
provenance:
  createdFrom: "Root design and independent source-owner review, 2026-10-02; explicit autonomous engineering authorization"
  supersedes: null
---

# DEE-1211 — observed DEVELOPMENT source preparation

This plan was first authored against the then-prepared DEE-1203 dependency
branch; it is now rebound to actual main `98a591c896d7e91ee10a0314b1b42b08afeebf5d`
after PR737 (DEE-1207) merged. The implementation integrates only after its
reviewed prerequisites; their old prepared branches are not copied into this
issue. This is one source preparation and consumption boundary, with
several work packages and one PR. It is not an Integration Train or permission
to retroactively combine already implemented issues.

## Contract

An operator's requested source run, checksum or release is a selection request,
not an observed source authority. A closed internal writer must load the actual
qualified DEVELOPMENT snapshot, bind its observed identities, and commit the
issued source and sealed rows together. The new issued-attempt path consumes
that immutable record and rereads it with the actual rows. Existing diagnostic
records retain their explicit engineering-only meaning and are not upgraded.

Reuse the existing FHV source loader and historical dataset writer. Accept one
symbol and one contiguous observation-plus-training DEVELOPMENT window of at
most 10,000 cycles, the existing loader cap. The existing writer prohibits
adding a non-identical second DEVELOPMENT range to the same run; retain that
law. The first slice is bounded, not a full-corpus streaming claim. Count and
byte bounds are operational limits, never scientific sample thresholds.

## WP-1 — closed issuer and atomic persistence

- Capture exact organization, command, symbol, selected range and observation/
  train split before awaiting. Derive the source run ID from the scoped command;
  never accept arbitrary caller-owned source IDs or issuance callbacks.
- Resolve the running release through the existing deployment contract. Load
  only the official-layout DEVELOPMENT file through actual qualification,
  requalification, full-stream hashing and volume checks. No raw-bars fallback,
  caller-built receipt or WAL/validation/blind selector supplies this path.
- Use dedicated `waia_research_source_writer_login` (NOINHERIT, no object
  ownership or direct grants) with exactly the `waia_research_source_writer`
  role. Its synthetic grants cover only source rows/issuance for the existing
  fixed Org0 `3c50b4e9-1138-43a5-a29f-e65088124cfc`; other organizations refuse.
  This first internal-research scope changes neither trading allowlists nor
  the existing historical runner role. Browser/general roles receive no grants.
  One driver-pinned owned root SERIALIZABLE transaction binds the existing dataset
  service to that same handle. The existing AsyncLocalStorage transaction helper
  joins nested same-handle operations without committing/retrying independently;
  prove that fact by native rollback rather than introducing a second commit.
- Bind observed qualification/requalification identities, raw and semantic
  partition digests, volume receipt, actual ordered row set, absolute indices,
  timestamps, split and running release into an append-only source issuance.
  Use a synthetic unnumbered SQL draft outside the production journal. Restrict
  write roles; do not grant browser/general roles source issuance authority.
- Same-command retry returns only the exact committed issuance and rows. A
  changed selection, source or release refuses. Concurrent owners serialize.
  Rollback leaves neither rows nor issuance. Lost commit acknowledgment permits
  fresh exact lookup, never false success or blind execution.

## WP-2 — issued attempt and snapshot reader

Add a separate `trader_research_issued_attempts_v2` record with an explicit V2
schema discriminator, composite organization/spec FK and organization/source/
issuer-digest FK. Its registrar verifies source/spec bindings inside one root
transaction; the legacy attempt table cannot masquerade as this record. The
source ID only selects an existing trusted record. Read its
issuance, experiment, attempt and exact source rows under one read-only snapshot;
verify count/bytes, ordered indices, bar/seal/volume digests, symbol, interval,
observation cutoff and train identity. Reject missing, altered, foreign or
caller-minted issuance, including internally resealed source rows.

Existing engineering-only diagnostic APIs and stored records remain readable.
They cannot satisfy the new issued-source contract or be silently promoted to a
qualified stage. No scoring, winner selection, validation/WF/blind or capital
permission is introduced by successful registration or loading.

## WP-3 — real default-off preparation entrypoint

Wire an explicit source-preparation mode through the existing operator discovery
CLI, before constructing the generic Drizzle client or ordinary orchestrator.
The owner resolves its dedicated connection and deployment release from the
host, not from caller assertions or an attestation string. It produces a
truthful source-preparation receipt and bounded observation
slice, then stops before scoring. Merely passing bars to the current discovery
orchestrator would still leave closed-trade/admission requirements unresolved;
do not disguise that as a complete hypothesis-to-strategy pipeline. The ordinary
default-off behavior remains and no enabled scheduled caller is added.

## WP-4 — adversarial proof and independent audit

Use a fresh synthetic official-layout fixture and actual restricted DB login.
Prove the real owner, immutable record, issued registration and read route,
not only pure digest helpers. Cover wrong login/current role/org, missing or
forged source, changed raw bytes/release/volume/ranges/cutoff, row resealing,
cross-source retries, real two-connection races, rollback between row/receipt
writes and lost COMMIT acknowledgment. Denied paths must produce no authority
or dependent payload. Preserve original counterexamples and all failed runs.

Run affected units, real synthetic PostgreSQL and a strict zero-skip native CI
gate, lint/typecheck/build, canon and both consumer graphs. Keep source pins and
actual-base identities honest. Independent adversarial review and every
applicable exact-head CI check precede merge; no redundant full local suite.

## Qualification and release limits

The accepted trust boundary is the restricted internal writer; no new PKI is
required. Its record proves the source snapshot actually loaded and the applied
closed-bar/index rule. Historical bar close is not proof of historical exchange
publication time: retain `PIT_SOURCE_AVAILABILITY_NOT_ESTABLISHED` unless separate
known-at evidence exists. Source issuance does not attest the complete research
code tree or establish scientific validity, profitability, Guardian readiness,
selection, blind authorization or capital authority.

No real FHV/C3/validation/WF/blind payload, exchange action, key mutation, financial
threshold, production migration or deployment is in this issue. Production0229
remains prohibited and0230 deferred. The broader DEE-1159,646,1139 contracts stay
open after this bounded source boundary until their own acceptance is proved.

## Implementation checkpoint (2026-10-02)

WP-1–3 implementation is complete on a prepared dependency tree; WP-4 remains
open for final source/gate acceptance, actual-base integration and exact-head CI.
Contract24, bounded receipt4 and final loader/CLI28 assertions passed. Typecheck,
lint (0 errors; existing warnings), build and canon passed. These are bounded
engineering checks, not scientific qualification.

The first native runs exposed JSON-string encoding and a disconnected reserved
COMMIT rollback. Both RED reports are retained. The private driver-managed root
transaction now validates its authenticated login and exact role ACL before
SET LOCAL ROLE, and existing ALS bindings keep nested dataset writes in that
transaction. An actual fresh-connection lookup handles uncertain COMMIT; when
that lookup is unavailable, no issuance or observation payload is returned.

The expanded actual PostgreSQL16 suite passed19/19 with no skipped/pending/todo
or failed tests, including six privilege poisons, real concurrent connections,
write rollback, lost COMMIT and unavailable recovery, caller mutation, invalid
volume/cutoff/cross-source bindings and an internally resealed dataset row.
All1826 captured functional source pins remained unchanged during this run.
This is source-bound proof from a dirty prepared worktree, not exact-head CI.
Native artifacts and earlier failures are in the October audit directory under
`dee1211-native-v1`. The mandatory CI gate must verify actual file identities
and named cases without confusing Vitest nested-suite counters with file count.

Independent source review also reproduced final/intermediate file symlink
substitution. The new capped loader refuses symlink components and nonregular
files, opens a checked file descriptor and preserves legacy uncapped behavior.
This structural check assumes a trusted host; it does not claim an OS sandbox
against a malicious process racing directory replacement.

Development used reviewed DEE-1203 head `cf76b113` as an explicit prepared parent.
PR736 subsequently merged as7b0a9b72; only this issue's owned commits may rebase
to actual main, retaining source and evidence identities. DEE-1207 still
precedes publication. Graph inventories, CI-trigger coverage and final
independent review remain to be closed. SQL remains an unnumbered synthetic
draft; no real payload, production migration, release or trading is involved.


The four owned plan/implementation/fault-proof commits were rebased onto actual
main7b0a9b72 without conflicts; the resulting tree is byte-identical to the
reviewed pre-rebase tree. The native test's final SQL result type annotation
is erased: the captured prior test bytes and current bytes emit identical
JavaScript, while all1825 other native pins remain exact. This bounded transfer
is recorded separately; it is not a new database execution. Final targeted
unit/graph/gate assertions pass100/100. The CI report guard now accepts the
actual one-file/two-nested-suite native report, and the isolated source-proof
service explicitly uses local-only trust authentication for the synthetic
restricted login. No production authentication setting is changed.

Historical checkpoint before PR737 merged: actual-main rebinding, independent
acceptance and published-head CI were pending. The current actual-main state is
recorded in the update below.


## Actual-main readiness update (2026-10-02)

The DEE-1211 commits were rebased onto actual main
`98a591c896d7e91ee10a0314b1b42b08afeebf5d` after PR737 merged. The old
prepared head was `4986eefb8abd7145fd813b2a12039ca3f7313b81`; current prepared
head is `71acdad1d6d432751a917249e6eb69f3bb74f9ab`. The rebase completed without
conflicts; the current uncommitted delta is limited to this plan update. Range-diff
matched the six owned commits, with an inherited PR737 workflow trigger retained.
This does not claim the older native proof
is byte-identical to the rebased source: comparison against its 1,826-file
source receipt found four changed pinned paths (the modeled-stage kernel,
training diagnostic, training policy and source-owner native test). The
19/19 PG16 run remains historical, synthetic, and bound to its captured tree;
no native rerun was performed for this actual-main preparation.

On this actual-main head the seven focused source-owner, CLI, reader, proof
guard and consumer-graph unit files passed 102/102 assertions, 15/15 suites,
with zero failures/pending/todo. Lint, typecheck, production build, canonical
plan validation, Reality graph, Execution graph and `git diff --check` passed.
Lint reports 331 warnings and zero errors, consistent with the repository
baseline. The detailed command receipts are in `dee1211-after737-readiness`
under the October audit directory. Independent current-base review and exact
published-head required CI remain outstanding. This is not source/PIT or
scientific qualification and does not authorize production migration,
deployment or trading.
