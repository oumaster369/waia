# Executable governance hooks

Operational aids that enforce WAIA DEV OS at CI/GitHub/Cursor boundaries. **Advisory hooks** pilot before blocking.

## Implemented

| Hook | Placement | Severity |
|------|-----------|----------|
| Shell guard (no force-push, no dev/main push) | [`.cursor/hooks/guard-shell.sh`](../../.cursor/hooks/guard-shell.sh) | Blocking (local) |
| Auto-format on file edit | [`.cursor/hooks/format-edit.sh`](../../.cursor/hooks/format-edit.sh) | Best-effort |
| Branch ruleset `dev` + `main` | [`.github/rulesets/`](../../.github/rulesets/) + apply script | Blocking (GitHub) |
| PR branch + Linear advisory | [`.github/workflows/pr-governance.yml`](../../.github/workflows/pr-governance.yml) | Advisory |
| Linear Done on merge | [`.github/workflows/linear-done.yml`](../../.github/workflows/linear-done.yml) | Automated (secret-gated) |
| CI failure → `/fix-ci` hint | [`.github/workflows/ci-failure-triage.yml`](../../.github/workflows/ci-failure-triage.yml) | Advisory |

## Backlog candidates

| Hook idea | Probable placement | Intended severity evolution |
|-----------|-------------------|----------------------------|
| Grep sentinel for forbidden transaction shortcuts | `pnpm verify:migration-guidance` (future) | Advisory → selective Block |
| ADR linkage reminder if Tier≥T2 & missing | CI comment | Advisory |

## Adoption rules

1. Pilot advisory minimally noisy.  
2. Collect false positives (<5% flaky) before block.  
3. Document rollout in [`GOVERNANCE-VERSIONING.md`](GOVERNANCE-VERSIONING.md).

## Ownership

Architect + maintainer nominate hook owner quarterly.
