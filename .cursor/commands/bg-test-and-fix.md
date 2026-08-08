# /bg-test-and-fix

Run [`/test-and-fix`](test-and-fix.md) as a **Background Agent** (or Cloud Agent) on the current `dee-*` branch.

## When to use

- Implementation is complete locally; human does not want to supervise the green-loop.
- Retrying validation after a long-running fix cycle.
- CI is green locally but you want the agent to handle commit → push → PR open while you context-switch.

## What you must do

1. Confirm branch matches `dee-<NN>-<slug>` and working tree has in-scope changes (or is clean post-implement).
2. Launch as **Background Agent** with this command as the prompt anchor.
3. Execute the [`test-and-fix`](test-and-fix.md) loop:
   - `pnpm lint && pnpm typecheck && pnpm build` + targeted tests
   - `pnpm test:e2e` when UI paths changed
   - Full unit suite is authoritative in GitHub PR CI (do not require redundant full local `pnpm test --run` solely to duplicate CI)
4. On green (twice): follow **safe auto-advance** in [`AGENT-AUTO-ADVANCE.md`](../../docs/waia-governance/AGENT-AUTO-ADVANCE.md):
   - Commit in-scope paths
   - Sync `origin/main` if needed; `git push -u origin <branch>`
   - Linear → `In Review` + compare URL comment (`main…branch`)
   - [`prepare-pr`](prepare-pr.md) package (compare URL, title/body, `--base main`) — **after** `preflight-pr-governance.sh` passes on rendered body
5. **Stop before merge.**

## Optional: open PR via CLI

If `gh` is authenticated — **after preflight passes** ([`prepare-pr.md`](prepare-pr.md) §6):

```bash
gh pr create --base main --title "DEE-NN type(scope): subject" --body-file .cursor/pr-body-DEE-NN.md --draft=false
```

Never `gh pr merge`.

## Integration boundary

Follow [`INTEGRATION-BOUNDARY-POLICY.md`](../../docs/waia-governance/INTEGRATION-BOUNDARY-POLICY.md): one PR per integration issue to `main`; stop before merge; no scope broadening.

## Hard rules

- Bounded by [`.cursor/hooks/guard-shell.sh`](../hooks/guard-shell.sh) and GitHub rulesets on `main`.
- T3/T4, open STOP, or out-of-scope dirty files → stop and surface blocker; do not auto-advance.
- Background agents must not broaden scope or start the next Linear issue.

## Human handoff

When the background agent completes, review the PR, CI, and Bugbot — then squash-merge to `main`.
