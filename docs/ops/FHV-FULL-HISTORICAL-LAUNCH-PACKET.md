# FHV Full Historical Validation Launch Packet

**Linear:** DEE-436 · **Authorization:** scoped `fhv-full-historical-authorization.v1.json` (Human-only ceremony)

> **Not interchangeable** with `AUTHORIZE-FHV-OPS-DEPLOY` (T4A Execution Server rehearsal).

## Purpose

Canonical Full Historical Validation launch surface. Executes the unified historical engine after immutable ceremony artifacts are bound: dataset qualification receipt, configuration freeze, scoped authorization receipt, and release checkout identity proof.

Official multi-year HTX run and bounded real-schema integration use the **same production path**; only data volume differs.

## Official v2 ceremony chain (steps 12–15)

Requires completed dataset preparation (steps 1–4) and control replay (steps 5–11). See [`FHV-DATASET-QUALIFICATION-PACKET.md`](./FHV-DATASET-QUALIFICATION-PACKET.md) and [`FHV-CONTROL-REPLAY-PACKET.md`](./FHV-CONTROL-REPLAY-PACKET.md).

### Step 12 — freeze-config (final launch)

```bash
pnpm trader:fhv:freeze-config -- \
  --release-sha "$FHV_RELEASE_SHA" \
  --release-tag "$FHV_RELEASE_TAG" \
  --run-id "$FHV_RUN_ID" \
  --organization-id "$FHV_ORGANIZATION_ID" \
  --operator-id "$FHV_OPERATOR_ID" \
  --artifact-dir "/path/to/freeze-final" \
  --dataset-qualification-receipt-path "/path/to/fhv-dataset-qualification-receipt.v1.json"
```

### Step 13 — authorize-full (final, `executionPurpose=FULL_HISTORICAL`)

```bash
export FHV_FULL_HISTORICAL_AUTHORIZATION="AUTHORIZE-FULL-HISTORICAL-VALIDATION"
export FHV_EXECUTION_PURPOSE="FULL_HISTORICAL"

pnpm trader:fhv:authorize-full -- \
  --release-sha "$FHV_RELEASE_SHA" \
  --release-tag "$FHV_RELEASE_TAG" \
  --run-id "$FHV_RUN_ID" \
  --organization-id "$FHV_ORGANIZATION_ID" \
  --operator-id "$FHV_OPERATOR_ID" \
  --receipt-dir "/path/to/auth-final" \
  --configuration-freeze-path "/path/to/fhv-configuration-freeze.v1.json" \
  --qualification-receipt-path "/path/to/fhv-dataset-qualification-receipt.v1.json" \
  --control-replay-receipt-path "/path/to/fhv-control-replay-receipt.v1.json" \
  --execution-purpose FULL_HISTORICAL
```

Authorization receipt field: `executionPurpose: "FULL_HISTORICAL"`. **Requires** bound `controlReplayReceiptDigest`.

### Step 14 — checkout proof (final)

```bash
pnpm trader:fhv:t4:record-checkout-identity -- \
  --release-sha "$FHV_RELEASE_SHA" \
  --release-tag "$FHV_RELEASE_TAG" \
  --run-id "$FHV_RUN_ID" \
  --organization-id "$FHV_ORGANIZATION_ID" \
  --output "/path/to/fhv-t4-checkout-identity.v1.json"
```

### Step 14b — Execution Server host qualification (Human-only, fail-closed)

Both target-host qualifications run on the actual Execution Server after release
checkout/deployment and before any official unbounded launch authorization. Each emits an
identity-bound receipt that the launch path validates fail-closed.

```bash
# WP-3B checkpoint host qualification (1 GiB / <=400 ms; ADR-0025 AD-6a):
pnpm trader:fhv:wp3b-host-qualification
#   -> fhv-wp3b-host-qualification.v1.json  (EXECUTION_SERVER_WP3B_HOST_QUALIFIED)

# Throughput host qualification (ADR-0025 AD-6b). Run the representative segment with progress
# enabled, fit the growth law, then qualify:
FHV_IDHPS_PROGRESS=1 pnpm trader:fhv:run -- --max-cycles <representative-cycles> ...  # representative segment
pnpm trader:fhv:growth-law-report -- --run-dir "<representative-run-dir>"
pnpm trader:fhv:throughput-host-qualification -- --run-dir "<representative-run-dir>"
#   -> fhv-throughput-host-qualification.v1.json  (EXECUTION_SERVER_FHV_THROUGHPUT_QUALIFIED)
```

A throughput receipt is QUALIFIED only when the growth-aware projected official runtime is
`<= 6480` s, the hot-path decay verdict is `FLAT`, bounded hot-state growth stays within the
structural ceiling, and the embedded `877 / 7200 / 6480` constants validate. It binds the release
SHA and target-host identity. The official unbounded launch requires **both** this receipt and the
WP-3B checkpoint receipt.

