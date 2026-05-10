<!--
Status: DOCTRINE (binding within scope)
Date: 2026-05-10
Version: 1.0
Authority: Architect-level constitutional acceptance.
Operationalization: Each Article still requires its own scoped Linear issue + branch + PR per EXECUTION-CONTRACT.md.
Read first: ../CONSTITUTIONAL-DOCTRINE.md
-->

# WAIA DEV OS — Constitutional Acceptance Artifact

> **Status: DOCTRINE (binding within the limits its own articles declare).** This artifact is the architect-level acceptance of the prior constitutional review. It binds **governance** within the scope its articles state; it does **not** authorize implementation, runtime, or agent identities by its own existence. Operationalization of any article still requires the standard `dee-<NN>-<slug>` branch + PR + human merge per `EXECUTION-CONTRACT.md`.
>
> On conflict with the operational canon (`AGENTS.md`, `WAIA-DEV-OS.md`, `EXECUTION-CONTRACT.md`, `CORE-PRINCIPLES.md`, `NON-GOALS.md`, `RISK-TIERS.md`, `AGENT-ROLES.md`, `LINEAR-GOVERNANCE.md`, `MIGRATION-GOVERNANCE.md`, `HUMAN-OVERRIDE.md`): the operational canon wins (Closing Clause C.2). This artifact must be amended to reconcile.

**Title:** Acceptance of the Agent Society Roadmap Review and Formal Compression of WAIA DEV OS Evolution Doctrine
**Status:** Accepted — Governance Consolidation (no implementation authorized by this artifact)
**Version:** 1.0
**Basis:** Prior constitutional review (dated 2026-05-10), evaluated against `docs/waia-governance/WAIA-DEV-OS.md`, `CORE-PRINCIPLES.md`, `EXECUTION-CONTRACT.md`, `NON-GOALS.md`, `RISK-TIERS.md`, `AGENT-ROLES.md`, `LINEAR-GOVERNANCE.md`, `MIGRATION-GOVERNANCE.md`, `HUMAN-OVERRIDE.md`, `EXECUTABLE-GOVERNANCE-HOOKS.md`, `AUTONOMOUS-EXECUTION-LOOP.md`.
**Source roadmap reviewed:** `2026-05-10-agent-society-roadmap.md` (canonized in this folder; original in Obsidian).
**Authority:** Architect-level constitutional acceptance. Operationalization of any Article herein still requires its own scoped Linear issue, branch, and PR per `EXECUTION-CONTRACT.md`.

---

## Preamble

WAIA DEV OS is hereby reaffirmed as **infrastructure for safely building the WAIA AI-Twin product** — not a product in itself, not an autonomous agent platform, not a multi-agent society. The Agent Society Roadmap is **accepted as a vision artifact** and **compressed to a bounded executable surface** by this document. Philosophical alignment with the roadmap is recognized; engineering scope expansion beyond the gates defined herein is **not** authorized.

---

## Article 1 — Acceptance of Review Conclusions

The following conclusions of the prior constitutional review are **accepted as binding**:

### 1.1 Gate Model (A → D) — Accepted

| Gate | Name | Authorization |
|------|------|----------------|
| **A** | Doctrine — Agent Charter & roadmap demotion | Authorized to be planned (Article 4 below) |
| **B** | Single Advisory Identity (read + comment only) | **Not authorized** until Gate A is merged and prerequisites of Article 5 are satisfied |
| **C** | Telemetry baseline (token / model / CI usage, observation only) | **Not authorized** until Gate B is observably stable for ≥ 1 quarter |
| **D** | Selective enforcement / second advisory identity | **Not authorized** until Gates B and C show no governance incidents and demonstrated usefulness |

The Gate Model is **strictly sequential**. Skipping a gate constitutes governance violation per `EXECUTION-CONTRACT.md`.

### 1.2 Agent Charter Doctrine — Accepted

No named, persistent, or Linear-resident agent may exist without a merged charter. Charter requirements are formalized in Article 5.

