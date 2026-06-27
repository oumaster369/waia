# DEE-170 — M7 Milestone Hygiene & Governance Review

> **Reconciliation (2026-06-27, BP-0 / DEE-347):** M7 paper-trading engineering validation is now **Accelerated Historical Replay Validation** (DEE-337 / PR #304). References below to the DEE-170 48h soak are **historical context** for this audit unless explicitly marked current.

**Linear project:** WAIA Development  
**Audit type:** Read-only milestone hygiene + governance review  
**Assessment date:** 2026-06-21  
**Prerequisite audit:** [DEE-170-48H-PAPER-SOAK-CLOSURE-REPORT.md](./DEE-170-48H-PAPER-SOAK-CLOSURE-REPORT.md) (48h soak PASS — historical)  
**Verdict:** **APPROVE FOR OPERATOR EXECUTION** (with conditions)

---

## Executive summary

Linear milestone **M7 — Paper Trading** is at **84.38%** (16 attached issues) despite M7 capability criteria being met by the DEE-170 48h soak (historical) and subsequently by DEE-337 Accelerated Historical Replay Validation. Three issues are mis-attached: **DEE-177** (epic spanning M7+M9), **DEE-178** (M7.5 governance gate), and **DEE-272** (M7.5 engineering). The approved hygiene plan re-milestones these issues without altering `parentId`, `blocks`, or `blockedBy`. After hygiene and DEE-170 closure, M7 becomes closable at 13 Done issues.

**Primary conditions:** Preserve audit comments before reassignment; create **M7.5 — Strategy Validation Gate** milestone; do **not** mark M7.5 complete when only DEE-272 is Done.

---

# Part I — Milestone Hygiene Audit

**Scope:** Read-only · Linear state as of audit · cross-checked against AI-TRADER Implementation Program v1.1 §4/§5/§6 and [ADR-0010](../adr/0010-strategy-validation-gate.md)

---

## Current Linear state (problem summary)

| Issue | Status | Milestone | Parent | M7-relevant work |
|-------|--------|-----------|--------|------------------|
| **DEE-177** | In Progress | **M7** | — (epic) | M7 slice **Done** (via DEE-222); M9 slice **open** (DEE-223) |
| **DEE-222** | Done | M7 | DEE-177 | M7 min telemetry FG |
| **DEE-253–256** | Done | M7 | DEE-222 | M7 telemetry slices |
| **DEE-223** | Backlog | **M9** | DEE-177 | M9 alerting FG ✓ already correct |
| **DEE-178** | Backlog | **M7** | — (gate) | M7.5 governance gate — **not M7** |
| **DEE-272** | Done | **M7** | DEE-178 | M7.5 service layer — **not M7** |

**Hygiene defect:** Two cross-milestone containers (DEE-177 epic, DEE-178 gate) and one M7.5 engineering issue (DEE-272) are attached to **M7**, while their open or post-M7 scope keeps M7 at **84.38%** despite M7 capability being met.

**Full M7 attachment (16 issues at audit):** DEE-170 (In Progress), DEE-177 (In Progress), DEE-178 (Backlog), DEE-209, DEE-210, DEE-222, DEE-253–256, DEE-267–271 (Done), DEE-272 (Done).

---

## Canon alignment

### AI-TRADER Program §6

| Milestone | Scope |
|-----------|--------|
| **M7** | Paper Trading Ready — AT-E9 + **AT-E15 min baseline** |
| **M7.5** | Strategy Validation Gate **Passed** — signed promotion per ADR-0010 |
| **M9** | Org-0 Live Ready — AT-E10, AT-E13, AT-E14B, **AT-E15 (full)** |

Program §4 line on AT-E15: **"M7/M9"** — intentional split delivery.

Program dependency graph: `AT-E15 (min) → AT-E9 → Strategy Validation Gate → AT-E11 → AT-E10`

M9 milestone description (Linear): *"Requires Strategy Validation Gate passed"* — gate is a **prerequisite**, not part of M9 engineering scope.

### ADR-0010

- Accelerated Historical Replay Validation = **plumbing** gate (M7 / AT-E9)
- Strategy Validation Gate = **sufficiency** gate for live promotion (M7.5)
- Gate is **governance + operator judgment**, not paper-loop engineering

### DEE-178 self-description

> *"Linear milestones do not support M7.5 cleanly, so the former milestone M7.5 is represented as this dedicated gate issue sequenced **between M7 and M9**."*

Attaching DEE-178 to M7 **contradicts** that stated intent and the M7 milestone description (*"Gate that follows"*).

---

## Hygiene verdicts

| Question | Recommendation |
|----------|----------------|
| **DEE-177 on M7?** | **No** — re-milestone to **M9** |
| **DEE-178 on M7?** | **No** — remove from M7; attach to **M7.5** (preferred) |
| **DEE-272 on M7?** | **No** — re-milestone to **M7.5** with parent DEE-178 |
| **Best program match** | Split AT-E15: M7 children stay M7; epic + alerting → M9. Gate track → M7.5 (not M7, not M9). |
| **M7 closable after hygiene?** | **Yes** — once DEE-170 → Done and reassignments applied |

---

## Recommended target structure

```
M7 — Paper Trading (close when all attached issues Done)
├── DEE-170  AT-E9 epic          → Done (after closure)
├── DEE-209  Paper Loop FG       → Done
├── DEE-210  Paper Reporting FG  → Done
├── DEE-222  Telemetry FG        → Done
└── DEE-253–256, DEE-267–271     → Done (slices / read models)

M7.5 — Strategy Validation Gate (NEW milestone)
└── DEE-178  GATE (parent container, governance)
    ├── DEE-272  service layer S1–S5  → Done
    └── [future per-strategy promotion operator issues]

M9 — Org-0 Live Ready
├── DEE-177  AT-E15 epic (alerting remainder)
│   └── DEE-223  Alerting FG  → Backlog
├── DEE-171  AT-E10 epic
├── DEE-173+ (AT-E13, AT-E14B, …)
└── (M9 description: requires DEE-178 gate passed)
```

**Relations to preserve (do not mutate):**

- DEE-178 `blockedBy` DEE-170 → satisfied when DEE-170 → Done
- DEE-178 `blocks` DEE-171 (AT-E10)
- DEE-272 `parent` DEE-178
- DEE-223 `parent` DEE-177

**Do not change:** DEE-222, DEE-253–256 milestone (stay M7 — they are the M7 AT-E15 deliverables).

---

## Milestone-closing comment (for M7 — use after mutations + DEE-170 → Done)

```markdown
## M7 — Paper Trading milestone CLOSED

**Hygiene note:** DEE-177 re-milestoned to M9 (alerting remainder). DEE-178 + DEE-272 moved to M7.5 gate track (post-M7, pre-live). M7 scope = AT-E9 + AT-E15 minimum baseline only.
**Canonical audit:** docs/ops/DEE-170-M7-MILESTONE-HYGIENE-GOVERNANCE-REVIEW.md

**Delivered:** Accelerated Historical Replay Validation (DEE-337 PASS), paper reporting read models, min observability baseline (DEE-222), validated measurable replay telemetry. *(Historical: DEE-170-48h operator soak also PASS.)*

**Not in M7:** Strategy Validation Gate passage (M7.5 / DEE-178), AT-E15 alerting (M9 / DEE-223), live trading (M9+).

**Next:** M7.5 operator gate (DEE-178) using DEE-337 Accelerated Historical Replay Validation evidence + PaperEvaluationExport.
```

---

# Part II — Final Governance Review

**Scope:** DEE-177 · DEE-178 · DEE-272 · M7 · M9  
**Mode:** Read-only · no mutations performed at audit time

---

## Issue hierarchy preservation

### Current hierarchy (unchanged by plan)

```
DEE-177  AT-E15 epic
├── DEE-222  Telemetry FG      [Done, M7]
│   └── DEE-253–256            [Done, M7]
└── DEE-223  Alerting FG       [Backlog, M9]

DEE-178  Strategy Validation Gate (no parent)
└── DEE-272  service layer S1–S5  [Done, M7]  parentId=DEE-178
```

### Proposed post-hygiene hierarchy (same tree; only milestone fields change)

```
DEE-177  [M9]  ← only milestone changes
├── DEE-222  [M7]  ← UNCHANGED (correct: M7 deliverable)
└── DEE-223  [M9]  ← UNCHANGED

DEE-178  [M7.5]  ← milestone only
└── DEE-272  [M7.5]  ← milestone only; parentId still DEE-178
```

| Check | Result |
|-------|--------|
| `parentId` modified? | **No** — plan preserves parent/child links |
| Open child under closed epic? | **No** — DEE-177 stays open while DEE-223 is Backlog |
| Done child under open gate? | **Yes (DEE-272 under DEE-178)** — already true today; intentional (engineering ≠ gate passage) |
| Cross-milestone parent/child (DEE-177 M9 → DEE-222 M7)? | **Allowed in Linear** — reflects split AT-E15 delivery (M7/M9) |

**Validation: PASS** — hierarchy is preserved; only milestone attribution is corrected.

---

## Dependency chain integrity

| Relation | Meaning | Status after hygiene |
|----------|---------|----------------------|
| DEE-177 **blocks** DEE-170 | AT-E15 min baseline before AT-E9 | **Unchanged** — satisfied in fact (DEE-222 Done); relation may remain stale until optional cleanup |
| DEE-177 **blockedBy** DEE-169 | AT-E8 before observability | **Unchanged** — satisfied |
| DEE-178 **blockedBy** DEE-170 | Gate after paper trading | **Unchanged** — clears when DEE-170 → Done |
| DEE-178 **blocks** DEE-171 | Gate before live execution | **Unchanged** — still correct |
| DEE-272 **blockedBy** DEE-271 | Service layer after export artifact | **Unchanged** — satisfied (DEE-271 Done) |
| DEE-223 **relatedTo** DEE-222 | Alerting depends on telemetry | **Unchanged** |

**Critical path (program):**  
`AT-E15 min → AT-E9 → Strategy Validation Gate → AT-E11 → AT-E10`

Milestone moves do **not** reorder this path. DEE-178 remains **between** M7 closure and M9 live readiness logically; it must **not** move to M9 (prerequisite ≠ M9 scope).

**Validation: PASS** — no dependency chains broken.

---

## Historical milestone reporting accuracy

### What remains accurate

| Artifact | After hygiene |
|----------|----------------|
| DEE-222, DEE-253–256 completed under **M7** | **Still true** — not reassigned; these *were* M7 work |
| DEE-223 on **M9** | **Still true** — unchanged |
| DEE-272 PR #230 merge / `completedAt` | **Unchanged** — status history immutable |
| 48h soak evidence tied to DEE-170 / M7 | **Historical record** (superseded for canonical validation by DEE-337) |

### What gets corrected (not erased)

| Misclassification today | After hygiene |
|-------------------------|---------------|
| DEE-272 (M7.5 engineering) counted toward M7 | Moves to M7.5 — **fixes** retroactive mis-tagging |
| DEE-178 (M7.5 gate) blocking M7 at 84.38% | Removed from M7 — **fixes** progress bar |
| DEE-177 (M9 remainder) blocking M7 | Moves to M9 — **fixes** epic/milestone mismatch |

### Reporting risks & mitigations

| Risk | Mitigation |
|------|------------|
| Reassigning **Done** DEE-272 changes milestone filter results | **Pre-mutation comment** on DEE-272 + M7 closure status update listing final M7 issue set |
| Future readers see parent M9 / child M7 split | **Comment on DEE-177** explaining intentional AT-E15 split per program §6 |
| M7 "completed issues" list differs before/after hygiene | **Expected and desired** — post-hygiene M7 set = true M7 scope only |
| M7.5 may show misleading progress when DEE-272 Done | M7.5 description + **do not mark M7.5 complete** until gate passage |

**Validation: PASS WITH MITIGATION** — reporting becomes *more* accurate if audit comments + M7 closure note are posted **before** reassignment.

---

## Hidden downsides (summary)

| Move | Key caveat |
|------|------------|
| DEE-177 → M9 | Epic on M9 while Done children stay on M7 — intentional per program §6 |
| DEE-178 → M7.5 | Gate Backlog may make M7.5 look idle despite DEE-272 Done — mitigate in milestone description |
| DEE-272 → M7.5 | M7.5 may briefly show high % — **do not** close DEE-178 or complete M7.5 |
| M7 closure | Progress 84.38% → 100% after DEE-170 Done — correct |

---

## Exact Linear mutation sequence (operator execution — not performed by this document)

**Do not execute out of order.** Post comments **before** milestone moves where noted.

### Phase 0 — Pre-flight snapshot

Post comment on **M7 — Paper Trading** milestone (`b85445f7-8d74-48c1-a92c-0fc83e86a8e4`):

```markdown
## Pre-hygiene M7 snapshot (2026-06-21)

Attached issues: 16 | Done: 13 | Open: DEE-170 (In Progress), DEE-177 (In Progress), DEE-178 (Backlog)
Progress: 84.38%

Hygiene plan: re-milestone DEE-177→M9, DEE-178+DEE-272→M7.5, then close DEE-170 and complete M7.
M7 deliverables (DEE-222, DEE-253–256, DEE-209/210, etc.) remain on M7 unchanged.
Canonical audit: docs/ops/DEE-170-M7-MILESTONE-HYGIENE-GOVERNANCE-REVIEW.md
```

### Phase 1 — Create M7.5 milestone

Create **M7.5 — Strategy Validation Gate** on project WAIA Development:

> Strategy Validation Gate Passed — signed promotion record per ADR-0010 for each strategy intended to go live (governance gate, not paper plumbing). Engineering prerequisite: DEE-272 Done. Gate passage: per-strategy operator promotion under ADR-0011. Does not complete M9. Source: AI-TRADER Program v1.1 §6.

### Phase 2 — Milestone reassignment (no hierarchy/relation changes)

| Issue | Action | Audit comment required |
|-------|--------|------------------------|
| **DEE-177** | M7 → **M9** | M7 min-baseline complete; epic re-milestoned for DEE-223 alerting |
| **DEE-178** | M7 → **M7.5** | Gate follows M7 per program §6 / ADR-0010 |
| **DEE-272** | M7 → **M7.5** | M7.5 engineering Done (PR #230); does NOT complete gate |

**Do NOT change:** `parentId`, `blocks`, `blockedBy`, `relatedTo`.

### Phase 3 — Verify intermediate state

- M7: **13** issues (12 Done + DEE-170 In Progress)
- Not on M7: DEE-177, DEE-178, DEE-272
- M9: gains DEE-177; retains DEE-223
- M7.5: DEE-178 (Backlog), DEE-272 (Done)

### Phase 4 — Close DEE-170

Post closing comment (from [soak closure report](./DEE-170-48H-PAPER-SOAK-CLOSURE-REPORT.md) §6) → **DEE-170 → Done**.

Optional: remove `DEE-178 blockedBy DEE-170` after DEE-170 is Done.

### Phase 5 — Complete M7 milestone

Verify M7: **13/13 Done**, progress **100%** → post closure comment → mark milestone **Completed** in Linear UI.

### Phase 6 — Post-closure posture

| Milestone | Expected state |
|-----------|----------------|
| **M7** | Completed, 13 Done issues, 0 open |
| **M7.5** | Active, DEE-272 Done, DEE-178 Backlog — **do not mark M7.5 complete** |
| **M9** | DEE-177 + DEE-223 attached; **not closable** until alerting + live epics done and **DEE-178 gate passed** |

---

## Final governance verdict

| Review area | Verdict |
|-------------|---------|
| Hierarchy preservation | **PASS** |
| Dependency chains | **PASS** |
| Historical reporting | **PASS WITH MITIGATION** (comments + snapshot required) |
| DEE-177 → M9 | **APPROVE** |
| DEE-178 → M7.5 | **APPROVE** (reject "no milestone" alternative) |
| DEE-272 → M7.5 | **APPROVE** (with M7.5 "not complete" guardrail) |
| M7 closure after sequence | **APPROVE** |
| M9 scope integrity | **PASS** (gate stays off M9) |

**Overall:** **APPROVE FOR OPERATOR EXECUTION** — follow Phases 0–5 in order; do not skip audit comments; do not mark M7.5 complete when only DEE-272 is Done.

---

## Related documentation

- [DEE-170 — 48h Paper Soak Closure Report](./DEE-170-48H-PAPER-SOAK-CLOSURE-REPORT.md)
- [ADR-0010 — Strategy Validation Gate](../adr/0010-strategy-validation-gate.md)
- [AI-TRADER Implementation Program v1.1 §6](../ai-trader/AI-TRADER-IMPLEMENTATION-PROGRAM.md)

---

*Read-only review. No Linear, Git, or code mutations were performed at audit time. This document is the canonical repository record for M7 milestone hygiene and governance approval.*
