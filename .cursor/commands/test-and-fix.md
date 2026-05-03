# /test-and-fix

Run the full local test suite, fix anything red, and loop until everything is green.

## Loop

1. Run all gates:

   ```bash
   pnpm lint && pnpm typecheck && pnpm test -- --run && pnpm build
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

After the loop is green, hand off to `/prepare-pr`.