### 1.3 Advisory-Only Principle — Accepted

All authorized agent activity in the foreseeable horizon is **advisory**. No agent may take state-changing action on Linear, Git, GitHub, infrastructure, or product surfaces beyond writing comments per its charter.

### 1.4 MVP Protection — Accepted and reinforced

`AI-Twin v1` (per `WAIA-V1-MVP-SPEC.md`, `ai-twin-user-flow.md`, `ai-twin-readiness-model.md`) **remains the primary product roadmap**. Any DEV-OS evolution that competes with AI-Twin v1 engineering attention is, by default, **deprioritized**.

### 1.5 Governance-First Scaling — Accepted

Capability expansion follows doctrine, never precedes it. Sequence is permanently: **doctrine → identity → permission → behavior → telemetry → selective enforcement.** Reversed sequencing is prohibited.

### 1.6 Refinements applied to the review

Two clarifications are added to the accepted conclusions:

- **R-1.** "Observably stable for ≥ 1 quarter" (Gate C precondition) is defined as: zero governance incidents attributable to the advisory identity, and at least one Architect-acknowledged usefulness signal (e.g. PR review citing an advisory comment as load-bearing).
- **R-2.** Demotion of the Agent Society Roadmap to vision status (Article 2.3) must be **explicit and discoverable** from `docs/waia-governance/`, not implied.

---

## Article 2 — Formal Roadmap Compression

The Agent Society Roadmap is compressed into three disjoint tiers. Movement between tiers requires Architect-approved governance update.

### 2.1 EXECUTABLE (near-term, doctrine-bound)

- **E-1.** Authoring of the **Agent Charter Doctrine** (Article 4 milestone).
- **E-2.** Explicit demotion in `NON-GOALS.md` and `AGENT-ROLES.md` of "Agent" terminology, distinguishing pattern (today) from chartered-comment-only-identity (Gate B candidate) from agent society (vision).
- **E-3.** Cross-link to the Obsidian Agent Society Roadmap as a **named vision artifact** in `docs/waia-governance/` (without copying its content into governance prose).

Nothing else is in EXECUTABLE scope.

### 2.2 DEFERRED (admissible only after preconditions are met)

- **D-1.** A single Linear advisory identity (Gate B), comment-scoped, after Gate A merge.
- **D-2.** Token / model / CI-minute telemetry collection, observation-only (Gate C), after Gate B stability.
- **D-3.** Graduation of one item from `EXECUTABLE-GOVERNANCE-HOOKS.md` from advisory to selective blocking, per its existing adoption rules (Gate D candidate).
- **D-4.** A second advisory identity (e.g. cost / migration preflight) after Gates B and C clear.

DEFERRED items are **not on the active roadmap**. They become candidates only when the Architect formally opens the next gate.

### 2.3 VISION ONLY (philosophy; not engineered)

- **V-1.** Multi-agent society with named, distinct, persistent agents (Architect Agent, Migration Agent, Governance Agent, Cost Agent, Release Agent, Product Agent, Telemetry Agent, Twin Memory Agent, Security Agent, Socialization Agent).
- **V-2.** Continuous / persistent / always-on agent loops ("Phase 4 — Persistent WAIA").
- **V-3.** Agent-to-agent communication, negotiation, consensus formation, councils.
- **V-4.** Discord / voice / external-channel agent surfaces.
- **V-5.** Agents holding autonomous budgets they spend without human authorization.
- **V-6.** Agents authoring or mutating governance documents.
- **V-7.** DEV-OS agent infrastructure as a substrate for WAIA AI-Twin user-facing socialization.

VISION items inform philosophy. They **do not** justify engineering work, Linear issues, or experimentation under WAIA-DEV-OS today.

---

## Article 3 — Official Near-Term Doctrine

The following clauses are adopted as **binding near-term doctrine**, complementary to (not replacing) `EXECUTION-CONTRACT.md` and `AGENT-ROLES.md`. On conflict, `AGENTS.md` and `EXECUTION-CONTRACT.md` remain superior; this Article extends them.

