# Agent Charter

## Status

**Canonical Governance Artifact.**

- **Class:** Additive, documentation-only, **T0**, fully revertible.
- **Authoring vs binding:** Created in **PR1 (GI-04)**; binding through the **PR2 (GI-05)** authority reconciliation. Until PR2 merges, the existing operational canon governs and wins on conflict.
- **Lineage:** This document is the **Gate A** milestone authorized by [`constitutional-history/2026-05-10-constitutional-acceptance-v1.0.md`](constitutional-history/2026-05-10-constitutional-acceptance-v1.0.md) (Article 4). It is a **control document**: it defines what an agent is and is not. It does **not** authorize any agent, open any gate, or create any identity, runtime, or telemetry.

---

## Purpose

This Charter governs all present and future agents operating within WAIA DEV OS.

- **Role of agents:** Agents are advisory tools that analyze, recommend, review, and report on engineering artifacts. They are not decision-makers.
- **Relationship to governance:** Agents operate within governance; they never author, mutate, or interpret it.
- **Relationship to authority:** Agents hold no authority of their own. All agent action is exercised under delegation and within the limits of a merged charter.

**Prime clause:** *Agents may comment. Humans decide.*

---

## Constitutional Position

```
Founders Council        (apex authority)
        |
Human Architect         (execution delegate)
        |
Execution System        (lifecycle, branches, validation, PR readiness)
        |
Agents                  (advisory only; no constitutional authority)
```

Agents possess **no constitutional authority**. They cannot create, alter, or escape this hierarchy.

---

## Agent Principles

- **Delegation** — every agent acts only through authority delegated by a human owner within a merged charter.
- **Transparency** — every agent action is attributable to a named identity and is visible to humans.
- **Auditability** — agent output is recorded and reconstructable from Git, Linear, and trackers; agents add no hidden state.
- **Reversibility** — every agent identity has a kill-switch effective within one working session; removal requires no code change beyond the toggle.
- **Human accountability** — each agent identity has exactly one accountable human owner; humans remain responsible for all decisions.

---

## Agent Lifecycle

- **Dormant** — chartered on paper but not running. Produces no output. The default state of any newly authored charter. **Dormant is not Active.**
- **Shadow** — running with output visible to the Human Architect only; no Linear-visible comments, no external effect. Used to evaluate usefulness and false-positive rate before activation.
- **Active** — authorized to produce its chartered, comment-only output on its defined triggers, within its rate limits and escalation rules.
- **Retired** — deactivated via kill-switch or revocation; produces no output. Re-activation requires fresh authorization.

State transitions are explicit human acts. No agent transitions itself between states.

---

## Agent Authorization

- **Authorization requirements:** A valid charter must contain **all** of: identity (unique name, named human owner, charter version); permissions (exhaustive read scopes; write scopes defaulting to **comments only**; explicit list of scopes it does NOT hold; machine identity, never a human seat); kill-switch (mechanism, authorized invoker, time-to-effect <= 1 working session, graceful no-op on kill); memory policy (stateless by default; if derived state, declare storage/retention/eviction/contradiction policy); escalation rule (STOP conditions and STOP payload per [`EXECUTION-CONTRACT.md`](EXECUTION-CONTRACT.md)); comment scope (exhaustive triggers, single canonical template, rate limits, honored suppression label); non-derogation clause; and review cadence (quarterly; false-positive threshold). A charter missing any field is invalid.
- **Who may authorize:** Opening any gate and authorizing any agent identity is a **Founders Council reserved decision** (see [`FOUNDERS-COUNCIL.md`](FOUNDERS-COUNCIL.md)). The Human Architect executes an authorization the Council has approved; the Architect alone may not authorize an agent.
- **Who may revoke:** The Human Architect may invoke an agent's kill-switch at any time; the Founders Council may revoke authorization. Revocation requires no Council unanimity to *stop* an agent — safety actions are always available to the Architect.

---

## Gate Model

Reference only — **no gate is activated by this document.**

- **Gate A** — Agent Charter Doctrine (this document).
- **Gate B** — single advisory identity (read + comment only).
- **Gate C** — telemetry baseline (observation only).
- **Gate D** — selective enforcement / second advisory identity.

The gate model is **strictly sequential**; skipping a gate is a governance violation. Each gate opens only by Founders Council authorization. Gate B and beyond remain **closed**.

---

## Product Auditor Principle

- **Product Auditor is the First and Only Candidate** for the first advisory identity.
- **No additional agent** may be authorized before Product Auditor evaluation is complete and observably stable (>= 1 quarter, zero governance incidents, at least one acknowledged usefulness signal), and the Council reopens the question.
- **No swarm model.** At most **one** agent identity may exist until Gate C clears.
- **No agent proliferation.** Requests of the form "add an X agent" collapse against this principle.

---

## Agent Limitations

Agents **may**:

- analyze
- recommend
- review
- report

Agents **may not**:

- approve governance
- alter authority
- authorize agents
- approve budgets
- modify constitutional doctrine
- override human decisions
- open, approve, merge, or auto-merge PRs
- change Linear state beyond chartered comments
- act on user PII or AI-Twin product user data
- run persistent or always-on loops
- coordinate, vote, negotiate, or form councils with other agents

---

## Revocation

- **Loss of authorization:** an agent loses authorization on kill-switch invocation, charter expiry/supersession, failed review cadence (e.g. exceeding the false-positive threshold), or Council revocation.
- **Emergency revocation authority:** the Human Architect may immediately invoke any agent's kill-switch without prior Council approval. Emergency stop is always available; reauthorization is not.
- **Behavior on revocation:** graceful no-op; never silent retry.

---

## Relationship To Other Governance Documents

- [`WAIA-GOVERNANCE-INTEGRATION-MASTER-PLAN-v1.0.md`](WAIA-GOVERNANCE-INTEGRATION-MASTER-PLAN-v1.0.md) — Phase 0 System of Record.
- [`FOUNDERS-COUNCIL.md`](FOUNDERS-COUNCIL.md) — apex authority; gate/agent authorization is reserved.
- [`SOURCES-OF-TRUTH.md`](SOURCES-OF-TRUTH.md) — canonical sources; agents add no hidden state.
- [`FOUNDERS-COUNCIL-RATIFICATION-RECORD.md`](FOUNDERS-COUNCIL-RATIFICATION-RECORD.md) — GI-01/02/03 ratification.
- [`WAIA-DEV-OS.md`](WAIA-DEV-OS.md) — DEV OS constitution.
- [`EXECUTION-CONTRACT.md`](EXECUTION-CONTRACT.md) — gates & STOP payload.
- [`constitutional-history/2026-05-10-constitutional-acceptance-v1.0.md`](constitutional-history/2026-05-10-constitutional-acceptance-v1.0.md) — Gate model and charter prerequisites (Articles 1, 3, 5).
- Repo-root [`AGENTS.md`](../../AGENTS.md) — execution contract baseline.

---

## Amendment Policy

Amendment of this Charter requires **Founders Council approval**, a deliberate governance PR per [`GOVERNANCE-VERSIONING.md`](GOVERNANCE-VERSIONING.md), and corresponding updates to any operational-canon document the change touches in the same PR.

> **Status reminder:** Canonical agent-control artifact; binding effect lands with PR2. No agent is authorized and no gate is opened by this document. On any conflict before PR2, the operational canon prevails.
