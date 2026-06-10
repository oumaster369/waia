# /groom

Validate a Linear issue **before** `/plan-feature` or `/implement`. Use **Plan Mode** or **Ask Mode** (read-only).

## Input

User provides `DEE-NN` or pastes the issue body.

## What you must do

1. Fetch the issue via Linear MCP (`plugin-linear-linear` → `get_issue`).
2. Verify it belongs to project **WAIA** and team **DEE**.
3. Check the **Task Contract** ([`AGENTS.md`](../../AGENTS.md), [`TASK-LIFECYCLE.md`](../../docs/waia-governance/TASK-LIFECYCLE.md)):

   | Field | Required |
   |-------|----------|
   | Exactly one execution label | `frontend` \| `backend` \| `ai` \| `infra` \| `product` \| `design` \| `security` |
   | Context | yes |
   | Goal | yes |
   | Scope | yes |
   | Do NOT | yes |
   | Acceptance Criteria | yes |
   | Files | yes (paths or globs) |
   | Dependencies | yes (or explicit "none") |
   | Validation commands | yes |

4. Check **atomicity**: one verifiable outcome; flag mixed ownership (UI + DB + AI in one card).
5. Check **risk tier** hint in description or infer T0–T4 per [`RISK-TIERS.md`](../../docs/waia-governance/RISK-TIERS.md); flag T3/T4 for human hold.
6. Verify `Files` paths exist or are clearly to-be-created; cross-check against execution label ([`AGENT-EXECUTION-LABELS.md`](../../docs/waia-governance/AGENT-EXECUTION-LABELS.md)).
7. Output a **Groom Report**:

   - **Ready** / **Blocked**
   - Missing fields (smallest ask)
   - Suggested branch name: `dee-<NN>-<slug>`
   - Suggested decomposition (if not atomic)
   - Recommended next command: `/plan-feature` or `/decompose`

## Hard rules

- **No code edits** in this phase.
- If `DEE-NN` does not resolve in Linear → STOP ([`FAILURE-PATTERNS.md`](../../docs/waia-governance/FAILURE-PATTERNS.md) FP-005).
- Do not reprioritize the portfolio or bulk-edit Linear.
