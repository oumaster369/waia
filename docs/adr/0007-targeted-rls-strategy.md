# ADR-0007 — Targeted RLS strategy (app-enforced primary, RLS as defense-in-depth)

Status: Accepted
Date: 2026-06-11

## Context

The AI-TRADER master spec assumed Supabase-native Row Level Security on all user-related tables. The real codebase enforces access in application code via Drizzle queries scoped by user, and RLS is not implemented ("out of scope for DEE-62", `db/schema.postgres.ts`). A platform-wide RLS migration is explicitly **not** an approved assumption. The system nonetheless handles trade-capable credentials and money, so the most sensitive tables warrant a hard backstop.

## Decision

**Application-layer enforcement is the primary access-control mechanism**, scoped by `organization_id` / `user_id` through a mandatory shared query helper so modules cannot issue unscoped queries.

**Targeted RLS is applied as defense-in-depth only**, on the highest-sensitivity tables:
- `exchange_credentials` — service-role only; deny the `authenticated` role entirely.
- `payments` / `payment_addresses` — organization-scoped, service-mediated.
- `audit_logs` — insert-only for services, select-only for admins; no update/delete for anyone.

No sweeping platform-wide RLS rollout is performed.

### Mandatory governance requirement — tenant-isolation tests

Because access control is primarily application-enforced, it must be continuously proven:

- **Every organization-scoped API, query path, service endpoint, admin operation, and dashboard view must have tenant-isolation tests** verifying that one organization cannot read or mutate another's data.
- **Any cross-organization access leak is a release blocker.** It blocks merge and release until fixed — no exceptions, no waivers.
- New organization-scoped surfaces are not considered complete without their isolation tests.

This requirement is reflected in [AI-TRADER Security](../ai-trader/AI-TRADER-SECURITY.md) and the Master Spec testing requirements.

## Consequences

+ Matches the existing codebase and avoids a risky platform-wide migration.
+ Secrets, payments, and audit get a hard backstop independent of application bugs.
− Two enforcement models coexist; the shared scoping helper and security tests are mandatory to prevent drift.
Neutral: a future full-RLS adoption remains possible without contradicting this decision.

## Links

- [WAIA Core Architecture](../waia-core/WAIA-CORE-ARCHITECTURE.md)
- [AI-TRADER Security](../ai-trader/AI-TRADER-SECURITY.md)
