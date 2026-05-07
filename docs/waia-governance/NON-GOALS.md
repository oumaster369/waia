# Non-goals (current engineering focus)

Complements—not replaces—explicit non-scope bullets in [`../product/ai-twin-user-flow.md`](../product/ai-twin-user-flow.md).

## Explicitly NOT building **now**

| Area | Notes |
|------|-------|
| **Business / 3P orchestration MVP** | No production workflows for companies module yet. |
| **AI-Trader** | Trading/finance automation platform out of scope until dedicated initiative. |
| **AI-Marketplace economy** | No marketplace transactional layer now. |
| **Speculative multi-agent AGI choreography** | No autonomous goal-driven agent herds beyond scripted dev assistants. |

## Anti-patterns (process)

| Anti-pattern | Why avoid |
|--------------|-----------|
| **Big-bang migrations** Without tracker slice | Risks regressions & unclear rollback narrative. |
| **Shadow branching conventions** Parallel naming schemes confuse agents [`FAILURE-PATTERNS.md`](FAILURE-PATTERNS.md). |
| **AI-generated semantic rewrites without Architect review** | Risks silent drift of product/governance meaning—Agents propose; Humans merge meaningful semantic changes. |
| **Runtime-first product reasoning** | Reduces WAIA to infrastructure narrative; runtime serves **human-centered AI-Twin** outcomes ([`SYSTEM-MAP.md`](SYSTEM-MAP.md), [`WAIA-V1-MVP-SPEC.md`](../product/WAIA-V1-MVP-SPEC.md)). |

## Lean principle

Prefer **few strong documents** referencing code & trackers versus duplicating migrating facts.
