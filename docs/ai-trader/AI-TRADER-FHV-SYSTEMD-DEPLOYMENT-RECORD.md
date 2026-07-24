# AI-TRADER FHV Systemd Deployment Record (DEE-435)

Fail-closed contract for recording **FHV systemd supervision** deployment truth on the Execution Server host. This record is **separate** from the legacy Docker `deployed-revision.json` used by BP-6 health container workflows.

## Symbol

| Variable | Meaning |
|----------|---------|
| `EXECUTION_SERVER_TARGET_SHA` | Full 40-character lowercase Git SHA every active FHV surface must pin |
| `FHV_SYSTEMD_DEPLOYED_REVISION_PATH` | Optional override for the record path (default: `<repo>/.ops/fhv-systemd-deployed-revision.v1.json`) |

## Record path

```text
.ops/fhv-systemd-deployed-revision.v1.json
```

Gitignored `.ops/` holds host-local operational truth. The FHV systemd record must **not** overwrite `.ops/deployed-revision.json`.

## Schema (`fhv-systemd-deployed-revision/v1`)

| Field | Required | Rule |
|-------|----------|------|
| `schemaVersion` | yes | Must be `fhv-systemd-deployed-revision/v1` |
| `releaseSha` | yes | Full 40-char lowercase hex; must equal `EXECUTION_SERVER_TARGET_SHA` after deploy |
| `releaseTag` | yes | Human release tag (e.g. `v2026.07.24.fb109fb`) |
| `runId` | yes | Rehearsal run identifier bound at deploy time |
| `organizationId` | yes | Rehearsal organization UUID bound at deploy time |
| `deploymentKind` | yes | Must be `FHV_SYSTEMD_REHEARSAL` |
| `installedUnitNames` | yes | Must be `[waia-fhv-campaign.service, waia-fhv-observer.service]` |
| `renderedUnitDigests` | yes | SHA-256 digests of rendered unit bodies at install time |
| `installedAtUtc` | yes | UTC ISO-8601 timestamp |
| `operatorId` | yes | Non-empty human operator identifier |
| `serviceUser` | yes | Non-root systemd service account |
| `legacyContainerName` | yes | Must be `ai-trader-execution-host` |
| `legacyContainerImage` | yes | Must be `waia-execution-host:bp6` |
| `legacyContainerRunning` | yes | Must be `true` at write time (inspection only — writer never mutates container) |
| `writerVersion` | yes | Record writer semver/id (`dee-435-v1`) |
| `contentDigest` | yes | SHA-256 over canonical JSON of all other fields |

## Operator scripts

| Script | `--confirm` behavior |
|--------|----------------------|
| [`fhv-systemd-record-deploy.sh`](../../scripts/ops/fhv-systemd-record-deploy.sh) | Preview only without `--confirm`; atomic write with `--confirm` (requires legacy container running) |
| [`fhv-systemd-verify-deploy.sh`](../../scripts/ops/fhv-systemd-verify-deploy.sh) | Read-only; fails closed on missing, corrupt, or mismatched identity |

Agents must **never** pass `--confirm` on host mutation scripts.

## Release identity cross-check

After Human dev → main release merge, all of the following must agree before T4 campaign start:

- `EXECUTION_SERVER_TARGET_SHA`
- checkout `HEAD`
- rehearsal manifest `targetSha`
- `.ops/fhv-systemd-deployed-revision.v1.json` `releaseSha`
- legacy `.ops/deployed-revision.json` `gitSha` (when Docker record is maintained separately)

Mismatch on any identity surface is **fail closed**.

## Related documents

- [`FHV-RELEASE-IDENTITY-CONTRACT.md`](../ops/FHV-RELEASE-IDENTITY-CONTRACT.md)
- [`FHV-EXECUTION-SERVER-REHEARSAL-CONTRACT.md`](../ops/FHV-EXECUTION-SERVER-REHEARSAL-CONTRACT.md)
- [`EXECUTION-SERVER-RUNBOOK.md`](../ops/EXECUTION-SERVER-RUNBOOK.md)
- Canonical plan: [`dee-435-fhv-t4-deterministic-runtime.md`](../plans/dee-435-fhv-t4-deterministic-runtime.md)
