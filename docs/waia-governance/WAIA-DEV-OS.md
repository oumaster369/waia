# WAIA DEV OS — constitution

**Status:** Canonical overview of how WAIA uses **humans**, **agents**, **Linear**, **GitHub**, **docs**, and **tooling** as a governed operating system for evolution. Detailed rules live in linked documents—this page **coordinates** them, not replaces them.

**Baseline:** Repo root [`AGENTS.md`](../../AGENTS.md) plus [`EXECUTION-CONTRACT.md`](EXECUTION-CONTRACT.md).

---

## 1. Purpose

**WAIA DEV OS** turns “AI-assisted coding” into a **repeatable, auditable system**: bounded tasks, explicit approval boundaries, traced decisions in Linear, technical truth in Git, and rollout doctrine in migration docs. Cursor is powerful enough to automate large diffs—which means **without** DEV OS gates, coherence and accountability collapse.

Goals:

| Goal | Means |
|------|--------|
| **Intent survives execution** | Product + architecture live in prose and Linear; code must map back. |
| **Risk matches autonomy** | Tiers, PR discipline, migration memory. |
| **Audit trail** | Git history + PR + Linear issue + comments. |
| **Recoverable failure** | Rollback story, post-merge verification, documented escalation. |

---

## 2. Core principle

**Human Architect** owns product meaning, architecture boundaries, merge authority, and production posture. **Cursor (the agent)** executes **scoped** work under that contract. **Linear** is **operational memory** (what is approved, in flight, done). **Git / GitHub** is the **canonical technical diff** and review surface. **Migration docs** (`docs/migrations/*`, trackers) are **rollout truth** for runtime and persistence—code must not silently contradict them.

See also: [`CORE-PRINCIPLES.md`](CORE-PRINCIPLES.md), [`SYSTEM-MAP.md`](SYSTEM-MAP.md), [`GLOSSARY.md`](GLOSSARY.md).

---

## 3. Roles

| Role | Responsibility |
|------|----------------|
| **Human Architect / operator** | Approves scope and semantics; merges PRs; owns production/staging policy; resolves contradictions between product, governance, and trackers. |
| **Cursor agent** | Plans and implements **only** within an approved Linear issue (or explicit human instruction that does not bypass gates); runs validation; opens PR **readiness**; never self-merges. |
| **Linear (project WAIA)** | Single source of **executable** work items; status, labels, dependencies, closeout comments. See [`LINEAR-GOVERNANCE.md`](LINEAR-GOVERNANCE.md), [`TASK-LIFECYCLE.md`](TASK-LIFECYCLE.md). |
| **GitHub PR** | Review, CI, discussion, and merge **by humans**; branch `dee-*` links issues. See [`PR-PROTOCOL.md`](PR-PROTOCOL.md), [`BRANCHING-STRATEGY.md`](BRANCHING-STRATEGY.md). |
| **Migration docs & trackers** | Staged migration doctrine (e.g. DEE-64, DEE-95 family). See [`MIGRATION-GOVERNANCE.md`](MIGRATION-GOVERNANCE.md), [`../migrations/DEE-64-TRACKER.md`](../migrations/DEE-64-TRACKER.md). |
| **MCP & IDE tooling** | Cursor invokes external systems (e.g. Linear) via MCP with **documented** server ids and schemas—see §9. |

Planner/executor vocabulary: [`AGENT-ROLES.md`](AGENT-ROLES.md).

---

## 4. Execution lifecycle

End-to-end flow (may be compressed in small tasks, but **approval** and **audit** must not vanish):

1. **Recommendation** — Human or agent proposes the **next bounded** task (architecture leverage, dependencies, risk). Agent may **recommend**; human may **request** analysis only (no code).  
2. **Approval** — Architect/human **approves** scope: Linear issue exists/updated, execution label correct, acceptance criteria clear. **No implementation** of net-new engineering work without this (see §10).  
3. **Implementation** — Agent on a **`dee-<NN>-<slug>`** branch; matches [`AGENTS.md`](../../AGENTS.md) phased workflow (`/plan-feature` → `/implement` → `/test-and-fix`, etc.).  
4. **Validation** — **Canon:** `pnpm lint`, `pnpm typecheck`, **`pnpm test --run`**, `pnpm build` (see §8). Optional e2e / Postgres opt-in tests per issue.  
5. **PR** — Human-opened merge request to **`dev`** (agent supplies compare URL / body); agents **never** merge.  
6. **Merge** — Human merges after review + green CI ([`RISK-TIERS.md`](RISK-TIERS.md) merge hints).  
7. **Post-merge closeout** — Sync `dev`, prune branches, rerun or trust CI, tracker updates if semantics changed ([`POST-MERGE-PROTOCOL.md`](POST-MERGE-PROTOCOL.md)).  
8. **Linear update** — Issue **Done**, comment with PR link, merge commit hash, validation summary ([`DOCUMENTATION-STANDARDS.md`](DOCUMENTATION-STANDARDS.md), [`LINEAR-GOVERNANCE.md`](LINEAR-GOVERNANCE.md)).

Extended loop reference: [`AUTONOMOUS-EXECUTION-LOOP.md`](AUTONOMOUS-EXECUTION-LOOP.md).

---

## 5. Risk-tier discipline

Every change should carry an honest **risk tier** (T0–T4) per [`RISK-TIERS.md`](RISK-TIERS.md): docs-only vs routes vs auth vs infra. Higher tiers imply **narrower autonomy**, richer review, and explicit architect touch for T3/T4-class work.

