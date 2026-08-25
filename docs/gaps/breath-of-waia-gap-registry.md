---
registryId: GAP-REG-WAIA-BREATH
title: "Breath of WAIA — gap registry"
scope: waia-core
owner: Architect
linkedSpec: docs/product-specs/breath-of-waia-completion.md
linkedRoadmap: docs/roadmaps/breath-of-waia-roadmap.md
lastReviewed: 2026-08-24
version: 0.1.0
---

# Breath of WAIA — gap registry

## Purpose

Track the remaining difference between the merged Treasury/Breath foundation and a safely operable, understandable module. DEE-705 closes these gaps as one Human-approved integration batch.

## Gap entries

| gapId | summary | severity | status | specRef | batchRef | evidence |
|-------|---------|----------|--------|---------|----------|----------|
| GAP-BREATH-001 | Virtual Operating/Development Fund truth is not visible in admin or public projections | major | resolved-in-code | Acceptance criteria §5 | DEE-705 / DEE-706 / DEE-708 | admin/public allocation projections and privacy tests green |
| GAP-BREATH-002 | Treasury watcher remains DARK without scheduled host/health activation readiness | critical | activation-pending | Acceptance criteria §6–7 | DEE-705 / DEE-706 / DEE-710 | scheduled host, health and DARK/READY_DARK proof complete; Human activation pending |
| GAP-BREATH-003 | Wallet and blockchain provenance lack complete operator/explorer UX | major | resolved-in-code | Acceptance criteria §6 | DEE-705 / DEE-706 / DEE-708 | Wallet/TronGrid readiness and safe TronScan UX covered by E2E |
| GAP-BREATH-004 | Finance operator cannot request reports or create supported records conversationally | major | resolved-in-code | Acceptance criteria §8–10 | DEE-705 / DEE-707 / DEE-708 / DEE-709 | strict planner, grounded reports and replay-safe preview/confirm flow green |
| GAP-BREATH-005 | R2, provider secrets, migration/publication and production activation lack one final fail-closed packet | critical | activation-pending | Acceptance criteria §12 | DEE-705 / DEE-710 | activation/rollback packet complete; managed configuration remains Human-only |

## Intake rules

- Product meaning remains governed by the linked doctrine; this registry cannot redefine it.
- New custody, spending, Commons or automatic-publication requests require a separate Architect-approved batch.
- Operational activation evidence may close GAP-BREATH-002/005 only after the explicit Human gate.

## Resolution workflow

1. Implement and validate the DEE-705 code/readiness packet locally.
2. Open one integration-ready PR to `main`; Human squash-merges.
3. Human completes the production activation checklist without sharing secrets.
4. Close gaps and mark the completion spec complete only after code and Human operational evidence are both authoritative.

## Traceability

| Artefact | Link |
|----------|------|
| Completion spec | [`../product-specs/breath-of-waia-completion.md`](../product-specs/breath-of-waia-completion.md) |
| Roadmap | [`../roadmaps/breath-of-waia-roadmap.md`](../roadmaps/breath-of-waia-roadmap.md) |
| Canonical plan | [`../plans/dee-705-breath-operational-completion.md`](../plans/dee-705-breath-operational-completion.md) |
| Lifecycle | [`../waia-governance/LIFECYCLE.md`](../waia-governance/LIFECYCLE.md) |
