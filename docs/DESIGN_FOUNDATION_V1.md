# WAIA Design Foundation v1

**Companion:** [DESIGN_OS_V1.md](./DESIGN_OS_V1.md)  
**Purpose:** production token architecture, naming, Tailwind v4 wiring, rollout—not screen generation.  

**Goals:** calm intelligence, cinematic restraint, emotional readability, conversational depth, atmospheric continuity.  
**Guardrails:** no generic SaaS rainbow, no token explosion, no crypto/gaming density.

---

## 1. Color token system

**Format:** OKLCH in `:root` / `.dark` (see [`app/design/tokens-waia.css`](../app/design/tokens-waia.css)). Components consume **semantic** roles via Tailwind (`bg-waia-field`) or CSS `var(--waia-color-field)`.

### Primitives (bounded)

| Token | Role |
|-------|------|
| `--waia-primitive-midnight-*` | Field depth ladder |
| `--waia-primitive-gold-*` | Warm accent |
| `--waia-primitive-platinum-*` | Cool / twin accent |
| `--waia-primitive-mist-*` | Muted text |
| `--waia-primitive-snow-*` | Near-primary text |

### Semantic roles

Field, elevated, veil, foreground (primary/muted), accent-warm/cool, rim, danger/warning/success (instrumental), `on-accent-warm` for button labels.

---

## 2. Semantic token hierarchy

```mermaid
flowchart TB
  primitives [Primitives]
  semantic [Semantic roles]
  component [Component aliases]
  primitives --> semantic
  semantic --> component
```

**Rule:** React references **semantic** or **component** vars; primitives only in token source file.

---

## 3. Atmospheric palette

`--waia-atmo-*`: halo warm/cool, orbital opacity, vignette, optional grain. **Ceremonial routes only** (auth, onboarding, milestones).

---

## 4. Typography scale system

**Registers:** brand serif (`--font-waia-serif`), UI sans (existing `--font-sans`).

**Steps:** `--waia-type-display` through `--waia-type-mono`; fluid `clamp()` in tokens. Conversational body uses **body-lg** + relaxed line-height.

---

## 5. Spatial / spacing system

**Base grid:** 4px. **Eight steps:** `--waia-space-1` … `--waia-space-20`. Layout: `--waia-layout-prose-width`, `--waia-layout-form-width`, `--waia-layout-shell-padding`.

---

## 6. Motion token system

`--waia-duration-*`, `--waia-ease-*`, `--waia-stagger-tight`. Prefer opacity/blur/subtle translate; honor `prefers-reduced-motion`.

---

## 7. Lighting and glow system

`--waia-light-*` (rim, inner-warm, ambient warm/cool, focus). Max **two** concurrent glows (excluding focus).

---

## 8. Surface / elevation system

Levels: **field → raised → overlay → ceremonial** mapped to semantic colors.

---

## 9. Blur / glass hierarchy

`--waia-blur-none | veil-sm | veil-lg` + `--waia-surface-veil-opacity`. No blur on sustained dense reading UI.

---

## 10. Border / rim-light system

`--waia-border-hairline`, `strong`, `divider`; radii `--waia-radius-control-sm`, `surface-md`, `ceremonial-lg`.

---

## 11. Interaction state philosophy

Rest (quiet); hover (+luminance/rim); **focus-visible** mandatory; active slight press; disabled lowered opacity **without** glow; loading = slow low-contrast pulse.

---

## 12. Conversational typography rules

Prose width cap; line-height ≥ 1.55 for long messages; spacing between messages 0.75–1em; twin differentiation **subtle** (cool tint / rail).

---

## 13. Dashboard density rules

Avatar + readiness **low**; tabs **low–medium**; chat **medium**; settings **medium–high** with **solid** surfaces, **no marketing atmosphere**.

---

## 14. Mobile scaling logic

Slightly tighter shell padding; type clamp minimums ≥ ~15–16px; reduce atmo orbital; prefer solid over heavy blur when contrast/jank suffers; **no dashboard scroll hijack**.

---

## 15. Tailwind v4 token architecture

`@theme inline` exposes `--color-waia-*`, spacing, fonts, shadows, blur, radius, etc., each pointing at `--waia-*`. Shadcn legacy vars in **`.dark`** alias to WAIA semantics (see `tokens-waia.css`).

---

## 16. CSS variable naming conventions

**Prefix:** `--waia-`. **Pattern:** `--waia-<category>-<role>-<variant?>`. Categories: `color`, `atmo`, `space`, `type`, `duration`, `ease`, `blur`, `radius`, `shadow`, `border`, `layout`, `z`.

---

## 17. Suggested folder structure

```text
waia-app/
  docs/
    DESIGN_OS_V1.md
    DESIGN_FOUNDATION_V1.md
  app/
    globals.css
    design/
      tokens-waia.css
  components/
    waia/          # optional future: Surface, Typography utilities
```

---

## 18. Design engineering implementation strategy

**Phase A:** Tokens in CSS + `@theme` + `.dark` shadcn alias (done for dark theme).  
**Phase B:** `WaiaSurface`, button variants, prose utilities.  
**Phase C:** Migrate routes to semantic colors; gate atmosphere behind layout wrappers.  

**Governance:** avoid raw hex in components; accent budget in review; amend Foundation with version note when tokens change.

---

## Canonical reference implementation

Single source for computed values: [`app/design/tokens-waia.css`](../app/design/tokens-waia.css) and [`app/globals.css`](../app/globals.css) `@theme` bridge.

Operations: rollout/rollback notes for the foundation merge are in [`docs/design/MIGRATION_DEE131.md`](design/MIGRATION_DEE131.md).
