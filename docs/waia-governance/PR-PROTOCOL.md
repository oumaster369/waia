# PR protocol — WAIA

## Branch + base + compare

- **Base:** `main`  
- **Compare:** `dee-<NN>-<slug>` (see [`BRANCHING-STRATEGY.md`](BRANCHING-STRATEGY.md))

## Opening a PR (CLI preferred)

From agent machine with GitHub CLI:

```bash
gh pr create --base main --title "DEE-NN type(scope): subject" --body-file .cursor/pr-body-DEE-NN.md
```

Prefer a preflight-validated body file over `--fill` alone when a rendered body exists.

### If `gh` auth unavailable

Architect opens PR via GitHub UI: Compare → base `main` → branch `dee-…`; paste checklist from [.github](../../.github/). PR title should include **`DEE-NN`**.

### Agent restrictions

Agents must **not** `gh pr merge` by default workflow (see [.cursor/commands/prepare-pr](../../.cursor/commands/prepare-pr.md)).

### Default PR readiness after implementation

After local PR-readiness validation succeeds, agents **normally** finish by syncing with `origin/main`, pushing the `dee-*` branch to `origin`, printing the **GitHub compare URL** (`main` … feature branch), PR title/body for paste, and validation results — then **halt** for human PR open/review/merge. This is bundled into `/test-and-fix` completion; `/prepare-pr` remains for standalone retries. Same **no-merge** rule: proposing a PR URL or optionally running **`gh pr create`** does **not** grant merge authority.

### Auto-merge (humans — optional)

**Maintainers** may turn on GitHub auto-merge **only** for **`T0`/`T1`** PRs that meet [`RISK-TIERS.md`](RISK-TIERS.md) merge-eligibility (checks green, no gate, no meaning shift, no runtime/migration/auth/infra in scope, no escalation). **Do not** use auto-merge for semantic/product governance changes, AI-Twin / readiness / autonomy / Society semantics, **`T2+`**, active Architect gates, or unresolved ambiguity—[`EXECUTION-CONTRACT.md`](EXECUTION-CONTRACT.md).

## Merge method

| PR class | Branch → base | Merge method |
|----------|---------------|--------------|
| **Feature / fix / governance** | `dee-<NN>-<slug>` → `main` | **Squash and merge** |

Full table: [`BRANCHING-STRATEGY.md`](BRANCHING-STRATEGY.md). Agents surface in the completion report: **Human squash-merges to `main`**. There is no active release-promotion or back-sync PR class.

A normal feature/governance PR to `main` uses squash and needs no special instruction beyond Human merge authority.

## PR body essentials

Canonical structure: [`.github/pull_request_template.md`](../../.github/pull_request_template.md). Agents must run [`preflight-pr-governance.sh`](../../scripts/linear/preflight-pr-governance.sh) before PR handoff ([`.cursor/commands/prepare-pr.md`](../../.cursor/commands/prepare-pr.md)).

| Field | Required syntax |
|-------|-----------------|
| Linear | `**Linear:** \`DEE-NN\`` (+ optional URL) |
| Linear completion (optional) | `**Linear completion:** auto-close` (default) or `**Linear completion:** keep-open` |
| Linear completion reason (required with keep-open) | `**Linear completion reason:** <non-empty explanation>` |
| Tier | `**Tier:** T0`–`T4` per [`RISK-TIERS.md`](RISK-TIERS.md) |
| Parent (optional) | `**Parent:** \`DEE-NN\`` — child issues only; not validated |
| ADR | Link or **`n/a`** + rationale if Tier ≤ `T1` small change |
| Human gate | `no`/`yes — reason` |
| Migration impacted | `no`/`yes — tracker link sentence` |

### Linear completion lifecycle (default = auto-close)

Ordinary atomic PRs need only **`Linear:** \`DEE-NN\``**. On merge to `main`, [`linear-done.yml`](../../.github/workflows/linear-done.yml) transitions that issue to **Done** when validation passes.

**Keep-open** is reserved for PRs that belong to an **active parent or integration issue** with unfinished governed work (for example a docs-only canonical-plan refresh under an open program). It must **not** be used to avoid closing a genuinely completed atomic issue.

Required fields when keep-open applies:

```markdown
**Linear:** `DEE-NN`
**Linear completion:** keep-open
**Linear completion reason:** <non-empty explanation>
```

Rules:

- Keep-open **does not** bypass title/branch/`Linear` alignment, scope verification, CI, review, or Human merge gates.
- Keep-open PRs **pass** PR governance but **skip** Linear Done automation with `SKIP_REASON=explicit_keep_open`.
- Identifiers in explanatory prose — including on `**Linear:** n/a (...)` lines — are **never** parsed as the explicit Linear id.
- Do **not** invent a release-promotion skip class for ordinary feature PRs; official release is an explicit Human tag of a `main` SHA ([`POST-MERGE-PROTOCOL.md`](POST-MERGE-PROTOCOL.md)).

### Multi-work-package / Includes

One integration batch may include multiple coherent work packages and list children under `**Includes:**` when the integration-ready contract holds ([`INTEGRATION-BOUNDARY-POLICY.md`](INTEGRATION-BOUNDARY-POLICY.md)). Preserve splitting criteria when batches are not coherent.

### Semantic-impact signal **(when touched)**

Only when the slice changes **meaning**, not purely mechanical code: if the PR affects **AI-Twin semantics**, **readiness progression**, **aligned autonomy behavior**, **Society interaction rules**, or **governance authority boundaries**, add **one plain line** in the title/summary **or** body (e.g. `Semantic impact: …`). **Not required** on every PR—only when those seams shift; skips ceremony for unrelated refactors and UI tweaks.

### Rollback / recovery hint **`T2+` when practical**

For **`T2` and above** ([`RISK-TIERS.md`](RISK-TIERS.md))—routes, persistence consumers, migration-adjacent behavior—include a **short** revert/rollback sentence when obvious (single revert PR, flip env, undo migration step). Omit when unknown or riskier than forward fix. **Not** expected for **`T0`/`T1`** doc-only / isolated edits.

## Validation before green PR

**Local PR readiness** ([`AGENTS.md`](../../AGENTS.md)):

```bash
pnpm lint && pnpm typecheck && pnpm build
# + targeted tests for changed surfaces
# + pnpm test:e2e when UI/user-visible behavior changes
./scripts/linear/preflight-pr-governance.sh --body-file .cursor/pr-body-DEE-NN.md
```

**Authoritative full unit suite** runs on **GitHub PR CI** (PR HEAD). Do not require a redundant full local `pnpm test --run` solely to duplicate that CI gate. During work packages, prefer path-scoped / targeted tests.

UI-visible flows: Playwright suite per `.cursor/commands/test-and-fix` when `app/**`, `components/**`, or user-visible behavior changes.

## Risk tiers & review depth

Higher tier ⇒ more reviewer migration awareness + architectural comment requirement — see [`RISK-TIERS.md`](RISK-TIERS.md).
