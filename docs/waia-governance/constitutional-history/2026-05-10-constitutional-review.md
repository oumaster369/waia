<!--
Status: ADVISORY (analytical record)
Date: 2026-05-10
Authority: Informs the binding Acceptance Artifact. NOT itself binding.
Superseded operationally by: 2026-05-10-constitutional-acceptance-v1.0.md
Read first: ../CONSTITUTIONAL-DOCTRINE.md
-->

# WAIA DEV OS — Constitutional Review of "Agent Society" Roadmap

> **Status: ADVISORY (analytical record).** This review informed the Acceptance Artifact (`2026-05-10-constitutional-acceptance-v1.0.md`). Its analysis is preserved verbatim for traceability of *why* the operational doctrine is shaped the way it is. Where this review and the Acceptance Artifact diverge in detail, the **Acceptance Artifact wins**. This file does **not** introduce new binding rules.

This review treats the roadmap as a **proposed constitutional amendment** to WAIA DEV OS, not as an implementation plan. The primary lens is: *Does this preserve the governance discipline already encoded in `docs/waia-governance/**` while remaining honest about WAIA MVP scope?*

I read the roadmap against the existing governance corpus: `WAIA-DEV-OS.md`, `CORE-PRINCIPLES.md`, `NON-GOALS.md`, `RISK-TIERS.md`, `EXECUTION-CONTRACT.md`, `AGENT-ROLES.md` (especially the **Orchestrator Agent** clause), `MIGRATION-GOVERNANCE.md`, `HUMAN-OVERRIDE.md`, `LINEAR-GOVERNANCE.md`, `EXECUTABLE-GOVERNANCE-HOOKS.md`, and `AUTONOMOUS-EXECUTION-LOOP.md`.

---

## 1. Constitutional Review

### 1.1 Architectural strengths

The roadmap is philosophically coherent with WAIA's stated identity:

- **"Agent acts in the interests of the human"** matches `EXECUTION-CONTRACT.md` ("Architect/operator retains final say").
- **"Governed autonomy, not AGI"** matches `NON-GOALS.md` ("No autonomous goal-driven agent herds").
- The framing of **Linear as nervous system** is consistent with the existing principle that *"Linear is operational memory."*
- Treating WAIA DEV OS as a **proving ground for AI-Twin philosophy** is genuinely valuable — it avoids building two separate ontologies.

These are not new ideas in WAIA — they are restated with stronger rhetoric. That is acceptable for a vision document.

### 1.2 Contradictions with existing governance

| # | Contradiction | Existing canon | Roadmap claim |
|---|---|---|---|
| C1 | **Identity proliferation** | `AGENT-ROLES.md` explicitly states the **Orchestrator Agent** is *"naming only — no runnable authority… no standalone service, bot, runtime, or Linear label."* | §2 / §10 propose ~10 named agents, each with *identity, memory, profile, permissions, token budget* — i.e. a runtime fleet. |
| C2 | **Speculative agent herds** | `NON-GOALS.md`: *"Speculative multi-agent AGI choreography — no autonomous goal-driven agent herds beyond scripted dev assistants."* | Phase 3 ("Multi-Agent Society") and Phase 4 ("Persistent WAIA, continuously active") are exactly that. |
| C3 | **Governance minimalism** | `CORE-PRINCIPLES.md`: *"Prefer few durable rules over wide predictive process. Governance cuts ambiguity, not imitation org complexity."* | The roadmap introduces 10 roles, 4 Linear layers, 2 communication channel families, 6 phases — predictive complexity. |
| C4 | **Auto-merge / autonomy line** | `RISK-TIERS.md`: *"Autonomous execution ≠ autonomous governance or autonomous architectural authority."* | §3 lets agents *"prepare execution paths"* and *"coordinate bounded execution"*; "execution" is dangerously ambiguous if it ever means PR merges, branch pushes, or status transitions. |
| C5 | **Persistent loops** | The current loop in `AUTONOMOUS-EXECUTION-LOOP.md` is **event-triggered** (issue → branch → PR → merge → closeout). | Phase 4 demands *continuous monitoring, proposing, optimizing, evolving* — a different control model that bypasses the issue-driven gate. |
| C6 | **Cost / telemetry framing** | WAIA has **no token-accounting system** today; `MIGRATION-GOVERNANCE.md` does not mandate it. | §6 Phase 2 implies budget enforcement as a near-term prerequisite. Useful, but not currently a tracked migration. |
| C7 | **Product canon drift risk** | `CORE-PRINCIPLES.md`: *"Product canon wins."* Real product = AI-Twin v1 (`WAIA-V1-MVP-SPEC.md`). | The roadmap can read as if **WAIA DEV OS itself** is becoming the product. The DEV OS is **infrastructure for building the product**, not the product. This must be re-asserted. |

