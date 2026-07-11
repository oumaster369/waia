# Gap registry standard

**Owner:** Architect · **Status:** Canonical · **Slice:** vNext G

Defines how WAIA records **known gaps** between product completion intent and current implementation — the intake surface for roadmap batches and integration plans.

---

## Purpose

Gap registries make **missing or partial work** explicit without polluting product journey docs or canonical plans.

| Concept | Location |
|---------|----------|
| **What should be true** | [`../product-specs/`](../product-specs/) completion specs |
| **What is missing or partial** | `docs/gaps/` registries |
| **When it will be closed** | [`../roadmaps/`](../roadmaps/) integration batches |
| **How it is executed** | [`../plans/`](../plans/) + Linear `DEE-*` |

---

## File naming

`docs/gaps/<scope>-gap-registry.md`

Examples (future):

- `docs/gaps/ai-twin-v1-gap-registry.md`
- `docs/gaps/platform-runtime-gap-registry.md`

Template: [`_TEMPLATE-gap-registry.md`](_TEMPLATE-gap-registry.md).

---

## Frontmatter schema

```yaml
---
registryId: GAP-REG-<SCOPE>
title: "..."
scope: ai-twin | waia-core | platform | cross-cutting
owner: Architect
linkedSpec: docs/product-specs/<spec>.md   # optional
linkedRoadmap: docs/roadmaps/<roadmap>.md  # optional
lastReviewed: YYYY-MM-DD
version: 0.1.0
---
```

---

## Gap entry schema

Each gap is a row or subsection under **Gap entries** with:

| Field | Required | Description |
|-------|----------|-------------|
| `gapId` | yes | Stable id, e.g. `GAP-AIT-001` |
| `summary` | yes | One-line description |
| `severity` | yes | `blocker` \| `major` \| `minor` \| `deferred` |
| `specRef` | optional | Acceptance criterion or section in linked completion spec |
| `evidence` | optional | PR, test, doc, or runtime observation |
| `status` | yes | `open` \| `in-progress` \| `closed` \| `wont-fix` |
| `batchRef` | optional | Roadmap `batchId` or Linear `DEE-NNN` closing this gap |
| `closedAt` | optional | ISO date when `status: closed` |

---

## Required body sections

| Section | Content |
|---------|---------|
| **Purpose** | Scope of this registry; which module or program it tracks. |
| **Gap entries** | Table or list using the gap entry schema above. |
| **Intake rules** | When to add a gap vs update product spec vs open Linear directly. |
| **Resolution workflow** | Path from gap → roadmap batch → plan → PR → closed. |
| **Traceability** | Links to completion spec, roadmap, and active Linear themes. |

---

## Intake rules (summary)

1. **Contradiction in product meaning** → fix `docs/product/**` or escalate; do not hide in gaps.
2. **Known incomplete implementation vs approved spec** → add gap entry.
3. **New deferred module work** → `severity: deferred` + link [`NON-GOALS.md`](../waia-governance/NON-GOALS.md).
4. **Each open blocker/major gap** should map to a roadmap batch or explicit `wont-fix` rationale.

Canonical plans may reference a registry via `provenance.gapRegistry` ([`../plans/README.md`](../plans/README.md)).

---

## Validation

```bash
pnpm validate:canon
```

See [`../../scripts/ops/validate-canonical-docs.sh`](../../scripts/ops/validate-canonical-docs.sh).

---

## Related canon

- [`PRODUCT-COMPLETION-SPEC-STANDARD.md`](../waia-governance/PRODUCT-COMPLETION-SPEC-STANDARD.md)
- [`../roadmaps/ROADMAP-STANDARD.md`](../roadmaps/ROADMAP-STANDARD.md)
- [`LIFECYCLE.md`](../waia-governance/LIFECYCLE.md)
