# FHV Full Historical Validation Launch Packet

**Linear:** DEE-436 · **Authorization:** scoped `fhv-full-historical-authorization.v1.json` (Human-only ceremony)

> **Not interchangeable** with `AUTHORIZE-FHV-OPS-DEPLOY` (T4A Execution Server rehearsal).

## Purpose

Canonical Full Historical Validation launch surface. Executes the unified historical engine after immutable ceremony artifacts are bound: dataset qualification receipt, configuration freeze, scoped authorization receipt, and release checkout identity proof.

Official multi-year HTX run and bounded real-schema integration use the **same production path**; only data volume differs.

## Ceremony chain (required before launch)

1. `pnpm trader:fhv:dataset-qualify` — official mode with `--dataset-root` + `--manifest-path`
2. `pnpm trader:fhv:freeze-config` — writes immutable `fhv-configuration-freeze.v1.json`
3. `pnpm trader:fhv:control-replay` — two-run determinism; retain `--control-replay-receipt-output`
4. `pnpm trader:fhv:authorize-full` — Human shell writes scoped authorization receipt binding `controlReplayReceiptDigest`
5. `pnpm trader:fhv:t4:record-checkout-identity` — release checkout identity proof at tagged release SHA
6. `pnpm trader:fhv:run` — Full Historical Validation execution (holdout requires control replay receipt path)

## Command

```bash
export FHV_RELEASE_SHA="<full-git-sha>"
export FHV_RELEASE_TAG="<release-tag>"
export FHV_RUN_ID="<human-approved-unique-run-id>"
export FHV_ORGANIZATION_ID="<uuid-v4>"
export FHV_OPERATOR_ID="<operator-id>"
export FHV_ARTIFACT_ROOT="/absolute/artifact/root"

# Official multi-year (executes after qualification + freeze + scoped auth + checkout proof):
pnpm trader:fhv:run -- \
  --release-sha "$FHV_RELEASE_SHA" \
  --release-tag "$FHV_RELEASE_TAG" \
  --run-id "$FHV_RUN_ID" \
  --organization-id "$FHV_ORGANIZATION_ID" \
  --operator-id "$FHV_OPERATOR_ID" \
  --artifact-root "$FHV_ARTIFACT_ROOT" \
  --configuration-freeze-path "/path/to/fhv-configuration-freeze.v1.json" \
  --authorization-receipt-path "/path/to/fhv-full-historical-authorization.v1.json" \
  --authorization-receipt-digest "<receipt-digest>" \
  --dataset-qualification-receipt-path "/path/to/fhv-dataset-qualification-receipt.v1.json" \
  --control-replay-receipt-path "/path/to/fhv-control-replay-receipt.v1.json" \
  --dataset-root "/absolute/dataset/root" \
  --manifest-path "/absolute/manifest/fhv-dataset-manifest.v1.json" \
  --checkout-identity-proof-path "/path/to/fhv-t4-checkout-identity.v1.json"

# Bounded real-schema integration (same production path, test fixture dataset):
pnpm trader:fhv:run -- --bounded-fixture \
  --release-sha "$FHV_RELEASE_SHA" \
  --run-id "$FHV_RUN_ID" \
  --organization-id "$FHV_ORGANIZATION_ID" \
  --operator-id "$FHV_OPERATOR_ID" \
  --artifact-root "$FHV_ARTIFACT_ROOT" \
  --configuration-freeze-path "<path>" \
  --authorization-receipt-path "<path>" \
  --authorization-receipt-digest "<digest>" \
  --dataset-qualification-receipt-path "<path>" \
  --dataset-root "<path>" \
  --manifest-path "<path>"
```

## Fail-closed gates

- Requires immutable configuration freeze artifact (no self-computed digest fallback)
- Requires scoped authorization receipt bound to one run (rejects reuse, wrong release/dataset/freeze/control-replay)
- Requires control replay PASS receipt for official holdout launch (`--control-replay-receipt-path`)
- Verifies release checkout identity (HEAD = release SHA, tag peel, clean tracked tree)
- Binds dataset content digest and manifest semantic digest from qualification receipt (not compile-time pins)
- Rejects reused `runId` (immutable receipt collision)
- Rejects wrong initial capital (must be `100000` USDT economically enforced in account state)
- Rejects strategy freeze / execution mismatch
- Rejects premature holdout access (holdout gate state machine)
- Rejects live exchange path (`assertFhvReplayNotLiveExchangePath`)

## Terminal classifications

- `FULL_HISTORICAL_VALIDATION_COMPLETED` — official multi-year path (`qualificationMode=OFFICIAL_MULTI_YEAR`) executed backtest, accounting, evidence
- `FHV_SCHEMA_INTEGRATION_CEREMONY_PASS` — schema integration fixture through same public CLI chain; explicitly non-official
- `BOUNDED_FULL_HISTORICAL_END_TO_END_PASS` — bounded ingress fixture through same path

## Artifacts

- `$FHV_ARTIFACT_ROOT/RI-P7/fhv-full-historical/<run-id>/fhv-full-launch-receipt.v1.json` (atomic exclusive)
- `$FHV_ARTIFACT_ROOT/RI-P7/fhv-full-historical/<run-id>/fhv-full-launch-result.v1.json` — terminal classification, semantic reproduction digest, evidence chain (qualification, control replay, freeze, auth, launch digests, accountingState, htrPnlReport, drawdown, checkpoint ref, rescan count, holdout unseal ref)

## Related

- [`FHV-DATASET-QUALIFICATION-PACKET.md`](./FHV-DATASET-QUALIFICATION-PACKET.md)
- [`FHV-CONTROL-REPLAY-PACKET.md`](./FHV-CONTROL-REPLAY-PACKET.md)
- [`HISTORICAL-TEST-READINESS-RUNBOOK.md`](./HISTORICAL-TEST-READINESS-RUNBOOK.md)
