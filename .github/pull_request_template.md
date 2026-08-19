## Summary

<!-- 1-3 bullets: what changed and why. -->

-
-

## Linked issue / plan

**Linear:** `DEE-NN` <!-- REQUIRED — canonical issue id; must match PR title + branch `dee-NN-*` -->

**Batch mode:** `single-issue` <!-- default; use `integration-train` only with a validated frozen AI-TRADER manifest -->

<!-- Example: **Linear:** `DEE-153` https://linear.app/deepsense/issue/DEE-153/... -->

<!-- Optional child issues: **Parent:** `DEE-NN` (same bold/backtick syntax; not required or validated) -->

**Linear groom verified:** <!-- yes (via /groom) OR n/a with Architect approval -->

**Includes:** <!-- optional child issue ids: `DEE-YYY`, `DEE-ZZZ` — not validated; not auto-closed on merge -->

**Deferred:** <!-- optional: child work not delivered in this batch — Linear children stay open -->

**Plan:** <!-- `docs/plans/dee-NN-slug.md` or `n/a` (Architect-approved bootstrap only) -->

<!-- Integration Train only — uncomment and fill every line; Includes/Deferred must exactly match the frozen manifest.

**Integration manifest:** `docs/plans/dee-NN-slug.integration-train.json`
**Manifest digest:** `<sha256>`
**Manifest status:** `frozen`
**Manifest base SHA:** `<exact PR base SHA>`
**Manifest head SHA:** `<exact PR head SHA>`
**Concurrency limit:** `2`
**Final integration:** `serialized`
**Independent review:** `pass`
**Independent review head:** `<same exact PR head SHA>`
**Unresolved findings:** `0`
**DEE-653 admission:** `required-before-merge`

Child evidence lives in the manifest: dependencies, scope, expected/actual surfaces, tier/Human gate, integrated commits/files/tests, cumulative checks, and delivered/deferred disposition.
-->

## Risk tier

<!-- T0 … T4 per `docs/waia-governance/RISK-TIERS.md` -->

**Tier:**

## Merge strategy

<!-- Single-trunk: Squash and merge into `main` for feature/fix/governance PRs. Official release is a separate Human tag/release of an exact main SHA — not a branch-to-branch promotion. -->

**Merge strategy:** squash

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
