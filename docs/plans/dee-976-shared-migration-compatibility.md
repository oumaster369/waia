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
state: { status: in-review, currentWorkPackage: WP-3, completedWorkPackages: [WP-1, WP-2], remainingWorkPackages: [WP-3], prNumber: 569, prUrl: "https://github.com/oumaster369/waia/pull/569", lastValidatedGitSha: 134524f5970b17515cc0a94a3a69bcd31ef6b689, lastValidationAt: "2026-09-09T17:03:32Z", blockedReason: "CI attempt 1: stale explicit Forecast extra-migration expectation omits 0205; bounded test correction requires review and new exact-head CI", nextAction: "Correct only the explicit extra-migration test expectation, obtain Trader-owner review, and wait for full exact-head CI before Human-authorized protected squash merge. No deployment or production migration." }
provenance: { createdFrom: DEE-871, gapRegistry: docs/gaps/ai-twin-v1-gap-registry.md, supersedes: null }
---

# DEE-976 — Frozen shared migration prerequisite

**Current authorization:** the Human subsequently instructed on 2026-09-09: continue, wait for test completion and merge PR #569. This supersedes the historical no-merge wording below for this bounded PR only. Protected squash merge requires successful exact-head CI and independent review; deployment, production apply and scientific operations remain forbidden. Historical admission and evidence are retained.

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
| `tests/unit/forecast-v2-applied-migration-identity-v1.test.ts` | CI-discovered adjacent compatibility correction: append only explicit0205 to expected post0148 extras; preserve ratified max148 and every negative assertion. Trader-owner review required before publication. |
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

Implementation, local gates and independent review completed below. External publication safety and PR CI remain pending.

### 2026-09-09 — Trader-owner extraction correction

DEE-960 comment `55850464-5490-4635-b48c-a2b69fc67ade` supersedes the earlier mirror recommendation. Existing credential repository uses unprojected select/insert/returning. Adding observationRevision would require205 for those consumers even when historical preflight accepts204. Owner explicitly approves deferring **all** schema.postgres.ts mirror changes here; preserve the file and consumers byte-for-byte from main. The exact SQL+journal remains the authoritative migration; account runtime/mirror rollout remains DEE-960. Final delivered manifest is exactly the four frozen adoption paths plus this plan and the independent PG harness (six files). No other files are admitted.

### 2026-09-09 — Local qualification receipt

- Current focused suite: **30/30 passed, zero skips** (20 frozen preflight units, one exact-source static check, nine actualPG17 scenarios). Fresh0000–0205 and204→205 use actual Drizzle with NOSUPERUSER/NOBYPASSRLS migration owner. Existing credential insert/get/list/revoke also run under that limited owner on BOTH schemas; captured generated SQL excludes observation_revision. Raw test SQL separately confirms revision increments after legacy revoke. Credential/snapshot preservation, forcedRLS/browser denial, exact scoped observer/reader filtering, secret denial, read-only/immutable/revision guards and eight rolled-back actual preflight corruptions pass. No account-runtime imports or calculation executed.
- External owned fixture proof: final container `34b47f4eba9a09d13b5cb7f331251c8a6811190f7d56ad18cbdd7d39017aa334`, owner label ai-twin-dee976-final-20260909, loopback51188, image `sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73`, PostgreSQL17.11, no host mounts, bounded1CPU/1GiB and tmpfs512MiB. SQL independently checked dedicatedDB/owner/marker beforeDDL. Tests do not themselves verify Docker binding. Prior own first-pass container59396019 was removed with synthetic data only.
- Lint passed with307 existing warnings/zero errors; typecheck, diff check, canon154 plus regressions/release identity, and PR-governance regressions passed. Full unit/E2E CI is not yet run. No hosted auth/Twin rights/207/full scientific readiness claim.
- Initial local build failed because a sibling-node_modules symlink is outside Turbopack root. Replace only this worktree's symlink with its own dependency copy; source/config is not changed to suppress the build check. Successful retry remains required.
- GitHub read-only check: no openPR; currentmain remains3657b257. Actions secret names contain only LINEAR_API_KEY, so existing Cloudflare preview deployment step is not enabled. No CI/config/secret changes. External Workers Builds behavior must be separately checked before push.

The reviewed six-file diff is728 additions/eight deletions, below the800-line target. One193-line immutableSQL, one small journal entry, one bounded preflight pair and one fresh/upgrade/security harness constitute a single compatibility/rollback boundary. No runtime feature is included to increase scope.

### 2026-09-09 — Review and publication checkpoint

