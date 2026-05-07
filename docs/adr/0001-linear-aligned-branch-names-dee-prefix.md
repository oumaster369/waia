# ADR-0001 — Linear-aligned branch naming (`dee-<NN>-<slug>`)

Status: Accepted  
Date: 2026-05-07

## Context

Traceability suffered when Cursor rule defaults (`feature/…`), development workflow examples, Linear issue IDs embedded in **`AGENTS.md`**, and **`/prepare-pr`** precondition diverged.**Humans merging must map PR ↔ Linear quickly during split-runtime rollout.**

## Decision

Codify **`dee-<NN>-<slug>`** as canonical new-work branch naming, anchoring merges to **`DEE-NN`** for WAIA repos unless Architect documents an exception.**Legacy `feature/*` fades** via docs + tooling alignment.

## Consequences

+ Faster audit trail & automated script potential  
− Requires disciplined issue numbering adherence  
Neutral: Hotfix urgency handled via [`../waia-governance/HUMAN-OVERRIDE.md`](../waia-governance/HUMAN-OVERRIDE.md)

## Links

- Governance: [`../waia-governance/BRANCHING-STRATEGY.md`](../waia-governance/BRANCHING-STRATEGY.md)  
- Operational alignment PR: (populate when merges)  
