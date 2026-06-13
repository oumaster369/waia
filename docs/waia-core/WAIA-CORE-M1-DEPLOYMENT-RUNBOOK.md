# WAIA Core M1 — Deployment Runbook

Operational runbook for promoting **WAIA Core Uplift M1** (epics WC-E1 … WC-E6:
profiles, organizations & membership, roles & permissions, subscriptions &
entitlements, platform audit, tenant isolation) to an environment.

- **Risk tier:** T2+ (schema change). Human operational sign-off required (**ADR-0002**).
- **Posture:** additive, shadow-mode by default. No behavior change for existing
  AI-TWIN users until enforcement is explicitly enabled.
- **Source of truth:** [WAIA Core Architecture](./WAIA-CORE-ARCHITECTURE.md),
  [ADR-0002](../adr/0002-staged-postgres-runtime-rollout-discipline.md),
  [ADR-0007](../adr/0007-targeted-rls-strategy.md),
  [ADR-0011](../adr/0011-single-operator-governance-model.md).

---

## 0. Invariants (must hold before AND after deploy)

| # | Invariant | How it is guaranteed |
|---|-----------|----------------------|
| I1 | `public.users.id == auth.users.id` | Supabase auth sync (pre-existing). |
| I2 | Exactly **one** personal organization per user | `organizations.id` is deterministic: `personalOrganizationIdFromUserId(userId)`. Re-running provisioning cannot create a second. |
| I3 | Personal org owner = the user | `organizations.owner_user_id = userId`, `organization_members.member_role = 'owner'`. |
| I4 | Every user has a `user` platform role + baseline `twin` subscription + entitlement | Provisioning seed (idempotent). |
| I5 | `audit_logs` is append-only | DB triggers reject UPDATE/DELETE in **both** SQLite (`0007`) and Postgres (`0004`), independent of connection role. RLS is defense-in-depth (ADR-0007). |
| I6 | No cross-organization data access | Application-layer org scoping + release-blocking `tenant-isolation` CI gate. |

Feature flags (default = shadow, non-enforcing):

| Env var | Default | Effect |
|---------|---------|--------|
| `WAIA_CORE_SHADOW` | `1` (on) | Mismatches are logged to `audit_logs`, never enforced. |
| `WAIA_CORE_ENFORCEMENT` | unset/`0` (off) | When `1`, permission/entitlement checks become authoritative. **Leave OFF for M1.** |

---

## 1. Migrate

Apply migrations with `drizzle-kit migrate` (hand-authored SQL — see
[`db/AGENTS.md`](../../db/AGENTS.md); do **not** run `db:generate`).

### SQLite (current default runtime)

```bash
# DATABASE_URL must point at the target SQLite database
pnpm db:migrate            # applies 0007_waia_core_m1 (tables + audit append-only triggers)
```

### Postgres (staged — only when the env is Postgres-routed, ADR-0002)

```bash
# DATABASE_URL_POSTGRES must point at the target database; requires human sign-off
pnpm db:migrate:postgres   # applies 0003_waia_core_m1, then 0004_audit_logs_rls (triggers + RLS)
```

**Verify migration applied** (see §3).

---

## 2. Backfill

Seed Core records for users that pre-date M1. Idempotent and safe to re-run.

```bash
# Always dry-run first
pnpm waia:core:backfill --dry-run                      # SQLite
pnpm waia:core:backfill --backend=postgres --dry-run   # Postgres

# Apply
pnpm waia:core:backfill                                 # SQLite
pnpm waia:core:backfill --backend=postgres              # Postgres
```

Each user receives: profile, personal organization, owner membership, `user`
platform role, baseline `twin` subscription + entitlement. Re-running converges
(no duplicates) because provisioning checks existence before every insert.

---

## 3. Verification

### 3a. Migration presence

