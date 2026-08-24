# WAIA conscious contribution and Development Fund doctrine

**Status:** Proposed product doctrine. It becomes canonical only through Human Architect review and squash-merge of the DEE-613 pull request.

- **Owner:** Human Architect
- **Scope:** Economic meaning, fund-allocation semantics and safe implementation boundaries
- **Implementation authority:** None by itself; DEE-690 owns the first backend implementation

## Purpose

WAIA may be supported by people who voluntarily contribute because they want the system to keep living and developing. A contribution is not a compulsory tax, a moral debt or a purchase of greater human importance.

The first fund-accounting model must remain understandable: protect one approved year of WAIA operation, then account resources above that requirement to development. The model records how shared Treasury resources are assigned; it does not move money between physical accounts or wallets.

## Conscious contribution

A person should contribute only what they genuinely choose and can afford without harming the essential interests of their own life or family.

Contribution amount:

- records financial participation only;
- does not create ownership, equity, securities or promised return;
- does not create stronger governance or voting weight;
- does not make one person's human contribution more important than another's;
- does not give a patron control over other users or future beneficiaries.

Public language should use `voluntary contribution`, `conscious contribution` or another Human-approved term. The internal metaphor `tax of awareness` must not be presented as a legally mandatory tax.

## First implemented fund topology

The initial model has exactly two virtual accounting balances.

### WAIA operating fund

The operating fund protects the approved annual budget required for WAIA to remain alive, secure, maintained and able to operate.

### Development Fund

The Development Fund contains canonical free Treasury resources above the approved annual budget. Its purpose is future WAIA development. This doctrine does not authorize any particular Development Fund expense, physical transfer, investment, grant or external distribution.

The Development Fund is not yet WAIA Commons. Commons, solidarity support, universal-access subsidies and DAO allocation remain separate future mechanisms with their own legal, sustainability, privacy and governance gates.

## Approved allocation rule

The Human Architect approved this first policy on 2026-08-24.

Let:

- `A` be canonical current free funds after active commitments, derived by the existing Treasury accounting authority;
- `B` be the one applicable approved and published annual WAIA budget;
- both values use the same accounting currency and exact integer micros.

Then:

```text
operatingAllocation = min(A, B)
developmentAllocation = max(0, A - B)
```

The conservation invariant is:

```text
operatingAllocation + developmentAllocation = A
```

The annual budget is therefore fully protected before any amount is reported as Development Fund capital.

### Examples

| Canonical free funds | Annual budget | Operating fund | Development Fund |
|---:|---:|---:|---:|
| 60 | 100 | 60 | 0 |
| 100 | 100 | 100 | 0 |
| 135 | 100 | 100 | 35 |

The examples are unitless illustrations, not production amounts or approved budget values.

## Recalculation semantics

Fund balances are a deterministic current allocation of canonical Treasury truth, not ownership of specific banknotes, card balances or blockchain units.

The backend must recalculate after every material authoritative change, including:

- verification of an accounting-relevant transaction;
- a verified correction, refund or reversal;
- an active commitment change;
- activation or replacement of the approved annual budget;
- restoration of previously unavailable canonical accounting truth.

Unverified transactions do not affect either fund. Existing transactions must not be retroactively rewritten merely to manufacture fund ownership.

Every persisted allocation result must be idempotent and auditable. It must identify the policy version and commit to the authoritative inputs and outputs with a deterministic digest. A later correction produces new evidence; it does not erase prior evidence.

## Fail-closed boundary

The Development Fund amount is unavailable, not zero, when any required authority is missing or unsafe, including:

- no unique applicable approved annual budget;
- unavailable, stale or unresolved canonical accounting truth;
- incompatible currencies;
- negative free funds;
- inconsistent or non-integer financial inputs.

No frontend or public page may invent the amount by recomputing arbitrary transaction data in the browser.

## Custody and spending boundary

This allocation is accounting-only:

- money remains on the same Treasury accounts, cards and cryptocurrency wallets;
- no on-chain, bank or card transfer is triggered;
- no production financial record is mutated merely by adopting this doctrine;
- no Development Fund spending authority is created;
- no AI system receives capital authority.

A later spending workflow must define who may approve Development Fund use, how commitments reduce available balances, and how every expense is audited. Until then, the fund is visible accounting capacity only.

## Public claim boundary

Before DEE-690 is Human-merged and its authoritative read model exists, public product surfaces must not claim that the Development Fund is operational or show a calculated balance.

After implementation truth exists, a public surface may truthfully explain that:

- one approved annual WAIA budget is protected;
- resources above that amount are accounted to the Development Fund;
- the allocation does not physically move custody;
- contribution amount does not create ownership or governance power.

Exact public copy and presentation remain a separate frontend issue.

## Deferred policy

This first rule intentionally does not implement:

- adaptive reserve ratios or replenishment-velocity curves;
- a lower operating floor than one annual budget;
- Commons-to-Breath backstops;
- solidarity payments, grants or sponsored access;
- Development Fund investment;
- DAO voting, delegation or regional allocation;
- automatic physical transfers;
- patron control over allocations or beneficiaries.

These concepts remain research and future product direction. They must not weaken the first annual-budget protection rule without a later explicit Human policy change.

## Implementation responsibility

DEE-690 owns the first backend implementation contract:

- additive Postgres allocation policy/evidence persistence;
- exact integer allocation engine;
- tenant-scoped repository and service;
- immutable or append-only audit evidence;
- fail-closed derived read;
- unit, Postgres integration, isolation and idempotency tests.

DEE-690 must start from the then-current `origin/main` after competing migration work is resolved. It must not touch AI-TRADER, the Execution Server, production data, physical custody or public/admin UI.

## Relationship to other doctrine

- DEE-612 owns user stewardship, universal access and mutual-support principles.
- DEE-606 owns the canonical Treasury ledger and accounting substrate.
- DEE-617 owns the current public Treasury read model.
- DEE-611 owns the public Patrons list and contribution-share boundary.
- DEE-613 owns this economic doctrine.
- DEE-690 owns the first virtual Development Fund implementation.

