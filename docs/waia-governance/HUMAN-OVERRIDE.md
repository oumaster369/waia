# Human override — emergency semantics

Agents **never** silently bypass governance. Humans (Architect / operator-on-call) may authorize **temporary** bypass for outage, rollback, legal/safety blocking issues, or time-critical stabilization.

**Semantic / product continuity:** Override relaxes **named operational gates** (merge path, naming, validation depth) **only as the Architect specifies**. It does **not** by itself authorize **silent semantic or product-doc rewrites** or a free pass on [`NON-GOALS.md`](NON-GOALS.md)—unless the bypass record **explicitly** says so.

## Auto-merge pause (operational)

Architect may direct **avoiding or pausing repo/team auto-merge** during migration waves, instability, incidents, or material governance uncertainty—until **explicitly** cleared. Preserves human control over merge **cadence**; not a separate approval system.

## When bypass is justified

Severe prod/staging impact, imminent data loss/security exposure, merge pipeline blocked with no safe alternative inside normal gates.

## Authorized actions during override

- Direct merge coordination (still via GitHub, auditable history).
- Hotfix branches: **prefer** `dee-<NN>-hotfix-<slug>` if Linear issue maps; Architect may waive naming if speed critical — note in merge body.
- Rollback commits / revert PRs without full feature validation **only when** rollback risk < forward fix risk (Architect judgment).

## Mandatory follow-up (~48 hours practical target)

Publish **minimal** retrospective (not a ceremonial postmortem):

1. Linear comment **or** issue update: incident summary, bypass rationale, merging human.
2. If behavior becomes **new precedent**: [`../adr/`](../adr/) `Proposed` → `Accepted` **or** update [`GOVERNANCE-VERSIONING.md`](GOVERNANCE-VERSIONING.md) entry.
3. If code debt remains: child issue linking revert/follow-up.

## Explicit non-goals for override

- Rewriting MVP product thresholds without Architect + product-issue path.
- Broad Postgres rollout or vendor swap without checklist in migration docs [`MIGRATION-GOVERNANCE.md`](MIGRATION-GOVERNANCE.md).

## Related

[`EXECUTION-CONTRACT.md`](EXECUTION-CONTRACT.md) · [`FAILURE-PATTERNS.md`](FAILURE-PATTERNS.md)
