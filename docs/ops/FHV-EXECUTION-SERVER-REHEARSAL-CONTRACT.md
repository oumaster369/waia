# FHV Execution Server Rehearsal Contract (WP-K / DEE-424)

Human-only rehearsal contract. **Agents must not connect to the Execution Server or run this rehearsal.**

## Preconditions

- PR-2 FHV operations core merged to `dev`
- DEE-424 Linux/systemd repository implementation merged to `dev`
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
| `pnpm trader:fhv:rehearsal -- --target-sha <sha> --run-id <id>` | Prepare rehearsal manifest under `replay-runs/RI-P7/fhv-ops-rehearsal/<run-id>/` |
| `scripts/ops/fhv-supervisor/render-units.sh` | Render `waia-fhv-campaign.service` + `waia-fhv-observer.service` (no install) |
| `scripts/ops/fhv-supervisor/install-units.sh` | **Human-only T4** — install units with `--confirm` on Execution Server |
| `scripts/ops/fhv-supervisor/rollback-units.sh` | **Human-only T4** — stop/disable/remove units with `--confirm` |

Systemd units require operator-supplied:

- `WorkingDirectory` (clean checkout root — not hardcoded `/root/waia`)
- `User` (non-root service account)
- `EnvironmentFile` (operator vault path — never committed)

Both units run SHA guard (`execution-server-preflight.sh`) in `ExecStartPre`.

## Sequence (Human-operated)

1. **Legacy preservation (T4):** move stale `/root/waia` checkout (`6faea4e…`) to timestamped legacy directory; do **not** delete 11 untracked legacy files; do **not** auto-import ignored/secret paths.
2. Provision **fresh clean checkout** at released SHA `1744301f…`; verify clean tree + SHA guard PASS.
3. Prepare rehearsal manifest: `pnpm trader:fhv:rehearsal -- --target-sha 1744301f… --run-id fhv-ops-rehearsal-<date>`.
4. Render and install qualified **systemd** units only (`waia-fhv-campaign`, `waia-fhv-observer`) with `--confirm`.
5. Pin `fhv-alert-policy/v1` digest from rehearsal manifest.
6. Start observer, then campaign; run bounded WP03 fixture replay (< 5 minutes).
7. Verify:
   - Bounded `fhv-operator-status/v1` under 256 KiB
   - Checkpoint/resume visibility
   - Alert policy digest match
   - Signed operator command auth drill (`PAUSE_AT_CHECKPOINT`, `RESUME_FROM_CHECKPOINT`)
8. SSH disconnect → **observer restart** → prove campaign economic state unchanged.
9. Worker dashboard via authenticated tunnel.
10. Seal evidence to `replay-runs/RI-P7/fhv-ops-rehearsal-<date>/`.
11. Keep legacy health container `waia-execution-host:bp6` running until separately authorized cutover.

## Rollback

- `scripts/ops/fhv-supervisor/rollback-units.sh --confirm`
- Preserve append-only ledgers (commands, alerts)
- Document terminal state in closure report

## Status

**NOT EXECUTED** — repository implementation merged; awaiting Human T4 gate (`AUTHORIZE-FHV-OPS-DEPLOY`).
