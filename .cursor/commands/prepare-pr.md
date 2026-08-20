# /prepare-pr

**PR readiness package:** push the current `dee-*` branch to `origin`, then supply compare/PR links and a paste-ready title and body targeting **`main`**. Human opens/reviews/squash-merges by default. The only merge exception is a fresh exact-head DEE-653 admission for an eligible AI-TRADER implementation PR; governance amendments and all reserved surfaces remain Human-merge-only.

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

Never push directly to `main` (or frozen `dev`).

### 4. Compare URL (base `main`, head = current branch)

Resolve `owner/repo` from `origin` (pick one approach):

- **If `gh` is available:** `gh repo view --json nameWithOwner -q .nameWithOwner` → `OWNER/REPO`
- **Else parse `git remote get-url origin`** for `github.com` SSH or HTTPS forms

Then print the **compare URL** (GitHub “Create pull request” entry point from this page):

```text
https://github.com/OWNER/REPO/compare/main...BRANCH
```

Use the **exact** remote branch name for `BRANCH` (URL-encode if it contains special characters).

### 5. GitHub PR creation URL

The compare URL in step 4 is the primary **PR creation** link: open it in a browser, confirm base **`main`** and compare branch, then use **Create pull request**.

Optionally include `?expand=1` on the compare URL if you want the rich compare view expanded; behavior is cosmetic.

### 6. PR title and body (ready to paste)

1. **Read** [`.github/pull_request_template.md`](../../.github/pull_request_template.md) and derive content from the **canonical plan** in `docs/plans/<branch>.md` when it exists.
2. **Copy** the template structure verbatim; fill placeholders (Summary, Linked issue, Risk tier, Test plan, etc.).
3. **Required field syntax** (validator-enforced — plain text fails CI):

   | Rejected | Required |
   |----------|----------|
   | `Linear: DEE-NN` | `**Linear:** \`DEE-NN\`` (+ optional Linear URL) |
   | `Tier: T1` | `**Tier:** T1` |
   | `Parent: DEE-NN` | `**Parent:** \`DEE-NN\`` (optional; child issues only) |

   Metadata belongs under `## Linked issue / plan` and `## Risk tier` — not a separate top-level block.

   For `**Batch mode:** \`integration-train\``, also render every field in [`PR-PROTOCOL.md`](../../docs/waia-governance/PR-PROTOCOL.md) §AI-TRADER Integration Train fields. `**Includes:**` and `**Deferred:**` must exactly match the frozen manifest; the validator recomputes its digest and binds current base/head/independent-review head. Missing/stale evidence fails closed. Single-issue mode needs no train manifest.

4. **Write** the rendered body to `.cursor/pr-body-DEE-NN.md` (gitignored temp path).
5. **Preflight** (mandatory — do **not** hand off if this fails):

   ```bash
   PR_TITLE="DEE-NN type(scope): subject" \
   PR_BRANCH="$(git branch --show-current)" \
   PR_BASE=main \
   ./scripts/linear/preflight-pr-governance.sh --body-file .cursor/pr-body-DEE-NN.md
   ```

6. **Title:** Conventional-commit style; include **Linear ID** (`DEE-NN`) per [`docs/waia-governance/PR-PROTOCOL.md`](../../docs/waia-governance/PR-PROTOCOL.md).
7. **Deliver** only after preflight passes:
   - **Preferred:** `gh pr create --base main --title "..." --body-file .cursor/pr-body-DEE-NN.md`
   - **Fallback:** paste-ready body in agent report (same content that passed preflight)

Checkbox rule: only check template items **actually verified**.

### 7. Report validation results

Echo the commands that were run for this task and their outcome (see [`AGENTS.md`](../../AGENTS.md) validation section — local PR readiness: **`pnpm lint && pnpm typecheck && pnpm build`** + **targeted tests** + **`pnpm validate:pr-governance`** / preflight; add **`pnpm test:e2e`** when UI/user-visible behavior changed). Full unit suite is **authoritative in GitHub PR CI** — do not require a redundant full local `pnpm test --run` solely to duplicate that gate.

### 8. Stop and wait

Stop before merge by default. Hand off to a human for PR open (if using links only), review, CI green, and squash-merge to `main`. Only an eligible AI-TRADER implementation PR may continue into the separate DEE-653 exact-head admission; this command itself never treats PR preflight as merge authority.

---

## Optional: GitHub CLI shortcut

Only if **`gh` is authenticated** and the operator wants the agent to open the PR form in one step — **after preflight passes**:

```bash
gh pr create --base main --title "DEE-NN type(scope): subject" --body-file .cursor/pr-body-DEE-NN.md --draft=false
```

Do **not** use `--fill` alone when a pre-rendered body file exists — it bypasses the filled template you validated. Still **never** `gh pr merge`.

## Integration boundary ([`INTEGRATION-BOUNDARY-POLICY.md`](../../docs/waia-governance/INTEGRATION-BOUNDARY-POLICY.md))

- Refuse a second PR for an integration id with an existing open/merged PR.
- Include `**Includes:**` and `**Deferred:**` in the rendered body when applicable.
- Synchronize with `origin/main` via merge before opening PR if the branch was already pushed.

## Hard rules

- Never `gh pr merge` from the ordinary agent workflow. The acting AI-TRADER Program Controller may do so only after the separate current-base DEE-653 contract admits the exact immutable implementation head; governance amendments and reserved surfaces never qualify.
- Never push to `main` (or frozen `dev`) directly.
- Never enable or assume auto-merge in agent workflows ([`docs/waia-governance/PR-PROTOCOL.md`](../../docs/waia-governance/PR-PROTOCOL.md)).