### 1.3 Premature complexity / hidden operational dangers

- **D1. Identity inflation.** Naming "Architect Agent / Migration Agent / Governance Agent / Cost Agent / …" creates a perception that each is a deliverable, an owner, and a budget line. In reality, all of these can today be **discharged by a single Architect-supervised Cursor agent following the existing playbooks**. Premature decomposition will create *org-chart cosplay* without operational benefit.
- **D2. Persistent autonomy without kill-switch design.** Phase 4 ("continuously active") has no described **HALT semantic**, no described **revocation path**, no described **drift detection**. `HUMAN-OVERRIDE.md` exists for emergencies; it does not currently scale to revoking 10 always-on agents.
- **D3. Linear write-permission blast radius.** Treating agents as Linear *members* (not bots) typically requires real seats with full API scope. An agent that can comment can usually also reassign, relabel, change status, and close issues. Current `LINEAR-GOVERNANCE.md` says *"Agents do not bulk reprioritize portfolio"* — agent-as-member by default breaks that.
- **D4. Memory governance is unspecified.** §2 says each agent *"has a memory context"*, §4.1 calls Linear the *"memory layer"*. Today there is **no memory model**, no retention policy, no PII boundary, no answer to *"what happens when an agent's memory contradicts a tracker?"*. This is the same class of problem WAIA's `MIGRATION-GOVERNANCE.md` solves for runtime persistence — it must be solved before agent memory exists, not after.
- **D5. Cost feedback loop is non-trivial.** A "Cost Agent" that reasons about its own runtime cost is itself a runtime cost. Without instrumentation upstream of any agent, the agent will hallucinate budgets.
- **D6. AI-Twin philosophical contamination.** Calling DEV-OS agents "the first behavioral socialization layer" for AI-Twins (§5) blurs two separate ontologies. **AI-Twins are user-facing personalized cognitive twins**; **DEV-OS agents are bounded ops automation**. Conflating them risks importing user-data semantics into infra agents, or importing bounded-autonomy semantics into the product where richer agency is required.

### 1.4 Governance risks (ranked)

1. **R1 — Scope creep into product time.** Highest risk. WAIA's MVP is AI-Twin v1, not an agent society. Every hour spent building a Governance Agent is an hour not spent on the AI-Twin dialogue, readiness model, diary, or socialization flow.
2. **R2 — Erosion of the "agents never merge / never authorize" line.** The roadmap's softer language ("propose execution paths", "prepare PRs autonomously") will, in practice, drift toward agent merges unless restated in absolute terms.
3. **R3 — Memory without canon.** Letting agents accumulate persistent context creates an unaudited *fifth source of truth* alongside Git / Linear / migration trackers / product specs. WAIA explicitly warns against silent drift among these.
4. **R4 — Identity sprawl in Linear.** Once agent users exist, removing them is socially expensive. Better to start with one bot identity and scale up, than to scale down later.
5. **R5 — Council / consensus formation (§4.4 "Society Layer" → "negotiation, consensus formation").** Agent-to-agent negotiation without human-in-the-loop is a textbook source of unaccountable decisions. Should be deferred indefinitely.

---

## 2. Strategic Compression

### NOW (consistent with existing governance, executable in next 1–2 milestones)

- **N1.** Token / model-usage accounting per Cursor session and per CI run (telemetry only, no enforcement).
- **N2.** A single **read-only advisory bot identity** in Linear (one identity, scoped to comments) that can post structured analysis on issues — no writes beyond comments.
- **N3.** Codification of an explicit **Agent Charter doctrine**: every named "agent" must have a one-page charter (scope, write permissions, escalation rule, kill-switch) before it is permitted to act. Companion to `AGENT-ROLES.md`.
- **N4.** Reaffirmation in `EXECUTION-CONTRACT.md` that **"agent" remains a coordination pattern realized by humans + Cursor session**, not a multiplying class of services.

