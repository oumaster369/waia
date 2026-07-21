# FHV Execution Server Rehearsal Contract (WP-K / DEE-424)

Human-only rehearsal contract. **Agents must not connect to the Execution Server or run this rehearsal.**

## Preconditions

- PR-2 FHV operations core merged to `dev`
- `EXECUTION_SERVER_TARGET_SHA` preflight PASS
- `HOST_OS` qualified (Linux → systemd, macOS → launchd)
- `AUTHORIZE-FHV-OPS-DEPLOY` issued by Human operator

## Scope

- **Non-production fixture only** (WP03 benchmark or RI-P7 synthetic)
- **No real HTX dataset**
- **No live trading**

## Sequence (Human-operated)

1. Detect `HOST_OS` and install **qualified supervisor only** (campaign + observer units).
2. Pin `fhv-alert-policy/v1` digest in campaign manifest.
3. Run short deterministic replay (< 5 minutes).
4. Verify:
   - Bounded `fhv-operator-status/v1` under 256 KiB
   - Checkpoint/resume visibility
   - Alert policy digest match
   - Signed operator command auth drill (`PAUSE_AT_CHECKPOINT`, `RESUME_FROM_CHECKPOINT`)
5. SSH disconnect → observer restart → campaign resume proof.
6. Worker dashboard via authenticated tunnel.
7. Seal evidence to `replay-runs/RI-P7/fhv-ops-rehearsal-<date>/`.

## Rollback

- Stop supervisor units
- Preserve append-only ledgers (commands, alerts)
- Document terminal state in closure report

## Status

**NOT EXECUTED** — awaiting Human T4 gate after PR-2 merge.