### Step 15 — Full Historical Validation run

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
  --manifest-path "/absolute/manifest/fhv-dataset-manifest.v2.json" \
  --checkout-identity-proof-path "/path/to/fhv-t4-checkout-identity.v1.json" \
  --throughput-host-qualification-receipt-path "/path/to/fhv-throughput-host-qualification.v1.json"

# Resume after checkpoint pause or infrastructure interruption (same run-id, same artifacts):
pnpm trader:fhv:run -- --resume \
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
  --manifest-path "/absolute/manifest/fhv-dataset-manifest.v2.json" \
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
- **Official unbounded launch only:** requires a valid WP-3B checkpoint host-qualification receipt (`EXECUTION_SERVER_WP3B_HOST_QUALIFIED`) **and** a valid throughput host-qualification receipt (`EXECUTION_SERVER_FHV_THROUGHPUT_QUALIFIED` via `--throughput-host-qualification-receipt-path`), each fail-closed on release/host/digest/contract evidence (ADR-0025 AD-6a/AD-6b)
- Verifies release checkout identity (HEAD = release SHA, tag peel, clean tracked tree)
- Binds dataset content digest and manifest semantic digest from qualification receipt (not compile-time pins)
- Rejects reused `runId` (immutable receipt collision)
- Rejects wrong initial capital (must be `100000` USDT economically enforced in account state)
- Rejects strategy freeze / execution mismatch
- Rejects premature holdout access (holdout gate state machine)
- Rejects live exchange path (`assertFhvReplayNotLiveExchangePath`)

## Resume and generation governance

Resume is **not** a new launch. The same `runId`, authorization receipt, and launch receipt must bind across segments.

| Rule | Behavior |
|------|----------|
| authorization consumed exactly once | Initial launch consumes the scoped authorization receipt; resume must not re-consume or rewrite the receipt |
| generation takeover | When a stale lease holder dies, a new process may takeover the authorization claim and continue from the durable checkpoint frontier |
| stale-generation rejection | Resume rejects a claim generation that does not match the durable WAL/checkpoint bundle generation |
| terminal reconciliation | On terminal classification, reconcile authorization claim, checkpoint bundle, and terminal result atomically |
| refusal to resume a completed run | `--resume` on a run whose terminal result is already published fails closed |

Synthetic official-scale proofs write artifacts under `$FHV_OFFICIAL_SCALE_ARTIFACT_ROOT` (default: `.artifacts/fhv-official-scale/`). This directory is gitignored.

## Terminal classifications

Official multi-year launch (`executionPurpose=FULL_HISTORICAL`) may terminate with:

| Classification | Meaning |
|----------------|---------|
| `FULL_HISTORICAL_TECHNICAL_COMPLETION` | Full v2 corpus exhausted through production path; technical backtest complete |
| `FULL_HISTORICAL_ECONOMIC_STOP_TECHNICAL_COMPLETION` | Drawdown/economic stop triggered; technical artifacts sealed |
| `FULL_HISTORICAL_INFRASTRUCTURE_FAILURE` | Unrecoverable infrastructure fault; partial evidence retained |
| `FHV_SYNTHETIC_SCALE_PROBE_COMPLETED` | Synthetic scale authority throughput probe segment (official-scale gate Phase 10) |
| `FHV_SYNTHETIC_PROCESS_PARITY_SEGMENT_COMPLETED` | Cross-process resume segment completed (official-scale gate Phase 11) |
| `FHV_SYNTHETIC_PROCESS_PARITY_PAUSED` | Cross-process pause at checkpoint frontier (official-scale gate Phase 12) |
| `FHV_SCHEMA_INTEGRATION_CEREMONY_PASS` | Bounded real-schema integration fixture through same public CLI chain; explicitly non-official |
| `BOUNDED_FULL_HISTORICAL_END_TO_END_PASS` | Bounded ingress fixture through same path |

> **Note:** `FULL_HISTORICAL_VALIDATION_COMPLETED` is reserved for Human-certified holdout validation and is **not** required by the public ceremony packet or CI official-scale gate.

## Artifacts

- `$FHV_ARTIFACT_ROOT/RI-P7/fhv-full-historical/<run-id>/fhv-full-launch-receipt.v1.json` (atomic exclusive)
- `$FHV_ARTIFACT_ROOT/RI-P7/fhv-full-historical/<run-id>/fhv-full-launch-result.v1.json` — terminal classification, semantic reproduction digest, evidence chain (qualification, control replay, freeze, auth, launch digests, accountingState, htrPnlReport, drawdown, checkpoint ref, rescan count, holdout unseal ref)

## Related

- [`FHV-DATASET-QUALIFICATION-PACKET.md`](./FHV-DATASET-QUALIFICATION-PACKET.md)
- [`FHV-CONTROL-REPLAY-PACKET.md`](./FHV-CONTROL-REPLAY-PACKET.md)
- [`HISTORICAL-TEST-READINESS-RUNBOOK.md`](./HISTORICAL-TEST-READINESS-RUNBOOK.md)
