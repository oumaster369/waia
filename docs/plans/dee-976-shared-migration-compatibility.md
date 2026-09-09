---
integrationIssue: DEE-976
integrationTitle: "AI-TWIN shared-boundary prerequisite — frozen 0205 migration compatibility"
branch: dee-976-shared-migration-compatibility
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr]
requiredValidation: [lint, typecheck, build, unit, integration, canon, pr-governance]
approvalGates: [plan-approved, independent-review, exact-head-ci]
includedIssues: []
state: { status: in-progress, currentWorkPackage: WP-3, completedWorkPackages: [WP-1, WP-2], remainingWorkPackages: [WP-3], prNumber: null, prUrl: null, lastValidatedGitSha: null, lastValidationAt: "2026-09-09T15:31:00Z", blockedReason: null, nextAction: "Complete local build and exact-diff Trader-owner review; verify publication has no deployment effect; prepare one unmerged PR." }
provenance: { createdFrom: DEE-871, gapRegistry: docs/gaps/ai-twin-v1-gap-registry.md, supersedes: null }
---

# DEE-976 — Frozen shared migration prerequisite

## Human approval and integration boundary

On 2026-09-09 the Human explicitly approved a minimal common compatibility package with exact 0205 under Trader-owner review, without the remainder of unfinished Trader code. This admits preparation and one PR, **not merge, deployment, production migration, runtime activation or scientific run/data/checkpoint operations**. Coordination decisions are preserved in DEE-871/DEE-960. This prerequisite is a separate issue because neither parent is complete, and one PR must have one correctly scoped integration issue. It is not an Integration Train or new product canon.

Verified origin/main base: `3657b25719e0935d20ca951eba1357196279d00e`. Frozen adoption source: Trader commit `6e35edb8ec2942e6c43ca62281bc7654c243b583`. Only exact committed objects may be read/adopted; no edits to the Trader worktree. One integrator owns this branch. The Trader owner reviews the extraction and historical-preflight guards. Existing Core-auth work at `b45941084f9b0ac1837b437ba783fa1952b695ab` remains on its separate unchanged branch.

## Admitted file manifest

| Surface | Admission |
|---|---|
| This plan | Admission, manifest, review and test receipts |
| `db/migrations_postgres/0205_trader_account_observation_v1.sql` | Exact source bytes; SHA256 `aa511acd320b653858e4b064dfeb1af744a4d7f81cffaf72fb67cd91f1fffde1`, Git blob `c75c42d2bae15beea5741161abfb18afae0b4c3b` |
| `db/migrations_postgres/meta/_journal.json` | Exact append only: idx205, version7, when1780000000205, tag0205_trader_account_observation_v1, breakpoints true |
| `lib/trader/observability/fhv-v2-postgres-schema-preflight.ts` | Exact frozen explicit optional0205 compatibility and identity/duplicate safeguards; no general future-migration admission |
| `tests/unit/fhv-v2-postgres-schema-preflight.test.ts` | Exact frozen negative/positive preflight cases; any subsequent bounded correction requires Trader review |
| `tests/integration/shared-migration-compatibility-postgres.test.ts` | New independent local-only PG17 fresh/upgrade/privilege/consumer and actual preflight negative matrix; no account runtime imports |
| `db/schema.postgres.ts` | Conditional only: source 57-line mirror requires Trader-owner review and proof of old204 consumer compatibility. Do not silently adopt a new field into existing unprojected credential queries. Deferral with explicit owner agreement is allowed for this inert SQL-only package. |

All other migration0000–0204 SQL and journal identities must remain byte-for-byte unchanged. No app/components/auth/Gateway/DB client/config/CI/secret changes. No copied account collection runtime, HTX code, UI, existing account test that imports absent runtime, or local SQL alternate migration. No new 0205 or renumbering. Prospective Twin206/207 remain reserved and unimplemented here.

## Work packages and acceptance

### WP-1 — Exact extraction and compatibility decision

Commit this admission before adoption. Preserve exact hashes, read the complete migration and preflight diff, and independently inspect old credential consumers. Resolve ORM mirror behavior with Trader owner before final freeze. Baseline historical migrations0000–0204 remain required;205 is optional but exact when present. Missing baseline, unknown migration, changed hash, wrong timestamp, duplicate hash/timestamp and missing historical table must still reject. No schema mirror may break existing204 queries.

### WP-2 — Isolated PostgreSQL17 qualification

Use a newly created own bounded container, no host mounts, no external URL or ambient .env. Externally verify exact container/image/loopback port/owner label and SQL database/role/run marker before DDL. Test itself validates local endpoint, explicit marker and major17; container-string shape alone is not ownership proof. No previous container or Trader database may be reused. Exact own container removal is the only cleanup and discards synthetic test data only.

