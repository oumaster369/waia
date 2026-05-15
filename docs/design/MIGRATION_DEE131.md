# DEE-131 / WAIA Design Foundation — migration & operations

**Branch:** `feat/dee-131-waia-design-foundation`  
**Target:** `dev` only (never `main` without governance promotion).  
**Linear:** baseline audit and milestone [WAIA Design System & Atmospheric UX v1](https://linear.app/deepsense) (DEE-131–DEE-146).

## What changed

1. **Canonical docs:** [`DESIGN_OS_V1.md`](../DESIGN_OS_V1.md), [`DESIGN_FOUNDATION_V1.md`](../DESIGN_FOUNDATION_V1.md).
2. **Token source:** [`app/design/tokens-waia.css`](../../app/design/tokens-waia.css) (`--waia-*` OKLCH primitives + semantics).
3. **Tailwind v4 bridge:** [`app/globals.css`](../../app/globals.css) imports tokens; `@theme inline` exposes `waia-*` utilities (`bg-waia-field`, `duration-waia-base`, etc.).
4. **shadcn compatibility:** `:root` **light** theme values are **unchanged** vs previous `dev`. `.dark` maps legacy semantic variables to WAIA tokens when `class="dark"` is used.
5. **Governance:** [`.cursor/rules/50-waia-design-os.mdc`](../../.cursor/rules/50-waia-design-os.mdc).
6. **Dependency:** `motion` — installed for upcoming bounded product motion ([DEE-134](https://linear.app/deepsense)); **no imports in application code in this PR** (no bundle behavior change from tree-shaking if unused).

## Compatibility

| Surface | Effect |
|--------|--------|
| **Light (default `<html>` without `.dark`)** | Same CSS variables as before for `--background`, `--primary`, etc. No intended pixel shift. |
| **`.dark` on an ancestor** | Previously neutral shadcn-like dark; now WAIA midnight / gold / platinum via bridge. Opt-in only. |
| **Existing `bg-primary`, `text-foreground`, etc.** | Continue to resolve through shadcn variable names; in `.dark`, those variables **alias** WAIA semantics. |
| **`waia-*` utilities** | New optional API; use incrementally in follow-up issues. |

## Rollback

- Revert the merge commit on `dev` (single revert restores prior `globals.css`, removes tokens file, docs, rules, and dependency).
- No database or API changes.
- No environment variable changes.

## Risk summary

- **Low** for light-mode default UI (unchanged `:root` light palette).
- **Medium** only if the product later enables global `.dark`; then validate against Design OS (expected).

## Follow-ups (not in this PR)

- **DEE-135:** `next/font` pairing and explicit `--font-sans` / `--font-waia-serif` wiring in layout (avoid accidental font shifts here).
- **DEE-142:** Playwright visual baselines once routes are stable.
- **DEE-134 / DEE-140:** Use `motion` with `--waia-duration-*` / `--waia-ease-*` patterns.
