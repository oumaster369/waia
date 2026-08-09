# Executable governance hooks

Operational aids that enforce WAIA DEV OS at CI/GitHub/Cursor boundaries. **Advisory hooks** pilot before blocking.

## Implemented

| Hook | Placement | Severity |
|------|-----------|----------|
| Shell guard (no force-push, no protected-branch push) | [`.cursor/hooks/guard-shell.sh`](../../.cursor/hooks/guard-shell.sh) | Blocking (local) |
| Auto-format on file edit | [`.cursor/hooks/format-edit.sh`](../../.cursor/hooks/format-edit.sh) | Best-effort |
| Branch ruleset `main` | [`.github/rulesets/main-protection.json`](../../.github/rulesets/main-protection.json) + apply script | Blocking (GitHub) |
| PR Linear ID P0 validation | [`.github/workflows/pr-governance.yml`](../../.github/workflows/pr-governance.yml) + [`validate-pr-linear-id.sh`](../../scripts/linear/validate-pr-linear-id.sh) | **Blocking** (ruleset) |
| PR body preflight (local) | [`preflight-pr-governance.sh`](../../scripts/linear/preflight-pr-governance.sh) + [`.cursor/commands/prepare-pr.md`](../../.cursor/commands/prepare-pr.md) | **Mandatory** (agent handoff) |
| Linear Done on merge to `main` (explicit **Linear:** field) | [`.github/workflows/linear-done.yml`](../../.github/workflows/linear-done.yml) | Automated; skips + warns on ambiguity |
| Tenant isolation gate (transitive via `build`) | [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) — `build` job `needs: [lint, typecheck, tenant-isolation]` | **Blocking** (ruleset) |
| CI failure → `/fix-ci` hint | [`.github/workflows/ci-failure-triage.yml`](../../.github/workflows/ci-failure-triage.yml) | Advisory |

Frozen `dev` may still appear in legacy hook patterns until Human retirement after one successful single-trunk cycle; **active** protection and PR base is **`main`**.

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
