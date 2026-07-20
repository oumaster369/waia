## Summary

<!-- 1-3 bullets: what changed and why. -->

-
-

## Linked issue / plan

**Linear:** `DEE-NN` <!-- REQUIRED — canonical issue id; must match PR title + branch `dee-NN-*` -->

<!-- Example: **Linear:** `DEE-153` https://linear.app/deepsense/issue/DEE-153/... -->

<!-- Optional child issues: **Parent:** `DEE-NN` (same bold/backtick syntax; not required or validated) -->

**Linear groom verified:** <!-- yes (via /groom) OR n/a with Architect approval -->

**Includes:** <!-- optional child issue ids: `DEE-YYY`, `DEE-ZZZ` — not validated; not auto-closed on merge -->

**Deferred:** <!-- optional: child work not delivered in this batch — Linear children stay open -->

**Plan:** <!-- `docs/plans/dee-NN-slug.md` or `n/a` (Architect-approved bootstrap only) -->

## Risk tier

<!-- T0 … T4 per `docs/waia-governance/RISK-TIERS.md` -->

**Tier:**

## Merge strategy

<!-- `squash` for feature/fix/governance PRs (default). `merge-commit` REQUIRED for release-promotion (dev→main) and back-sync (main→dev) PRs — squash drops the second parent and re-creates ancestry drift. See `docs/waia-governance/BRANCHING-STRATEGY.md`. -->

**Merge strategy:** squash <!-- squash | merge-commit -->

## ADR

<!-- Link to `docs/adr/NNNN-*.md`, or note `ADR: n/a (<one-line rationale>)` -->

## Human gate / ambiguity

<!-- `Human gate: no` OR `yes — <why>` -->

**Architectural ambiguity surfaced during work:** <!-- `no` OR describe + escalation path -->

## Migration impacted

<!-- `no` OR `yes` + sentence pointing to tracker / docs/migrations -->

## Test plan

- [ ] `pnpm lint` passes
- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes
- [ ] `pnpm test:e2e` passes (if UI changes)
- [ ] Manual check: <describe>

## Screenshots / recordings

<!-- For UI changes; drag in images or videos. Delete section if N/A. -->

## Risk & rollout

<!-- Migrations, env vars, breaking changes, deploy notes. Delete section if N/A. -->

## Agent attribution

<!-- If an AI agent produced this PR, name the model/agent and link the chat. -->
