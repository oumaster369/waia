# /decompose

Split a **parent** Linear issue into atomic child issues. Use **Plan Mode** before any implementation.

## Input

User provides parent `DEE-NN` and optional decomposition hints.

## What you must do

1. Fetch parent issue via Linear MCP (`plugin-linear-linear` → `get_issue` with relations).
2. Read parent Goal/Scope; identify mixed ownership or multiple verifiable outcomes.
3. Propose **2–8 child issues**, each with:
   - One execution label
   - Full Task Contract (Context, Goal, Scope, Do NOT, Acceptance Criteria, Files, Dependencies, Validation commands)
   - `parentId` = parent issue
   - Title: actionable, single outcome
4. Present the decomposition table to the user for approval **before** creating issues.
5. On approval, create children via `save_issue` (team **DEE**, project **WAIA**).
6. Add a parent comment listing created children with links.

## Decomposition patterns

| Parent pattern | Split into |
|----------------|------------|
| UI + API + schema | `frontend` + `backend` (+ `db/` child if migrations heavy) |
| Feature + tests only | implementation child + optional `qa`-labeled follow-up (non-execution) |
| Product spec + build | `product` grooming child + `frontend`/`backend` implementers |

## Hard rules

- **No code edits** in this phase.
- One child = one PR-sized outcome ([`TASK-LIFECYCLE.md`](../../docs/waia-governance/TASK-LIFECYCLE.md)).
- Do not create orphan epics — parent must exist ([`LINEAR-GOVERNANCE.md`](../../docs/waia-governance/LINEAR-GOVERNANCE.md)).
- Semantically sensitive AI-Twin changes need Architect visibility in parent or child description.
- Agents do not auto-start implementation on children — human picks next `Todo`.
