# Agent automation in WAIA

Multi-agent setup for **groom → plan → develop → test/fix → PR → merge hygiene**.

## Topology

```
User / Linear
 ├─ /groom           (Plan/Ask)              → Task Contract validation
 ├─ /decompose       (Plan)                  → atomic child issues via Linear MCP
 ├─ /plan-feature    (Plan, Opus)            → .cursor/plans/<slug>.md
 ├─ /implement       (Agent, Sonnet)         → code on dee-<NN>-<slug>
 ├─ /test-and-fix    (Agent + Playwright MCP)→ green gates + default PR readiness
 ├─ /bg-test-and-fix (Background Agent)      → same loop unattended → stop before merge
 ├─ /fix-ci          (Background Agent)      → triage failing PR checks
 ├─ /diagnose        (Agent + Cloudflare MCP)→ prod/preview deploy investigation
 ├─ /parallel-implement (Agent + worktrees)  → N independent issues in parallel
 └─ /prepare-pr      (retry)                 → PR package without full test loop
                                                    │
                                                    ├─ CI + pr-governance (blocking required check)
                                                    ├─ ci-failure-triage → /fix-ci hint
                                                    ├─ linear-done on merge (if LINEAR_API_KEY set)
                                                    ├─ Cursor Bugbot review
                                                    └─ Human squash-merges to main (optional explicit release tag)
```

## Models

- **Default for code**: Claude Sonnet (Agent Mode).
- **Planning / groom / decompose**: Claude Opus (Plan Mode).
- Disable unused models in Cursor Settings so agents cannot silently switch.

## Observability

| Signal | Where | Purpose |
|--------|-------|---------|
| Chat transcripts | Cursor History; `~/.cursor/projects/.../agent-transcripts/` | Session replay |
| JSONL audit log | `.cursor/agent-log.jsonl` (gitignored) | Agent stop events + branch |
| Status line | CLI `~/.cursor/cli-config.json` | Model + branch + context % |
| PR comments | GitHub | Bugbot, Cloudflare preview, governance, CI triage |
| Hooks tab | Cursor Settings → Hooks | Hook fire diagnostics |

## MCP

| Server | Config | Use |
|--------|--------|-----|
| Playwright | [`.cursor/mcp.json`](../.cursor/mcp.json) | e2e during test-and-fix |
| Linear | Cursor plugin `plugin-linear-linear` | groom, decompose, In Review / Done |
| Cloudflare | Cursor plugins (builds, observability, bindings, docs) | `/diagnose` |

## Allowed / denied agent actions

User `settings.json` allow/deny lists + [`.cursor/hooks/guard-shell.sh`](../.cursor/hooks/guard-shell.sh):

- **Allowed**: `pnpm (lint|typecheck|test|build|format)…`, `gh (pr|issue|repo)…`
- **Denied**: `git push --force`, direct push to `main` (or frozen `dev`), destructive `rm -rf`

**Server-side:** GitHub ruleset on `main` ([`main-protection.json`](../.github/rulesets/main-protection.json)) — apply via [`scripts/github/apply-branch-rulesets.sh`](../scripts/github/apply-branch-rulesets.sh).

## Background and parallel agents

- **`/bg-test-and-fix`**: unattended green loop; bounded by hooks + branch protection.
- **`/parallel-implement`**: [`scripts/worktrees/parallel-issue.sh`](../scripts/worktrees/parallel-issue.sh) + one agent per atomic issue.
- **`/fix-ci`**: triggered manually or via [`ci-failure-triage.yml`](../.github/workflows/ci-failure-triage.yml) comment.

## Expanded execution narrative

12-step loop: [`waia-governance/AUTONOMOUS-EXECUTION-LOOP.md`](waia-governance/AUTONOMOUS-EXECUTION-LOOP.md).

## What remains manual

- Cursor login + model selection.
- GitHub App / Bugbot integration.
- `gh auth login`, ruleset apply (one-time maintainer).
- `LINEAR_API_KEY` in GitHub Actions secrets for Done automation.
- **Merging** PRs to `main` (squash) and creating official release tags (human authority per `AGENTS.md`).
