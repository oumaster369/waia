# FHV Control Replay Operator Packet

**Linear:** DEE-436 · **Classification gate:** `CONTROL_REPLAY=PASS`

## Purpose

Two-run determinism on the **same Full Historical Validation production path**: execute twice with separate run IDs and compare decisions, fills, costs, accounting, PnL, drawdown, and semantic reproduction digests.

## Official mode

Requires released checkout identity proofs (one per run), `DATASET_QUALIFICATION=PASS` receipt, configuration freeze (one per run), scoped authorization (one per run), control-replay PASS receipt output, and qualified dataset/manifest paths.

```bash
export FHV_RELEASE_SHA="<full-git-sha>"
export FHV_RELEASE_TAG="<release-tag>"
export FHV_ORGANIZATION_ID="<uuid-v4>"
export FHV_OPERATOR_ID="<operator-id>"
export FHV_RUN_ONE_ID="fhv-control-replay-1-<suffix>"
export FHV_RUN_TWO_ID="fhv-control-replay-2-<suffix>"
export FHV_ARTIFACT_ROOT="/absolute/artifact/root"

pnpm trader:fhv:control-replay -- \
  --release-sha "$FHV_RELEASE_SHA" \
  --release-tag "$FHV_RELEASE_TAG" \
  --organization-id "$FHV_ORGANIZATION_ID" \
  --operator-id "$FHV_OPERATOR_ID" \
  --run-one-id "$FHV_RUN_ONE_ID" \
  --run-two-id "$FHV_RUN_TWO_ID" \
  --artifact-root "$FHV_ARTIFACT_ROOT" \
  --configuration-freeze-path "/path/to/fhv-configuration-freeze-run-one.v1.json" \
  --configuration-freeze-path-run-two "/path/to/fhv-configuration-freeze-run-two.v1.json" \
  --authorization-receipt-path "/path/to/fhv-full-historical-authorization-run-one.v1.json" \
  --authorization-receipt-path-run-two "/path/to/fhv-full-historical-authorization-run-two.v1.json" \
  --dataset-qualification-receipt-path "/path/to/fhv-dataset-qualification-receipt.v1.json" \
  --dataset-root "/absolute/dataset/root" \
  --manifest-path "/absolute/fhv-dataset-manifest.v1.json" \
  --checkout-identity-proof-path-run-one "/path/to/run-one/control/fhv-t4-checkout-identity.v1.json" \
  --checkout-identity-proof-path-run-two "/path/to/run-two/control/fhv-t4-checkout-identity.v1.json" \
  --control-replay-receipt-output "/absolute/fhv-control-replay-receipt.v1.json"
```

Exit 0 emits immutable `CONTROL_REPLAY=PASS` receipt when both run digests and cycle counts match.

## Holdout sequence

Before any official holdout launch:

1. Run control replay and retain `--control-replay-receipt-output`
2. Bind `controlReplayReceiptDigest` in scoped authorization receipt
3. Launch with `--control-replay-receipt-path` (holdout unseal evidence recorded at launch)

## Bounded fixture mode (test-only)

```bash
pnpm trader:fhv:control-replay -- --bounded-fixture \
  --release-sha "$FHV_RELEASE_SHA" \
  --organization-id "$FHV_ORGANIZATION_ID" \
  --operator-id "$FHV_OPERATOR_ID" \
  --configuration-freeze-path "<path>" \
  --authorization-receipt-path "<path>" \
  --dataset-qualification-receipt-path "<path>"
```

Uses repository real-schema test fixture through the official production path (not synthetic digest strings).

## Machine-readable output

JSON schema: `fhv-control-replay-receipt/v1` with fields:

- `classification`: `CONTROL_REPLAY=PASS` | `CONTROL_REPLAY=FAIL`
- `runOneDigest` / `runTwoDigest`
- `digestsMatch`
- `controlReplayReceiptPath` (when `--control-replay-receipt-output` supplied)

## Related

- [`FHV-DATASET-QUALIFICATION-PACKET.md`](./FHV-DATASET-QUALIFICATION-PACKET.md)
- [`FHV-FULL-HISTORICAL-LAUNCH-PACKET.md`](./FHV-FULL-HISTORICAL-LAUNCH-PACKET.md)
