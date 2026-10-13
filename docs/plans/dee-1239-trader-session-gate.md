# DEE-1239 — Trader session-aware account connection

## Context and goal
The unauthenticated Trader workspace displayed HTX key inputs after the credential-list API rejected access. Its header also looked signed in. Separate access states must precede the connection form, while authorized new and existing accounts retain their current observation workflow.

## Scope and implementation
- Distinguish loading, allowed, unauthenticated, forbidden and unavailable credential-list outcomes.
- Hide credential fields and account actions until access is confirmed. Clear held credentials on authorization loss; retain existing generation fencing for stale requests.
- Route unauthenticated users to the canonical Trader landing, whose existing authentication flow returns to the Trader workspace.
- Keep authenticated connection/replacement/revocation behavior and all server authorization unchanged.
- Identify exchange inputs explicitly and request new-password autofill semantics for the secret. Browsers may override autocomplete hints.

No trading, venue permission, schema, key, collection schedule or observer deployment change is included.

## Acceptance and validation
Focused UI tests cover pending access, 401/403/transient failures, safe recovery, existing accounts, auth loss, and synthetic Read+Trade connection without trading requests. Browser coverage verifies the actual landing and return path. Full lint, typecheck and Next build precede PR readiness; full unit and required integration checks run once in PR CI. Independent review binds the exact source files.

## Delivery and recovery
One frontend issue/PR to main. Source integration and production release are separate results. Any later Worker-only release requires a fresh read confirming PAPER_LOOP_ENABLED=0 and must preserve that disabled value, current projection, observation configuration and all nonrelease variables. The committed Wrangler configuration declares PAPER_LOOP_ENABLED=1, so a generic deployment using repository defaults is not admitted; use the separately reviewed preservation procedure. Do not activate the unqualified financial observer. A source revert through a reviewed PR is available for the isolated UI change.

