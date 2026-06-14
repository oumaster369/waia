# PR protocol — WAIA

## Branch + base + compare

- **Base:** `dev`  
- **Compare:** `dee-<NN>-<slug>` (see [`BRANCHING-STRATEGY.md`](BRANCHING-STRATEGY.md))

## Opening a PR (CLI preferred)

From agent machine with GitHub CLI:

```bash
gh pr create --base dev --fill
```

Ensure body covers template fields manually if `--fill` incomplete.

### If `gh` auth unavailable

Architect opens PR via GitHub UI: Compare → base `dev` → branch `dee-…`; paste checklist from [.github](../../.github/). PR title should include **`DEE-NN`**.

### Agent restrictions

Agents must **not** `gh pr merge` by default workflow (see [.cursor/commands/prepare-pr](../../.cursor/commands/prepare-pr.md)).

### Default PR readiness after implementation

After local validation succeeds, agents **normally** finish by pushing the `dee-*` branch to `origin`, printing the **GitHub compare URL** (`dev` … feature branch), PR title/body for paste, and validation results — then **halt** for human PR open/review/merge. This is bundled into `/test-and-fix` completion; `/prepare-pr` remains for standalone retries. Same **no-merge** rule: proposing a PR URL or optionally running **`gh pr create`** does **not** grant merge authority.

### Auto-merge (humans — optional)

**Maintainers** may turn on GitHub auto-merge **only** for **`T0`/`T1`** PRs that meet [`RISK-TIERS.md`](RISK-TIERS.md) merge-eligibility (checks green, no gate, no meaning shift, no runtime/migration/auth/infra in scope, no escalation). **Do not** use auto-merge for semantic/product governance changes, AI-Twin / readiness / autonomy / Society semantics, **`T2+`**, active Architect gates, or unresolved ambiguity—[`EXECUTION-CONTRACT.md`](EXECUTION-CONTRACT.md).

## Merge method (by PR class)

The merge **method** is not freeform — it is fixed by PR class (full table in [`BRANCHING-STRATEGY.md`](BRANCHING-STRATEGY.md)):

- **Feature / fix / governance PR → `dev`:** **Squash and merge** (default).
- **Release promotion → `main`:** **Create a merge commit** — never squash.
- **Release back-sync → `dev`:** **Create a merge commit** — never squash.

**Exact human merge instruction (agents must surface this in the PR body for the latter two classes):**

> **Merge this PR with "Create a merge commit". Do NOT "Squash and merge".**
> Squash drops the second parent and re-creates `dev`/`main` ancestry drift (see [`POST-MERGE-PROTOCOL.md`](POST-MERGE-PROTOCOL.md)).

A normal feature/governance PR to `dev` (including this protocol's own PRs, unless a PR explicitly changes merge rules) uses squash and needs no special instruction.

## PR body essentials

| Field | Notes |
|-------|-------|
| `Linear` | Issue URL / `DEE-NN` |
| `Risk tier` | [`RISK-TIERS.md`](RISK-TIERS.md) `T0`–`T4` |
| `ADR` | Link or **`n/a`** + rationale if Tier ≤ `T1` small change |
| `Human gate` | `no`/`yes — reason` |
| `Migration impacted` | `no`/`yes — tracker link sentence` |

### Semantic-impact signal **(when touched)**

Only when the slice changes **meaning**, not purely mechanical code: if the PR affects **AI-Twin semantics**, **readiness progression**, **aligned autonomy behavior**, **Society interaction rules**, or **governance authority boundaries**, add **one plain line** in the title/summary **or** body (e.g. `Semantic impact: …`). **Not required** on every PR—only when those seams shift; skips ceremony for unrelated refactors and UI tweaks.

### Rollback / recovery hint **`T2+` when practical**

For **`T2` and above** ([`RISK-TIERS.md`](RISK-TIERS.md))—routes, persistence consumers, migration-adjacent behavior—include a **short** revert/rollback sentence when obvious (single revert PR, flip env, undo migration step). Omit when unknown or riskier than forward fix. **Not** expected for **`T0`/`T1`** doc-only / isolated edits.

## Validation before green PR

[`AGENTS.md`](../../AGENTS.md):  

`pnpm lint && pnpm typecheck && pnpm test --run && pnpm build`

UI-visible flows: Playwright suite per `.cursor/commands/test-and-fix`.

## Risk tiers & review depth

Higher tier ⇒ more reviewer migration awareness + architectural comment requirement — see [`RISK-TIERS.md`](RISK-TIERS.md).
