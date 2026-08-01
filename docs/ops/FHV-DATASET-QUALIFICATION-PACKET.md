# FHV Dataset Qualification Operator Packet

**Linear:** DEE-436 · **Classification gate:** `DATASET_QUALIFICATION=PASS`

## Purpose

Prove bounded fixture dataset integrity and partition alignment before Full Historical Validation launch.

## Command

```bash
pnpm trader:fhv:dataset-qualify
```

Exit 0 emits `DATASET_QUALIFICATION=PASS`. Any failure emits `DATASET_QUALIFICATION=FAIL` (fail-closed).

## Machine-readable output

JSON schema: `fhv-dataset-qualification/v1` with fields:

- `classification`: `DATASET_QUALIFICATION=PASS` | `DATASET_QUALIFICATION=FAIL`
- `manifestSemanticDigest`
- `partitionsDigest` (must match `FHV_DATASET_PARTITIONS_V1`)
- `gapPolicyId`

## Official multi-year gate

Real HTX 2020–2026 dataset qualification remains a **Human/data gate**. This CLI proves the repository qualification surface on the bounded fixture harness.

## Related

- [`FHV-FULL-HISTORICAL-LAUNCH-PACKET.md`](./FHV-FULL-HISTORICAL-LAUNCH-PACKET.md)
- [`FHV-CONTROL-REPLAY-PACKET.md`](./FHV-CONTROL-REPLAY-PACKET.md)
