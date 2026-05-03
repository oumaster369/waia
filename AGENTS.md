# AGENTS.md

This file is the contract every AI coding agent must read **first** when working in this repository. It supersedes anything that contradicts it in the agent's default behavior.

## TL;DR

1. Never push to `dev` or `main`. Always feature branch + PR. (`.cursor/rules/10-git-workflow.mdc`)
2. Never commit secrets. (`.cursor/rules/40-secrets.mdc`)
3. Run all gates before opening a PR:
   ```bash
   pnpm lint && pnpm typecheck && pnpm test -- --run && pnpm build
   ```
4. Use the four-phase workflow below. Don't skip phases.

## Workflow phases

| Phase | Command | Mode | Recommended model |
|-------|---------|------|-------------------|
| 1. Plan | `/plan-feature` | Plan Mode | Claude Opus 4.x (thinking) |
| 2. Implement | `/implement` | Agent Mode | Claude Sonnet 4.5 |
| 3. Test & fix | `/test-and-fix` | Agent Mode | Claude Sonnet 4.5 |
| 4. Open PR | `/prepare-pr` | Agent Mode | Claude Sonnet 4.5 |

Each command's full instructions live in `.cursor/commands/<command>.md`.

## Project rules

The agent automatically loads everything in `.cursor/rules/`:

- `00-overview.mdc` — stack and repo layout (always)
- `10-git-workflow.mdc` — branching and PRs (always)
- `20-code-style.mdc` — TS/React/Tailwind conventions (auto, on .ts/.tsx)
- `30-testing.mdc` — what and how to test (auto, on .ts/.tsx)
- `40-secrets.mdc` — env hygiene (always)

## Hooks (active in this workspace)

`.cursor/hooks.json` defines:

- `beforeShellExecution` -> `guard-shell.sh`: blocks `git push --force`, direct push to `dev`/`main`, and `rm -rf` at root/home.
- `afterFileEdit` -> `format-edit.sh`: auto-runs `eslint --fix` + `prettier --write` on each edited source file.
- `stop` / `subagentStop` -> `log-event.sh`: appends a JSONL audit row to `.cursor/agent-log.jsonl` (gitignored) so you can see who did what, when.

## MCP servers

`.cursor/mcp.json` provides:

- `playwright` — gives the agent a real Chromium browser for e2e debugging and visual checks.

## Tooling cheat sheet

```bash
pnpm dev              # next dev (Turbopack)
pnpm lint             # eslint
pnpm typecheck        # tsc --noEmit
pnpm test             # vitest watch
pnpm test -- --run    # vitest single run (use this in CI / scripts)
pnpm test:e2e         # playwright (auto-starts the app via webServer)
pnpm build            # next build
pnpm format           # prettier --write .
```

## Where things go

- New route -> `app/<route>/page.tsx`
- New shared component -> `components/<name>.tsx` (or `components/ui/` for shadcn primitives)
- New utility -> `lib/<name>.ts` (one default-free named export per file)
- New unit test -> `tests/unit/<subject>.test.ts(x)`
- New e2e test -> `tests/e2e/<flow>.spec.ts`
- New plan (produced by `/plan-feature`) -> `.cursor/plans/<YYYY-MM-DD>-<slug>.md`

## When in doubt — STOP

If anything is ambiguous, the rule is: **stop and ask the user**. Especially for:

- Git operations on `dev` / `main`
- Adding a new top-level dependency
- Editing CI workflows
- Changing branch protection or repository settings
- Touching environment / secrets handling
