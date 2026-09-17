---
integrationIssue: DEE-1018
integrationTitle: "Ordered post-H2 migration lane: fail-closed exact-one-step operator for 0209 and 0210"
branch: dee-1018-ordered-post-h2-migration-lane
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [focused-unit-tests, actual-postgres17-integration, h2-regressions, lint, typecheck, build, canonical-docs, pr-governance, independent-exact-diff-review]
approvalGates: [integration-ready, human-merge, separate-production-0209-ceremony, separate-production-0210-ceremony]
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-review
  currentWorkPackage: WP-4
  completedWorkPackages: [WP-1, WP-2, WP-3, WP-4]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: 2026-09-17
  blockedReason: null
  nextAction: "Human review and squash merge. Production 0209 and 0210 remain two separate Human-only ceremonies."
provenance:
  authoritativeBase: 4b6081342702e0322d0bda4c64f00cbf04704b4e
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1018 — Ordered post-H2 migration lane

## Exact starting point

Base SHA **`4b6081342702e0322d0bda4c64f00cbf04704b4e`** (`origin/main`), which is the DEE-1015 squash
merge that introduced `0210`. Fresh worktree/branch `dee-1018-ordered-post-h2-migration-lane`.

## Human Architect decision (2026-09-17)

The read-only audit found no single lawful multi-module rollout model in the repository and stopped
for a decision. The Human Architect ratified:

| Decision | Consequence |
|----------|-------------|
| **Selected model: ordered global post-H2 lane** | Production advances `0205 → 0206 → 0207 → 0208 → 0209 → 0210` and nothing else |
| Sparse `0210`-before-`0209` application is **rejected** | The operator refuses it structurally, not by convention |
| `0209_ai_twin_epistemic_persistence_v1` remains valid, canonical, unchanged | No renumbering, no journal surgery, no rewrite |
| `0210_trader_account_observation_credential_v1` remains valid, canonical, unchanged | Delivered unchanged; no defect was found |
| Production `0209` may later be authorized as **schema-only** | Applying it authorizes no AI-TWIN runtime, ingestion, writer, route, backfill or rollout |
| `0210` only after an exact successful `0209` | Enforced by the predecessor prefix and a catalog cross-check |
| Every post-H2 step needs a **separate Human ceremony** | One migration per invocation; no auto-advance |
| The H2 operator stays frozen at `0205..0208` | Not changed, not broadened, not re-pointed |
| `assertForecastV2AppliedMigrationIdentity` open-range fragility is a **follow-up finding** | Recorded below; deliberately not repaired here |

## Why the generic Drizzle path cannot be the production ceremony

Proven empirically on disposable PostgreSQL 17 during the audit, and the reason this operator exists:

| Fact | Evidence |
|------|----------|
| Drizzle selects unapplied migrations by a single `max(created_at)` high-water mark, not by strict prefix | `drizzle-orm/postgres-js/migrator`; probe scenarios A/B/C |
| From a live journal at `0208`, a generic migrate applies `0209` **and** `0210` in one uninterruptible run | probe scenario B — one command, two module lanes, one Human decision |
| If `0210` were ever recorded first, `0209` is silently skipped **forever** | probe scenario C: `0209` is below the high-water mark and is never considered again |
| Production apply is already "targeted SQL only" | [`db/AGENTS.md`](../../db/AGENTS.md) |
| H2 cannot carry these steps | `H2_STEPS = ["0205","0206","0207","0208"]`; its comparator refuses the `0209` identity outright |

## Acceptance

