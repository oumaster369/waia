# /implement

Switch to **Agent Mode** with Claude Sonnet 4.5 (default) and execute the plan from `.cursor/plans/<latest>.md`.

## What you must do

1. Read the plan file (most recent in `.cursor/plans/`).
2. Verify you are on `dev` and it is up to date:

   ```bash
   git checkout dev && git pull --ff-only origin dev
   ```

3. Create the feature branch from the plan slug:

   ```bash
   git checkout -b feature/<scope>-<slug>
   ```

4. Implement the plan **file by file** following `.cursor/rules/20-code-style.mdc`.
5. After each meaningful chunk, run:

   ```bash
   pnpm lint && pnpm typecheck && pnpm test -- --run
   ```

6. When the implementation is complete, hand off to `/test-and-fix`.

## Hard rules

- Do not commit until tests pass locally.
- Do not change the plan file. If the plan is wrong, switch back to Plan Mode and re-plan.
- Do not push to `dev` or `main` directly. The shell guard hook will block you anyway.
