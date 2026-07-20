# Research Campaign Lifecycle Contract

**Schema:** `waia.trader.discovery-research-campaign.v1`  
**Tables:** `trader_discovery_research_campaign`, `trader_discovery_campaign_state_record`

## States

| State | Meaning |
|-------|---------|
| `PROPOSED` | Campaign charter drafted; discovery orchestrator skips (default) |
| `ACTIVE` | Operator authorized (G3); evolution pass may run when `enabled=true` |
| `PAUSED` | No new experiments; existing evidence retained |
| `CONSOLIDATED` | Knowledge consolidation applied; no new hypotheses |
| `RETIRED` | Append-only retirement record; read-only archive |

## Transitions

All transitions are **append-only** state records with operator attestation digest. No UPDATE/DELETE on campaign rows.

## Parent-child contract

- Research Campaign **owns** Research Questions, Hypothesis Proposals, Strategy Candidates, Evidence Records
- Hypothesis Proposal **requires** `researchQuestionRef` (enforced in Hypothesis Studio)
- Discovery orchestrator refuses to run when campaign state ≠ `ACTIVE` or `enabled=false`

## Human gates

| Gate | Operator action | Authority key |
|------|-------------------|---------------|
| G3 | Accept research campaign / authorize run | `authorize_discovery_run` |
| G1a | Accept research question | `accept_research_question` |
| G1 | Accept hypothesis proposal | `accept_hypothesis_proposal` |
| G2 | Accept strategy synthesis | `accept_strategy_synthesis` |
| G6 | Trigger knowledge consolidation | `trigger_knowledge_consolidation` |