### LATER (after AI-Twin v1 is observably stable)

- **L1.** A second advisory bot (e.g., migration/risk-tier preflight) once N2 has 1–3 quarters of low-noise operation.
- **L2.** Cost forecasts and budget warnings (the *"warn"* part of Phase 2 only — not enforcement).
- **L3.** Optional ADR / governance preflight comment bot from `EXECUTABLE-GOVERNANCE-HOOKS.md` graduated from "advisory" to "selective block".

### VISION ONLY (do not plan; keep as guiding philosophy)

- **V1.** Agent ↔ agent dialogue, negotiation, consensus formation.
- **V2.** Persistent always-on agents.
- **V3.** Agents with their own token budgets they autonomously spend.
- **V4.** Agent-driven roadmap proposals beyond a single ranked list of "next bounded task".
- **V5.** AI-council / voice / Discord agent layer.
- **V6.** Treating DEV-OS agent infrastructure as a substrate for AI-Twin socialization (philosophically inspirational; do not engineer).

---

## 3. Feasibility Assessment

| Roadmap layer | Verdict | Reason |
|---|---|---|
| Phase 1 — Governed Execution | **Realistic now** (already largely done) | Matches existing `AGENTS.md`, `EXECUTION-CONTRACT.md`, etc. The remaining "executable governance hooks" are already backlogged honestly in `EXECUTABLE-GOVERNANCE-HOOKS.md`. |
| Phase 2 — Operational Awareness (telemetry) | **Partially realistic** | Token/usage telemetry is feasible; *budget enforcement* and *queue awareness* are not, because we have no executor queue and no shared budget primitives. |
| Phase 2 — Operational Awareness (forecasting, reservation) | **Not realistic yet** | Requires baseline historical data we do not collect. |
| Phase 3 — Multi-Agent Society (10 named agents) | **Not realistic yet** | Each "agent" presupposes infra (memory, identity, runtime) that does not exist. Most are role-restatements, not new capabilities. |
| Phase 3 — Coordination loop (Migration → Governance → Cost → Architect → Human → Release) | **Partially realistic as a procedural flow** | Realistic as a **documented procedure** that humans execute; **not realistic as autonomous handoff** between independent agents. |
| Phase 4 — Persistent WAIA (continuous loops) | **Not realistic yet** | No drift detection, no kill-switch design, no cost ceiling, no provenance tracking. Architecturally premature. |
| §2 — Agent identity & permissions | **Partially realistic** | One *bot identity* in Linear with comment-only scope is feasible. Ten distinct identities is not. |
| §4.4 — Society Layer (negotiation, consensus) | **Not realistic yet** (and arguably should remain VISION) | No safety story exists for agent-only consensus. |
| §7 — Discord / voice agents / AI councils | **Not realistic yet** | No business need from MVP; out of scope. |
| §11 — DEV-OS agents as embryo of AI-Twin society | **Conceptually realistic, engineering-wise no** | Useful as a guiding metaphor; do not let it shape technical decisions. |

---

## 4. Recommended Evolution Path (safest, highest-leverage)

The roadmap collapses into four bounded gates, each gated by the previous one being observably stable.

```text
GATE A  —  Doctrine (this review + 1 governance PR)
              ↓
GATE B  —  Single Advisory Identity (read-only, comment-only)
              ↓
GATE C  —  Cost & Usage Telemetry (observation only)
              ↓
GATE D  —  Selective enforcement / second advisory identity
```

- **Gate A — Doctrine.** Land a small governance change that (i) names "Agent Charter" as a required artifact for any future named agent, (ii) restates the absolute prohibitions, (iii) cross-references this roadmap as *vision*, not plan.
- **Gate B — One identity, one scope.** Ship a single Linear bot identity (e.g. `WAIA Advisory`) with **comment-only** scope and a written charter. Use it for one concrete, useful task: e.g. posting a structured "PR readiness" comment on Linear issues that have an open `dee-*` PR.
- **Gate C — Telemetry.** Begin collecting token / model-mix / CI-minute usage **without** acting on it. Baseline for ≥1 quarter.
- **Gate D — Conditional graduation.** Only after Gates B and C produce no governance incidents and clear usefulness, consider a *second* advisory identity (cost / migration preflight) and/or graduating one advisory hook to selective blocking per `EXECUTABLE-GOVERNANCE-HOOKS.md`.

