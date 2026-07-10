# WAIA Cursor Environment — canonical restoration guide

**Purpose:** Make WAIA development independent of any specific Cursor account. Any engineer (or a fresh macOS install) can restore the full agent-assisted development environment by following this document.

**Scope:** WAIA repository only (`oumaster369/waia`).

**Related canon:**

- [`AGENTS.md`](../../AGENTS.md) — execution contract router
- [`docs/AGENT_AUTOMATION.md`](../AGENT_AUTOMATION.md) — automation topology
- [`docs/waia-governance/AGENT-ROLES.md`](../waia-governance/AGENT-ROLES.md) — model selection policy
- [`.cursor/`](../../.cursor/) — committed project rules, commands, hooks, MCP

---

## 1. Architecture: where configuration lives

| Layer | Location | Survives git clone? | Survives account change? |
|-------|----------|---------------------|--------------------------|
| **Repository** | `.cursor/`, `AGENTS.md`, `docs/**` | Yes | Yes |
| **Cursor account** | User Rules, MCP OAuth, model prefs, plugin installs | No | No — must reconfigure |
| **Local machine** | `.env.local`, `.dev.vars`, `~/.cursor/plans/`, agent transcripts | No | No — secure copy required |
| **GitHub / SaaS** | Repo, CI secrets, Linear workspace | Yes (org-level) | Yes |

```text
┌─────────────────────────────────────────────────────────────┐
│  Repository (version controlled)                             │
│  .cursor/rules  .cursor/commands  .cursor/hooks  mcp.json   │
│  AGENTS.md  docs/AGENT_AUTOMATION.md  docs/waia-governance/ │
└─────────────────────────────────────────────────────────────┘
         ▲                              ▲
         │ auto-loads on open           │ manual paste / OAuth
         │                              │
┌────────┴────────┐            ┌───────┴────────────────────┐
│ Cursor account  │            │ Local machine secrets       │
│ User Rules      │            │ .env.local  .dev.vars       │
│ Plugin OAuth    │            │ ~/.cursor/plans/ (optional) │
│ Model settings  │            └─────────────────────────────┘
└─────────────────┘
```

---

## 2. Required software

Install on macOS **before** opening WAIA in Cursor:

| Tool | Version (reference) | Purpose |
|------|---------------------|---------|
| **Git** | latest stable | Version control |
| **Node.js** | **22.x** (e.g. 22.22.3) | Next.js, Vitest, scripts |
| **pnpm** | **10.x** (e.g. 10.34.1) | Package manager (`node-linker=hoisted`) |
| **GitHub CLI (`gh`)** | latest | PR creation, auth, repo ops |
| **Cursor IDE** | latest | Agent development environment |
| **jq** | optional but recommended | Hook scripts parse JSON reliably |
| **Docker** | optional | Local Postgres validation (`pnpm db:postgres:up`) |

```bash
# After clone
cd waia
pnpm install
pnpm db:migrate          # SQLite local DB
```

---

## 3. Required Cursor plugins

Install via **Cursor Settings → Plugins** (Cursor marketplace). These are **account-scoped** — reinstall on every new Cursor account.

| Plugin | Version (reference) | Why |
|--------|---------------------|-----|
| **Linear** | 1.0.0 | Issue lifecycle, groom/decompose, In Review/Done via MCP |
| **Supabase** | 0.1.4 | Database schema, migrations, SQL, logs via MCP |
| **Cloudflare** | 1.0.0 | Workers/Pages deploy diagnostics via MCP (`/diagnose`) |

### Optional extension

| Extension | ID | Why |
|-----------|-----|-----|
| Remote - SSH | `anysphere.remote-ssh` | Remote development over SSH |

---

## 4. MCP configuration

### 4.1 Project MCP (committed — automatic)

File: [`.cursor/mcp.json`](../../.cursor/mcp.json)

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest"]
    }
  }
}
```

| Runtime server id | Source | Auth | Use |
|-------------------|--------|------|-----|
| `project-0-waia-playwright` | Project `mcp.json` | None (local npx) | Browser automation during `/test-and-fix` |

**Restore:** Open repo folder — Cursor loads project MCP automatically. Requires network on first run.

### 4.2 Plugin MCP (account OAuth — manual)

After installing plugins, authenticate each MCP when prompted:

| Server id | Plugin | Endpoint | OAuth |
|-----------|--------|----------|-------|
| `plugin-linear-linear` | Linear | `https://mcp.linear.app/mcp` | Linear account |
| `plugin-supabase-supabase` | Supabase | `https://mcp.supabase.com/mcp` | Supabase account |
| `plugin-cloudflare-cloudflare-docs` | Cloudflare | Plugin-managed | Cloudflare account |
| `plugin-cloudflare-cloudflare-bindings` | Cloudflare | Plugin-managed | Cloudflare account |
| `plugin-cloudflare-cloudflare-builds` | Cloudflare | Plugin-managed | Cloudflare account |
| `plugin-cloudflare-cloudflare-observability` | Cloudflare | Plugin-managed | Cloudflare account |

