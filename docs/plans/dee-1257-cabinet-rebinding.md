# DEE-1257 — recover the cabinet after a configuration revision changes

An open cabinet currently treats an authorized configuration revision change as
permanent credential revocation. It clears its data but never discovers the new
binding until the user reloads the page.

Return a typed 409 (or equivalent stream control event) only when authorization,
account identity and credential revision remain valid and the configuration
revision has changed. Clear observation and history data immediately, then make
at most three sequential current-binding lookups per invalidated revision. A
temporary 204 may precede the first new natural observation. Offer explicit
retry after the bounded lookup budget is spent. Real 401/403, credential revision
changes, and mismatched account identities remain terminal. Never resume the old
configuration revision.

Validation: 164 focused cases, a mounted Chromium regression covering old data →
409 → cleared state/204 → new binding → missing observation → fresh observation,
typecheck, lint, build, consumer graphs and authoritative PR CI. The browser
regression uses synthetic local fixtures and makes no exchange requests.

Risk T3: this changes an authenticated read protocol and its browser consumer.
Deploy the server and browser together; old servers continue to return terminal
403. No database migration, provider request, collection trigger or trading
behavior changes. Rollback is a code revert followed by a coordinated web
release; the underlying collector and reader do not need replacement.

Source acceptance does not complete the parent financial-history or product
acceptance. Actual cabinet deployment and venue financial records remain
separate checks.