Phases 3 and 4 of the original roadmap are intentionally absent from this evolution path. They re-enter as VISION until preconditions exist.

---

## 5. Minimal Next Milestone (recommend exactly one)

**Milestone: "Agent Charter Doctrine" — a single docs-only governance PR.**

Scope:

- Add `docs/waia-governance/AGENT-CHARTER.md` defining what is required before *any* future named, persistent, or Linear-resident agent is allowed to exist:
  - Charter must declare: name, owner (human), bounded scope, **write permissions (default: none)**, escalation rule, kill-switch, retention/memory policy, cost ceiling.
  - Until charter exists and is merged, no agent identity may be created.
- Update `AGENT-ROLES.md` and `NON-GOALS.md` with one paragraph each explicitly distinguishing:
  - "Agent" as **coordination pattern** (today) vs.
  - "Agent" as **chartered identity with comment-only scope** (allowed via Gate B), vs.
  - "Agent society" with persistent autonomy (VISION only, NON-GOAL today).
- Cross-link the Agent Society Roadmap doc in Obsidian as a vision artifact.

Why this milestone:

- **T0 risk** (docs-only) — fits existing risk-tier model.
- **Integrates safely** — no new runtime, no new identities, no new dependencies.
- **Does not derail MVP** — pure governance prose; AI-Twin v1 work is unaffected.
- **Immediate leverage** — every future "let's build a Cost Agent" conversation collapses to *"draft the charter first"*. This single artifact prevents weeks of premature implementation drift.
- **Governance-first** — exactly the discipline `CORE-PRINCIPLES.md` already demands.

Future milestones (Gates B–D) are deliberately **not** scheduled here.

---

## 6. Candidate Early Agents (1–3, useful NOW)

Constraint: each must be (a) governance-aligned, (b) deliverable as a **comment-only Linear identity** under one charter, (c) covers a real existing pain point.

| Rank | Agent | Why useful now | Initial scope (strictly bounded) |
|---|---|---|---|
| 1 | **WAIA Advisory** (single multi-purpose identity) | Removes the seductive temptation to spawn N identities. Solves operational visibility immediately. | Posts structured Linear comments containing: PR readiness checklist, risk-tier sanity check, link to relevant migration tracker, suggested validation canon command. |
| 2 | **WAIA Telemetry** (read-only, optional second identity) | Once Gate C delivers data, surfaces token/CI-minute usage on issues. | Posts cost summary on PR-linked issues. Cannot enforce. |
| 3 | (defer) Migration / Governance / Architect / Cost / Release / Product / Society / Twin Memory / Security / Socialization | **Not now.** Each duplicates either an existing human role, an existing tracker, or a future module. | — |

The single most valuable shipped form is **#1, comment-only**. Everything else should wait.

---

## 7. What MUST NOT Be Built Yet

Explicit prohibitions that should be carried into the Agent Charter doctrine:

1. **No agent with Linear write permissions beyond commenting.** No status transitions, no label edits, no assignments, no parent links, no priority changes.
2. **No agent that opens, merges, or auto-merges PRs.** Restates `AGENT-ROLES.md` and `RISK-TIERS.md` line-in-the-sand.
3. **No agent-to-agent communication channels.** No queue, no message bus, no shared memory between named agents. (Single advisory identity = no edge for negotiation.)
4. **No persistent / always-on loop.** All agent activity must be event-triggered (PR opened, issue updated, cron-bounded report) with a documented trigger and a documented stop condition.
5. **No agent-owned budget or autonomous spend.** Agents may *report* cost; humans *decide* spend.
6. **No agent reasoning over user PII or AI-Twin user data.** DEV-OS agents operate on engineering artifacts only. Crossing into product data is a separate constitutional question.
7. **No agent that can mutate governance docs.** `docs/waia-governance/**` edits remain Architect-authored.
8. **No "council" / "consensus" mechanism.** Multi-agent voting/negotiation is a vision concept; do not engineer.
9. **No Discord / voice / external channel surfaces.** Out of scope until at least Gate D.
10. **No conflation with AI-Twin product.** DEV-OS agent infra is not allowed to be marketed, modeled, or designed *as* the Society/Diary/Twin layers of the actual product.

