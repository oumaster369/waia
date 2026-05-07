# /prepare-pr

Open a Pull Request targeting `dev` from the current feature branch.

## Steps

1. Check status:

   ```bash
   git status
   git branch --show-current
   ```

   The branch name must match **`dee-<NN>-<slug>`** (Linear issue id + kebab-case summary), per [`AGENTS.md`](../../AGENTS.md) and [`docs/waia-governance/BRANCHING-STRATEGY.md`](../../docs/waia-governance/BRANCHING-STRATEGY.md). If it does not — STOP and ask (legacy `feature/` requires Architect approval documented in the PR).

2. Stage and commit any remaining changes using Conventional Commits:

   ```bash
   git add -A
   git commit -m "<type>(<scope>): <subject>"
   ```

3. Push the branch:

   ```bash
   git push -u origin "$(git branch --show-current)"
   ```

4. Create the PR (uses the repo's PR template automatically):

   ```bash
   gh pr create --base dev --fill --draft=false
   ```

5. Print the PR URL and stop. The user will:
   - Review Bugbot comments
   - Wait for CI to go green
   - Manually merge `dev` -> `main` to trigger Cloudflare Pages deploy

## Hard rules

- Never `gh pr merge` from the agent — merging is the user's call.
- Never push to `dev` or `main` directly.
- If the PR template's checkboxes can be checked truthfully, check them; do not check items you didn't actually verify.
