# Model and cost policy (version-agnostic classes)

**Owner:** Architect · **Status:** Canonical · **Linear:** DEE-408 (vNext Slice F)

Defines **model classes** — not pinned product versions — for Cursor agent work. Cursor renames tiers over time; governance references **capability classes** and maps them to current IDE equivalents at runtime.

**Related:**

- [`AGENT-ROLES.md`](AGENT-ROLES.md) — role defaults
- [`RISK-TIERS.md`](RISK-TIERS.md) — tier hints
- [`EXECUTION-CONTRACT.md`](EXECUTION-CONTRACT.md) — escalation
- [`docs/ops/OPERATOR-QUICKREF.md`](../ops/OPERATOR-QUICKREF.md) — action matrix and checkpoints

---

## Principle

Use the **cheapest class that can safely complete** the slice. Escalate **up** when requirements are unclear, trackers contradict code, or rollback is costly. **Never** silently downgrade mid-task.

No automated model-routing scripts — judgment only ([`AGENT-ROLES.md`](AGENT-ROLES.md)).

---

## Model classes

| Class | Cursor equivalent (remap when renamed) | Cost posture | Typical use |
|-------|----------------------------------------|--------------|-------------|
| **`fast`** | Composer 2 (or current fast inline tier) | Lowest | T0/T1 docs (`docs/**`), governance touch-ups, Linear hygiene, continuity handoffs, uncomplicated copy |
| **`mid`** | Sonnet (or current default Agent tier) | Standard | `/implement`, `/test-and-fix`, `/prepare-pr`, substantive backend/frontend, debugging with pinned context |
| **`reasoning`** | Opus (or current strongest Plan tier) | Highest | `/plan-feature`, `/groom`, `/decompose`, migration/runtime tradeoffs, T3/T4 ambiguity, pre-merge Architect review, long-context audits |

**Background Agent** (`/bg-test-and-fix`, `/fix-ci`): **`mid`** unless the failure is architectural — then escalate to **`reasoning`** for triage planning only.

**Implementation Build agent** (Composer-class agents executing approved plans): **`mid`** for code paths; plan authorship remains **`reasoning`**.

---

## Phase → class mapping

Aligned with [`AGENTS.md`](../../AGENTS.md) workflow table — classes, not version numbers:

| Phase / command | Mode | Class |
|-----------------|------|-------|
| `/groom`, `/decompose` | Plan / Ask | **`reasoning`** |
| `/plan-feature` | Plan | **`reasoning`** |
| `/implement`, `/test-and-fix`, `/prepare-pr` | Agent | **`mid`** |
| `/bg-test-and-fix`, `/fix-ci` | Background Agent | **`mid`** |
| `/diagnose`, `/parallel-implement` | Agent | **`mid`** (escalate if deploy topology ambiguous) |
| Fast docs / low-risk edits | Agent | **`fast`** |

---

## Routing rules

1. **Planning / architecture** → **`reasoning`**
2. **Implementation / test-fix / PR-prep** → **`mid`**
3. **Low-risk docs / edits** → **`fast`**
4. **Debugging** → **`mid`**; escalate to **`reasoning`** when root cause is architectural or cross-tracker
5. **Long-context audits** (e.g. future Completion Spec → Gap Registry) → **`reasoning`**, acknowledged cost-heavy; use sparingly
6. **Pool preference:** first-party Cursor pool; API-billed models only when required and noted in the plan or PR

### Escalate upward when

- Requirements unclear or contradictory across product / governance / trackers
- Risk tier ≥ T3 or migration route uncertainty
- Rollback would be costly or multi-surface
- Pre-merge review requests strongest pass

### Do not

- Pin minor model versions in commands or governance (e.g. "Sonnet 4.5", "Opus 4.x")
- Build automated routing scripts
- Silently switch tiers mid-slice without operator awareness

---

## Risk tier hints

Optional defaults — override when complexity demands ([`RISK-TIERS.md`](RISK-TIERS.md)):

| Tier | Class hint |
|------|------------|
| **T0** | **`fast`** for pure doc/ADR |
| **T1** | **`fast`** quick paths; **`mid`** if logic non-trivial |
| **T2** | **`mid`**; **`reasoning`** if route/migration ambiguity |
| **T3** | **`mid`** + Architect touch; **`reasoning`** for planning / pre-merge review |
| **T4** | **`reasoning`** / maintainer-led; never autonomous merge |

---

## Audit note

Logging the concrete model name in a PR is **optional** — include when helpful for high-tier or cost-sensitive work.

---

*Last updated: 2026-07-10 — vNext Slice F.*