### 3.1 Prime clause

> **Agents may comment. Humans decide.**

This is the operational compression of the Architect-owned approval gates. It applies to all current and future advisory identities until and unless a future Architect-approved governance update modifies it.

### 3.2 Triggering discipline

- **3.2.1** All agent activity must be **event-triggered** (issue/PR webhook, explicit human invocation, scheduled report with documented bounds).
- **3.2.2** No polling beyond a documented schedule.
- **3.2.3** No persistent loops. No "always-on" runtime.
- **3.2.4** Every trigger must have a documented stop condition and an idempotency rule (e.g. "at most one comment per issue per state transition").

### 3.3 Authority discipline

- **3.3.1** No autonomous governance: agents do not author, mutate, or interpret governance documents.
- **3.3.2** No autonomous merge: agents do not open, approve, merge, or auto-merge PRs.
- **3.3.3** No autonomous Linear writes beyond comments authorized by charter: no status changes, label changes, assignments, parent links, priorities, dependencies, or issue creation/deletion.
- **3.3.4** No autonomous spend: agents may report cost; humans authorize spend.
- **3.3.5** No multi-agent councils, voting, negotiation, or consensus formation between agents.
- **3.3.6** Agents do not act on user PII or AI-Twin product user data; DEV-OS agents operate on engineering artifacts only.

### 3.4 Identity discipline

- **3.4.1** Each agent identity is realized through a **machine identity** (OAuth app / API key with scoped permissions), **not** a human Linear seat.
- **3.4.2** Each comment authored by an agent must be unambiguously attributable: identity name and footer line referencing the active charter version.
- **3.4.3** Each agent identity has exactly one human owner accountable per `AGENT-ROLES.md` authority hierarchy.

### 3.5 Reversibility discipline

- **3.5.1** Every agent identity has a documented kill-switch (env var, Linear label, or revocation procedure) executable by the Architect within the same session it is needed.
- **3.5.2** Removal of an agent identity must not require code changes beyond toggling its kill-switch.

### 3.6 Memory discipline

- **3.6.1** Agents do **not** maintain private persistent memory beyond what already exists in Git, Linear, and migration trackers.
- **3.6.2** If an agent uses derived context (e.g. cached Linear issue text), retention bounds must be declared in its charter.
- **3.6.3** Linear, Git, and migration trackers remain the canonical sources of truth. No agent-derived store may silently override them; contradictions trigger STOP per `EXECUTION-CONTRACT.md`.

### 3.7 Escalation discipline

- **3.7.1** Every agent has a documented escalation rule: what conditions require it to STOP and surface to a human.
- **3.7.2** Default escalation surface: a Linear comment on the originating issue, structured per the same `STOP` payload defined in `EXECUTION-CONTRACT.md` (one-sentence question, contradicted documents, proposed risk tier, optional ADR title).

---

## Article 4 — Approved Next Bounded Milestone

Exactly one milestone is authorized at this time.

### 4.1 Milestone identity

- **Name:** Agent Charter Doctrine (Gate A)
- **Type:** Documentation-only governance milestone
- **Risk tier:** **T0** (with the `T0 caveat` from `RISK-TIERS.md` acknowledged: this milestone redefines autonomy boundary semantics, so Architect visibility is mandatory and review depth is treated as **≥ T1** for governance review purposes).
- **Scope:** Authorship and merge of `docs/waia-governance/AGENT-CHARTER.md`, plus minimal cross-reference updates in `AGENT-ROLES.md` and `NON-GOALS.md`, plus a vision-artifact link to the Obsidian roadmap.

### 4.2 What this milestone delivers

- A canonical definition of what a "WAIA DEV OS agent" is and is not.
- A required template for any future agent (Article 5).
- The formal demotion of the Agent Society Roadmap to vision status.
- A discoverable doctrinal anchor that future requests of the form "let's add an X Agent" will collapse against.

### 4.3 What this milestone does **not** deliver

- No agent identity.
- No Linear OAuth application.
- No telemetry.
- No code changes outside `docs/`.
- No new MCP server or hook.

