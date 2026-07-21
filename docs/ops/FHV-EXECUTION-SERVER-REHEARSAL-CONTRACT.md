# FHV Execution Server Rehearsal Contract (WP-K / DEE-424)

Human-only rehearsal contract. **Agents must not connect to the Execution Server or run this rehearsal.**

See also: [`FHV-RELEASE-IDENTITY-CONTRACT.md`](FHV-RELEASE-IDENTITY-CONTRACT.md)

## Preconditions

- PR-2 FHV operations core merged to `dev`
- DEE-424 Linux/systemd repository implementation merged to `dev`
- Corrective release-identity gates merged (DEE-431)
- Next dev → main release Human-merged; `EXECUTION_SERVER_TARGET_SHA="$NEW_RELEASE_SHA"` resolved per release identity contract
- `EXECUTION_SERVER_TARGET_SHA` preflight PASS on a **fresh clean checkout** at released SHA
- `HOST_OS=LINUX_SYSTEMD` qualified (Ubuntu 24.04 + systemd observed)
- `AUTHORIZE-FHV-OPS-DEPLOY` issued by Human operator

## Scope

- **Non-production fixture only** (`HTR_WP03_BENCHMARK` allowlisted repository fixture)
- **No real HTX dataset**
- **No live trading**
- **Maximum runtime:** 5 minutes

## Repository tooling (local preparation only)

| Command | Purpose |
|---------|---------|
| `pnpm trader:fhv:rehearsal -- --target-sha "$EXECUTION_SERVER_TARGET_SHA" --run-id <human-approved-unique-run-id>` | Prepare rehearsal manifest under `replay-runs/RI-P7/fhv-ops-rehearsal/<run-id>/` |
| `scripts/ops/fhv-supervisor/render-units.sh` | Render `waia-fhv-campaign.service` + `waia-fhv-observer.service` (no install) |
| `scripts/ops/fhv-supervisor/install-units.sh` | **Human-only T4** — install units with `--confirm` on Execution Server |
| `scripts/ops/fhv-supervisor/rollback-units.sh` | **Human-only T4** — stop/disable/remove units with `--confirm` |

Systemd units require operator-supplied:

- `WorkingDirectory` (clean checkout root — not hardcoded `/root/waia`)
- `User` (non-root service account)
- `EnvironmentFile` (operator vault path — never committed)

Both units run SHA guard (`execution-server-preflight.sh`) in `ExecStartPre`.

## Sequence (Human-operated)

1. **Resolve release identity:** after Human dev → main release merge, set `EXECUTION_SERVER_TARGET_SHA` to the exact new `main` release merge SHA. Verify tag peel and GitHub Release identify the same full SHA. Fail closed if unresolved.
2. **Legacy preservation (T4):** move stale checkout to a timestamped legacy directory; do **not** delete untracked legacy files; do **not** auto-import ignored/secret paths.
3. Provision **fresh clean checkout** at `"$EXECUTION_SERVER_TARGET_SHA"`; verify clean tree + SHA guard PASS.
4. Prepare rehearsal manifest:

   ```bash
   pnpm trader:fhv:rehearsal -- \
     --target-sha "$EXECUTION_SERVER_TARGET_SHA" \
     --run-id "<human-approved-unique-run-id>"
   ```

5. Render and install qualified **systemd** units only (`waia-fhv-campaign`, `waia-fhv-observer`) with `--confirm`.
6. Pin `fhv-alert-policy/v1` digest from rehearsal manifest.
7. Start observer, then campaign; run bounded WP03 fixture replay (< 5 minutes).
8. Verify:
   - Bounded `fhv-operator-status/v1` under 256 KiB
   - Checkpoint/resume visibility
   - Alert policy digest match
   - Signed operator command auth drill (`PAUSE_AT_CHECKPOINT`, `RESUME_FROM_CHECKPOINT`)
9. SSH disconnect → **observer restart** → prove campaign economic state unchanged.
10. Worker dashboard via authenticated tunnel.
11. Seal evidence to `replay-runs/RI-P7/fhv-ops-rehearsal-<date>/`.
12. Keep legacy health container `waia-execution-host:bp6` running until separately authorized cutover.

## Rollback

- `scripts/ops/fhv-supervisor/rollback-units.sh --confirm`
- Preserve append-only ledgers (commands, alerts)
- Document terminal state in closure report

## Historical evidence

| Fact | SHA / note |
|------|------------|
| Previous released `main` (pre DEE-424 release) | `1744301f6ed31c754b183634daa37372a7d898cb` |
| Legacy Execution Server checkout (Human preflight) | `6faea4eeeec5cae50ba025e59ade4117c77131df` |
| DEE-424 feature head (squash source, not a release target) | `dfb7b87c31450e1c494da84acaf5d5582f4daa4d` |
| DEE-424 dev squash merge | `2f6b164b732ac33275dd47a943fc06467d61be5e` |

These identities are historical records only. **Do not** use them as active deployment or rehearsal targets.

## Status

**NOT EXECUTED** — repository implementation merged; awaiting dev → main release, then Human T4 gate (`AUTHORIZE-FHV-OPS-DEPLOY`).