```sql
-- Postgres: tables exist
SELECT to_regclass('public.profiles'), to_regclass('public.organizations'),
       to_regclass('public.organization_members'), to_regclass('public.user_platform_roles'),
       to_regclass('public.organization_subscriptions'), to_regclass('public.organization_entitlements'),
       to_regclass('public.audit_logs');

-- Postgres: append-only triggers present
SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.audit_logs'::regclass AND NOT tgisinternal;
-- expect: audit_logs_block_update, audit_logs_block_delete

-- Postgres: RLS enabled (ADR-0007 defense-in-depth)
SELECT relrowsecurity FROM pg_class WHERE oid = 'public.audit_logs'::regclass;  -- expect: t
```

```sql
-- SQLite: triggers present
SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='audit_logs';
-- expect: audit_logs_block_update, audit_logs_block_delete
```

### 3b. Backfill coverage (every user has exactly one personal org + profile)

```sql
-- Users missing a profile (expect 0)
SELECT count(*) FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE p.id IS NULL;

-- Users missing a personal org membership (expect 0)
SELECT count(*) FROM users u
LEFT JOIN organization_members m ON m.user_id = u.id AND m.member_role = 'owner'
WHERE m.id IS NULL;

-- Duplicate personal orgs per owner (expect 0 rows)
SELECT owner_user_id, count(*) FROM organizations WHERE kind = 'personal'
GROUP BY owner_user_id HAVING count(*) > 1;
```

### 3c. Audit immutability (must FAIL — proves append-only)

```sql
-- Both must raise "audit_logs is append-only" and change nothing:
UPDATE audit_logs SET action = 'tamper' WHERE id = (SELECT id FROM audit_logs LIMIT 1);
DELETE FROM audit_logs WHERE id = (SELECT id FROM audit_logs LIMIT 1);
```

### 3d. Automated gates (must be green)

```bash
pnpm test --run tenant-isolation          # release-blocking isolation gate (ADR-0007)
WAIA_PG_INTEGRATION=1 pnpm test --run postgres-waia-core-parity   # Postgres parity (when Postgres-routed)
```

---

## 4. Rollback

Because M1 is **additive and shadow-only**, the first-line rollback is to disable
behavior, not to drop schema.

1. **Disable enforcement (instant, no migration):**
   set `WAIA_CORE_ENFORCEMENT=0` (and confirm `WAIA_CORE_SHADOW=1`). Core checks
   stop affecting any user-visible behavior. AI-TWIN paths are unchanged.
2. **Code rollback:** redeploy the previous build. Core tables remain populated but
   unused; this is safe (no other module reads them yet).
3. **Schema rollback (last resort, requires sign-off — ADR-0002):** the Core tables
   are leaf/additive. If removal is mandated, drop in dependency order inside a
   reviewed down-migration:
   `audit_logs → organization_entitlements → organization_subscriptions →
   organization_members → user_platform_roles → organizations → profiles`,
   then drop the Postgres trigger function `public.waia_audit_logs_block_mutation()`
   and (Postgres) the `audit_logs_*` policies / enum types.
   Backfilled data is regenerable via §2, so a drop is recoverable.

> Do **not** attempt to UPDATE/DELETE `audit_logs` to "clean up" — the append-only
> triggers will reject it. Disable the trigger explicitly only inside a reviewed
> migration if a destructive schema rollback is truly required.

---

## 5. Operator checklist

- [ ] Human operational sign-off recorded (ADR-0002), correct backend confirmed.
- [ ] `WAIA_CORE_ENFORCEMENT` is **off**; `WAIA_CORE_SHADOW` is **on**.
- [ ] Backup / snapshot of target DB taken.
- [ ] Step 1 migrate completed; §3a verification passes.
- [ ] Step 2 backfill dry-run reviewed, then applied; §3b shows 0 missing / 0 duplicates.
- [ ] §3c audit immutability checks correctly **fail** (append-only proven).
- [ ] §3d `tenant-isolation` gate green (+ Postgres parity when Postgres-routed).
- [ ] Rollback path (§4) understood; previous build identified for fast revert.
