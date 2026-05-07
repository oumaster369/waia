# Executable governance hooks (design backlog)

**Nothing here is implemented by this artifact.** Tracks optional future advisory→blocking machinery.

Hooks are **optional operational aids**, not milestones. **No hook** deployed does **not** mean WAIA is “behind”—maturity stays in human review + docs. **Experiments welcome** where noise stays low (`Adoption rules` below).

## Candidates

| Hook idea | Probable placement | Intended severity evolution |
|-----------|-------------------|----------------------------|
| Branch pattern `dee-..` preflight | GH Action / local voluntary script `.tools/` | Advisory → Blocking |
| PR body regex for Linear + tier | Action comment bot | Advisory |
| Grep sentinel for forbidden transaction shortcuts | Script `pnpm verify:migration-guidance` (future) | Advisory → selective Block |
| ADR linkage reminder if Tier≥T2 & missing | CI comment | Advisory |

## Adoption rules

1. Pilot advisory minimally noisy.  
2. Collect false positives (<5% flaky) before block.  
3. Document rollout in [`GOVERNANCE-VERSIONING.md`](GOVERNANCE-VERSIONING.md).

## Ownership

Architect + maintainer nominate hook owner quarterly (lightweight accountability).
