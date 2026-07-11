# Product completion spec standard

**Owner:** Architect · **Status:** Canonical · **Slice:** vNext G

Defines the **product completion spec** layer: durable, module-scoped definitions of *done* that bridge the MVP hub ([`../product/WAIA-V1-MVP-SPEC.md`](../product/WAIA-V1-MVP-SPEC.md)) and executable integration batches ([`../plans/README.md`](../plans/README.md)).

---

## Purpose

| Layer | Role |
|-------|------|
| **`docs/product/**`** | Authoritative user journey, models, and surface semantics (what the product *is*). |
| **`docs/product-specs/**`** | Completion specs — measurable *done* for a module or slice, with acceptance criteria agents can verify. |
| **`docs/plans/**`** | Mutable operational state for one integration batch (branch, validation, PR). |
| **`docs/gaps/**`** | Known gaps between spec intent and current reality. |
| **`docs/roadmaps/**`** | Ordered integration batches linking gaps → Linear → plans. |

Completion specs **do not replace** product journey docs. They **compress** scope into integration-ready acceptance criteria and traceability links.

---

## File naming

`docs/product-specs/<module>-<slug>-completion.md`

Examples (future, not pre-authored in Slice G):

- `docs/product-specs/ai-twin-v1-completion.md`
- `docs/product-specs/waia-core-auth-completion.md`

Templates: [`../product-specs/_TEMPLATE-COMPLETION-SPEC.md`](../product-specs/_TEMPLATE-COMPLETION-SPEC.md).

---

## Frontmatter schema

```yaml
---
specId: PCS-<MODULE>-<SLUG>
title: "..."
module: ai-twin | waia-core | platform | deferred-module
maturity: draft | active | complete | archived
owner: Architect
sourceOfTruth:
  - docs/product/...
relatedGaps: []          # optional: docs/gaps/<registry>.md
relatedRoadmap: null     # optional: docs/roadmaps/<roadmap>.md
lastReviewed: YYYY-MM-DD
version: 0.1.0
---
```

**Rules:**

- `specId` is stable; rename files only with Architect approval and supersession note.
- `maturity: complete` requires all acceptance criteria checked and linked integration batches merged.
- Do **not** embed secrets, env values, or credentials.

---

## Required body sections

Every completion spec **must** include these `##` headings (order flexible):

| Section | Content |
|---------|---------|
| **Purpose** | Why this spec exists; which product outcome it closes. |
| **Scope** | In-scope surfaces, behaviors, and modules. |
| **Out of scope** | Explicit non-goals (link [`NON-GOALS.md`](NON-GOALS.md) when deferring ecosystem modules). |
| **Acceptance criteria** | Verifiable checklist — the primary agent contract. |
| **Dependencies** | Upstream specs, migrations, ADRs, or integration batches. |
| **Traceability** | Links to product docs, gap registry entries, roadmap batches, and Linear themes. |

Optional: `## Validation commands`, `## Human gates`, `## Revision history`.

---

## Intake workflow

1. **Identify gap or roadmap batch** — see [`../gaps/GAP-REGISTRY-STANDARD.md`](../gaps/GAP-REGISTRY-STANDARD.md) and [`../roadmaps/ROADMAP-STANDARD.md`](../roadmaps/ROADMAP-STANDARD.md).
2. **Draft** from [`../product-specs/_TEMPLATE-COMPLETION-SPEC.md`](../product-specs/_TEMPLATE-COMPLETION-SPEC.md).
3. **Architect approval** before `maturity: active`.
4. **Promote integration batch** — one Linear issue → one plan in `docs/plans/` per [`INTEGRATION-BOUNDARY-POLICY.md`](INTEGRATION-BOUNDARY-POLICY.md).
5. **Close gaps** in the linked registry when acceptance criteria are met.

---

## Validation

```bash
pnpm validate:canon
# or
bash scripts/ops/validate-canonical-docs.sh
```

See [`../../scripts/ops/validate-canonical-docs.sh`](../../scripts/ops/validate-canonical-docs.sh).

---

## Related canon

- [`LIFECYCLE.md`](LIFECYCLE.md) — intake pointers
- [`DOCUMENTATION-STANDARDS.md`](DOCUMENTATION-STANDARDS.md) — five-memory closeout
- [`../plans/README.md`](../plans/README.md) — integration plan schema
