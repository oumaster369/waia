---
roadmapId: ROADMAP-WAIA-BREATH
title: "Breath of WAIA — completion roadmap"
horizon: v1
owner: Architect
linkedSpec: docs/product-specs/breath-of-waia-completion.md
linkedGapRegistry: docs/gaps/breath-of-waia-gap-registry.md
lastReviewed: 2026-08-24
version: 0.1.0
---

# Breath of WAIA — completion roadmap

## Purpose

Finish the already-merged Breath/Treasury foundation in one reviewable integration batch, then perform a separate Human-only production activation ceremony without adding another software PR.

## Integration batches

```yaml
- batchId: IB-BREATH-01
  linearIssue: DEE-705
  title: "Breath of WAIA operational completion + Finance Assistant"
  dependsOn: [DEE-606, DEE-607, DEE-611, DEE-617, DEE-618, DEE-619, DEE-661, DEE-671, DEE-672, DEE-673, DEE-690]
  riskTier: T3
  status: integration-ready
  planPath: docs/plans/dee-705-breath-operational-completion.md
  gapRefs: [GAP-BREATH-001, GAP-BREATH-002, GAP-BREATH-003, GAP-BREATH-004, GAP-BREATH-005]
  acceptanceSummary: "Expose fund truth, complete read-only wallet observation, add bounded Finance Assistant, and deliver Human activation readiness in one PR."
```

Production activation is a T4 Human-only checkpoint attached to IB-BREATH-01; it is not a second autonomous integration batch and performs no code merge.

## Batch schema

Each batch maps one Linear integration issue to one canonical plan, one primary branch, one PR and one merge event. Child issues are work-package ownership contracts included by the plan, not separate PRs.

## Dependencies

- Annual-budget fund allocation doctrine and DEE-690 implementation.
- Existing Postgres Treasury migrations through 0164 plus DEE-705 append-only confirmation receipts 0165/0166.
- Existing DARK Treasury watcher and watched-address inception contract from DEE-606.
- Managed Cloudflare/Postgres/R2/OpenAI/TronGrid configuration supplied only at the Human gate.

## Traceability

| Artefact | Link |
|----------|------|
| Completion spec | [`../product-specs/breath-of-waia-completion.md`](../product-specs/breath-of-waia-completion.md) |
| Gap registry | [`../gaps/breath-of-waia-gap-registry.md`](../gaps/breath-of-waia-gap-registry.md) |
| Canonical plan | [`../plans/dee-705-breath-operational-completion.md`](../plans/dee-705-breath-operational-completion.md) |
| MVP hub | [`../product/WAIA-V1-MVP-SPEC.md`](../product/WAIA-V1-MVP-SPEC.md) |
