# Operator quick reference

**Owner:** Architect · **Status:** Canonical · **Linear:** DEE-408 (vNext Slice F)

Compact guide for human operators running WAIA DEV OS integration batches. Full canon: [`INTEGRATION-BOUNDARY-POLICY.md`](../waia-governance/INTEGRATION-BOUNDARY-POLICY.md), [`LIFECYCLE.md`](../waia-governance/LIFECYCLE.md), [`MODEL-COST-POLICY.md`](../waia-governance/MODEL-COST-POLICY.md).

---

## Nine operator questions

Answer these before starting or resuming a batch:

| # | Question | Where to look |
|---|----------|---------------|
| **Q1** | Which **integration Linear issue** owns this batch (one issue = one PR)? | Issue title; branch `dee-<NN>-<slug>`; PR `**Linear:**` field |
| **Q2** | What is the **canonical plan** and `state.status`? | `docs/plans/dee-<NN>-<slug>.md` (or bootstrap: master plan + issue before Slice C) |
| **Q3** | What **risk tier** and **execution surfaces** apply? | Plan frontmatter; [`RISK-TIERS.md`](../waia-governance/RISK-TIERS.md); [`EXECUTION-SURFACES.md`](EXECUTION-SURFACES.md) |
| **Q4** | Which **model class** (`fast` / `mid` / `reasoning`) for the current phase? | [`MODEL-COST-POLICY.md`](../waia-governance/MODEL-COST-POLICY.md) |
| **Q5** | Is this action **AUTO**, **CONFIRM**, or **HUMAN-ONLY**? | Action matrix below; [`INTEGRATION-BOUNDARY-POLICY.md`](../waia-governance/INTEGRATION-BOUNDARY-POLICY.md) §AUTO/CONFIRM/HUMAN-ONLY |
| **Q6** | Which **checkpoint** am I at? | Checkpoint table below |
| **Q7** | Is the **integration-ready contract** satisfied before opening a PR? | [`INTEGRATION-BOUNDARY-POLICY.md`](../waia-governance/INTEGRATION-BOUNDARY-POLICY.md) §Integration-ready |
| **Q8** | Where is **evidence** stored and classified? | Plan PR body; `replay-runs/**` when applicable |
| **Q9** | After merge, what is **next action** (no forbidden post-merge Git write)? | [`POST-MERGE-PROTOCOL.md`](../waia-governance/POST-MERGE-PROTOCOL.md); plan `state.nextAction`; refresh `dev` only |

---

## Action matrix (compact)

| Class | Composer / agent | Operator |
|-------|------------------|----------|
| **AUTO** | Inspect repo; read-only diagnostics; docs/code on feature branch; local gates; commits/push; PR body prep; **one PR when integration-ready**; update plan `state` | Monitor; no per-step approval on low-risk batches |
| **CONFIRM** | **STOP** — new integration issue; scope change; batch split; plan promotion; ambiguous child completion; partial-criteria PR; constitutional edits; CI/ruleset/schema changes | Answer or approve |
| **HUMAN-ONLY** | **Never** — merge; push `dev`/`main`; production deploy; Execution Server sync/build/deploy/rollback; live trading; secret mutation; weaken gates | Operator performs |

Full matrix: [`INTEGRATION-BOUNDARY-POLICY.md`](../waia-governance/INTEGRATION-BOUNDARY-POLICY.md).

---

## Checkpoints (minimal)

Normal low-risk batch: **#1 scope** + **#3 merge** only.

| # | Checkpoint | When |
|---|------------|------|
| **1** | **Scope approval** | Before implementation — issue, plan, tier, surfaces, acceptance criteria |
| **2** | **Exceptional runtime / architecture** | Execution Server mutation, T3/T4, DB migration, constitutional change, live external ops |
| **3** | **Merge approval** | PR is integration-ready; human reviews and merges |
| **4** | **Production / live operation** | Production release, host deploy, live AI-TRADER, market credentials |

---

## Default validation (before PR)

```bash
pnpm lint && pnpm typecheck && pnpm test --run && pnpm build
pnpm validate:pr-governance
```

Add `pnpm test:e2e` when UI changes. Run [`scripts/ops/cursor-env-preflight.sh`](../../scripts/ops/cursor-env-preflight.sh) after environment restore.

---

## Environment preflight

```bash
./scripts/ops/cursor-env-preflight.sh          # strict — exit 1 on any gap
./scripts/ops/cursor-env-preflight.sh --dry-run  # report only — always exit 0
```

See [`CURSOR-ENVIRONMENT.md`](CURSOR-ENVIRONMENT.md) for full restoration.

---

## Resume rule

**Never resume from chat alone.** Resume from: canonical plan `state` + branch + `git log` + pushed PR. Pre–Slice C bootstrap: master Build program + Linear issue + branch + commits.

---

*Last updated: 2026-07-10 — vNext Slice F.*
