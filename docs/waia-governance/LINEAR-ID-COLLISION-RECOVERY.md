# Linear ID collision recovery (DEE-150 / DEE-153 incident)

**Date:** 2026-06-10 · **Status:** Remediated in Linear · **Merge:** PR #165 (`40c983a` on `dev`)

## What happened

PR #165 implemented the WAIA DEV OS Optimization Roadmap but used **`DEE-150`** in branch name, title, and squash commit while **DEE-150** was already assigned to *Twin dialogue turn latency attribution* (DEE-129b).

The Linear GitHub integration linked PR #165 to DEE-150 and transitioned it **Done** on merge. Our `linear-done.yml` workflow **did not** run (`LINEAR_API_KEY` not configured).

## Audit answers

| Question | Finding |
|----------|---------|
| DEE-150 modified incorrectly? | **Yes** — wrongly closed Done; PR #165 attached |
| DEE-150 moved to Done? | **Yes** — 17:00:12 UTC via Linear↔GitHub (not `linear-done.yml`) |
| Wrong comments on DEE-150? | **No** Linear comments before remediation; correction comment added |
| Incorrect backlinks? | **Yes** — PR #165 + linear-code linkback on DEE-150 |
| Automation incorrect state? | **Linear GitHub app yes**; **`linear-done.yml` no** (skipped) |

## Remediation taken

1. **DEE-150** → reverted to **Todo** with process-correction comment (latency scope preserved).
2. **DEE-153** created — *WAIA DEV OS Optimization Roadmap* (`infra`, parent DEE-103) → **Done** with PR #165 + merge commit links.
3. **Cross-links:** DEE-150 ↔ DEE-153 `relatedTo`.
4. PR #165 attachment on DEE-150 **retained** for audit; semantic owner is DEE-153.

## Historical artifacts (do not rewrite)

- Merge commit message: `DEE-150 infra(dev-os): …` on `dev`
- Branch: `dee-150-dev-os-optimization-roadmap`
- Git history is immutable; grep `DEE-153` for canonical tracking going forward

## Manual follow-ups

- [ ] Optional: remove PR #165 attachment from DEE-150 in Linear UI (if duplicate confuses board)
- [ ] Comment on DEE-103 linking DEE-153 child delivery
- [ ] Configure `LINEAR_API_KEY` before enabling `linear-done.yml`
- [ ] Apply branch rulesets + squash merge scripts (DEE-153 open acceptance items)

## Prevention (see FAILURE-PATTERNS FP-009)

**Implemented (P0 — governance hardening PR):**

| Control | Location |
|---------|----------|
| Blocking PR governance check | [`.github/workflows/pr-governance.yml`](../../.github/workflows/pr-governance.yml) |
| Shared validator | [`scripts/linear/validate-pr-linear-id.sh`](../../scripts/linear/validate-pr-linear-id.sh) |
| Safe Linear Done (explicit field only) | [`.github/workflows/linear-done.yml`](../../.github/workflows/linear-done.yml) |
| Required ruleset check | [`.github/rulesets/dev-main-protection.json`](../../.github/rulesets/dev-main-protection.json) → `PR governance` |

**Rules enforced:**

- PR body **must** include explicit `**Linear:** \`DEE-NN\``
- PR title / branch `dee-NN` must match that explicit id
- `do NOT use DEE-NN` disclaimer + same id in title/branch → **fail**
- When `LINEAR_API_KEY` is set: Linear issue title must overlap PR scope tokens
- `linear-done.yml` never infers id from title alone; ambiguity → warning comment, no auto-close

**Process:**

- `/groom` before `/implement` — verify branch `dee-NN` matches issue scope via Linear MCP
- Never pick `dee-NN` branch numbers without `get_issue` confirmation
