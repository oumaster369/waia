# Task lifecycle (Linear + issue contract)

## Source of executable work

WAIA project in Linear (team **DEE**) per [`AGENTS.md`](../../AGENTS.md). Exactly **one execution label** owns implementation: `frontend` | `backend` | `ai` | `infra` | `product` | `design` | `security`.

## Required issue fields (agents)

If any required field is missing (`Context`, `Goal`, `Scope`, `Do NOT`, `Acceptance Criteria`, `Files`, `Dependencies`, `Validation commands`), STOP and request the smallest missing datum.

## Status flow (target)

Documented in `AGENTS.md` as Backlog → Todo → In Progress → In Review → Done. Some workspaces may omit `Todo` — **mirror board reality**: see [`LINEAR-GOVERNANCE.md`](LINEAR-GOVERNANCE.md).

### Selection order

[`AGENTS.md`](../../AGENTS.md): prefer `Todo`, then continuation of owned `In Progress`, then explicit `Backlog` grooming only when tasked.

### Terminal states

`Canceled`, `Duplicate` — do not revive for coding.

## Decomposition rule

One issue → one observable outcome PR (unless paired issues explicitly stacked).

### Semantically sensitive decomposition

Tiny **implementation** diffs can still carry **heavy product meaning**. When work touches **AI-Twin behavior**, **readiness semantics**, **aligned autonomy boundaries**, or **Society interaction rules**, favor **narrower Linear issues** (or explicit sub-scope bullets) **before** cramming unrelated meaning into “one small task”—reduces stealth semantic bundles without extra approval gates.
