# Risk tiers — autonomy envelopes

Agents self-label PRs realistically; reviewer challenges mismatch.

## T0 — Docs & diagrams only

Markdown under `docs/**` governance / ADRs.

| Dimension | Expectation |
|-----------|-------------|
| Autonomy | High for drafting |
| Validation | Editorial accuracy + link checks |
| Merge | Human merges (still PR) |

**T0 caveat:** Pure markdown can still exceed T0 **if** it **redefines** canonical product meaning—e.g. AI-Twin **behavior**, **readiness** semantics, **autonomy boundaries**, or Society **interaction** semantics. Label and review at **≥T1** (Architect visibility as needed); do not hide product-risk edits behind “docs only.”

## T1 — Isolated code surfaces

Pure unit logic, narrowly scoped modules without altering runtime persistence contracts.

Validation: lint/typecheck/unit/build; targeted e2e if UI touch.

## T2 — Runtime routes / persistence consumers

Touches `app/api/**` paths using `getWaiaRuntimeDb()`, response contracts, Postgres/SQLite selection logic.

Extras: cite migration trackers in PR [`MIGRATION-GOVERNANCE.md`](MIGRATION-GOVERNANCE.md); migration memory line mandatory.

## T3 — Auth / orchestration bridging reasoning + DB

Higher integration + contradiction risk.

Extras: Architect consult note; richer manual/integration plan per issue instructions.

## T4 — Production infra & broad rollout

Vendor integrations, Postgres broad enablement, CI deploy topology changes — **Architect explicit approval & ops checklist.**

## Merge authority (humans — optional auto-merge)

**Not about agents:** [`AGENTS.md`](../../AGENTS.md) still applies—agents do **not** `gh pr merge` or treat merge as theirs. Below ties **human** use of GitHub **auto-merge** (or similar) to **tier and risk**, not to CI roadmaps or governance automation.

**`T0` / `T1` — may enable auto-merge** when **all** apply: required checks **green**; **no** `Human gate` / Architect hold; **no** semantic/product/governance meaning change ([`PR-PROTOCOL.md`](PR-PROTOCOL.md), including T0 meaning caveat); **no** runtime, migration, auth, or infra change in scope; **no** open STOP/escalation ([`EXECUTION-CONTRACT.md`](EXECUTION-CONTRACT.md)).

**`T2+` — default human-reviewed merge** (reviewer clicks merge or equivalent explicit action)—not routine auto-merge unless Architect **names** an exception for that PR.

**`T3` / `T4` — no auto-merge** except [`HUMAN-OVERRIDE.md`](HUMAN-OVERRIDE.md), **explicit** Architect ok on that change, or a **future** governance doc update—never as silent standing policy.

**Line in the sand:** **Autonomous execution** (implement, validate, open PR) ≠ **autonomous governance** or **autonomous architectural authority**. Low-risk merge acceleration ≠ waiving semantics, rollout, or Architect gates.

## Default model hint (Cursor — optional)

Not prescriptive; escalate model **up** when complexity or tier demands it.

| Tier | Hint |
|------|------|
| **T0** | Composer 2 typical for pure doc/ADR edits |
| **T1** | Composer 2 quick paths; Sonnet if logic non-trivial |
| **T2** | Sonnet implementation; Opus if route/migration ambiguity |
| **T3** | Sonnet + Architect touch; Opus for planning / pre-merge review as needed |
| **T4** | Opus/Maintainer-led; never autonomous merge |

Full policy: [`AGENT-ROLES.md`](AGENT-ROLES.md).

## Interaction map

[`PR-PROTOCOL.md`](PR-PROTOCOL.md), [`EXECUTION-CONTRACT.md`](EXECUTION-CONTRACT.md), [`MIGRATION-GOVERNANCE.md`](MIGRATION-GOVERNANCE.md), [`POST-MERGE-PROTOCOL.md`](POST-MERGE-PROTOCOL.md).

**Agents never assume merge autonomy at any tier.**
