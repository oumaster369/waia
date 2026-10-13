# DEE-1247 — preserve authenticated cabinet stream updates

## Problem and outcome

The observation stream performs its first authenticated read inside the route, but later reads run from a deferred stream pull. That pull can lose the request's asynchronous context, so session resolution fails although ordinary JSON polling succeeds. Separately, the membership adapter treats any database exception as missing membership, and cancellation can be reported as access revocation. The browser then clears data and stops updating.

Preserve request context for deferred reads and distinguish temporary unavailability from verified denial. Persist verified session-cookie refreshes on the cabinet and its observation read routes, which the current middleware helper skips. This does not retain authorization: every read still resolves the session and independently rechecks entitlement, membership or operator permission, account binding and revisions before returning data. Synthetic reproduction establishes these defects, but does not prove which specific denial produced the later live REVOKED state.

## Scope and boundaries

- Bind the stream read callback to its originating asynchronous context.
- Treat only `OrgScopeError("ORG_MEMBERSHIP_REQUIRED")` as missing membership; propagate other failures to the unavailable response.
- Return unavailable for canceled reads rather than implying revoked access.
- Extend the existing session-refresh route guard to `/trader` and tenant/admin account-observation routes; retain Trader-host, configured-provider, existing-cookie, verified-user and transient-error rules. Persist refreshed cookies to both the forwarded request and browser response. If token rotation succeeds before user verification fails transiently, preserve the staged replacement cookies on the unavailable response without granting access. Keep the auth-unavailable response in English.
- Keep genuine denial and rotation terminal; preserve five-second read and bounded stream limits, cancellation, disposal, fixed projection origin, signature and current-binding checks.
- No schema, migrations, secrets, exchange calls, trading actions or execution infrastructure changes.

## Validation and rollout

Use deterministic regressions for loss of request context, isolation between requests, fresh revocation, cancellation and transient membership failures. Qualify the stream callback in the installed Worker runtime with synthetic data and no external sockets. Verify session rotation and cookie persistence with the installed SSR SDK and a synthetic Auth provider, retaining exclusions for unrelated routes. Run affected unit suites, typecheck, lint, build and the mounted cabinet update/revocation scenario; full unit qualification belongs to PR CI.

Risk T3: authorization-adjacent error classification and deferred request context. Existing Human instructions explicitly authorize cabinet repair and controlled release; this is not a bounded Integration Train merge. Root performs the exact reviewed release and verifies signed-in cabinet updates and return from the connection form. Source tests and one initial successful load do not establish stable production acceptance.

Migration memory: no migration impact; preserve already-applied migrations and the current journal without replay. No production database mutation is part of this change.

Financial and full-product acceptance remain separate outstanding work.
