---
specId: PCS-WAIA-BREATH
title: "Breath of WAIA — completion spec"
module: waia-core
maturity: active
owner: Architect
sourceOfTruth:
  - docs/product/waia-conscious-contribution-development-fund-doctrine.md
  - docs/product/waia-user-stewardship-doctrine.md
  - docs/plans/dee-606-breath-of-waia-transparent-treasury-ledger-watcher-ingestion.md
relatedGaps:
  - docs/gaps/breath-of-waia-gap-registry.md
relatedRoadmap: docs/roadmaps/breath-of-waia-roadmap.md
lastReviewed: 2026-08-24
version: 0.1.0
---

# Breath of WAIA — completion spec

## Purpose

Define the measurable product and operational boundary for a working Breath of WAIA: one trustworthy Treasury ledger, understandable public financial facts, voluntary-contribution shares, virtual Operating and Development Fund allocation, read-only wallet observation, and a bounded Human-operated Finance Assistant.

## Scope

- Authenticated Finance Console for transactions, budgets, counterparties, accounts, projects, evidence, wallet observation, fund allocation and publication preview.
- Public homepage Breath, Budget, Patrons and work-plan pages backed only by server-owned read models.
- Exact, fail-closed virtual Operating Fund and Development Fund allocation under the one-annual-budget rule.
- Read-only USDT TRC-20 Treasury observation through TronGrid with safe TronScan provenance links.
- English Finance Assistant for scoped reports and confirmation-gated creation of supported Treasury records.
- Operational readiness for Postgres migrations, provider secrets, R2 evidence storage, monitoring, publication and rollback.

## Out of scope

- Private keys, custody, signing, transfer broadcast or automatic physical movement between wallets, cards or bank accounts.
- Automatic financial verification, publication, budget approval or Development Fund spending authority.
- Commons, grants, subsidies, investments, patron governance weight or equity.
- Arbitrary SQL, shell access, generic database tools or autonomous AI authority.
- AI-TRADER, FHV, live trading, capital gates and the Execution Server.

## Acceptance criteria

- [x] Canonical Treasury supports watcher and manual entries, Human classification/review, catalogs, monthly budgets, evidence metadata, publication gates and audit.
- [x] Public Breath answers Available now, Runway and Annual budget without invented values.
- [x] Public Budget, transactions, Patrons contribution shares and Linear work plan are read-only and tenant-bound.
- [x] Virtual Operating and Development Fund allocation is exact, conserved, auditable and unavailable when authority is unsafe.
- [x] Fund allocation is exposed in Finance and public read models with the accounting-only boundary clearly stated.
- [x] A public Treasury wallet address can be registered and observed through the existing DARK-by-default USDT TRC-20 watcher; TronGrid/TronScan provenance is operator-visible without custody material.
- [x] The scheduled host, health probe and operational runbook can activate the Treasury watcher independently without blocking payment or Trader jobs.
- [x] Finance Assistant reports use authoritative typed facts with scope and as-of time.
- [x] Finance Assistant writes are limited to supported record creation and require preview, tamper-evident confirmation and existing audited services.
- [x] Provider outage, ambiguity, prompt injection, cross-tenant input, expired confirmation and forbidden actions fail closed.
- [x] Ordinary Finance UI remains useful without the AI provider.
- [x] Local validation, disposable Postgres checks and Finance Playwright E2E pass before one Human-reviewed PR is opened.
- [ ] Production activation occurs only through the documented Human wallet/secrets/R2/migration/publication/watcher gates.

## Dependencies

- Product doctrine: [`../product/waia-conscious-contribution-development-fund-doctrine.md`](../product/waia-conscious-contribution-development-fund-doctrine.md), [`../product/waia-user-stewardship-doctrine.md`](../product/waia-user-stewardship-doctrine.md)
- Watcher doctrine: [`../adr/0014-payment-watcher-execution-model-read-only-observer.md`](../adr/0014-payment-watcher-execution-model-read-only-observer.md), [`../adr/0015-tron-settlement-finality-rpc-trust-doctrine.md`](../adr/0015-tron-settlement-finality-rpc-trust-doctrine.md)
- Completed batches: DEE-606, DEE-607, DEE-611, DEE-617, DEE-618, DEE-619, DEE-661, DEE-671, DEE-672, DEE-673, DEE-690
- Completion batch: DEE-705

## Human gates

- Human review and squash merge of the single DEE-705 PR.
- Human supplies and registers only the public Treasury wallet address and approved watcher start block; private keys are never requested.
- Human configures provider and Finance Assistant secrets directly in the managed host, never in chat or Git.
- Human authorizes any production migration apply, R2 binding, first public publication and watcher enablement after preflight evidence is green.

## Validation commands

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm validate:canon
pnpm validate:pr-governance
```

Focused Treasury, assistant, watcher, security, Postgres isolation and Finance Playwright suites are release-blocking for DEE-705.

## Traceability

| Artefact | Link |
|----------|------|
| MVP hub | [`../product/WAIA-V1-MVP-SPEC.md`](../product/WAIA-V1-MVP-SPEC.md) |
| Gap registry | [`../gaps/breath-of-waia-gap-registry.md`](../gaps/breath-of-waia-gap-registry.md) |
| Roadmap | [`../roadmaps/breath-of-waia-roadmap.md`](../roadmaps/breath-of-waia-roadmap.md) |
| Canonical plan | [`../plans/dee-705-breath-operational-completion.md`](../plans/dee-705-breath-operational-completion.md) |
| Linear | DEE-705; includes DEE-706, DEE-707, DEE-708, DEE-709, DEE-710 |
