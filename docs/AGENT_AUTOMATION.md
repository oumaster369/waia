# Agent automation in WAIA

This document describes the multi-agent setup the project uses for the loop **plan -> develop -> test/fix -> PR**.

## Topology

```
User
 ├─ /plan-feature  (Plan Mode, Opus 4.x)        -> .cursor/plans/<slug>.md
 ├─ /implement     (Agent Mode, Sonnet 4.5)     -> code on feature/<slug>
 ├─ /test-and-fix  (Agent Mode + Playwright MCP)-> green local gates
 └─ /prepare-pr    (Agent Mode + gh CLI)        -> PR into dev
                                                    │
                                                    ├─ GitHub Actions CI (lint/typecheck/test/build/e2e)
                                                    ├─ Cursor Bugbot review
                                                    └─ User merges dev -> main -> Cloudflare Pages deploys
```

## Models

- **Default for code**: Claude Sonnet 4.5 (Cursor settings -> Models -> set as default for Agent Mode).
- **Planning / hard debug**: Claude Opus 4.x (thinking).
- Disable other models you don't intentionally use, so the agent can't silently switch under cost pressure.

## Observability

| Signal | Where | Purpose |
|--------|-------|---------|
| Chat transcripts | Cursor "@ History" sidebar; files in `~/.cursor/projects/.../agent-transcripts/` | Full replay of any agent session |
| JSONL audit log | `.cursor/agent-log.jsonl` (gitignored) | One line per agent stop / subagent stop with timestamp + branch |
| Status line | CLI `~/.cursor/cli-config.json` (set up via `statusline` skill) | At-a-glance: current model + branch + context % |
| PR comments | GitHub PR view | Bugbot review, CI statuses |
| Hooks tab | Cursor Settings -> Hooks | See which hooks fired and their stdout/stderr |

## Allowed / denied agent actions

Configured in user `settings.json` (`cursor.agent.allowList` / `denyList`) and enforced by `.cursor/hooks/guard-shell.sh`:

- **Allowed without prompt**: `pnpm (lint|typecheck|test|build|format) ...`, `pnpm exec ...`, `gh (pr|issue|repo) ...`
- **Always denied**: `git push --force`, direct push to `dev`/`main`, `rm -rf /` or `rm -rf $HOME`

## What the user does manually (not automated)

- Cursor Pro login + model selection in Cursor Settings -> Models.
- Install Cursor's GitHub App (Settings -> Integrations -> GitHub) so Bugbot can comment on PRs.
- `gh auth login` once.
- Merging `dev` -> `main` to trigger Cloudflare Pages deploy.
- Approving / rejecting PRs created by agents.
