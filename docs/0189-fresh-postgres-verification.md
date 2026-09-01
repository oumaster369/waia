# Migration 0189 fresh-PostgreSQL verification

Date: 2026-08-31 (Europe/Moscow)

Scope: disposable local PostgreSQL 16 databases, including final matrix database
`waia_validate_0189_e2e20`. No production database or credentials were used.

Evidence:

- Created an empty database and the minimal local `auth.users` prelude required by migration 0001.
- Applied the literal canonical migrations `0000` through `0189` after the final exact Forecast role/content-digest FK changes: **PASS** (`FRESH_0000_0189_PASS_FINAL3`).
- Applied 0189 independently on a database already canonical through 0188: **PASS**.
- The schema establishes producer-owned runtime input, exact historical PIT input and knowledge-link tables with composite source FKs (including Forecast bundle, target role and content digest), append-only triggers, RLS, authenticated/anonymous revocation and retention/lookup indexes.
- Focused catalog/RLS/FK verification against that clean database: **PASS** (`1/1`).
- Populated compatibility replay: after producing one genuine Scientific V2 receipt, one contract binding, one predictive package, one Forecast bundle and its two role members, only the 0189 objects/indexes were removed. Reapplying 0189 over those retained canonical 0188-shaped rows passed, with counts unchanged (`binding=1, scientific=1, package=1, bundle=1, forecast=2`).
- Real database behavior matrix: genuine authorized `runBacktest` Forecast issuance → durable
  runtime input source → filesystem-derived dataset authority → canonical sequence-one accounting
  inception/preregistration/run start → SERIALIZABLE PIT producer → REPEATABLE READ exact loader
  and authority replay: **PASS**. The same run proved concurrent idempotent production, exact retry,
  wrong-dataset and build-SHA refusal, runtime/PIT UPDATE and PIT DELETE refusal, fake knowledge-link
  FK refusal, owner visibility, and `authenticated` revocation. Test cleanup also exercised the
  dependency graph without disabling production constraints outside the bounded cleanup transaction.
- This is disposable validation evidence and is not a claim about production migration state.
