# /bg-test-and-fix

Run [`/test-and-fix`](test-and-fix.md) as a **Background Agent** (or Cloud Agent) on the current `dee-*` branch.

## When to use

- Implementation is complete locally; human does not want to supervise the green-loop.
- Retrying validation after a long-running fix cycle.
- CI is green locally but you want the agent to handle commit → push → PR open while you context-switch.

## What you must do

1. Confirm branch matches `dee-<NN>-<slug>` and working tree has in-scope changes (or is clean post-implement).
2. Launch as **Background Agent** with this command as the prompt anchor.
3. Execute the full [`test-and-fix`](test-and-fix.md) loop:
   - `pnpm lint && pnpm typecheck && pnpm test --run && pnpm build`
   - `pnpm test:e2e` when UI paths changed
4. On green (twice): follow **safe auto-advance** in [`AGENT-AUTO-ADVANCE.md`](../../docs/waia-governance/AGENT-AUTO-ADVANCE.md):
   - Commit in-scope paths
   - `git push -u origin <branch>`
   - Linear → `In Review` + compare URL comment
   - [`prepare-pr`](prepare-pr.md) package (compare URL, title/body)
5. **Stop before merge.**

## Optional: open PR via CLI

If `gh` is authenticated:

```bash
gh pr create --base dev --fill --draft=false
```

Never `gh pr merge`.

## Hard rules

- Bounded by [`.cursor/hooks/guard-shell.sh`](../hooks/guard-shell.sh) and GitHub rulesets on `dev`/`main`.
- T3/T4, open STOP, or out-of-scope dirty files → stop and surface blocker; do not auto-advance.
- Background agents must not broaden scope or start the next Linear issue.

## Human handoff

When the background agent completes, review the PR, CI, and Bugbot — then merge.
