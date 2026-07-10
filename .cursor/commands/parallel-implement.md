# /parallel-implement

Fan out **independent** atomic Linear issues in parallel using **git worktrees**. Use **Agent Mode**.

## Preconditions

- Each issue is atomic, single execution label, no shared file overlap in `Files` sections.
- Issues are `Todo` or explicitly approved for parallel work.
- Human approves the fan-out list.

## What you must do

1. User provides 2–5 issue ids (`DEE-101`, `DEE-102`, …) or asks you to pick unblocked `Todo` issues.
2. `/groom` each issue — abort fan-out if any is Blocked.
3. Run the worktree bootstrap script:

   ```bash
   ./scripts/worktrees/parallel-issue.sh DEE-101 DEE-102 DEE-103
   ```

   This creates `../waia-worktrees/dee-<NN>-<slug>/` checkouts on `dee-*` branches from current `dev`.

4. For each worktree, launch a **parallel Agent** (or Background Agent) with:

   ```
   /implement — worktree at <path>, issue DEE-NN
   ```

5. Track completion in a summary table (branch, PR URL, CI status).
6. **Do not merge** — human reviews each PR independently.

## Collision handling

If two agents touch the same file → stop both, merge sequentially instead.

## Hard rules

- Max 5 parallel agents (context and review bandwidth).
- Never parallelize T3/T4 or schema + UI on coupled paths without explicit Architect approval.
- Each worktree uses its own `dee-*` branch; never share one branch across agents.

- Each worktree = one integration batch = one PR ([`INTEGRATION-BOUNDARY-POLICY.md`](../../docs/waia-governance/INTEGRATION-BOUNDARY-POLICY.md)).

## Cleanup

After merge:

```bash
git worktree remove ../waia-worktrees/dee-<NN>-<slug>
```