1. One canonical operator, `pnpm trader:post-h2:migrate`, supports exactly `0209` and `0210`, and
   refuses `0205`–`0208` (H2's lane), `0204`, `0211` and anything unparsable.
2. `0209` is admitted only against a live journal exactly through canonical `0208`; `0210` only
   against a live journal exactly through canonical `0209`.
3. Sparse `0208 → 0210` is refused, as are gaps, unknown or later entries, duplicate identities,
   wrong hashes, wrong timestamps, reordering, an already-applied step and incompatible catalog state.
4. No Drizzle high-water behavior, no `--latest`/`--all`/loop/auto-next; SQL is read from the pinned
   Git blob and one selected migration is committed atomically with its single journal row.
5. H2's evidence model is reused at full strength under a distinct schema and trust anchor, with
   `--verify-only` recovery and no retry after an uncertain `COMMIT`.
6. Migration-specific verification proves the DEE-871 `0209` contract and the DEE-1015 `0210`
   security contract before commit, both bound to pinned catalog digests.
7. `0205`–`0210` migration bytes, `_journal.json`, the H2 operator, AI-TWIN runtime mounting, C3 and
   FHV compatibility are unchanged; nothing is applied to production.

## WP-1 — Pinned identity and ordered prefix

`scripts/ops/postgres-post-h2-migration-manifest-v1.ts`: pinned `0209`/`0210` idx/when/tag/commit/
blob/SHA-256/predecessor, the ordered prefix builder over H2's own pinned closure, the post-H2
attestation schema and trust-policy path, and the exact ordered journal comparator.

## WP-2 — Exact-one-step operator

`scripts/ops/postgres-post-h2-migration-operator-v1.ts` and the `pnpm trader:post-h2:migrate` script:
CLI admission, target identity and authority checks, writer quiescence, locks, the atomic
SQL + journal transaction, `--verify-only` classification and the secret-free receipt.

## WP-3 — Migration-specific verification

DEE-871 `0209` and DEE-1015 `0210` catalog contracts plus their pinned catalog digests, executed
pre-commit and re-verified in a fresh read-only post-commit transaction.

## WP-4 — Tests and documentation

`tests/unit/postgres-post-h2-migration-operator-v1.test.ts`,
`tests/integration/postgres-post-h2-migration-operator-v1.test.ts`,
[`POST-H2-MIGRATION-OPERATOR.md`](../ops/POST-H2-MIGRATION-OPERATOR.md), and the Alpha 0 runbook
preflight note.

## State machine

| `--step` | Accepted live journal | Resulting journal |
|----------|----------------------|-------------------|
| `0209` | exactly `0000..0208` (209 rows) | `0000..0209` (210 rows) |
| `0210` | exactly `0000..0209` (210 rows) | `0000..0210` (211 rows) |

The predecessor prefix through `0208` is taken from H2's own pinned closure
(`loadH2CanonicalSource(repoRoot, "0208").expectedAppliedPrefix`), so the two lanes cannot disagree
about what "canonical through 0208" means. Refused: gaps, extra rows, unknown or later identities,
duplicate identities, wrong hashes, wrong timestamps, reordering, sparse `0210`, a second invocation
of an applied step, and incompatible catalog state.

## Source pinning

| Step | idx | when | source commit | blob | SHA-256 |
|------|-----|------|---------------|------|---------|
| `0209` | 209 | 1780000000209 | `b10f7edcb2187253355399ca5dfb82bac0177c12` | `baa60df0…` | `abed7b09…` |
| `0210` | 210 | 1780000000210 | `4b6081342702e0322d0bda4c64f00cbf04704b4e` | `302d215e…` | `1ab9f641…` |

SQL is read from the pinned Git blob, never from the mutable checkout; a PG17 test mutates the
working-tree file and proves the pinned bytes are executed and journaled anyway.

## Human evidence

The lane reuses H2's strongest semantics without touching H2: direct/session PostgreSQL only
(transaction poolers refused), a root-owned trusted-key policy file, four Ed25519 attestations
(restore point, writer quiescence, target identity, ceremony authorization) bound to one ceremony,
one request, one selected step and one exact target fingerprint, 15-minute freshness, owner-only
attestation files, explicit `--confirm-exact-step`, no retry after an uncertain `COMMIT`, and a
read-only `--verify-only` recovery classification.

The attestation schema is `waia.trader.post-h2.human-attestation.v1` and the trust policy lives at
`/etc/waia/post-h2-approved-human-key.sha256`. Both are deliberately distinct from H2's, so an H2
ceremony packet can never authorize a post-H2 step and vice versa.

## Verified migration contracts

`0209` (DEE-871): exactly the 18 `ai_twin_*` tables, the 4 immutable validators (none
`SECURITY DEFINER`), every `ai_twin_*` index belonging to one of those tables, all objects owned by
the migration authority, **zero** grants to any other role, no reachability for `authenticated`,
`anon` or `PUBLIC`, and the Trader `0205` observation surface left intact. The absence of grants is
what proves that journaling `0209` activates no AI-TWIN runtime: no runtime identity can reach the
tables.

`0210` (DEE-1015): exact `waia_account_observation_credential` posture (NOLOGIN, NOINHERIT,
NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE, NOREPLICATION, no memberships), exactly the
eight granted credential columns and three state columns, no whole-table credential `SELECT`, no
credential INSERT/UPDATE/DELETE, no observer or reader access to `encrypted_payload` or
`wrapped_dek_key`, both assignment-bound `FOR SELECT` policies present and never `USING (true)`, and
`FORCE ROW LEVEL SECURITY` still disabled on `exchange_credentials` per `0007`.

Both steps additionally pin an exact catalog digest, computed pre-commit inside the transaction, so
any drift rolls the step back.

## Non-goals

Not applying `0209` or `0210` anywhere; not touching production or a production database; not
executing H2; not changing `0205`–`0208`, `0209`, `0210`, `0007` or `_journal.json`; not deploying;
not touching C3; not calling real HTX; not mounting AI-TWIN writers, routes or ingestion; not
repairing the forecast open-range coupling recorded below.

## Validation

| Gate | Command |
|------|---------|
| Post-H2 unit suite | `pnpm vitest run tests/unit/postgres-post-h2-migration-operator-v1.test.ts` |
| Disposable PG17 lane | `WAIA_TEST_DEE1018_PG_ADMIN_URL=… pnpm vitest run tests/integration/postgres-post-h2-migration-operator-v1.test.ts` |
| H2 regressions | `pnpm vitest run tests/unit/postgres-h2-migration-operator-v1.test.ts` (+ owned-local H2 integration) |
| DEE-871 / DEE-1015 / FHV / tenant | AI-TWIN persistence, account-observation security, FHV preflight and tenant-isolation suites |
| Repository gates | `pnpm lint && pnpm typecheck && pnpm build && pnpm validate:canon` |

The PG17 lane is opt-in through `WAIA_TEST_DEE1018_PG_ADMIN_URL` and skips otherwise, matching the
owned-local H2 integration posture.

## Follow-up finding (recorded, not repaired)

`assertForecastV2AppliedMigrationIdentity`
(`lib/trader/intelligence/forecast-v2/forecast-v2-applied-migration-identity-v1.ts`) reads every
journal entry from `FORECAST_V2_STORAGE_MIGRATION_MIN` with **no upper bound** and requires each one
to be applied. Any later canonical entry from any module therefore becomes a Forecast V2
precondition, which couples the Trader forecast plane to unrelated module rollout — including
AI-TWIN `0209`. It does not block the ordered lane (the ratified order applies `0209` before `0210`,
so the terminal state satisfies it), so per decision 10 it is recorded as a separate post-Alpha 0
architectural follow-up and is deliberately unchanged here. FHV's own preflight
(`FHV_V2_POSTGRES_REQUIRED_MIGRATION_MAX = 207` plus a tolerated additive set) does **not** share the
defect.

## Second follow-up finding (recorded, not repaired)

H2's `0205` catalog snapshot selects `pg_auth_members` with
`WHERE member.rolname IN (…) OR granted.rolname IN (…)`, so any LOGIN identity later granted
`waia_account_observer` or `waia_account_observation_reader` — exactly what the DEE-1015 provisioning
operator creates — changes H2's expected digest. Reproduced locally: the owned-local H2 integration
suite fails `CATALOG_DIGEST_MISMATCH:0205` on a cluster carrying those provisioned logins and passes
8/8 on a pristine PostgreSQL 17 cluster. H2 is frozen and this branch changes none of its files, so
the behavior is recorded, not repaired. This lane deliberately scopes its own membership snapshot to
`member.rolname` only, and its two digests were verified identical on both a pristine cluster and one
carrying the provisioned observation logins.

## Independent review hardening (applied in this branch)

Two independent exact-head adversarial reviews ran against `de2bcc9d`. One returned a clean pass. The
other confirmed the pins, the state machine, the evidence model and the transaction semantics but
identified that scoping this lane's membership snapshot to `member.rolname` (see the finding above)
dropped H2's *reverse* coverage without a replacement, and that a few named contract assertions were
weaker than the digest that backs them. All were closed here, inside the operator only:

| Finding | Closure |
|---------|---------|
| Reverse role membership uncovered: a `CREATEROLE` actor could pre-create a posture-compliant role and `GRANT waia_account_observation_credential TO <server_role>`, gaining inherited column `SELECT` on ciphertext while every check and the digest still matched | `verify0210` now refuses `CATALOG_0210_ROLE_GRANTEES` unless the only member is `waia_account_observation_credential_login` without `INHERIT`/`ADMIN`. The digest relaxation stays scoped to the observer/reader roles, whose provisioning state legitimately varies |
| `--verify-only` never ran a catalog precondition, so a journal row for `0209` with absent `ai_twin_*` tables was receipted as `PREDECESSOR_NOT_APPLIED` | The read-only path now runs `assertCatalogPrecondition` in that branch |
| `policySnapshot` matched `polname` only, so a same-named policy on another relation would have satisfied the 0210 policy assertions | Bound to `polrelid` for both policies |
| `relforcerowsecurity = false` was asserted, but `relrowsecurity = true` was not — the assignment-bound contract is inert without RLS | Added `CATALOG_0210_ROW_SECURITY` |
| The `0209` precondition counted `pg_class` only, so a leftover `ai_twin_*` function surfaced as a raw `42723` instead of a refusal | Precondition now counts relations and routines |
| `0209` validator ACLs were unobserved; `PUBLIC` holds PostgreSQL's default `EXECUTE` | Asserted `proacl IS NULL` (untouched default) and `IMMUTABLE`, rather than revoking — revoking would alter DEE-871 semantics. Bodies remain pinned verbatim in the digest |
| An unrecognized bare CLI token was echoed verbatim, so a mis-pasted connection string reached stderr | Only the argument position is reported |
| Pooler refusal missed port `6432` and trailing whitespace in `pool_mode` | Both ports and `transaction`/`statement`, whitespace-trimmed, are refused |
| Runbook claimed verify-only refuses catalog-contradictory state and did not mention attestation freshness on recovery | Both corrected, plus the validator-ACL posture stated explicitly |

None of these touch H2, `0209`, `0210`, `_journal.json` or any pinned digest.

## Production ceremony (Human-only, twice)

Two separate ceremonies, each with its own Human authorization packet:

```bash
pnpm trader:post-h2:migrate --step 0209 --confirm-exact-step 0209 …   # then STOP
pnpm trader:post-h2:migrate --step 0210 --confirm-exact-step 0210 …   # new packet, later
```

Full operator detail: [`POST-H2-MIGRATION-OPERATOR.md`](../ops/POST-H2-MIGRATION-OPERATOR.md).
