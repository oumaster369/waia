# M9 forensic archive — 2026-07-08 transaction pooler crash

**Provenance:** Copied from operator forensics stash before migration cleanup (2026-07-10).

**Context:** First `0.1.7` campaign attempt crashed on Supabase **transaction pooler** (`:6543`) with `CONNECTION_CLOSED`. Superseding repeat-run artifacts live in the vault root (`mi-repeat-20260709` suffix, session pooler `:5432`).

**Files:**

| File | Notes |
|------|-------|
| `m9-campaign-operator-diagnostics.json` | Crash on `:6543` |
| `m9-evolution-cycle-mvp.json` | Evolution cycle state at crash |
| `m9-provider-sidecar.json` | Provider sidecar capture |
| `m9-research-rejection-record.json` | Rejection record |

Do not delete — supports DEE-399 / M9 operator forensics timeline.
