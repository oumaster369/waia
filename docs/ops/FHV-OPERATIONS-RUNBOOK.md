# FHV Operations Runbook (DEE-416)

Operational guide for AI-TRADER Historical Validation host-resident observability.

## Scope

- Bounded operator status contract (`fhv-operator-status/v1`)
- Host observer daemon (`pnpm trader:fhv:observer`)
- Worker admin dashboard (`/admin/fhv-operations`)
- Authenticated operator commands (`fhv-operator-command/v1`)

**Out of scope for agents:** Execution Server deployment, real HTX dataset qualification, full historical replay, live trading.

## Host qualification gate

`HOST_OS=UNKNOWN_UNTIL_EXECUTION_SERVER_PREFLIGHT`

At first Execution Server preflight (Human-operated):

| Detected OS | Supervisor |
|-------------|------------|
| Linux | systemd (`waia-fhv-campaign.service`, `waia-fhv-observer.service`) |
| macOS | launchd (`com.waia.fhv-campaign.plist`, `com.waia.fhv-observer.plist`) |
| Other | Architect decision required |

Do **not** install both systemd and launchd. Concrete OS units remain blocked until Human T4 qualification.

## Process boundaries

| Component | Owns |
|-----------|------|
| **Campaign** | Semantic/economic violation detection and shutdown |
| **Observer** | Host safety, telemetry, alert ledger, signed command enforcement |
| **Worker admin** | Read-only status + signed command issuance via tunnel |

Observer **never** imports replay hot-path modules. Replay **never** awaits observer.

## Local observer (development)

```bash
export FHV_RUN_ROOT=/path/to/run
export FHV_RUN_ID=fhv-dev-run
export FHV_ORGANIZATION_ID=<org-uuid>
export FHV_OPERATOR_COMMAND_SECRET=<vault-secret>
pnpm trader:fhv:observer
```

Binds `127.0.0.1:${FHV_OBSERVER_PORT:-9471}` only.

## Worker admin

- UI: `/admin/fhv-operations`
- Status API: `GET /api/trader/admin/fhv-operations/status?organization_id=...`
- Commands API: `POST /api/trader/admin/fhv-operations/commands?organization_id=...`

Set `FHV_OPERATOR_STATUS_PATH` to a host-resident status file for dashboard reads during development.

## Holdout confidentiality

When holdout gate is **CLOSED**, only identity fields are exposed:

- `SEALED_NOT_ACCESSED`
- `PROHIBITED_UNTIL_OPERATOR_PROCEDURE`

No holdout economic outputs may be returned, logged, or rendered.

## Human gates (not executed by agents)

| Gate | Status |
|------|--------|
| `HISTORICAL_DATASET_QUALIFICATION` | `NOT_EXECUTED` |
| `READY_FOR_FULL_HISTORICAL_TEST` | `NO` |
| `EXECUTION_SERVER_DEPLOYMENT_AUTHORIZED` | `NO` |
| `LIVE_TRADING_AUTHORIZED` | `NO` |

### Human T4 — enable FHV operator command enforcement

After repository release is deployed to the Execution Server checkout, the Human operator must set **both** enforcement gates in the host `EnvironmentFile` referenced by the rendered systemd units (for example `/etc/waia/fhv.env`):

```bash
FHV_HOST_OS_QUALIFIED=true
FHV_COMMAND_ENFORCEMENT_ENABLED=true
```

Requirements:

- Values must be exact lowercase `true` (not `TRUE`, `1`, or `yes`).
- Both must be present; either missing or malformed keeps enforcement disabled at runtime.
- Do **not** bake these into rendered unit files; the EnvironmentFile is the sole source of truth.
- Reload/restart `waia-fhv-observer.service` only after the EnvironmentFile is updated on the host.

## Checkpoint resume (repository implementation)

`RESUME_FROM_CHECKPOINT` is **true incremental resume**, not a full replay from cycle zero:

1. Validate checkpoint identity (`assertFhvRehearsalResumeIdentity`).
2. Restore canvas from the checkpoint sidecar (`restoreCanvasFromCheckpoint`).
3. Resume at `safeResumeThroughCycleIndex + 1` with the exact `initialBars1mPrefix` substrate slice.
4. Enforce `getFullHistoryRescanCount() === 0` (fail closed on full-history rescan).
5. Write a dual **authoritative** run-chain: partial segment (cycles `0..pauseFrontier`) + continuation segment (cycles `pauseFrontier..terminal`). The partial segment is retained as authoritative audit lineage; it is **not** superseded on genuine incremental resume.
6. Progress and heartbeat continue from the paused frontier; they must never regress to `0`/`1` after resume.

Hermetic proofs: `tests/integration/fhv-true-incremental-resume.test.ts`, `tests/unit/fhv-incremental-resume-guards.test.ts`, `tests/unit/fhv-resume-timeout.test.ts`.

## Related documents

- [`FHV-EXECUTION-SERVER-REHEARSAL-CONTRACT.md`](./FHV-EXECUTION-SERVER-REHEARSAL-CONTRACT.md)
- [`docs/plans/dee-416-ai-trader-historical-validation-operations-and-observability.md`](../plans/dee-416-ai-trader-historical-validation-operations-and-observability.md)