**Critical:** Use server id **`plugin-linear-linear`**, not `linear`. The alias `linear` fails with "MCP server does not exist" (see [`.cursor/rules/00-overview.mdc`](../../.cursor/rules/00-overview.mdc)).

**Restore:** Settings → MCP → authenticate each server. If auth fails, run the plugin OAuth flow again.

---

## 5. Model configuration

Models are configured in **Cursor Settings → Models** (account-scoped). Policy is documented in repo:

| Phase / command | Mode | Model (default) | Source |
|-----------------|------|-----------------|--------|
| `/groom`, `/decompose` | Plan / Ask | **Opus** | [`AGENTS.md`](../../AGENTS.md) |
| `/plan-feature` | Plan | **Opus** | [`AGENTS.md`](../../AGENTS.md) |
| `/implement`, `/test-and-fix`, `/prepare-pr` | Agent | **Sonnet** | [`AGENTS.md`](../../AGENTS.md) |
| `/bg-test-and-fix`, `/fix-ci` | Background Agent | **Sonnet** | [`docs/AGENT_AUTOMATION.md`](../AGENT_AUTOMATION.md) |
| Fast docs / low-risk edits | Agent | **Composer 2** | [`docs/waia-governance/AGENT-ROLES.md`](../waia-governance/AGENT-ROLES.md) |

**Restore checklist:**

1. Enable **Claude Sonnet**, **Claude Opus**, and **Composer 2** (or current equivalents).
2. **Disable unused models** so agents cannot silently switch tiers.
3. Set Agent mode default to Sonnet for implementation work.

---

## 6. Agent, Composer, Plan, and Background Agent settings

| Capability | Configuration | Storage | Restore |
|------------|---------------|---------|---------|
| **Agent mode** | Cursor UI — default for `/implement`, `/test-and-fix` | Account | Enable in subscription |
| **Plan mode** | Cursor UI — `/plan-feature`, audits | Account | Enable in subscription |
| **Composer** | Inline editing; follows same model policy | Account | Default Cursor feature |
| **Background agents** | `/bg-test-and-fix`, `/fix-ci` | Account + subscription | Enable Background Agents |
| **Auto-advance** | Process only — [`docs/waia-governance/AGENT-AUTO-ADVANCE.md`](../waia-governance/AGENT-AUTO-ADVANCE.md) | Repo docs | Read and follow preconditions |
| **Bugbot** | GitHub App on repository | GitHub org | Verify Bugbot enabled on `oumaster369/waia` |

**Agent safety boundaries** (repo-enforced):

- Hooks: [`.cursor/hooks/guard-shell.sh`](../../.cursor/hooks/guard-shell.sh) blocks force-push and direct push to `dev`/`main`
- GitHub rulesets: [`.github/rulesets/dev-main-protection.json`](../../.github/rulesets/dev-main-protection.json)
- Agents **never merge** PRs ([`docs/waia-governance/PR-PROTOCOL.md`](../waia-governance/PR-PROTOCOL.md))

---

## 7. Cursor User Rules (account-scoped — paste on new account)

These rules currently live only in the Cursor account **Settings → Rules → User Rules**. Paste the following blocks into a new account to restore operator behavior.

### 7.1 Git commit protocol

```markdown
Only create commits when requested by the user. If unclear, ask first. When the user asks you to create a new git commit, follow these steps carefully:

Git Safety Protocol:

- NEVER update the git config
- NEVER run destructive/irreversible git commands (like push --force, hard reset, etc) unless the user explicitly requests them in the user query or in a different user rule
- NEVER skip hooks (--no-verify, --no-gpg-sign, etc) unless the user explicitly requests it in the user query or in a different user rule
- NEVER run force push to main/master, warn the user if they request it
- Avoid git commit --amend. ONLY use --amend when ALL conditions are met:
  1. User explicitly requested amend, OR commit SUCCEEDED but pre-commit hook auto-modified files that need including
  2. HEAD commit was created by you in this conversation (verify: git log -1 --format='%an %ae')
  3. Commit has NOT been pushed to remote (verify: git status shows "Your branch is ahead")
- CRITICAL: If commit FAILED or was REJECTED by hook, NEVER amend - fix the issue and create a NEW commit
- CRITICAL: If you already pushed to remote, NEVER amend unless the user explicitly requests it in the user query or in a different user rule (requires force push)
- NEVER commit changes unless the user explicitly asks you to in the user query or in a different user rule. It is VERY IMPORTANT to only commit when explicitly asked, otherwise the user will feel that you are being too proactive.

Before commit: run git status, git diff, git log in parallel. Draft conventional commit message. Use HEREDOC for commit message. Do not push unless explicitly asked.
```

