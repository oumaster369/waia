# /plan-feature

Switch to **Plan Mode** and use the strongest reasoning model available (e.g. Claude Opus 4.x) to design the implementation **before any code changes**.

## What you must do

1. Read **`AGENTS.md`**, skim **`docs/waia-governance/README.md`**, and `.cursor/rules/*` first. **`docs/DEVELOPMENT_WORKFLOW.md`** is for git ergonomics / deploy snippets only—canonical workflow remains **`AGENTS.md`**.
2. Restate the goal in 1-2 sentences. Confirm assumptions explicitly.
3. Explore the relevant parts of the codebase (`app/`, `components/`, `lib/`, existing tests). Cite specific files.
4. Produce a plan with:
   - **Goal** and non-goals
   - **Files to add / change** (paths + 1-2 lines per file)
   - **Tests** — what unit and e2e tests will be added/changed
   - **Risk / rollout** notes
   - **Open questions** (if any) — ask the user before continuing
5. Save the final plan to `.cursor/plans/<YYYY-MM-DD>-<slug>.md` and reference it in the next phase.

## Hard rules

- **No code edits** in this phase. Plan Mode is read-only.
- If multiple valid implementations exist, list them with trade-offs and ask the user to pick one.
- Don't create the feature branch yet — that happens in `/implement`.
