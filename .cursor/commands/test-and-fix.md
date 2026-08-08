# /test-and-fix

Run local validation, fix anything red, and loop until PR-readiness gates are green. Full unit suite is **authoritative in GitHub PR CI** — do not require a redundant full local `pnpm test --run` solely to duplicate that gate.

## Loop

1. Run local PR-readiness gates:

   ```bash
   pnpm lint && pnpm typecheck && pnpm build
   # + targeted / path-scoped tests for changed surfaces
   ```

2. If a gate fails:
   - Read the actual error message — don't guess.
   - Make the smallest possible fix.
   - Re-run only the failing gate, then re-run the local chain.
3. For UI changes, run e2e:

   ```bash
   pnpm exec playwright install --with-deps chromium  # first run only
   pnpm test:e2e
   ```

4. If e2e fails, inspect `playwright-report/` and `test-results/`, then iterate.
5. Stop when local PR-readiness gates pass twice in a row (targeted tests included).

## When to ask for help instead of looping

- A flaky test fails non-deterministically -> investigate, don't retry blindly.
- A type error points to an upstream library bug -> ask before pinning workarounds.
- A test contradicts the plan -> stop and re-plan; do not silently change tests to make them pass.

After the loop is green twice, **safe auto-advance** per [`AGENTS.md`](../../AGENTS.md) / [`AGENT-AUTO-ADVANCE.md`](../../docs/waia-governance/AGENT-AUTO-ADVANCE.md):

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

3. **Continue into PR readiness** — update plan `state.lastValidatedGitSha` when a canonical plan exists; same checklist as [`/prepare-pr`](prepare-pr.md): sync `origin/main` if needed, push `dee-*` to `origin` with `-u` if needed, render PR body from plan + template, run `preflight-pr-governance.sh` with `PR_BASE=main`, compare URL, **stop before merge**.

4. **Move the Linear issue to `In Review`** (existing DEE status) and add a PR-ready comment with the compare URL.

5. **Stop before merge.** Humans open/review/squash-merge to `main`.

No separate "now run /prepare-pr" prompt is required for normal task completion. If any auto-advance precondition fails (validation, scope, branch, Linear id, risk tier, open STOP, constitutional Architect hold), do **not** auto-advance — surface the blocker.

Use `/prepare-pr` only when you need a standalone retry (e.g. push failed earlier) without re-running the full test loop; its §1 STOP remains the safety net if the tree is unexpectedly dirty.

## Integration boundary ([`INTEGRATION-BOUNDARY-POLICY.md`](../../docs/waia-governance/INTEGRATION-BOUNDARY-POLICY.md))

- Loop gates locally many times; **one PR to `main`** only when integration-ready.
- Render `**Includes:**` / `**Deferred:**` when child work is in scope.
- Do not open a second PR for the same integration issue — spawn a new batch instead.
- Sync branch with `origin/main` via merge (not rebase) before PR when branch was already pushed.
