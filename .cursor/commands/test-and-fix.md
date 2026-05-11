# /test-and-fix

Run the full local test suite, fix anything red, and loop until everything is green.

## Loop

1. Run all gates:

   ```bash
   pnpm lint && pnpm typecheck && pnpm test --run && pnpm build
   ```

2. If a gate fails:
   - Read the actual error message — don't guess.
   - Make the smallest possible fix.
   - Re-run only the failing gate, then re-run the full chain.
3. For UI changes, run e2e:

   ```bash
   pnpm exec playwright install --with-deps chromium  # first run only
   pnpm test:e2e
   ```

4. If e2e fails, inspect `playwright-report/` and `test-results/`, then iterate.
5. Stop when all gates pass twice in a row.

## When to ask for help instead of looping

- A flaky test fails non-deterministically -> investigate, don't retry blindly.
- A type error points to an upstream library bug -> ask before pinning workarounds.
- A test contradicts the plan -> stop and re-plan; do not silently change tests to make them pass.

After the loop is green twice, **safe auto-advance** per [`AGENTS.md`](../../AGENTS.md) "Safe auto-advance after green validation":

1. **Verify only in-scope files are dirty.**

   ```bash
   git status
   ```

   If any **unrelated** file is dirty (outside the active Linear issue's scope), **STOP** and ask. Do not commit unrelated changes; do not blanket `git add -A` when the working tree mixes scopes.

2. **Commit in-scope changes** with a Conventional Commits message that includes the active Linear id, e.g.:

   ```bash
   git add <named in-scope paths>
   git commit -m "DEE-NN type(scope): subject"
   ```

   `git add -A` is acceptable **only** when every dirty path is genuinely in scope for the active issue.

3. **Continue into PR readiness** — same checklist as [`/prepare-pr`](prepare-pr.md): push `dee-*` to `origin` with `-u` if needed, compare URL `dev...HEAD`, PR creation via that link, paste-ready title/body, report validation, **stop before merge**.

4. **Move the Linear issue to `In Review`** (existing DEE status) and add a PR-ready comment with the compare URL.

5. **Stop before merge.** Humans open/review/merge.

No separate "now run /prepare-pr" prompt is required for normal task completion. If any auto-advance precondition fails (validation, scope, branch, Linear id, risk tier, open STOP, constitutional Architect hold), do **not** auto-advance — surface the blocker.

Use `/prepare-pr` only when you need a standalone retry (e.g. push failed earlier) without re-running the full test loop; its §1 STOP remains the safety net if the tree is unexpectedly dirty.
