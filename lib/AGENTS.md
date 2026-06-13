# lib/ — shared server and client utilities

**Execution label:** depends on module — `backend` (persistence, auth), `ai` (twin logic, prompts), or shared infra.

## Principles

- Prefer **pure functions** where possible; side effects belong in explicit server modules.
- Use `server-only` import guard for code that must never reach the browser.
- Export `cn()` from `lib/utils.ts` for class merging — do not duplicate.

## Module boundaries

| Area | Typical path | Owner label |
|------|--------------|-------------|
| Auth / session | `lib/auth/**` | `backend` / `security` |
| AI-Twin / readiness | `lib/ai/**`, twin engines | `ai` |
| DB clients | `lib/db/**` | `backend` |
| Runtime routing | `lib/runtime/**` | `backend` / `infra` |

## Rules

- No UI imports from `lib/` into `components/` that pull server secrets client-side.
- AI prompt envelopes and doctrine: [`docs/architecture/DEE-80-PROMPT-ENVELOPE-DOCTRINE-V1.md`](../docs/architecture/DEE-80-PROMPT-ENVELOPE-DOCTRINE-V1.md).
- Transaction patterns: [`docs/architecture/transactions.md`](../docs/architecture/transactions.md).

## Testing

Unit tests in `tests/unit/` colocated or named after the module under test. Run `pnpm test --run` after changes.
