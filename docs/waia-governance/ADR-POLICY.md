# ADR policy (`docs/adr/`)

Lightweight WHY log.**Do not recreate** migrating operational truth duplicated in trackers.

## Filename & numbering

`NNNN-short-title.md` (4-digit sequential). Update [`README.md`](../adr/README.md) index when adding/changing statuses.

## Status lifecycle

Proposed → **Accepted** (merged decision) ↔ **Superseded by ADR-xxxx** (still readable)

Optional `Deprecated` textual banner if rollback impossible but historical curiosity remains.

## Template (minimal)

```
# ADR-NNNN — Title
Status: Accepted | Proposed | Supersedes ADR-xxxx
Date: YYYY-MM-DD
## Context          ( concise )
## Decision         ( bullet )
## Consequences     ( +/- )
## Links            Linear DEE-xx, PR #, docs paths
```

## When to skip ADR

Trivial refactor, copy tweak, ephemeral experiment behind flag with zero policy impact—capture in PR description only.

## Semantic / product pivots (sometimes ADR-worthy even if code is small)

**WAIA couples product meaning to engineering.** A **material reinterpretation** of **AI-Twin behavior**, **readiness progression**, **aligned autonomy**, **Society interaction**, or **Diary as alignment / behavioral memory** may warrant an ADR when the **precedent should survive churn** beyond one PR—especially if docs or agents will rely on it. **Not** every product tweak: localized UI that **implements** unchanged spec → PR + spec citation only. **Architect judgment**; pair with [`DOCUMENTATION-STANDARDS.md`](DOCUMENTATION-STANDARDS.md) semantic traceability—not ADR inflation.

## Volume discipline

Prefer **few** durable ADRs; watch for ADR spam ([`FAILURE-PATTERNS.md`](FAILURE-PATTERNS.md) future entry). Link supersedes in [`GOVERNANCE-VERSIONING.md`](GOVERNANCE-VERSIONING.md).
