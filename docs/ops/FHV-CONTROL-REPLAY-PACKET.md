# FHV Control Replay Operator Packet

**Linear:** DEE-436 · **Classification gate:** `CONTROL_REPLAY=PASS`

## Purpose

Two-run determinism on the **same Full Historical Validation production path**: execute twice with separate run IDs and compare decisions, fills, costs, accounting, PnL, drawdown, and semantic reproduction digests.

## Official v2 ceremony chain (steps 5–11)

Requires completed dataset preparation (steps 1–4 in [`FHV-DATASET-QUALIFICATION-PACKET.md`](./FHV-DATASET-QUALIFICATION-PACKET.md)).

### Steps 5–7 — Control replay run one

**Step 5 — freeze-config (run one):**

```bash
pnpm trader:fhv:freeze-config -- \
  --release-sha "$FHV_RELEASE_SHA" \
  --release-tag "$FHV_RELEASE_TAG" \
  --run-id "$FHV_RUN_ONE_ID" \
  --organization-id "$FHV_ORGANIZATION_ID" \
  --operator-id "$FHV_OPERATOR_ID" \
  --artifact-dir "/path/to/freeze-run-one" \
  --dataset-qualification-receipt-path "/path/to/fhv-dataset-qualification-receipt.v1.json"
```

**Step 6 — authorize-full (run one, `executionPurpose=CONTROL_REPLAY`):**

```bash
export FHV_FULL_HISTORICAL_AUTHORIZATION="AUTHORIZE-FULL-HISTORICAL-VALIDATION"
export FHV_EXECUTION_PURPOSE="CONTROL_REPLAY"

pnpm trader:fhv:authorize-full -- \
  --release-sha "$FHV_RELEASE_SHA" \
  --release-tag "$FHV_RELEASE_TAG" \
  --run-id "$FHV_RUN_ONE_ID" \
  --organization-id "$FHV_ORGANIZATION_ID" \
  --operator-id "$FHV_OPERATOR_ID" \
  --receipt-dir "/path/to/auth-run-one" \
  --configuration-freeze-path "/path/to/fhv-configuration-freeze-run-one.v1.json" \
  --qualification-receipt-path "/path/to/fhv-dataset-qualification-receipt.v1.json" \
  --execution-purpose CONTROL_REPLAY
```

Authorization receipt field: `executionPurpose: "CONTROL_REPLAY"`. **Must not** bind `controlReplayReceiptDigest` on CONTROL_REPLAY receipts.

**Step 7 — checkout proof (run one):**

```bash
pnpm trader:fhv:t4:record-checkout-identity -- \
  --release-sha "$FHV_RELEASE_SHA" \
  --release-tag "$FHV_RELEASE_TAG" \
  --run-id "$FHV_RUN_ONE_ID" \
  --organization-id "$FHV_ORGANIZATION_ID" \
  --output "/path/to/run-one/control/fhv-t4-checkout-identity.v1.json"
```

### Steps 8–10 — Control replay run two

**Step 8 — freeze-config (run two):**

```bash
pnpm trader:fhv:freeze-config -- \
  --release-sha "$FHV_RELEASE_SHA" \
  --release-tag "$FHV_RELEASE_TAG" \
  --run-id "$FHV_RUN_TWO_ID" \
  --organization-id "$FHV_ORGANIZATION_ID" \
  --operator-id "$FHV_OPERATOR_ID" \
  --artifact-dir "/path/to/freeze-run-two" \
  --dataset-qualification-receipt-path "/path/to/fhv-dataset-qualification-receipt.v1.json"
```

**Step 9 — authorize-full (run two, `executionPurpose=CONTROL_REPLAY`):**

```bash
pnpm trader:fhv:authorize-full -- \
  --release-sha "$FHV_RELEASE_SHA" \
  --release-tag "$FHV_RELEASE_TAG" \
  --run-id "$FHV_RUN_TWO_ID" \
  --organization-id "$FHV_ORGANIZATION_ID" \
  --operator-id "$FHV_OPERATOR_ID" \
  --receipt-dir "/path/to/auth-run-two" \
  --configuration-freeze-path "/path/to/fhv-configuration-freeze-run-two.v1.json" \
  --qualification-receipt-path "/path/to/fhv-dataset-qualification-receipt.v1.json" \
  --execution-purpose CONTROL_REPLAY
```

**Step 10 — checkout proof (run two):**

```bash
pnpm trader:fhv:t4:record-checkout-identity -- \
  --release-sha "$FHV_RELEASE_SHA" \
  --release-tag "$FHV_RELEASE_TAG" \
  --run-id "$FHV_RUN_TWO_ID" \
  --organization-id "$FHV_ORGANIZATION_ID" \
  --output "/path/to/run-two/control/fhv-t4-checkout-identity.v1.json"
```

### Step 11 — control-replay

Requires released checkout identity proofs (one per run), `DATASET_QUALIFICATION=PASS` receipt, both configuration freezes, both scoped authorizations, qualified dataset/manifest paths, and control-replay receipt output.

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
  --manifest-path "/absolute/fhv-dataset-manifest.v2.json" \
  --checkout-identity-proof-path-run-one "/path/to/run-one/control/fhv-t4-checkout-identity.v1.json" \
  --checkout-identity-proof-path-run-two "/path/to/run-two/control/fhv-t4-checkout-identity.v1.json" \
  --control-replay-receipt-output "/absolute/fhv-control-replay-receipt.v1.json"
```

Exit 0 emits immutable `CONTROL_REPLAY=PASS` receipt when both run digests and cycle counts match.

## Holdout sequence

Before any official holdout launch:

1. Run control replay and retain `--control-replay-receipt-output`
2. Bind `controlReplayReceiptDigest` in scoped authorization receipt (`executionPurpose=FULL_HISTORICAL`)
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
