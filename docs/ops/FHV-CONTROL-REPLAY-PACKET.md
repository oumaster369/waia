# FHV Control Replay Operator Packet

**Linear:** DEE-436 · **Classification gate:** `CONTROL_REPLAY=PASS`

## Purpose

Two-run determinism: execute bounded Full Historical Validation twice and compare semantic reproduction digests.

## Command

```bash
export FHV_FULL_HISTORICAL_AUTHORIZATION="AUTHORIZE-FULL-HISTORICAL-VALIDATION"
export FHV_RELEASE_SHA="<full-git-sha>"
export FHV_ORGANIZATION_ID="<uuid-v4>"
export FHV_OPERATOR_ID="<operator-id>"
export FHV_ARTIFACT_ROOT="/absolute/artifact/root"

pnpm trader:fhv:control-replay
```

Exit 0 emits `CONTROL_REPLAY=PASS` when both run digests are identical.

## Machine-readable output

JSON schema: `fhv-control-replay/v1` with fields:

- `classification`: `CONTROL_REPLAY=PASS` | `CONTROL_REPLAY=FAIL`
- `runOneDigest` / `runTwoDigest`
- `digestsMatch`

## Related

- [`FHV-DATASET-QUALIFICATION-PACKET.md`](./FHV-DATASET-QUALIFICATION-PACKET.md)
- [`FHV-FULL-HISTORICAL-LAUNCH-PACKET.md`](./FHV-FULL-HISTORICAL-LAUNCH-PACKET.md)
