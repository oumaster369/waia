# Vitest hermetic environment directory

Vitest `envDir` points here so repository-root `.env.local` is not loaded during `pnpm test`.

Opt-in integration tests receive Postgres settings via explicit shell `process.env` only.