### 7.2 Pull request protocol

```markdown
Use the gh command via the Shell tool for ALL GitHub-related tasks. When the user asks you to create a pull request:

1. Run git status, git diff, upstream tracking check, git log, and git diff [base]...HEAD in parallel
2. Analyze ALL commits that will be included in the PR
3. Push with -u if needed, then gh pr create with HEREDOC body
4. Return the PR URL when done
5. NEVER update git config. Do not use git -i flags.
```

### 7.3 Instruction fidelity

```markdown
Follow ALL user, tool, system, and skill instructions precisely and completely. When a skill, rule, or tool description specifies a format or workflow, FOLLOW it — even if you think a different approach might be better. Skills are in ~/.cursor/skills-cursor/ — read and follow when relevant.
```

### 7.4 Real environment

```markdown
This is a real environment with full shell access, not a simulated one. You MUST run commands and use tools to investigate and solve problems yourself. You MUST NOT give up after a single failure.
```

### 7.5 Communication standards

```markdown
- Use code citation blocks: ```startLine:endLine:filepath format
- Citation fences must be on their own line
- Prefer markdown links for URLs and paths
- Write like an excellent technical blog post — precise, well-structured, complete sentences
- Do not overuse bolding or backticks
- Keep responses proportional to task complexity
- Avoid engagement baiting at end of responses
```

### 7.6 Conversation continuity

```markdown
Reason about conversation history to understand user intent. The latest message inherits context from prior turns. Identify underlying goal from the arc of the conversation, not just literal text.
```

### 7.7 Code principles

```markdown
1. Minimize scope — simplest correct diff
2. Avoid over-engineering
3. Use existing conventions — read surrounding code first
4. Comments only for non-obvious business logic
5. Useful tests only — no trivial assertions
```

### 7.8 WAIA product context

```markdown
WAIA delivery focus: AI-Twin v1 (not the entire ecosystem).

AI-Twin v1 includes: auth + dashboard, six readiness indicators (Values, Behavior, Thinking, Emotions, Interests, Goals), dialogue interface, Twin/Diary/Society tabs with unlock thresholds, socialization flow.

Deferred modules: Business, AI-Trader (separate product module), AI-Marketplace — do not implement unless explicitly requested.

Core principles: modular, scalable, user data belongs to user, trust and auditability, simplicity at MVP with growth path.