- Trader-owner final bounded review PASS on exact code candidate `90e7cdfa804ef7c3aa8942b527197d6d1b5128ab` / base3657b257, DEE-976 comment `153ad243-e7e0-44a3-8e60-25f9d830e5a6`: no proven P1/P2 across allsixfiles. Reviewer independently ran20units+1static, scopedlint/typecheck/diff; ninePGscenarios were deliberately skipped in that separate run and not counted as PGproof. ActualPG and Dockerbinding remain the integrator's receipts above.
- Build retry passed with own copied dependencies and explicit own SQLite path. Rendered PR body passed P0governance preflight. Only documentation/PR-body receipt changes follow the reviewed code; no affected source/test rerun is required for this receipt. Revalidate base/head and any affected review before eventual publication.
- Read-only Cloudflare dashboard request was denied: browser security could not verify the admin-enforced policy. No alternate browser/API workaround, setting change, push or PR was attempted. Earlier observed upload-only settings are historical, not a current verification. Need restored permitted read access or a Human-provided current view of waia-app Workers Builds production and non-production commands before publishing under the no-deployment constraint.
- Final own tmpfs container34b47f4 was re-inspected by exact id/label/port and removed. Only synthetic test databases were discarded; no persistent Human data or Trader container was touched. Both created test containers are gone. This branch and prior871Core-auth branch remain local and unmerged.

This completes the bounded local prerequisite, not DEE-871 or full AI-TWIN. No206/207/current-consent/right checks are claimed. No production/scientific operation, deployment, merge or periodic automation occurred.

### 2026-09-09 — Human-supplied publication evidence closes the check

The Human supplied the current waia-app Settings screenshot at18:57:11 and then the complete Deploy command and Version command values. Both values are identical: `npx wrangler versions upload` followed solely by seven `--var` arguments (TREASURY_WATCHER_ENABLED:false, TREASURY_WATCHER_ORGANIZATION_ID from WAIA_TREASURY_ORG, WAIA_FINANCE_ASSISTANT_OPENAI_MODEL:gpt-5.5, WAIA_FINANCE_ASSISTANT_WRITES_ENABLED:false, WAIA_PUBLIC_LINEAR_PROJECT_ALLOWLIST from WAIA_LINEAR_ALLOWLIST, WAIA_PUBLIC_TREASURY_ORGANIZATION_ID from WAIA_TREASURY_ORG and WAIA_PUBLIC_SUPPORT_USDT_TRC20_ADDRESS from WAIA_SUPPORT_ADDRESS). No chained shell command, deployment/activation command or database apply command is present. Environment values were not read or changed.

Screenshot independently identifies repositoryoumaster369/waia, production branchmain and enabled non-production builds. This is Human-provided settings evidence, not successful browser access or a production-state inspection. It supersedes the previous incomplete screenshot/publication blocker; no browser-policy workaround was performed. Rechecked main3657b257, no existing PR for this branch and Actions secrets names still onlyLINEAR_API_KEY. Existing external branch builds may upload an inactive version; publication does not authorize its activation. Only this documentation receipt and rendered PR body change after the independently reviewed code. No redundant expensive tests.

### 2026-09-09 — CI-discovered explicit extra-migration expectation correction

PR #569 head134524f5: full unitCI attempt1 failed exactly one assertion (6488 passed, one failed,555 skipped). The existing Forecast identity test enumerates post0148 extras through0204; the real journal now also contains the admitted0205. Focused local reproduction: one failed, seven passed. The binder truthfully reports0205 as an extra and still seals max148; runtime is not changed to hide it. Amend exactly one expected string, retaining explicit equality and all hash/timestamp/missing/unknown-extra guards. This adjacent test is the seventh delivered file, superseding the historical six-file inventory above; no broader source surface is admitted.

PG workflow34374239368 on134524f5 completed successfully: PG16 preflight20 passed and integration192 passed/3 skipped; PG17 historical regressions18 passed. Existing integrator30/30 PG17 qualification and runtime review retain unchanged-source provenance, not new-head execution claims. Build/E2E were skipped after the failed unit gate. The bounded test/documentation correction requires focused GREEN, Trader-owner delta review, and a fresh authoritative full PR CI before merge. Do not repeat local DB/build qualification solely for this expected-string correction; no runtime, SQL, journal, schema, config or CI byte changes. No deployment/apply/scientific action is authorized.

Trader-owner scope confirmation: DEE-976 comment71d633db-3150-4401-86b0-fd1755048504 independently reproduced the same1FAIL/7PASS and accepted exactly this expected-string/plan correction. Integrator focused GREEN after correction:28/28 passed (all8 Forecast identity cases and20 historical preflight cases), scopedESLint and diff-check PASS. Final committed delta review and new-head CI remain required; no failure is waived or converted to a skip.