### 4.4 Authorization mechanics

This artifact authorizes the **planning intent** of the milestone. Operationalization still requires:

- A scoped Linear issue under the appropriate parent per `LINEAR-GOVERNANCE.md`.
- A `dee-<NN>-<slug>` branch.
- A PR opened and merged by a human per `EXECUTION-CONTRACT.md`.

No work on Article 4 is authorized to begin within the conversation in which this artifact was produced. Initiation is a separate act.

---

## Article 5 — Gate B Prerequisites (Charter Requirements)

No advisory agent identity may exist until **all** of the following prerequisites are satisfied. These prerequisites are the substantive content the Article 4 milestone must encode in `AGENT-CHARTER.md`.

A valid charter is a single document containing **all** of:

### 5.1 Identity

- Agent name (unique, stable, human-readable).
- Owner: named human (Architect or delegate per `AGENT-ROLES.md`).
- Active charter version and supersession rule.

### 5.2 Permissions

- Exhaustive enumeration of every read scope.
- Exhaustive enumeration of every write scope (default: **comments only**).
- Explicit statement of all write scopes the agent **does not** have.
- Identity realization mechanism (OAuth app, API key, etc.) — never a human seat.

### 5.3 Kill-switch

- Mechanism (env var, Linear label, OAuth revocation, or equivalent).
- Owner authorized to invoke it.
- Maximum time-to-effect (must be ≤ 1 working session).
- Behavior on kill: graceful no-op; never silent retry.

### 5.4 Memory policy

- Whether the agent maintains derived state at all.
- If yes: storage location, retention bound, eviction rule, contradiction policy with Git/Linear/trackers.
- If no: explicit declaration that the agent is stateless beyond per-event context.

### 5.5 Escalation rule

- Conditions that trigger STOP.
- Form of the STOP comment (must conform to `EXECUTION-CONTRACT.md` STOP payload).
- Whom to surface to.

### 5.6 Comment scope (bounded)

- Trigger events (exhaustive list).
- Comment template (single canonical structure with a unique header).
- Rate limit (per issue, per state transition, per day).
- `agent-quiet`-equivalent suppression label honored on every issue.

### 5.7 Non-derogation clause

- Explicit statement that the charter does not, under any circumstance, grant authority to mutate governance, merge PRs, change Linear state beyond comments, or act on user PII / AI-Twin product data.

### 5.8 Review cadence

- Quarterly Architect review per the adoption rules in `EXECUTABLE-GOVERNANCE-HOOKS.md`.
- Noise threshold: ≤ 5% false-positive comments before any expansion of scope.

A charter missing any of 5.1 – 5.8 is **invalid** and Gate B remains closed.

---

## Article 6 — Reaffirmation of WAIA DEV OS Role

### 6.1 What WAIA DEV OS is

- A governed system for **safely building WAIA**.
- A discipline layer over Cursor-assisted coding, Linear operational memory, GitHub technical truth, and migration doctrine.
- A proving ground that may, **philosophically only**, inform the future architecture of WAIA AI-Twin society — without being engineered as that society.

### 6.2 What WAIA DEV OS is not

- WAIA DEV OS is **not the WAIA product**.
- WAIA DEV OS is **not** an autonomous agent platform.
- WAIA DEV OS is **not** a multi-agent society.
- WAIA DEV OS is **not** a substitute for the AI-Twin user-facing socialization layer described in product specs.

### 6.3 Primacy of AI-Twin v1

- The AI-Twin v1 roadmap (per product canon) **remains the primary engineering priority**.
- Any DEV-OS evolution that would (a) consume engineering attention away from AI-Twin v1, (b) introduce new runtime surfaces, (c) introduce new vendor dependencies, or (d) blur the boundary between DEV-OS infra and AI-Twin product, requires **explicit Architect approval** in the form of an ADR.
- This Article supersedes any ambiguous reading of the Agent Society Roadmap that could be interpreted as authorizing parallel scope.

---

