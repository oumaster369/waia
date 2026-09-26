---
integrationIssue: DEE-1117
integrationTitle: "Enforce exact manual reconciliation amounts and server-owned cooling"
branch: dee-1117-reconciliation-command-integrity
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation: [lint, typecheck, targeted-unit, build, validate-canon, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-progress
  currentWorkPackage: integration-readiness
  completedWorkPackages: [WP-1, WP-2]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: d249732623a479e0416b4f6dd8a10782b8f04021
  lastValidationAt: "2026-09-26T14:32:36.952352+00:00"
  blockedReason: null
  nextAction: "Independent accepted-base delta review, controller readiness and final-head publication/CI."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1117 — manual reconciliation command integrity

## Evidence and integration scope

On accepted main `ded58378b57b1cdc869f495905dcdf4d9a52d791`, the manual
reconciliation validator compares invoice fee and settlement value as strings.
A stored fee `30` and confirmed settlement value `30.000000` are numerically
equal under existing zero-tolerance matching, but manual proposal/execution
reject them. Independently reproduced D31/PS04 is a false refusal, not proof of
an underpayment or a production incident.

Separate D32 exposes an internal cooling override through both HTTP backend
branches. Numeric `coolingOffMs: 0` replaces even a configured server delay, and
a negative value backdates the proposal deadline. The common execution guard
then permits immediate resolution with the remaining decision/lease/confirmation
checks intact. ADR0016's S3-C-B addendum requires server-authoritative cooling;
this package restores that existing boundary. It is distinct from invoice
issuance's snake_case parameter fixed by DEE1112.

## WP-1 — exact amount equivalence without rewriting financial evidence

`reconciliation-validation.ts::validateManualApplyTarget` retains the current
invoice existence, organization, account and ISSUED-state checks. Both amounts
must be strings containing at least one decimal digit and valid under existing
`risk/numeric.ts` syntax/8-decimal precision. Compare them with `compareDecimal`
and require exact equality. Invalid decimals use the existing invoice-not-eligible
domain error. There is no Number conversion, rounding, epsilon, scale conversion
or new amount cap. Return the original stored invoice fee unchanged; existing
proposal impact, application serialization and audit retain that financial text.

Valid zero/signed-zero and signed decimal equality preserve existing semantics.
No new positive-fee threshold is inferred from default fee configuration:
issuance requires billable canonical sources, but configurable thresholds do
not prove every possible historical invoice must be positive. This narrow
amount-equivalence correction does not qualify malformed source evidence or
ratify new invoices. Negative settlement versus a positive fee still refuses.

The accepted base's shared parser admits punctuation-only `.` and `-.` as zero
(separate DEE1114/D26). A local at-least-one-digit precheck rejects those values
on either side even before that unpublished parser repair is integrated.
No shared numeric implementation is changed or copied from another branch;
the boundary remains valid after the independent parser fix lands.

## WP-2 — server-owned reconciliation delay at HTTP admission

`reconciliation-workflow-handler.ts` preserves its existing signed-in and Trader
access decisions. After those checks and JSON parsing, any own `coolingOffMs`
property returns400 `COOLING_OFF_OVERRIDE_FORBIDDEN` before acquiring a runtime,
reading a case or writing effects. This includes zero, negative, short positive,
ordinary positive, enormous/nonfinite numeric JSON, null and non-number values.
Both SQLite and PostgreSQL proposal calls omit that field. A field omitted by a
normal caller retains the configured server delay or default900000ms.

Internal command overrides/injected clocks remain available for existing trusted
service tests; the server configuration/default is unchanged. Execution still
requires its live decision, sequence, lease holder, nonempty confirmation and
elapsed saved deadline. No new authorization role, state, resolution, automatic
execution or historical proposal repair is introduced.

## Acceptance and validation

Two production files only: the validator and workflow handler. Typed in-memory
repository fixtures carry synthetic evidence through actual proposal/execution
commands and actual handler branches; factories at the persistence/audit boundary
return inert ports. The tests do not connect to SQLite/PostgreSQL, invoke a
provider, or change a real payment/account. They establish input/effect ordering,
not database isolation, crash recovery or source authenticity.

- Exact30/30.0/30.000000 equality; original fee text and application content/digest
  preserved; near misses at one 8-decimal unit and neighboring values above
  Number's safe integer range refused without tolerance.
- Malformed strings on both sides (including identically malformed pairs),
  absent/untyped values and excess scale refuse. Very large valid decimals stay
  exact; no arbitrary business maximum is added. Existing tenant/account/status
  and absent-invoice refusals remain.
- Real manual proposal/execution preserve opened evidence, server/internal
  cooling, confirmation, current decision, application content and idempotent
  retry (one in-memory application/PAID effect). Execution revalidates an invoice
  whose amount changed after proposal, refusing before an application.
- Actual workflow handler for both backends rejects every supplied own delay
  before runtime/repository/audit calls. Auth401/403 precedence, missing case404,
  stale version/lease409 and default/env cooling remain. Normal omitted-field
  manual flow passes using both equal and trailing-zero representations.

Baseline focused tests: **45 RED / 33 PASS**, after isolating amount and delay
controls so the amount mismatch cannot mask the old delay forwarding. Fixed
focused tests: **78 PASS in two files**. Combined targeted acceptance with six
pure existing matching/numeric/reconciliation companion suites: **163 PASS in
eight files**. Scoped lint passes. Root coordinates full lint/typecheck/build/canon/governance, source
consumer checks, any required native companions and exact-head CI. The existing
native reconciliation workflow parity suite remains unchanged and is not
claimed executed by the author.

Commands for controller/CI verification:

```sh
pnpm test --run tests/unit/reconciliation-exact-manual-amounts.test.ts tests/unit/reconciliation-workflow-cooling-admission.test.ts tests/unit/settlement-matching.test.ts tests/unit/trader-risk-numeric.test.ts tests/unit/reconciliation-serialize.test.ts tests/unit/reconciliation-priority.test.ts tests/unit/reconciliation-fold-replay.test.ts tests/unit/reconciliation-transitions.test.ts
pnpm lint
pnpm typecheck
pnpm build
pnpm validate:canon
pnpm validate:pr-governance
```

## Do NOT / remaining limits

No rate, HWM, fee threshold, settlement allocation, tolerance, finality, cooling
duration or ADR changes. No invoice/payment/settlement/event history is rewritten.
No new refund, partial allocation, activation, venue, credential, role, production,
C3 or scientific authority action. Transaction boundaries and append-only/
exactly-once persistence protections remain unchanged. Full P08 remains open;
these input-boundary tests do not prove every reconciliation writer is atomic
or that historical proposals have valid timing/source evidence. Non-author
review and final-base/root readiness precede publication; author creates no PR,
push, merge, deployment or shared checkpoint update.

## Root local acceptance

On accepted base `ded58378`, 179 targeted tests in ten files pass, including
the existing SQLite command and sweeper companions. Five actual PostgreSQL
tests in the two existing workflow/reconciliation parity suites pass with zero
skips on the guarded local profile. No migration or fixture history repair was
performed. These companions establish compatibility, not new crash/atomicity
coverage. Full lint, typecheck, build, canon, governance and both consumer graphs
pass. Independent review of frozen author `77f45459` found no bounded blocker:
1,521 decimal pairs matched an independent oracle, and separate actual-handler
admission, scope/configuration controls and 78 focused cases passed. Final-base
integration, rendered-body preflight and exact-head CI remain publication gates.

### Accepted-base integration — 2026-09-26

Reviewed candidate `8ba5233eb9fac1d5e64464220f474ede5fd2501a` was merged with exact
accepted main `ed2a25f72008a97211c9454fd29d4f62a65508b2` as
`985c7c755f899e583b81194e5e8f0e551de036b0`, without conflict. The six author paths
and 11 incoming billing/CI paths do not overlap. Blob and binary-diff comparisons
prove both patches unchanged at the merge. This follow-up changes only the plan.

Current scoped acceptance passes 192 tests across eleven suites: the original
179 cases plus 13 executed-proof guard cases. Scoped ESLint and diff checks pass.
All 12 mandatory PostgreSQL suite registrations and their test blobs are
preserved exactly. Registration preservation is not a native execution result.

The five native cases remain evidence executed on author head
`77f454590327418e1b27891489d5b45c39744d60`, documented above. They were **not rerun**
for this integration. A bounded source comparison finds all 248 repository files
in the two suites' runtime-import closure unchanged, including literal dynamic
imports, with no unresolved or nonliteral runtime imports. Schema/migrations,
dependency lock and test setup are also unchanged. An initial conservative scan
including erased type dependencies encountered unrelated dynamic imports; it is
preserved separately, not relabeled as a complete runtime proof. Source equality
does not assert a new environment or execution result.

Both suites' existing connection guard requires the canonical local
`waia_validate` profile; a differently named fresh database cannot satisfy it.
The canonical profile has a known 0218 table/registry-through-0217 mismatch.
One read-only identity/count/presence check confirmed it; no migration, registry
repair, guard change, fixture write or new database was performed. Controller
retains the prior native proof with these limits and owns current full readiness
and authoritative final-head CI. No financial/scientific/settlement readiness is
inferred from this integration.

### Accepted-base refresh to 2565e1a2

Normal merge `a24cb3577d50907b9004cbe6d7f3d673c1726aef` incorporates exact
accepted main `2565e1a23741d0042096fd8209cd9793e8aa7e19` into reviewed
`fd932c2e6eacb4198f80ef6cfe3bee6cd11d6956`, without conflicts. All six author
paths and six incoming PR675 paths retain exact blobs at merge, and complete
binary patches match in both directions. The final evidence update changes only
this plan; the five author production/helper/test blobs and all incoming files
remain exact. All 13 incoming mandatory native registrations and suite blobs
are preserved, without representing a new native run.

At that merge head, **193 targeted unit assertions / 11 files PASS, zero skips**:
the original 179 cases plus 14 current executed-proof guard cases. Scoped ESLint
and diff checks pass. Separate author logs, JSON results and immutable-source
proof are under `evidence/dee-1117/accepted-base-2565e1a2/`; historical root logs
remain intact. Current full lint/type/build/readiness is root-owned and pending.

The runtime-import comparison was rerun against the new immutable merge: all
248 dependency blobs still equal the original native-tested `77f45459`, with no
unresolved or nonliteral runtime imports, and unchanged schema/migrations,
package lock and test setup. This is static source preservation only. The five
PostgreSQL assertions in two suites remain historical evidence at `77f45459`;
no native test, database connection, canonical-profile inspection or fixture/
registry mutation occurred during this refresh. The previously documented
canonical mismatch is neither repaired nor newly measured here. Current
independent delta review and exact-head CI remain required; no new financial,
scientific, settlement or production-readiness claim follows.

### Accepted-base refresh to 1a59b31b

Normal conflict-free merge `d249732623a479e0416b4f6dd8a10782b8f04021`
incorporates exact accepted main `1a59b31b620af81b727d28b24f3ddbf9cb953074`
into reviewed `dd68bb0bdef7f1e9c90e84e1350d3f5e5cc6bc71`. The six author
paths and 14 incoming paths are disjoint. Complete binary patches match in both
directions and all changed blobs are preserved. This evidence update changes
only the plan; the five original production/helper/test blobs remain unchanged.
All 15 incoming mandatory native suite registrations and test blobs are exact.
Registration preservation does not represent a new native execution.

At that merge, **195 targeted assertions / 11 files PASS, zero skips**: the
original 179 cases plus 16 current executed-proof guard cases. Scoped ESLint
and diff checks pass. The separate author raw logs, JSON results and immutable
source manifest are in `evidence/dee-1117/accepted-base-1a59b31b/`. Current-base
full readiness, nonauthor delta review and authoritative final-head CI remain
root-owned gates; no full typecheck/build/global suite ran in this refresh.

A source-only runtime-import comparison again finds the same 248 dependency
blobs unchanged from native-tested `77f45459`, with no unresolved/nonliteral
runtime imports or schema/migration/lock/test-setup delta. An initial invocation
from the audit directory could not resolve repository aliases; its failure and
partial report are preserved as `*-wrong-cwd.*`. Re-running the unchanged
comparison from the repository resolved all aliases. This was a tooling working-
directory correction, not a product failure or a native test run.

The five native assertions in two suites remain inherited execution evidence
at `77f454590327418e1b27891489d5b45c39744d60`. No database connection, native
suite, profile inspection, fixture/registry write, provider, production, C3 or
real financial action occurred here. The earlier canonical-profile mismatch
remains neither repaired nor remeasured. Static source equality does not prove
a fresh database/runtime environment, arbitrary dynamic loading, full P08 or
settlement readiness.
