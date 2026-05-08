# /prepare-pr

**PR readiness package:** push the current `dee-*` branch to `origin`, then supply compare/PR links and a paste-ready title and body targeting **`dev`**. Human opens the PR, reviews CI/Bugbot, and merges — **agents never merge**.

Use this command **standalone** (e.g. retry after a rejected push) or rely on it implicitly: **`/test-and-fix` ends here by default** after gates are green (`AGENTS.md` workflow).

## Default completion checklist (agents)

Execute in order. **Stop before merge.** Do not run `gh pr merge` or any auto-merge flow.

### 1. Confirm working tree clean

```bash
git status
```

If there are uncommitted changes → **STOP**: commit or stash in the Implement / Test & Fix phases first; PR readiness assumes a finalized commit sequence.

### 2. Confirm branch naming

```bash
git branch --show-current
```

The branch must match **`dee-<NN>-<slug>`** ([`AGENTS.md`](../../AGENTS.md), [`docs/waia-governance/BRANCHING-STRATEGY.md`](../../docs/waia-governance/BRANCHING-STRATEGY.md)). Otherwise **STOP** and ask (legacy `feature/` needs Architect approval documented in the PR).

### 3. Push to `origin` and set upstream if missing

```bash
git push -u origin "$(git branch --show-current)"
```

`-u` establishes tracking when the upstream is not set yet.

Never push directly to `dev` or `main`.

### 4. Compare URL (base `dev`, head = current branch)

Resolve `owner/repo` from `origin` (pick one approach):

- **If `gh` is available:** `gh repo view --json nameWithOwner -q .nameWithOwner` → `OWNER/REPO`
- **Else parse `git remote get-url origin`** for `github.com` SSH or HTTPS forms

Then print the **compare URL** (GitHub “Create pull request” entry point from this page):

```text
https://github.com/OWNER/REPO/compare/dev...BRANCH
```

Use the **exact** remote branch name for `BRANCH` (URL-encode if it contains special characters).

### 5. GitHub PR creation URL

The compare URL in step 4 is the primary **PR creation** link: open it in a browser, confirm base **`dev`** and compare branch, then use **Create pull request**.

Optionally include `?expand=1` on the compare URL if you want the rich compare view expanded; behavior is cosmetic.

### 6. PR title and body (ready to paste)

- **Title:** Conventional-commit style preferred; include **Linear ID** (`DEE-NN`) per [`docs/waia-governance/PR-PROTOCOL.md`](../../docs/waia-governance/PR-PROTOCOL.md).
- **Body:** Follow [`.github/pull_request_template`](../../.github/pull_request_template.md) (if present): risk tier, Linear link, validation summary, semantic-impact line when required by protocol.

Checkbox rule: only check template items **actually verified**.

### 7. Report validation results

Echo the commands that were run for this task and their outcome (see [`AGENTS.md`](../../AGENTS.md) validation section — minimally **`pnpm lint`** and **`pnpm typecheck`**; full gate list applies before calling work PR-ready unless the issuing task narrows scope).

### 8. Stop and wait

Do **not** merge. Hand off to a human for PR open (if using links only), review, CI green, and merge.

---

## Optional: GitHub CLI shortcut

Only if **`gh` is authenticated** and the operator wants the agent to open the PR form in one step:

```bash
gh pr create --base dev --fill --draft=false
```

Still **never** `gh pr merge`. If `gh` is missing or auth fails, fall back to the compare URL + paste title/body — no requirement to use `gh` for PR readiness.

## Hard rules

- Never `gh pr merge` from the agent — merging is the human’s call.
- Never push to `dev` or `main` directly.
- Never enable or assume auto-merge in agent workflows ([`docs/waia-governance/PR-PROTOCOL.md`](../../docs/waia-governance/PR-PROTOCOL.md)).
