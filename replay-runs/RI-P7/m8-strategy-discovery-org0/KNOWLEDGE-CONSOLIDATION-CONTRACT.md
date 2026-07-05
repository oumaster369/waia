# Knowledge Consolidation Contract

**Module:** `lib/trader/discovery/knowledge-consolidation.ts`  
**Table:** `trader_discovery_consolidation_record`

## Purpose

Append-only audit trail for operator-directed consolidation: dedupe markers, archive pointers, retirement notes — **never destructive deletion** of sealed RI artifacts.

## Allowed actions

| Action | Effect |
|--------|--------|
| `archive_observation` | Marks observation ref as archived in consolidation ledger |
| `dedupe_hypothesis_proposal` | Links duplicate proposals to canonical ref |
| `retire_candidate` | Records retirement rationale; candidate remains in Postgres |
| `consolidate_research_question` | Moves RQ status toward `consolidated` via append-only record |

## Forbidden

- DELETE on discovery substrate tables (blocked by append-only triggers)
- Automatic consolidation without operator attestation
- Mutation of sealed RI validation runs or blind artifacts

## Operator gate

Requires `trigger_knowledge_consolidation` authority + attestation digest on each consolidation record.
