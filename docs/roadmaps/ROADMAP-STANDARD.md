# Roadmap standard — integration-batch schema

**Owner:** Architect · **Status:** Canonical · **Slice:** vNext G

Defines how WAIA roadmaps **order integration batches**: gap → Linear issue → canonical plan → PR → merge.

Roadmaps are **program architecture** (what ships in what order). Canonical plans hold **mutable per-batch state** ([`../plans/README.md`](../plans/README.md)).

---

## Purpose

| Layer | Mutability | Audience |
|-------|------------|----------|
| **Roadmap** | Revised on Architect approval | Program sequencing, dependencies |
| **Gap registry** | Entries open/close as work lands | Intake truth |
| **Completion spec** | `maturity` advances toward `complete` | Definition of done |
| **Canonical plan** | `state` updated during execution | Agent resumption |

---

## File naming

`docs/roadmaps/<program>-roadmap.md`

Examples (future):

- `docs/roadmaps/devos-vnext-roadmap.md`
- `docs/roadmaps/ai-twin-v1-roadmap.md`

---

## Frontmatter schema

```yaml
---
roadmapId: ROADMAP-<PROGRAM>
title: "..."
horizon: v1 | vNext | YYYY-QN
owner: Architect
linkedSpec: docs/product-specs/<spec>.md   # optional
linkedGapRegistry: docs/gaps/<registry>.md # optional
lastReviewed: YYYY-MM-DD
version: 0.1.0
---
```

---

## Integration-batch schema

Each batch under **Integration batches** uses:

```yaml
batchId: IB-<PROGRAM>-<NN>      # stable within roadmap
linearIssue: DEE-NNN            # integration issue id
title: "..."
dependsOn: []                   # batchIds or DEE-NNN ids
riskTier: T0 | T1 | T2 | T3 | T4
status: planned | approved | in-progress | complete | deferred
planPath: docs/plans/dee-NNN-slug.md   # null until plan promoted
gapRefs: []                     # gapIds from linked registry
acceptanceSummary: "..."        # one line — full criteria live in plan/spec
```

**Rules:**

- One `linearIssue` per batch — aligns with [`INTEGRATION-BOUNDARY-POLICY.md`](../waia-governance/INTEGRATION-BOUNDARY-POLICY.md).
- `status: complete` only after human merge to `dev` and gap entries closed.
- `planPath` populated when `/plan-feature` promotes to `docs/plans/`.

---

## Required body sections

| Section | Content |
|---------|---------|
| **Purpose** | Program outcome this roadmap sequences toward. |
| **Integration batches** | Ordered list or table using the batch schema above. |
| **Batch schema** | Copy of the YAML block above for authors (may be abbreviated if frontmatter carries batches). |
| **Dependencies** | Cross-roadmap, migration, or ADR prerequisites. |
| **Traceability** | Links to completion spec, gap registry, MVP hub, and master program docs. |

---

## Workflow

1. **Gaps triaged** in [`../gaps/`](../gaps/).
2. **Architect approves** batch ordering on roadmap.
3. **Linear integration issue** created per batch (`DEE-NNN`).
4. **Plan promoted** to `docs/plans/dee-NNN-slug.md` when work starts ([`LIFECYCLE.md`](../waia-governance/LIFECYCLE.md)).
5. **Execute** one PR per batch; update roadmap `status` and gap `status` on merge.

---

## Validation

```bash
pnpm validate:canon
```

See [`../../scripts/ops/validate-canonical-docs.sh`](../../scripts/ops/validate-canonical-docs.sh).

---

## Related canon

- [`PRODUCT-COMPLETION-SPEC-STANDARD.md`](../waia-governance/PRODUCT-COMPLETION-SPEC-STANDARD.md)
- [`../gaps/GAP-REGISTRY-STANDARD.md`](../gaps/GAP-REGISTRY-STANDARD.md)
- [`../plans/README.md`](../plans/README.md)
