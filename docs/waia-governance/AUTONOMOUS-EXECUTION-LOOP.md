# Autonomous execution loop (12 steps)

Maps Cursor phases to WAIA artifacts. Humans remain merge authority unless [`HUMAN-OVERRIDE.md`](HUMAN-OVERRIDE.md).

**Orchestrator (pattern):** optional continuity mindset described in [`AGENT-ROLES.md`](AGENT-ROLES.md)—**not** a separate runtime. **Typically the same Architect/humans/implementers** sequence the loop steps (model/hints, sanity checks)—no external merge authority implied.

| Step | Action | Governor docs |
|------|--------|-----------------|
| 1 | Pick executable Linear issue label-sane | [`AGENTS.md`](../../AGENTS.md), [`TASK-LIFECYCLE.md`](TASK-LIFECYCLE.md), [`LINEAR-GOVERNANCE.md`](LINEAR-GOVERNANCE.md) |
| 2 | Read product + task file paths | [`../product/WAIA-V1-MVP-SPEC.md`](../product/WAIA-V1-MVP-SPEC.md), canonical product docs |
| 3 | Read governance + principles | [`EXECUTION-CONTRACT.md`](EXECUTION-CONTRACT.md), [`CORE-PRINCIPLES.md`](CORE-PRINCIPLES.md) |
| 4 | `/plan-feature` saves dated plan | `.cursor/commands/plan-feature`, [`DOCUMENTATION-STANDARDS.md`](DOCUMENTATION-STANDARDS.md) |
| 5 | **Align then implement:** task still fits [`WAIA-V1-MVP-SPEC.md`](../product/WAIA-V1-MVP-SPEC.md), [`GLOSSARY.md`](GLOSSARY.md) canon, [`NON-GOALS.md`](NON-GOALS.md); if semantic/product drift appears, STOP ([`EXECUTION-CONTRACT.md`](EXECUTION-CONTRACT.md)). Else implement on branch | `.cursor/commands/implement`, `.cursor/rules/20-code-style.mdc` |
| 6 | `/test-and-fix` gates | `.cursor/commands/test-and-fix`, `AGENTS.md` validation |
| 7 | Prepare PR | [`PR-PROTOCOL.md`](PR-PROTOCOL.md), `.github/pull_request_template`, [`RISK-TIERS.md`](RISK-TIERS.md) |
| 8 | Human reviews + merges | Maintainer / Architect depending on tier |
| 9 | Post-merge hygiene | [`POST-MERGE-PROTOCOL.md`](POST-MERGE-PROTOCOL.md) |
| 10 | Linear update + five-memory abbreviated closeout | [`LINEAR-GOVERNANCE.md`](LINEAR-GOVERNANCE.md) |
| 11 | Docs/trackers touched if behavior changed | [`DOCUMENTATION-STANDARDS.md`](DOCUMENTATION-STANDARDS.md), trackers |
| 12 | Queue next unblock | Architect for roadmap churn |

### Danger zones (agents)

T3/T4 infra, rollout levers, auth rewrite, speculative multi-owner PRs → escalate.

### Continuity checkpoints (non-blocking)

After **Step 7** (PR ready), **Step 9** (merge landed), **Step 12** (next task): whoever is sequencing work confirms risk tier, Linear link, suggested next model—Architect may override ad hoc. **Optional “Orchestrator” hat** (`AGENT-ROLES`): pattern only.
