# FHV Dataset Qualification Operator Packet

**Linear:** DEE-436 · **Classification gate:** `DATASET_QUALIFICATION=PASS`

## Purpose

Validate a Full Historical Dataset against the official contract before configuration freeze and Full launch. Produces an immutable qualification receipt binding separate `datasetContentDigest` and `manifestSemanticDigest`.

## Official v2 ceremony chain (steps 1–4)

The executable public ceremony begins with dataset preparation. Steps 5–15 are documented in [`FHV-CONTROL-REPLAY-PACKET.md`](./FHV-CONTROL-REPLAY-PACKET.md) and [`FHV-FULL-HISTORICAL-LAUNCH-PACKET.md`](./FHV-FULL-HISTORICAL-LAUNCH-PACKET.md).

### Step 1 — Acquire six canonical partition files

Run once per canonical `(partition, symbol)` pair (six total):

```bash
export FHV_RELEASE_SHA="<full-git-sha>"
export FHV_ORGANIZATION_ID="<uuid-v4>"
export FHV_OPERATOR_ID="<operator-id>"
export FHV_DATASET_ROOT="/absolute/dataset/root"
export FHV_ACQUISITION_RUN_ID="<unique-acquisition-run-id>"

pnpm trader:fhv:acquire-htx-v2 -- --partition development --symbol BTCUSDT --dataset-root "$FHV_DATASET_ROOT" --release-sha "$FHV_RELEASE_SHA" --organization-id "$FHV_ORGANIZATION_ID" --operator-id "$FHV_OPERATOR_ID" --acquisition-run-id "$FHV_ACQUISITION_RUN_ID"
pnpm trader:fhv:acquire-htx-v2 -- --partition development --symbol ETHUSDT --dataset-root "$FHV_DATASET_ROOT" --release-sha "$FHV_RELEASE_SHA" --organization-id "$FHV_ORGANIZATION_ID" --operator-id "$FHV_OPERATOR_ID" --acquisition-run-id "$FHV_ACQUISITION_RUN_ID"
pnpm trader:fhv:acquire-htx-v2 -- --partition walk-forward --symbol BTCUSDT --dataset-root "$FHV_DATASET_ROOT" --release-sha "$FHV_RELEASE_SHA" --organization-id "$FHV_ORGANIZATION_ID" --operator-id "$FHV_OPERATOR_ID" --acquisition-run-id "$FHV_ACQUISITION_RUN_ID"
pnpm trader:fhv:acquire-htx-v2 -- --partition walk-forward --symbol ETHUSDT --dataset-root "$FHV_DATASET_ROOT" --release-sha "$FHV_RELEASE_SHA" --organization-id "$FHV_ORGANIZATION_ID" --operator-id "$FHV_OPERATOR_ID" --acquisition-run-id "$FHV_ACQUISITION_RUN_ID"
pnpm trader:fhv:acquire-htx-v2 -- --partition blind-holdout --symbol BTCUSDT --dataset-root "$FHV_DATASET_ROOT" --release-sha "$FHV_RELEASE_SHA" --organization-id "$FHV_ORGANIZATION_ID" --operator-id "$FHV_OPERATOR_ID" --acquisition-run-id "$FHV_ACQUISITION_RUN_ID"
pnpm trader:fhv:acquire-htx-v2 -- --partition blind-holdout --symbol ETHUSDT --dataset-root "$FHV_DATASET_ROOT" --release-sha "$FHV_RELEASE_SHA" --organization-id "$FHV_ORGANIZATION_ID" --operator-id "$FHV_OPERATOR_ID" --acquisition-run-id "$FHV_ACQUISITION_RUN_ID"
```

### Step 2 — Seal v2 dataset

```bash
pnpm trader:fhv:seal-v2-dataset -- \
  --dataset-root "$FHV_DATASET_ROOT" \
  --acquisition-receipt-dir "$FHV_DATASET_ROOT/control/acquisition" \
  --seal-run-id "<unique-seal-run-id>" \
  --release-sha "$FHV_RELEASE_SHA" \
  --organization-id "$FHV_ORGANIZATION_ID" \
  --operator-id "$FHV_OPERATOR_ID"
```

Publishes `fhv-dataset-manifest.v2.json` then `fhv-dataset-seal-receipt.v2.json` (logical commit marker).

### Step 3 — Validate v2 bars

```bash
pnpm trader:fhv:validate-v2-dataset -- \
  --dataset-root "$FHV_DATASET_ROOT"
```

Exit classification: `FHV_V2_DATASET_VALIDATION_PASS`.

### Step 4 — Dataset qualify (official mode)

```bash
export FHV_RELEASE_TAG="<release-tag>"
export FHV_RECEIPT_DIR="/absolute/receipt/dir"

pnpm trader:fhv:dataset-qualify -- \
  --dataset-root "$FHV_DATASET_ROOT" \
  --manifest-path "$FHV_DATASET_ROOT/fhv-dataset-manifest.v2.json" \
  --qualification-mode OFFICIAL_MULTI_YEAR \
  --release-sha "$FHV_RELEASE_SHA" \
  --release-tag "$FHV_RELEASE_TAG" \
  --organization-id "$FHV_ORGANIZATION_ID" \
  --operator-id "$FHV_OPERATOR_ID" \
  --receipt-dir "$FHV_RECEIPT_DIR"
```

Validates:

- Provider HTX / market SPOT / symbols BTCUSDT + ETHUSDT / base interval 1m
- UTC half-open coverage `[2020-01-01T00:00:00.000Z, 2026-01-01T00:00:00.000Z)`
- Partition completeness, non-overlap, boundary continuity
- Per-file digests, no duplicate/out-of-order bars
- Blind holdout seal status preserved

## Schema integration fixture mode (test-only — explicit flag required)

```bash
pnpm trader:fhv:dataset-qualify -- \
  --dataset-root "/absolute/tests/fixtures/trader/fhv-official-real-schema" \
  --manifest-path "/absolute/tests/fixtures/trader/fhv-official-real-schema/fhv-dataset-manifest.json" \
  --qualification-mode SCHEMA_INTEGRATION_FIXTURE \
  --release-sha "$FHV_RELEASE_SHA" \
  --release-tag "$FHV_RELEASE_TAG" \
  --organization-id "$FHV_ORGANIZATION_ID" \
  --operator-id "$FHV_OPERATOR_ID" \
  --receipt-dir "$FHV_RECEIPT_DIR"
```

Uses real-schema integration fixture. **Must not** be confused with official multi-year qualification.

## Bounded fixture mode (test-only — explicit flag required)

```bash
pnpm trader:fhv:dataset-qualify -- --bounded-fixture [--receipt-dir /abs/path]
```

Uses ingress manifest evidence harness. **Must not** be confused with official qualification.

## Machine-readable output

Receipt schema: `fhv-dataset-qualification-receipt/v1` written to `$FHV_RECEIPT_DIR/fhv-dataset-qualification-receipt.v1.json` with fields:

- `classification`: `DATASET_QUALIFICATION=PASS` | `DATASET_QUALIFICATION=FAIL`
- `datasetContentDigest` (content authority — distinct from manifest)
- `manifestSemanticDigest`
- `partitionsDigest`, symbol digests, holdout seal digest
- release SHA/tag, organization/operator bindings

## Related

- [`FHV-FULL-HISTORICAL-LAUNCH-PACKET.md`](./FHV-FULL-HISTORICAL-LAUNCH-PACKET.md)
- [`FHV-CONTROL-REPLAY-PACKET.md`](./FHV-CONTROL-REPLAY-PACKET.md)
