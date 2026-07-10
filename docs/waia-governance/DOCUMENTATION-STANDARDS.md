# Documentation standards — traces & continuity

Goal: deterministic reconstruction (`git → PR template → ADR IDs → trackers → Linear`).

## Five-memory planes (per merged deliverable)

| Plane | Artefact expectation |
|-------|---------------------|
| **Implementation** | Diff + green CI checklist |
| **Architectural** | ADR [`../adr/`](../adr/README.md) OR `ADR: none` rationale when Tier≤T1 / obviously mechanical |
| **Operational** | PR links to rollout/runbook snippets when env/telemetry/staging semantics shift |
| **Migration** | PR states **explicitly touched / untouched trackers** referencing [`../migrations/DEE-64-TRACKER.md`](../migrations/DEE-64-TRACKER.md) lineage |
| **Governance** | If execution contract branching policy changes coincide, update BOTH [`EXECUTION-CONTRACT.md`](EXECUTION-CONTRACT.md)+[`AGENTS.md`](../../AGENTS.md) intentionally |

ADR necessity guidance pairs with **[`ADR-POLICY.md`](ADR-POLICY.md)** and **[`RISK-TIERS.md`](RISK-TIERS.md)**.

## Semantic continuity (recoverability, not bureaucracy)

When a change moves **product or authority meaning**—**AI-Twin** behavior, **readiness** progression, **aligned autonomy**, **Society** interaction rules, **governance** boundaries—keep **reconstruction cheap** for future readers: link the intent through **at least one** light anchor, e.g. merged **PR** (semantic line per [`PR-PROTOCOL.md`](PR-PROTOCOL.md)), **`docs/product/**`**, **`docs/waia-governance/**`**, an **ADR** if precedent must generalize ([`ADR-POLICY.md`](ADR-POLICY.md)), and/or **Linear** summary.**Avoid** silent narrative drift; **avoid** mandatory extra review stages—**traceability only**.

## Language canon (English authoritative)

- **English is the authoritative language** for all governance, constitutional, operational, and architectural documentation.
- **Translations are informational only.** On any discrepancy, **English prevails**.
- **Carve-out:** product/UI copy and user-facing strings **may remain multilingual** (e.g. verbatim landing copy); **user examples and quoted user content may remain multilingual**. These are product data, not governance prose, and are not subject to the English-prevails rule.
- Rationale and acceptance: [`../adr/0012-governance-integration-founders-council-and-english-canon.md`](../adr/0012-governance-integration-founders-council-and-english-canon.md), [`constitutional-history/2026-06-21-constitutional-acceptance-v2.0.md`](constitutional-history/2026-06-21-constitutional-acceptance-v2.0.md), [`FOUNDERS-COUNCIL-RATIFICATION-RECORD.md`](FOUNDERS-COUNCIL-RATIFICATION-RECORD.md) (GI-02). Binding effect lands with PR2; until then the operational canon governs.

## Heading conventions

Governance headings stay imperative + short (`# Title`, sections `##`).

Deprecation: prepend `**(Superseded by …)**` rather than deleting historical bullets when possible — then trim after ADR supersession logged.

**Natural compression:** When guidance moves, prefer a **short stub + supersession pointer** over two full narratives side by side—not a mandated cleanup ritual; favors semantic continuity without archive sprawl.

## Canonical plan promotion

Integration plans promote from draft (`.cursor/plans/`, gitignored) to committed canonical plans (`docs/plans/dee-<NN>-<slug>.md`) per [`docs/plans/README.md`](../plans/README.md). PR bodies reference the canonical plan path in `**Plan:**`. See [`INTEGRATION-BOUNDARY-POLICY.md`](INTEGRATION-BOUNDARY-POLICY.md) for integration-ready and post-merge reconciliation rules.

## When to author ADR

Non-obvious durable policy shifts, infra topology change, branching/merge rituals adjustments, rollout doctrine reinterpretations — see **[`ADR-POLICY.md`](ADR-POLICY.md)** (including **semantic / product pivots** that outlive a single PR).

## Optional deep dives

Rare major decisions MAY add dated narrative under docs if ADR insufficient — prefer ADR concise form first.
