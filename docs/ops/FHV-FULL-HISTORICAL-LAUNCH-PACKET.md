# FHV Full Historical Validation Launch Packet

**Linear:** DEE-436 · **Authorization:** `AUTHORIZE-FULL-HISTORICAL-VALIDATION` (Human-only)

> **Not interchangeable** with `AUTHORIZE-FHV-OPS-DEPLOY` (T4A Execution Server rehearsal).

## Purpose

Canonical Full Historical Validation launch surface. Writes immutable launch receipt **before** execution. Official multi-year HTX run requires qualified dataset + Human authorization.

## Command

```bash
export FHV_FULL_HISTORICAL_AUTHORIZATION="AUTHORIZE-FULL-HISTORICAL-VALIDATION"
export FHV_RELEASE_SHA="<full-git-sha>"
export FHV_RELEASE_TAG="<optional-tag>"
export FHV_RUN_ID="<human-approved-unique-run-id>"
export FHV_ORGANIZATION_ID="<uuid-v4>"
export FHV_OPERATOR_ID="<operator-id>"
export FHV_ARTIFACT_ROOT="/absolute/artifact/root"
export FHV_DATASET_DIGEST="<qualified-dataset-digest>"
export FHV_MANIFEST_DIGEST="<qualified-manifest-digest>"
export FHV_CHECKPOINT_DIGEST="<checkpoint-digest>"
export FHV_CONFIGURATION_FREEZE_DIGEST="<computed-freeze-digest>"

# Official multi-year (receipt only until qualified dataset bound):
pnpm trader:fhv:run

# Bounded fixture (repository tests / operator rehearsal of FULL parsers):
pnpm trader:fhv:run -- --bounded-fixture \
  --release-sha "$FHV_RELEASE_SHA" \
  --run-id "$FHV_RUN_ID" \
  --organization-id "$FHV_ORGANIZATION_ID" \
  --operator-id "$FHV_OPERATOR_ID" \
  --artifact-root "$FHV_ARTIFACT_ROOT"
```

## Fail-closed gates

- Rejects missing or wrong authorization literal
- Rejects `FHV_REHEARSAL_MODE=true`
- Rejects reused `runId` (immutable receipt collision)
- Rejects wrong digests, wrong initial capital (must be `100000` USDT)
- Rejects premature holdout access
- Rejects live exchange path (`assertFhvReplayNotLiveExchangePath`)
- Binds configuration freeze digest before execution

## Artifacts

- `$FHV_ARTIFACT_ROOT/RI-P7/fhv-full-historical/<run-id>/fhv-full-launch-receipt.v1.json` (immutable, written first)
- Bounded mode also writes `fhv-full-launch-result.v1.json` with `BOUNDED_FULL_HISTORICAL_END_TO_END_PASS`

## Related

- [`FHV-DATASET-QUALIFICATION-PACKET.md`](./FHV-DATASET-QUALIFICATION-PACKET.md)
- [`FHV-CONTROL-REPLAY-PACKET.md`](./FHV-CONTROL-REPLAY-PACKET.md)
- [`HISTORICAL-TEST-READINESS-RUNBOOK.md`](./HISTORICAL-TEST-READINESS-RUNBOOK.md)
