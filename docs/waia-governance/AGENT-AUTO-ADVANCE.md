# Safe auto-advance after green validation

When `/test-and-fix` finishes successfully, agents **may** continue automatically into **commit → push → Linear `In Review` → PR readiness** without a follow-up prompt — **only** when every precondition below holds.

**Router:** [`AGENTS.md`](../../AGENTS.md) · **PR package:** [`.cursor/commands/prepare-pr.md`](../../.cursor/commands/prepare-pr.md) · **Protocol:** [`PR-PROTOCOL.md`](PR-PROTOCOL.md)

This does **not** waive STOP conditions, risk tiers, merge authority, or governance escalation.

## Preconditions (all required)

1. Gates green: `pnpm lint`, `pnpm typecheck`, `pnpm test --run`, `pnpm build` — plus Playwright e2e when touching `app/**`, `components/**`, or user-visible behavior ([`.cursor/rules/30-testing.mdc`](../../.cursor/rules/30-testing.mdc)).
2. Diff contains **only in-scope files** for the active Linear issue (`git status` clean of unrelated dirty paths).
3. Branch matches `dee-<NN>-<slug>` and `DEE-NN` resolves in Linear WAIA project.
4. Risk tier does not require Architect hold (T0/T1 baseline; T2 only when issue text allows; never T3/T4) — [`RISK-TIERS.md`](RISK-TIERS.md).
5. No open STOP or governance escalation — [`EXECUTION-CONTRACT.md`](EXECUTION-CONTRACT.md).
6. No unresolved TODO/blocker in diff or PR body.

## Authorized actions

- Commit with Conventional Commits message including `DEE-NN` ([`BRANCHING-STRATEGY.md`](BRANCHING-STRATEGY.md)); `git add` named in-scope paths only.
- `git push -u origin <branch>`.
- Move Linear issue to **`In Review`** with compare URL comment.
- Print compare URL (`dev…branch`), PR create URL, paste-ready title/body, validation summary.
- **Stop.** Wait for human review/merge.

## Never allowed

- `gh pr merge` or any auto-merge.
- Direct push to `dev` / `main`.
- Fabricated Linear IDs ([`FAILURE-PATTERNS.md`](FAILURE-PATTERNS.md) FP-005).
- Out-of-scope commits or skipped validation (FP-002).
- Broadening scope or starting the next issue automatically.
- Auto-advance under constitutional Architect hold or open STOP.

If any precondition fails: surface blocker per STOP format in [`EXECUTION-CONTRACT.md`](EXECUTION-CONTRACT.md) and wait.
