# DEE-518 — Addendum: Human ratification of migration 0148 (forward corrective open tails)

> **Provenance:** This is a **subsequent Human amendment/addendum** to the Gate-D–approved
> DEE-518 plan (`docs/plans/dee-518-ai-trader-correctness-mathematical-intelligence-fhv-v1.md`,
> approved commit `df6e02b7375a886e45569158c9b15bdcb3d0696a`, plan SHA-256
> `02c55a578333d182f7632946230b6f01662430ba5462d95c115cd6199c71a909`).
> It **does not** rewrite the historical approved plan body, which remains byte-identical to
> the approved commit. The approved plan's original migration map ended at **0145**.

## Human decision

- **Authorization token:** `HUMAN-RATIFY-DEE-518-0148-FORWARD-CORRECTIVE-OPEN-TAILS-V1`
- **Decision:** D2 approved — ratify the existing forward corrective migration 0148.
- **Ratified migration:** `db/migrations_postgres/0148_trader_forecast_v2_open_tail_null_bounds_v1.sql`
- **Ratified SHA-256:** `b0e445468a89303cbe9dc8611e9194a9d9774113b0990fe03f02125621fad1e8`
- **Scope of ratification:** this migration's exact bytes only. Does **not** authorize any
  future `0149+` migration. Does **not** preserve the old A3@147 storage PASS as current
  authority.

## Authoritative migration evolution

| Range / id | Provenance |
|------------|------------|
| `0110`–`0145` | Original Gate-D implementation map (approved plan body). |
| `0146` (`…a3_storage_representation_v1`, sha `9621c6d14f05d26c89ca476b0dd5d98ff6456fa620f7f4a5e32e7a352181eb96`) | Later Human-authorized A3 storage corrective migration (Closure VI). Participated in sealed A3 evidence. |
| `0147` (`…a3_storage_compaction_v1`, sha `bd10d01f0b84c866241eed33d6cdf58282661b336e7977826e55709620743216`) | Later Human-authorized A3 storage corrective migration (Closure VI). Participated in sealed A3 evidence. |
| `0148` (`…open_tail_null_bounds_v1`, sha `b0e445468a89303cbe9dc8611e9194a9d9774113b0990fe03f02125621fad1e8`) | **Human-ratified forward corrective** restoring Forecast V2 open-tail DDL semantics (this addendum). |

## Why 0148 is forward-only (not a rewrite of prior migrations)

- Committed/original `0112` `trader_forecast_target_bucket_v2` declared `lower_bound_scale8` /
  `upper_bound_scale8` as `text NOT NULL`.
- Committed/original `0124` `trader_forecast_scenario_v2` declared its outer bounds as
  `text NOT NULL` (later `bigint NOT NULL` via `0147`).
- The approved semantic architecture requires **open SQL `NULL` tails** (`lower_bound IS NULL`
  ⇒ −∞ `LOWER_TAIL`; `upper_bound IS NULL` ⇒ +∞ `UPPER_TAIL`).
- Rewriting committed historical base migrations (`0112`/`0124`) is rejected.
- Rewriting sealed `0146`/`0147` would **not** fix the `NOT NULL` origin in `0112`/`0124`, and
  would destroy A3 provenance (their exact bytes participated in A3 qualification).
- Therefore `0148` is the **smallest safe forward correction**.

## 0148 governance classifications

- `0148_INITIAL_CREATION_GOVERNANCE_CLASSIFICATION = IMPLEMENTATION_AGENT_VIOLATED_STOP_CONDITION`
  — the implementation agent originally created 0148 before Human authorization (recorded, not erased).
- `0148_CURRENT_STATUS = HUMAN_RATIFIED_FORWARD_CORRECTIVE`
  — this ratification cures authorization **prospectively** for the unpublished change; it does
  not falsify the historical event.
- Semantic scope re-evaluation: `0148_MINIMUM_FORWARD_IMPLEMENTATION_OF_RATIFIED_DDL`
  (supersedes the prior audit's provisional `0148_OVERBROAD` label — see below).

## Ratified DDL semantic scope (every statement bounded)

`0148` performs only:

1. `trader_forecast_target_bucket_v2`: temporarily `DISABLE` the append-only UPDATE trigger for
   safe DDL; `DROP NOT NULL` on `lower_bound_scale8` / `upper_bound_scale8`;
   `ADD COLUMN tail_semantics text NOT NULL DEFAULT 'INTERIOR'`; add
   `tftbv2_tail_semantics_check` (`LOWER_TAIL` / `INTERIOR` / `UPPER_TAIL`); add
   `tftbv2_open_tail_bounds_check` binding tail semantics ⇔ null/non-null bounds; re-`ENABLE`
   the trigger.
2. `trader_forecast_scenario_v2`: temporarily `DISABLE` the append-only UPDATE trigger;
   `DROP NOT NULL` on `lower_bound_scale8` / `upper_bound_scale8`; re-`ENABLE` the trigger.

No type changes, no new indexes, no PK/UQ changes, no RLS changes, no bundle/forecast/outcome/
calibration/package table changes, no storage-codec changes, no data rewrites, no destructive
operations. Trigger disable/enable is strictly scoped to the two tables' DDL.

## A3 evidence disposition

- Old A3@147 receipts are preserved **byte-for-byte** (no file rewrite):
  - P01 R5 raw `5835ad07ff92badf369ff9f9c4ea016b37af274b616bd94f7160b71864666e61`
  - P02 R2 raw `4246db0ff5673bb17aba060bf31612e0148e672bcc052cea2af3d7fa295acfd6`
  - P03 R1 raw `95723ae2f21aa981b4ffd0658079298d2c55c9e2e5f5b1ab3c7c217464101373`
  - Aggregate R1 raw `b778aafe3a082e244f598d9e77bc1ed190d47dc699ab013e136b4c99a19c064c`
- Classification: `A3_147_SUPERSEDED_FOR_CURRENT_SCHEMA_MAX_148`
  (equivalently `A3_147_HISTORICAL_VALID_FOR_SCHEMA_MAX_147`). **Not** `INVALID_AB_INITIO`:
  the evidence was valid for the schema it actually measured (max 147).

## Identity rebind (max 147 → 148)

- `FORECAST_V2_STORAGE_MIGRATION_MAX_EXPECTED`: 147 → **148**.
- `FORECAST_V2_STORAGE_SURFACE_MIGRATION_MAX`: 147 → **148**.
- `FORECAST_V2_CANONICAL_MIGRATION_MAX`: **145 (unchanged)** — relation-era bound; 0148 changes
  physical storage only, not the plan-semantic relation era.
- `storageSurfaceDigest`: `72524574cd1f20b728b2cffebe1c4f837881117af0474798138178ce098038cd`
  → **`e61c6dac262d2bfc2671b9c431fbcaa9802073398f80c80fd7f39a2ebfff2731`**.
- `a3CanonicalContractDigest`: **`b4474831…` unchanged** (relation inventory + canonical bound
  unchanged; source-truth outcome, not forced).
- Phase implementation digests: **unchanged** (no phase implementation-path source was edited):
  P01 `d7baed10…`, P02 `f3c9c465…`, P03 `3c90e8dd…`, Aggregate `23f99a87…`.

## Required A3 requalification (schema@148) — Human-launched later

Old P01/P02/Aggregate are superseded for schema@148 and must be recomputed. Old P03 is
directly reusable under the current aggregate/invalidation contract (see the requalification
prelaunch report). Minimum authoritative order: **P02@148 → P01@148 → Aggregate@148**
(P03 reused). No authoritative run is launched by this addendum.
