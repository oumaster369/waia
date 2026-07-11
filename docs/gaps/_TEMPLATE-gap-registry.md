---
registryId: GAP-REG-SCOPE
title: "Scope — gap registry (template)"
scope: ai-twin
owner: Architect
linkedSpec: null
linkedRoadmap: null
lastReviewed: 2026-07-10
version: 0.1.0
---

# Scope — gap registry (template)

Replace placeholders before use. Delete this intro paragraph in real registries.

## Purpose

Describe which module or program this registry tracks and why gaps are recorded here instead of in product journey docs.

## Gap entries

| gapId | summary | severity | status | specRef | batchRef | evidence |
|-------|---------|----------|--------|---------|----------|----------|
| GAP-EX-001 | Example gap — replace with real entry | minor | open | Acceptance criteria §1 | null | null |

## Intake rules

- Add a gap when implementation lags an **active** completion spec acceptance criterion.
- Do **not** use gaps for product semantics disputes — escalate via [`../waia-governance/EXECUTION-CONTRACT.md`](../waia-governance/EXECUTION-CONTRACT.md).
- Set `severity: deferred` for explicitly out-of-scope ecosystem modules.

## Resolution workflow

1. Triage gap → assign `severity` and optional `specRef`.
2. Group into roadmap **integration batch** ([`../roadmaps/ROADMAP-STANDARD.md`](../roadmaps/ROADMAP-STANDARD.md)).
3. Create Linear integration issue + canonical plan.
4. Merge PR → set `status: closed`, `closedAt`, and `batchRef`.

## Traceability

| Artefact | Link |
|----------|------|
| Completion spec | `docs/product-specs/...` |
| Roadmap | `docs/roadmaps/...` |
| Lifecycle intake | [`../waia-governance/LIFECYCLE.md`](../waia-governance/LIFECYCLE.md) |
