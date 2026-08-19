# /parallel-implement

Fan out **independent** atomic Linear issues in parallel using **git worktrees**. Use **Agent Mode**.

For an authorized AI-TRADER **Integration Train**, this command runs in train mode under [`INTEGRATION-BOUNDARY-POLICY.md`](../../docs/waia-governance/INTEGRATION-BOUNDARY-POLICY.md): child branches feed one Integration Batch branch/PR and the stricter two-task limit below overrides the general fan-out rules.

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

   This creates `../waia-worktrees/dee-<NN>-<slug>/` checkouts on `dee-*` branches from current `main`.

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

## Integration Train override

- The valid admitted manifest must be committed before child implementation and name every child, dependency, expected surface, tier/gate, and contiguous ordered execution wave. One-child waves are serialized; only a two-child wave may declare one parallel group.
- Maximum **two** child implementation tasks at once, each in an isolated worktree/branch. Child branches do not open their own PRs.
- Never run dependent children or children with overlapping expected surfaces/actual files concurrently. Competing migrations, shared canonical identities, shared authority schemas, or mutual invalidation risk require serialization.
- The integrator reviews each child commit/diff, admits it serially to the Integration Batch branch, records exact commit/file/test mapping, and runs cumulative targeted checks after every admission.
- Every child file must stay inside its admitted expected surfaces. The final PR diff/commit range must contain only mapped child work plus the adjacent Integration Batch plan/manifest; unlisted implementation work is rejected.
- The general `Max 5` rule above applies only to separate, independently reviewed integration batches; it never raises a train's two-task limit.

## Cleanup

After merge:

```bash
git worktree remove ../waia-worktrees/dee-<NN>-<slug>
```
