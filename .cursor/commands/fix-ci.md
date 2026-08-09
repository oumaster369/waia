# /fix-ci

Triage and fix **failing PR checks** on the current `dee-*` branch. Prefer **Background Agent** for the fix loop.

## When to use

- GitHub Actions failed on your PR (`lint`, `typecheck`, `unit tests`, `build`, `e2e`, Cloudflare preview).
- User says "fix CI" or the [`ci-failure-triage` workflow](../../.github/workflows/ci-failure-triage.yml) commented on the PR.

## What you must do

1. Identify failing checks:

   ```bash
   gh pr checks --watch=false 2>/dev/null || true
   ```

   Or read the PR Checks tab / workflow run logs via `gh run view --log-failed`.

2. Reproduce locally with the same command chain as [`test-and-fix`](test-and-fix.md).

3. Make the **smallest** fix — do not weaken tests or skip gates to greenwash.

4. Push to the same `dee-*` branch; wait for CI (do not merge).

5. If failure is **infra/flake** (timeouts, Cloudflare secrets missing): document in PR comment; escalate if not fixable in-repo.

6. For **Cloudflare bundle** failures: optionally run `/diagnose` with builds MCP.

## Hard rules

- Never `gh pr merge`.
- Never push to `main` (or frozen `dev`).
- If failure contradicts the plan → STOP and re-plan; do not silently change acceptance criteria.
- Scope stays within the active Linear issue; new failures outside scope → new issue.

Follow [`INTEGRATION-BOUNDARY-POLICY.md`](../../docs/waia-governance/INTEGRATION-BOUNDARY-POLICY.md) — fixes stay on the same integration branch; no second PR; HUMAN-ONLY merge.

## Completion

Report: which checks failed, root cause, fix summary, new CI status. Stop for human merge.