## Article 7 — Recommended Next Operational Sequence (Governance Only)

After acceptance of this artifact, the recommended sequence is **strictly governance consolidation**. No tasks, plans, or PRs are created by this artifact; the sequence below is the **next discrete steps** the Architect may choose to initiate when ready.

### 7.1 Step 1 — Anchor this acceptance

Preserve this artifact as the canonical record of the constitutional acceptance:

- Save to a discoverable location accessible to future agent sessions (Obsidian or `docs/waia-governance/` once the Article 4 milestone is initiated).
- Reference its existence in the next governance-touching PR description.

### 7.2 Step 2 — Open the Article 4 milestone (only when ready)

- File a Linear issue under the appropriate parent (`DEE-92` migration spine, an existing governance epic, or a newly architected governance root per `LINEAR-GOVERNANCE.md`).
- Title indicating doctrine intent (e.g. "Agent Charter Doctrine — Gate A").
- Risk tier: T0 with T1-equivalent governance review depth.
- Acceptance criteria: the Article 5 prerequisites are encoded; `AGENT-ROLES.md` and `NON-GOALS.md` cross-reference updates merged; vision-artifact link added.

### 7.3 Step 3 — Execute the milestone per existing lifecycle

- Standard `dee-<NN>-<slug>` branch.
- `/plan-feature` → `/implement` → `/test-and-fix` → PR readiness per `AUTONOMOUS-EXECUTION-LOOP.md`.
- Validation canon applies (markdown lint at minimum); architect review required given the T0 caveat.

### 7.4 Step 4 — Hold

After Article 4 is merged, **hold**. Gate B is not authorized by this artifact. Reopening the question requires a separate Architect decision and a separate constitutional update.

### 7.5 What is explicitly not authorized by this artifact

- Creation of any agent identity.
- Provisioning of any OAuth application or API key.
- Telemetry collection.
- Any code outside `docs/`.
- Any roadmap beyond Article 4.
- Any reinterpretation of the Agent Society Roadmap as an executable plan.

---

## Closing Clauses

### C.1 Effective date

This artifact is effective upon Architect acknowledgment in the conversation in which it was produced (2026-05-10).

### C.2 Supersession

This artifact does **not** supersede `AGENTS.md`, `EXECUTION-CONTRACT.md`, `CORE-PRINCIPLES.md`, `NON-GOALS.md`, `RISK-TIERS.md`, `AGENT-ROLES.md`, `MIGRATION-GOVERNANCE.md`, `LINEAR-GOVERNANCE.md`, or `HUMAN-OVERRIDE.md`. On any conflict with those documents, the existing governance corpus wins; this artifact must be amended to reconcile.

### C.3 Mutation rule

Amendment of this artifact requires a deliberate governance PR per `GOVERNANCE-VERSIONING.md`, Architect approval, and a corresponding update to `AGENT-ROLES.md` or `NON-GOALS.md` if the Article 3 doctrine is touched.

### C.4 Review cadence

Mandatory Architect review at the moment any of the following conditions becomes true:

- The Article 4 milestone is merged.
- A request to open Gate B is raised.
- A request to revisit the VISION-ONLY tier (Article 2.3) is raised.
- A governance incident attributable to agent activity occurs.
- One full quarter passes since the last review.

### C.5 Final reaffirmation

> Humans define meaning.
> Agents may comment.
> Humans decide.
> AI-Twin v1 remains the product.
> WAIA DEV OS exists to ship it safely.

---

**End of Acceptance Artifact v1.0.**

No tasks, branches, or PRs were created by this artifact. No implementation was initiated. This is governance consolidation only. The next discrete action is Architect-initiated and bounded by Article 7.

---

## Provenance

- **Original:** Obsidian vault, `WAIA GOV/waia_dev_os_constitutional_acceptance.md`
- **Canonized in repo:** 2026-05-10
- **Successor:** None (current head of doctrine).
- **Amendment procedure:** See Closing Clause C.3 and `GOVERNANCE-VERSIONING.md`.
