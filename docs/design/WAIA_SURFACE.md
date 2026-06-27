# WaiaSurface — CVA surface primitive (DEE-146)

**Canonical implementation:** [`components/waia/waia-surface.tsx`](../../components/waia/waia-surface.tsx)

## Purpose

`WaiaSurface` is a small layout wrapper for instrumental and ceremonial panels. It centralizes WAIA semantic tokens and radii so feature code does not scatter one-off `className` strings.

Use it for **containers** (message logs, invitation cards, workspace sections). Do not use it for interactive controls — use shadcn primitives (`Button`, `Textarea`, etc.) instead.

## Variants

| Variant | When to use | Tokens / shape |
|---------|-------------|----------------|
| **`raised`** (default) | Dense tool UI: chat logs, lists, workspace sections | `rounded-waia-surface`, `border-border`, `bg-muted/10` |
| **`elevated`** | Solid panels that need WAIA elevation semantics | `rounded-waia-surface`, `border-waia-divider`, `bg-waia-elevated` |
| **`invitation`** | First-start / opt-in framing (ceremonial, not sustained reading) | `rounded-waia-ceremonial`, dashed `border-border`, `bg-muted/20` |

## Usage rules

1. Pick the **smallest** variant that matches intent — default to `raised`.
2. Pass layout/spacing via `className` (`p-3`, `flex`, `gap-*`); do not fork surface styling inline.
3. Preserve shadcn bridge tokens on `raised` and `invitation` for light-mode stability.
4. Set `data-slot="waia-surface"` is automatic — use it in tests, not in product logic.
5. Pilot adoption: [`components/dashboard/twin-dialogue-workspace.tsx`](../../components/dashboard/twin-dialogue-workspace.tsx) (`invitation` + `raised`).

## When NOT to create new variants

- **One-off padding or layout** — add `className` on an existing variant.
- **Interactive states** (hover, focus, disabled) — belong on the control, not the surface.
- **Atmospheric / blur / veil layers** — use layout wrappers and `--waia-atmo-*` per Design OS; not `WaiaSurface`.
- **Message bubbles or typography** — use conversational primitives (DEE-138); surfaces wrap regions, not copy.
- **New variant requests** — require a Design Foundation note and Architect approval; prefer extending the three variants only when semantics are genuinely distinct.