Use actual Drizzle migrator for fresh0000–0205 and204→205 upgrade, under a NOSUPERUSER/NOBYPASSRLS CREATEROLE DDL owner. For the baseline fixture, copy unchanged migration bytes and journal prefix into a unique temporary test directory; do not hand-invent applied hashes. Assert actual historical preflight before/after, existing credential and balance snapshot preservation, legacy credential read/insert/revoke behavior, forced RLS/browser denial, secret-column denial and read-only reader. Run negative preflight mutations only in rolled-back synthetic transactions, leaving fixtures valid. Do not invoke historical calculation or its35-cycle bootstrap.

Required local gates: focused units/integration, lint, typecheck, build, canon, PR governance and rendered-body preflight. Full unit suite remains authoritative in PR CI, not duplicated locally. No UI change or full user journey claim. Passing skips is not database qualification; stubbed auth roles are not hosted Supabase authentication evidence.

### WP-3 — Review and unmerged PR

Freeze exact complete diff for independent Trader-owner review. No unresolved P1/P2. Check current origin/main and existing PR/build behavior read-only before publication; do not change CI or bypass deployment restrictions. Publish one coherent PR only after integration-ready acceptance, with DEE-976 as sole Linear integration id. DEE-871 and DEE-960 remain deferred/open. No auto-merge or deployment. Human decides any later merge/activation.

## Risks, rollback and explicit deferral

This package establishes migration ordering compatibility, not connected AI-TWIN persistence or finished account observation. It does not prove Twin consent/rights, full206/207 fresh/upgrades, hosted auth or real-user safety. Those remain DEE-871 acceptance. Schema mirrors can change generated SQL even with no new runtime caller; inspect and test rather than equating additiveDDL with application compatibility.

Before any DB apply, reverting this unactivated code restores the previous checkout. After any future production apply, deleting the journal or reverting SQL is not a safe rollback; additive columns/triggers/data require a separately approved forward plan. This PR authorizes no such apply. Reviewability target is one SQL file, one journal append, one preflight pair, one harness and this plan; reject broader runtime adoption rather than import the complete Trader branch.

## Evidence log

Implementation and scoped PG17 acceptance completed below. Build, final independent review and PR gates remain pending.

### 2026-09-09 — Trader-owner extraction correction

DEE-960 comment `55850464-5490-4635-b48c-a2b69fc67ade` supersedes the earlier mirror recommendation. Existing credential repository uses unprojected select/insert/returning. Adding observationRevision would require205 for those consumers even when historical preflight accepts204. Owner explicitly approves deferring **all** schema.postgres.ts mirror changes here; preserve the file and consumers byte-for-byte from main. The exact SQL+journal remains the authoritative migration; account runtime/mirror rollout remains DEE-960. Final delivered manifest is exactly the four frozen adoption paths plus this plan and the independent PG harness (six files). No other files are admitted.

### 2026-09-09 — Local qualification receipt

- Current focused suite: **30/30 passed, zero skips** (20 frozen preflight units, one exact-source static check, nine actualPG17 scenarios). Fresh0000–0205 and204→205 use actual Drizzle with NOSUPERUSER/NOBYPASSRLS migration owner. Existing credential insert/get/list/revoke also run under that limited owner on BOTH schemas; captured generated SQL excludes observation_revision. Raw test SQL separately confirms revision increments after legacy revoke. Credential/snapshot preservation, forcedRLS/browser denial, exact scoped observer/reader filtering, secret denial, read-only/immutable/revision guards and eight rolled-back actual preflight corruptions pass. No account-runtime imports or calculation executed.
- External owned fixture proof: final container `34b47f4eba9a09d13b5cb7f331251c8a6811190f7d56ad18cbdd7d39017aa334`, owner label ai-twin-dee976-final-20260909, loopback51188, image `sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73`, PostgreSQL17.11, no host mounts, bounded1CPU/1GiB and tmpfs512MiB. SQL independently checked dedicatedDB/owner/marker beforeDDL. Tests do not themselves verify Docker binding. Prior own first-pass container59396019 was removed with synthetic data only.
- Lint passed with307 existing warnings/zero errors; typecheck, diff check, canon154 plus regressions/release identity, and PR-governance regressions passed. Full unit/E2E CI is not yet run. No hosted auth/Twin rights/207/full scientific readiness claim.
- Initial local build failed because a sibling-node_modules symlink is outside Turbopack root. Replace only this worktree's symlink with its own dependency copy; source/config is not changed to suppress the build check. Successful retry remains required.
- GitHub read-only check: no openPR; currentmain remains3657b257. Actions secret names contain only LINEAR_API_KEY, so existing Cloudflare preview deployment step is not enabled. No CI/config/secret changes. External Workers Builds behavior must be separately checked before push.

The six-file diff may slightly exceed800lines after formatting the independent harness. One193-line immutableSQL, one small journal entry, one bounded preflight pair and one fresh/upgrade/security harness constitute a single compatibility/rollback boundary; separating these would leave migration acceptance unqualified. No runtime feature is included to increase scope.
