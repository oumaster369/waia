# /implement

Switch to **Agent Mode** with Claude Sonnet 4.5 (default) and execute the canonical plan from `docs/plans/dee-<NN>-<slug>.md` (or bootstrap sources before Slice C).

## What you must do

1. Resolve the canonical plan: prefer **`docs/plans/dee-<NN>-<slug>.md`** matching the current branch's `integrationIssue`; if missing (bootstrap before Slice C), use the master Build program + Linear issue; fallback to newest draft in `.cursor/plans/`.
2. Verify you are on `dev` and it is up to date:

   ```bash
   git checkout dev && git pull --ff-only origin dev
   ```

3. Create the feature branch using the canonical WAIA convention from `AGENTS.md` ("Branching and PR Rules"): `dee-<NN>-<slug>`, where `<NN>` is the Linear issue number zero-padded to two digits and `<slug>` is a kebab-case summary of the goal:

   ```bash
   git checkout -b dee-<NN>-<slug>
   ```

   Example: `dee-37-implement-readiness-service`. `AGENTS.md` is the source of truth; do not invent alternative branch templates.

4. Implement the plan **file by file** following `.cursor/rules/20-code-style.mdc`.
5. Update plan `state` after each work package when a canonical plan exists (commit with related changes).
6. After each meaningful chunk, run:

   ```bash
   pnpm lint && pnpm typecheck && pnpm test --run
   ```

7. When the implementation is complete, hand off to `/test-and-fix`.

## Integration boundary ([`INTEGRATION-BOUNDARY-POLICY.md`](../../docs/waia-governance/INTEGRATION-BOUNDARY-POLICY.md))

- Many work packages, local commits, and branch pushes **without a PR** until integration-ready.
- Open **exactly one PR** per integration Linear issue when the integration-ready contract holds.
- Classify actions AUTO / CONFIRM / HUMAN-ONLY per policy; stop at human merge (Checkpoint #3).
- After first push: sync with `git fetch origin && git merge --no-edit origin/dev` — never force-push.

## Hard rules

- Do not commit until tests pass locally.
- Do not change the plan file. If the plan is wrong, switch back to Plan Mode and re-plan.
- Do not push to `dev` or `main` directly. The shell guard hook will block you anyway.
