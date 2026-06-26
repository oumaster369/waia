# AI-TRADER — Settlement Reconciliation Event Taxonomy (S3-C-B)

Reference for the operator reconciliation workflow event ledger. Schema version: `waia.trader.settlement-reconciliation-event.v1`.

## Resolution types (terminal only)

- `MANUAL_APPLY`
- `WAIVE`
- `CLOSE_NO_ACTION`
- `CLOSE_DUPLICATE`

Escalation is a holding-state action, not a `resolutionType`.

## Event types

| Event | Actor | Payload highlights |
|-------|-------|-------------------|
| `CASE_OPENED` | system | `evidenceSnapshot`, `exceptionReason`, `priority` |
| `CASE_CLAIMED` | operator | `assignedTo`, `claimExpiresAt`, `idempotencyKey` |
| `CASE_RELEASED` | operator | `reason?`, `idempotencyKey` |
| `CLAIM_EXPIRED` | system | `expiredAssignee`, `claimExpiresAt`, `idempotencyKey` |
| `REVIEW_STARTED` | operator | `idempotencyKey` |
| `RESOLUTION_PROPOSED` | operator | `decisionId`, `resolutionType`, `targetInvoiceId?`, `projectedImpact`, `rationale`, `coolingOffUntil`, `recommendationRef?`, `idempotencyKey` |
| `PROPOSAL_CANCELLED` | operator | `decisionId`, `reason`, `idempotencyKey` |
| `RESOLUTION_EXECUTED` | operator | `decisionId`, `proposalRef`, `resolutionType`, `settlementApplicationRef?`, `effectiveAt`, `idempotencyKey` |
| `CASE_ESCALATED` | operator | `reason`, `idempotencyKey` |
| `CASE_REOPENED` | operator | `reason`, `idempotencyKey` |

Reserved (never emitted in S3-C-B MVP): `RESOLUTION_RECOMMENDED`.

## Evidence snapshot

Version: `waia.trader.reconciliation-evidence.v1`. Fields may be inline (`kind: inline`) or reference-capable (`kind: reference`) for future artifact storage.

## Effective outcome

Derived read model — never stored on settlement rows:

1. Application exists → `FINANCIALLY_APPLIED`
2. Else case `RESOLVED` with non-applying type → `CLOSED_WITHOUT_APPLICATION`
3. Else → `PENDING_RECONCILIATION` (includes `ESCALATED`)
