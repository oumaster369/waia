# DEE-1121 — Recorded noncapital paper analysis storage

Migration0219 is additive and PostgreSQL-only. It adds immutable session headers,
complete normalized input packets and observational-analysis companions. Existing
0218 receipts retain their original grammar and sole canonical NO_TRADE result.

Each table denies authenticated/anon, blocks update/delete and independently
checks the existing org-wide owner at the default-deferred commit fence. Packet
references bind tenant/session/config, persisted source outcomes and predecessor
state. Companion references bind the exact saved input and existing v2 receipt;
there is one companion per session sequence and v2 natural key.

The fence is a transaction-time check under ordinary deferred constraint mode;
changing constraint timing is not a universal post-commit durability guarantee.
Rows and release metadata do not qualify sources, strategies, capital or binary
identity. Public collection can leave unreferenced canonical-source receipts if
packet publication fails. They do not advance the completed prefix.

No backfill or old-receipt enrichment. A legacy v2-only key is an explicit refusal.
No migration has been applied to production. All220 repository migrations applied
to a new isolated local database after an initial draft SQL-expression error was
corrected; the original failed-proof database and logs were preserved. Final
combined native acceptance at602d30c3 passed323 tests in17 suites, including all34
new recorded-analysis cases, with zero skips. Teardown found zero sessions, fault
triggers/functions or disabled new guards. A later test-only annotation correction
at110909b5 emits identical JavaScript; native evidence remains attributed to602.
Production migration and root CI/current-base acceptance remain outstanding.
