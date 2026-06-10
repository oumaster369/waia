# app/ — Next.js routes and UI shell

**Execution label:** `frontend` (UI) · `backend` (API routes under `app/api/`)

## Defaults

- **RSC by default** — add `"use client"` only when hooks, browser APIs, or event handlers require it.
- Server Components fetch data on the server; keep secrets and DB access out of client bundles.
- Route groups and layouts follow Next.js 16 App Router conventions.

## Design canon

When editing `.tsx` or styles: follow [`.cursor/rules/50-waia-design-os.mdc`](../.cursor/rules/50-waia-design-os.mdc), [`docs/DESIGN_OS_V1.md`](../docs/DESIGN_OS_V1.md), tokens in `app/design/tokens-waia.css`.

## Testing

User-visible changes require Playwright e2e per [`.cursor/rules/30-testing.mdc`](../.cursor/rules/30-testing.mdc).

## Boundaries

- `frontend` does not own DB schema — coordinate via `backend` issues.
- `ai` owns prompts/inference — UI only renders contracts from `lib/`.
- Do not hardcode AI-Twin unlock thresholds; use product-defined constants from `lib/`.

## Key product surfaces

Dashboard shell, Twin/Diary/Society modes, dialogue interface — see [`docs/product/ai-twin-dashboard-shell.md`](../docs/product/ai-twin-dashboard-shell.md).