---

## 8. Linear Integration Strategy

### 8.1 Benefits (real)

- Audit trail: agent reasoning becomes durable next to the work it concerns.
- Reviewer ergonomics: a structured pre-flight comment is more useful than a chat transcript.
- Provenance: agent-attributed comments are clearly distinguishable from human ones — better than ghost-writing through a human account.
- Aligns with the existing principle that *Linear is operational memory*.

### 8.2 Governance risks (real)

- **Identity = permission surface.** A Linear "member" account typically has full workspace API scope. We need *bot / app / OAuth-app* semantics, not human seats.
- **Action drift.** Once an agent can comment, the next request will be "let it close issues / move status". Must be prohibited from day one.
- **Comment noise.** An overly chatty agent destroys signal. Need a **rate limit per issue** and a **structured comment template** so noise stays bounded.
- **Attribution.** Comments must be unambiguously labeled as agent-authored (identity name + a footer line citing the charter version).

### 8.3 Technical feasibility

- Linear supports **OAuth applications / API keys with scoped permissions** (the right primitive — not a human seat).
- The existing `plugin-linear-linear` MCP server already lets Cursor read/write Linear. The new piece is a **dedicated machine identity** distinct from any human user, with **scope: read + comments only**.
- Implementation cost is small (one OAuth app, one charter, one comment template).

### 8.4 Safest first implementation path

1. Charter merged (Milestone §5).
2. Provision **one** Linear OAuth application with **read + comment** scope. No user seat.
3. Define a **single comment template** (e.g. structured markdown block with a unique header).
4. Trigger: only on Linear webhook events (issue updated → in progress, PR linked, etc.) or explicit `/advise` mention. **No polling, no continuous loop.**
5. Rate-limit: at most 1 comment per issue per state transition.
6. Kill-switch: a single env var or Linear label (e.g. `agent-quiet`) that suppresses the bot on a given issue.
7. Quarterly review of comment usefulness vs. noise per `EXECUTABLE-GOVERNANCE-HOOKS.md` adoption rules (≤5% noise threshold before any expansion).

This path uses the **minimal possible permission surface** that still delivers the roadmap's transparency benefit.

---

## 9. Final Recommendation

**Direction: yes, but compressed.**

- **Strategically sound?** Yes — the philosophy aligns with WAIA's stated identity (governed autonomy, human as source of meaning, AI as amplifier).
- **Realistically achievable?** Only Phases 1 and (partially) 2 in the next 6–12 months. Phases 3 and 4 are aspirational, not achievable, and would actively damage MVP delivery if pursued now.
- **Compatible with WAIA MVP execution discipline?** Only if the roadmap is **explicitly demoted to a vision artifact** and the Agent Charter doctrine is in place before any agent identity exists. Without that demotion, it directly contradicts `NON-GOALS.md` and `CORE-PRINCIPLES.md` ("Governance minimalism").

### The safest next bounded move

Land the **Agent Charter Doctrine** (§5) as a single docs-only governance PR. One artifact. T0 risk. No identities, no runtimes, no new dependencies. It immediately disciplines every subsequent "let's build an X Agent" conversation.

After that one milestone is merged and observably referenced in at least one architect decision, **stop and reassess** before opening Gate B.

### Reassertion (constitutional)

The DEV OS exists to **build the AI-Twin product safely**. It is not the product. The roadmap is most valuable when it sharpens *how WAIA DEV OS thinks about itself*, and most dangerous when it competes with AI-Twin v1 for engineering attention.

The single principle to carry forward, drawn from the roadmap itself and consistent with existing canon:

> *"Humans define meaning. Agents execute, analyze, coordinate, warn, propose, and assist."*

Translated operationally for the next quarter: **agents may comment; humans decide.** Everything else waits for charter.

---

## Provenance

- **Original:** Obsidian vault, `WAIA GOV/waia_dev_os_constitutional_review.md`
- **Canonized in repo:** 2026-05-10
- **Operational supersession:** Conclusions of this review were formally adopted into `2026-05-10-constitutional-acceptance-v1.0.md`. Where Acceptance differs in detail (e.g. Acceptance Article 1.6 refinements R-1 / R-2), Acceptance prevails.
