# Safe auto-advance after green validation

When `/test-and-fix` finishes successfully, agents **may** continue automatically into **commit → push → Linear `In Review` → PR readiness** without a follow-up prompt — **only** when every precondition below holds.

**Router:** [`AGENTS.md`](../../AGENTS.md) · **PR package:** [`.cursor/commands/prepare-pr.md`](../../.cursor/commands/prepare-pr.md) · **Protocol:** [`PR-PROTOCOL.md`](PR-PROTOCOL.md)

This does **not** waive STOP conditions, risk tiers, merge authority, or governance escalation. The separate DEE-653 AI-TRADER exception applies only after ordinary PR readiness and exact-head admission are both complete.

## Preconditions (all required)

1. Local PR-readiness gates green: `pnpm lint`, `pnpm typecheck`, `pnpm build` + **targeted tests** for changed surfaces — plus Playwright e2e when touching `app/**`, `components/**`, or user-visible behavior ([`.cursor/rules/30-testing.mdc`](../../.cursor/rules/30-testing.mdc)). Full unit suite is authoritative in GitHub PR CI; do not block auto-advance solely to re-run a redundant full local `pnpm test --run`.
2. Diff contains **only in-scope files** for the active Linear issue (`git status` clean of unrelated dirty paths).
3. Branch matches `dee-<NN>-<slug>` (from `main`) and `DEE-NN` resolves in Linear WAIA project.
4. Risk tier does not require Architect hold (T0/T1 baseline; T2 only when issue text allows; never T3/T4) — [`RISK-TIERS.md`](RISK-TIERS.md).
5. No open STOP or governance escalation — [`EXECUTION-CONTRACT.md`](EXECUTION-CONTRACT.md).
6. No unresolved TODO/blocker in diff or PR body.
7. If `Batch mode: integration-train`, Git proves the valid admitted manifest commit/path/digest predates all delivered child commits, its contiguous waves are dependency-ordered, the final manifest/diff is frozen, delivered commit→actual-file evidence is exact, cumulative checks passed, at most two isolated tasks ran in any wave under the no-overlap rules, and the rendered PR body passes exact digest/base/head/review-head validation.

## Authorized actions

- Commit with Conventional Commits message including `DEE-NN` ([`BRANCHING-STRATEGY.md`](BRANCHING-STRATEGY.md)); `git add` named in-scope paths only.
- Sync with `origin/main` via merge when the branch was already pushed; then `git push -u origin <branch>`.
- Move Linear issue to **`In Review`** with compare URL comment.
- Print compare URL (`main…branch`), PR create URL, paste-ready title/body targeting **`main`**, validation summary.
- Close with the **agent completion protocol** report ([`POST-MERGE-PROTOCOL.md`](POST-MERGE-PROTOCOL.md)) including the exact human merge instruction (**Squash and merge** to `main`), and optionally **recommend** (never execute) an explicit Human release tag of the resulting `main` SHA when release-worthy.
- **Stop by default.** Wait for human review/merge and explicit confirmation before starting the next task. For a DEE-653-eligible AI-TRADER implementation PR only, continue through the independent-review and exact-head merge-admission contract, squash merge, post-merge verification, then select only the next dependency-unblocked Linear node.
- For an admitted Integration Train, reconcile only the children delivered by the merged frozen manifest. Deferred/excluded children remain open and are never inferred complete from the batch merge.

## Never allowed

- `gh pr merge` or any auto-merge, except the explicit manual squash-merge action performed by the acting AI-TRADER Program Controller after [`AI-TRADER-BOUNDED-MERGE-AUTHORITY.md`](AI-TRADER-BOUNDED-MERGE-AUTHORITY.md) returns a complete exact-head admission proof.
- Direct push to `main` / frozen `dev`.
- Fabricated Linear IDs ([`FAILURE-PATTERNS.md`](FAILURE-PATTERNS.md) FP-005).
- Out-of-scope commits or skipped validation (FP-002).
- Broadening scope or starting the next issue automatically.
- Auto-advance under constitutional Architect hold or open STOP.
- Reviving `dev` → `main` promotion or `main` → `dev` back-sync as routine recommendations.

If any precondition fails: surface blocker per STOP format in [`EXECUTION-CONTRACT.md`](EXECUTION-CONTRACT.md) and wait.