---

## 6. PR and rollback discipline

- **Small, reversible PRs** preferred; one Linear issue ↔ one observable outcome when possible [`TASK-LIFECYCLE.md`](TASK-LIFECYCLE.md).
- **Rollback** = revert PR / config / env—not silent dual paths without documentation ([`POST-MERGE-PROTOCOL.md`](POST-MERGE-PROTOCOL.md), migration strategy docs).
- **Semantic impact** declarations: see [`PR-PROTOCOL.md`](PR-PROTOCOL.md).

---

## 7. Migration memory discipline

- **Trackers** state what shipped, what must not regress, and what remains ([`../migrations/DEE-64-TRACKER.md`](../migrations/DEE-64-TRACKER.md) and related `DEE-*` docs).
- Agents **cite** migration memory in PRs when touching runtime, persistence, or telemetry ([`MIGRATION-GOVERNANCE.md`](MIGRATION-GOVERNANCE.md)).
- **Forbidden shortcuts** (e.g. fake neutral DB APIs) are listed in trackers—do not “paper over” with abstractions.

---

## 8. Validation canon

Default local gate before PR (per [`AGENTS.md`](../../AGENTS.md)):

```bash
pnpm lint
pnpm typecheck
pnpm test --run
pnpm build
```

Use **`pnpm test --run`** for **one-shot** Vitest (avoids watch-mode hangs). Path-scoped or env-gated tests (e.g. Postgres integration) follow issue instructions and [`../postgres-development.md`](../postgres-development.md).

CI must stay aligned with the same invocation (see `.github/workflows/ci.yml`).

---

## 9. MCP and tooling rules

- **Linear in Cursor:** use MCP server id **`plugin-linear-linear`** (not an undocumented `linear` alias). See [`.cursor/rules/00-overview.mdc`](../../.cursor/rules/00-overview.mdc).
- **Before any MCP tool call:** read the tool **schema/descriptor** in the workspace MCP folder—**required** for correct parameters.
- **Secrets:** never commit; follow [`.cursor/rules/40-secrets.mdc`](../../.cursor/rules/40-secrets.mdc) and [`AGENTS.md`](../../AGENTS.md).

---

## 10. Semi-autonomous planning rules

| Allowed | Not allowed |
|---------|--------------|
| Agent **recommends** next bounded task (ranked candidates, risks, dependencies). | Implement **nett-new** scoped engineering **without** human/architect approval on **that** scope. |
| Agent **creates or updates** Linear issues **after** human approval to proceed (e.g. file DEE issue, backlog placement). | Create work that **redefines product/architecture** without explicit human sign-off. |
| Agent **documents** migrations and governance **when tasked**. | Silent contradiction of trackers or execution-contract hierarchy. |

Human approval gates (summary): [`EXECUTION-CONTRACT.md`](EXECUTION-CONTRACT.md).

---

## 11. What the Cursor agent must not do

Non-exhaustive; [`AGENTS.md`](../../AGENTS.md) remains authoritative:

- Push to **`main`** or **`dev`** directly.
- **Merge** or enable auto-merge for high-stakes tiers without human policy.
- **Implement** ambiguous or multi-owner issues without split issues.
- **Bypass** STOP / escalation when coherence breaks ([§12](#12-how-uncertainty-is-escalated)).
- **Invent** Linear statuses or violate **exactly-one** execution label rule.
- Expose **secrets** or production credentials in code, logs, or PR bodies.

---

## 12. How uncertainty is escalated

On ambiguity, contradiction, or unclear risk:

1. **STOP** — do not guess across product vs governance vs tracker vs issue.  
2. Follow [`EXECUTION-CONTRACT.md`](EXECUTION-CONTRACT.md) escalation: one-sentence question, contradicted doc links, proposed tier, optional ADR title.  
3. **Emergency** path: [`HUMAN-OVERRIDE.md`](HUMAN-OVERRIDE.md).

---

## 13. What counts as “task done”

An implementation task is **not** done until:

- Scope in the **Linear issue** is satisfied.  
- **Validation canon** (§8) is green (unless issue explicitly documents an exception).  
- **PR readiness** is complete per [`.cursor/commands/prepare-pr.md`](../../.cursor/commands/prepare-pr.md): branch pushed, compare URL, title/body—**human** opens/merges PR.  
- After merge: **post-merge closeout** and **Linear** terminal state + comment per [`POST-MERGE-PROTOCOL.md`](POST-MERGE-PROTOCOL.md).

---

## 14. Related index

| Topic | Doc |
|------|-----|
| Governance table of contents | [`README.md`](README.md) |
| Agent entrypoint | [`../../AGENTS.md`](../../AGENTS.md) |
| Cursor commands | [`.cursor/commands/`](../../.cursor/commands/) |
| Cursor rules | [`.cursor/rules/`](../../.cursor/rules/) |
| Architect checklist | [`LINEAR-ARCHITECT-NEXT-STEPS.md`](LINEAR-ARCHITECT-NEXT-STEPS.md) |
| Failure learning | [`FAILURE-PATTERNS.md`](FAILURE-PATTERNS.md) |
| Governance evolution | [`GOVERNANCE-VERSIONING.md`](GOVERNANCE-VERSIONING.md) |

---

## Document control

| Version | Note |
|---------|------|
| 1.0 | Initial WAIA DEV OS constitution (overview + gates + lifecycle). |