Before implementing: identify if feature belongs to AI-Twin v1 or later module.
```

---

## 8. Project Rules (repository — automatic)

Nine rules in [`.cursor/rules/`](../../.cursor/rules/):

| File | alwaysApply | globs | Purpose |
|------|-------------|-------|---------|
| `00-overview.mdc` | yes | — | Tech stack, repo layout, Linear MCP id |
| `10-git-workflow.mdc` | yes | — | Branch naming, commits, git safety |
| `40-secrets.mdc` | yes | — | Never commit secrets |
| `11-app-routes.mdc` | no | `app/**` | App Router conventions |
| `12-db-schema.mdc` | no | `db/**` | Drizzle / migrations |
| `13-lib-modules.mdc` | no | `lib/**` | Lib boundaries |
| `20-code-style.mdc` | no | `**/*.{ts,tsx}` | TypeScript / React style |
| `30-testing.mdc` | no | `**/*.{ts,tsx}` | Vitest + Playwright policy |
| `50-waia-design-os.mdc` | no | `**/*.{tsx,css}` | Design tokens / UI |

Also loaded: [`AGENTS.md`](../../AGENTS.md), [`CLAUDE.md`](../../CLAUDE.md) (redirect stub).

**Restore:** Clone repo and open folder — no account action needed.

---

## 9. Commands (repository — automatic)

Ten slash-command playbooks in [`.cursor/commands/`](../../.cursor/commands/):

| Command | Purpose |
|---------|---------|
| `/groom` | Validate Linear task contract |
| `/decompose` | Split issues via Linear MCP |
| `/plan-feature` | Write plan to `.cursor/plans/<slug>.md` |
| `/implement` | Code on `dee-*` branch |
| `/test-and-fix` | lint → typecheck → test → build (+ e2e when UI) |
| `/prepare-pr` | Push + PR package; never merge |
| `/bg-test-and-fix` | Unattended green loop |
| `/fix-ci` | CI triage |
| `/diagnose` | Cloudflare deploy investigation |
| `/parallel-implement` | Parallel worktree fan-out |

**Restore:** Automatic from repo.

---

## 10. Hooks (repository — automatic)

File: [`.cursor/hooks.json`](../../.cursor/hooks.json)

| Hook | Script | Behavior |
|------|--------|----------|
| `beforeShellExecution` | `guard-shell.sh` | **failClosed** — blocks force-push, push to dev/main, destructive rm |
| `afterFileEdit` | `format-edit.sh` | ESLint --fix + Prettier on edited source files |
| `stop` / `subagentStop` | `log-event.sh` | Append to `.cursor/agent-log.jsonl` (gitignored) |

**Restore:** Automatic. Ensure hook scripts are executable:

```bash
chmod +x .cursor/hooks/*.sh
```

Verify in **Cursor Settings → Hooks**.

---

## 11. Cursor editor settings (local — optional)

Recommended user settings (paste in **Cursor Settings → JSON**):

```json
{
  "window.autoDetectColorScheme": true,
  "git.openRepositoryInParentFolders": "never"
}
```

**Storage:** `~/Library/Application Support/Cursor/User/settings.json` (macOS).

---

## 12. Environment variables checklist (no secrets)

Copy templates and fill from secure vault — **never commit values**.

| File | Template | Required for |
|------|----------|--------------|
| `.env.local` | [`.env.example`](../../.env.example) | Local `pnpm dev`, migrations, OAuth, AI keys |
| `.dev.vars` | [`.dev.vars.example`](../../.dev.vars.example) | `pnpm cloudflare:preview` / Wrangler |

### Minimum local dev

| Variable | Required? | Notes |
|----------|-----------|-------|
| `NEXT_PUBLIC_SITE_URL` | yes | Default `http://localhost:3000` |
| `DATABASE_URL` | yes | Default SQLite `file:./.data/waia.db` |
| `OAUTH_PUBLIC_BASE_URL` | yes | Match dev origin |
| `AUTH_SESSION_MAX_AGE_SECONDS` | optional | Default 30 days in code |

### Postgres / Supabase (when used)

| Variable | Required? | Notes |
|----------|-----------|-------|
| `DATABASE_URL_POSTGRES` | when PG tooling | Transaction pooler for Workers |
| `DATABASE_URL_POSTGRES_SESSION` | M9 campaigns | Session pooler for long CLI runs (DEE-399) |
| `WAIA_DB_BACKEND` | optional | `postgres` to switch runtime |
| `NEXT_PUBLIC_SUPABASE_URL` | when SSR wired | Public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | when SSR wired | Public |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | **Secret** |

### OAuth providers (when testing auth)

| Variable | Notes |
|----------|-------|
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `APPLE_*` | Apple Sign In materials |
| `TELEGRAM_BOT_TOKEN` | Telegram login |

### AI-TRADER / ops (when running trader CLI)

See full inventory in [`.env.example`](../../.env.example) — includes HTX credentials, alerting bots, AI gateway keys, Tron settlement RPC, etc.

### GitHub Actions secrets (not local — org-level)

| Secret | Purpose |
|--------|---------|
| `LINEAR_API_KEY` | Auto-mark Linear issues Done on merge |

---

## 13. GitHub authentication

### Local `gh` CLI

```bash
gh auth login
gh auth status
```

Required scopes: repo access to `oumaster369/waia`.

Credential helper is typically `gh auth git-credential` (macOS keychain).

### Repository protection (already in repo)

- Branch rulesets: [`.github/rulesets/dev-main-protection.json`](../../.github/rulesets/dev-main-protection.json)
- Apply once per org (maintainer): `./scripts/github/apply-branch-rulesets.sh`

### Agent PR workflow

Agents use `gh pr create --base dev` per [`.cursor/commands/prepare-pr.md`](../../.cursor/commands/prepare-pr.md). Humans merge.

---

## 14. Restoration order

Execute in this sequence on a **brand-new macOS + Cursor account**:

### Phase 1 — Base tooling

1. Install Homebrew, Git, Node 22, pnpm 10, gh, Cursor, jq (optional), Docker (optional).
2. Sign in to **new Cursor account**.

### Phase 2 — Repository

3. `gh auth login`
4. `git clone https://github.com/oumaster369/waia.git ~/Projects/waia`
5. `cd ~/Projects/waia && git checkout dev && git pull origin dev`
6. `pnpm install`
7. Copy `.env.local` and `.dev.vars` from secure backup (or create from examples).
8. `pnpm db:migrate`

### Phase 3 — Cursor account configuration

9. **File → Open Folder** → `~/Projects/waia`
10. Paste **User Rules** (Section 7) into Settings → Rules → User Rules
11. Apply **editor settings** (Section 11)
12. Configure **models** (Section 5)
13. Install **plugins**: Linear, Supabase, Cloudflare (Section 3)
14. **Authenticate MCP** servers (Section 4.2)
15. Verify **hooks** loaded (Section 10)
16. Wait for **codebase indexing** to complete

### Phase 4 — Validate

17. Run validation checklist (Section 15)
18. Test Linear MCP: list issues on project WAIA / team DEE
19. Test Supabase MCP: list projects
20. Optional: run `pnpm test:e2e` (Playwright MCP + browsers)

---

## 15. Validation checklist

Run after restoration:

```bash
# Dependencies
node -v          # expect 22.x
pnpm -v          # expect 10.x
gh auth status   # must succeed

# Project gates (required before any PR)
pnpm lint
pnpm typecheck
pnpm test --run
pnpm build

# PR governance regression
pnpm validate:pr-governance

# Optional — UI changes
pnpm test:e2e
```

### Cursor-specific checks

- [ ] Project Rules visible (9 rules under `.cursor/rules/`)
- [ ] Commands available (10 under `.cursor/commands/`)
- [ ] Hooks tab shows 4 hook entries from `hooks.json`
- [ ] MCP: `project-0-waia-playwright` starts without error
- [ ] MCP: `plugin-linear-linear` authenticated
- [ ] MCP: `plugin-supabase-supabase` authenticated
- [ ] MCP: Cloudflare plugin servers authenticated
- [ ] User Rules pasted (Section 7)
- [ ] Models: Sonnet + Opus enabled; unused models disabled

---

## 16. Account-dependent items to migrate manually

These **cannot** be stored in git and must be handled during account migration:

| Item | Action before decommissioning old account |
|------|-------------------------------------------|
| User Rules | Already captured in Section 7 — paste into new account |
| MCP OAuth tokens | Re-authenticate on new account |
| `.env.local` / `.dev.vars` | Secure copy from old machine |
| `~/.cursor/plans/` | Copy if plan history needed (gitignored) |
| Agent transcripts | Copy from `~/.cursor/projects/.../agent-transcripts/` if needed |
| Local git branches | Push or document (see Section 17) |
| Uncommitted work | Commit, stash, or discard (see Section 17) |

---

## 17. Repository synchronization reference

Run before migration to assess git state:

```bash
git checkout dev && git pull origin dev
git status -sb
git branch -vv
```

### Expected healthy state

- Branch: `dev` tracking `origin/dev`
- Ahead/behind: `0 0`
- Working tree: clean (or known pending items documented)

### Known gitignore patterns for Cursor runtime

From [`.gitignore`](../../.gitignore):

- `.cursor/agent-log.jsonl` — local agent audit log
- `.cursor/plans/` — plan artifacts (regenerate via `/plan-feature`)
- `.cursor/pr-*.md` — **not** gitignored; treat ad-hoc PR bodies as local scratch unless committed intentionally

---

## 18. Future-proofing recommendations

Items still partially dependent on Cursor account or local machine — proposed repo improvements:

| Gap | Proposal | Priority |
|-----|----------|------------|
| User Rules only in account | **Done** — Section 7 of this doc | — |
| Plans gitignored but referenced in docs | Archive approved plans under `docs/plans/` | Medium |
| `replay-runs/` campaign JSON artifacts untracked | Add runbook: commit evidence vs gitignore `_operator-forensics-stash/` | Medium |
| Playwright MCP uses `@latest` | Pin version in `.cursor/mcp.json` | Low |
| No preflight script | Add `scripts/ops/cursor-env-preflight.sh` | Low |
| `.vscode/extensions.json` missing | Recommend `anysphere.remote-ssh` for team | Low |

---

## 19. Quick reference — MCP server ids

| Use this id | Not this |
|-------------|----------|
| `plugin-linear-linear` | `linear` |
| `plugin-supabase-supabase` | `supabase` |
| `project-0-waia-playwright` | — |

---

*Last updated: 2026-07-10 — canonical for WAIA Cursor account migration.*
