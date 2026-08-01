# FHV Dataset Qualification Operator Packet

**Linear:** DEE-436 · **Classification gate:** `DATASET_QUALIFICATION=PASS`

## Purpose

Validate a Full Historical Dataset against the official contract before configuration freeze and Full launch. Produces an immutable qualification receipt binding separate `datasetContentDigest` and `manifestSemanticDigest`.

## Official mode (HTX multi-year or real-schema integration)

```bash
export FHV_RELEASE_SHA="<full-git-sha>"
export FHV_RELEASE_TAG="<release-tag>"
export FHV_ORGANIZATION_ID="<uuid-v4>"
export FHV_OPERATOR_ID="<operator-id>"

pnpm trader:fhv:dataset-qualify -- \
  --dataset-root "/absolute/dataset/root" \
  --manifest-path "/absolute/fhv-dataset-manifest.v1.json" \
  --release-sha "$FHV_RELEASE_SHA" \
  --release-tag "$FHV_RELEASE_TAG" \
  --organization-id "$FHV_ORGANIZATION_ID" \
  --operator-id "$FHV_OPERATOR_ID" \
  --output "/absolute/fhv-dataset-qualification-receipt.v1.json"
```

Validates:

- Provider HTX / market SPOT / symbols BTCUSDT + ETHUSDT / base interval 1m
- UTC half-open coverage `[2020-01-01T00:00:00.000Z, 2026-01-01T00:00:00.000Z)`
- Partition completeness, non-overlap, boundary continuity
- Per-file digests, no duplicate/out-of-order bars
- Blind holdout seal status preserved

## Bounded fixture mode (test-only — explicit flag required)

```bash
pnpm trader:fhv:dataset-qualify -- --bounded-fixture [--receipt-dir /abs/path]
```

Uses ingress manifest evidence harness. **Must not** be confused with official qualification.

## Machine-readable output

Receipt schema: `fhv-dataset-qualification-receipt/v1` with fields:

- `classification`: `DATASET_QUALIFICATION=PASS` | `DATASET_QUALIFICATION=FAIL`
- `datasetContentDigest` (content authority — distinct from manifest)
- `manifestSemanticDigest`
- `partitionsDigest`, symbol digests, holdout seal digest
- release SHA/tag, organization/operator bindings

## Related

- [`FHV-FULL-HISTORICAL-LAUNCH-PACKET.md`](./FHV-FULL-HISTORICAL-LAUNCH-PACKET.md)
- [`FHV-CONTROL-REPLAY-PACKET.md`](./FHV-CONTROL-REPLAY-PACKET.md)
