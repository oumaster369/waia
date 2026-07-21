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

## Related documents

- [`FHV-EXECUTION-SERVER-REHEARSAL-CONTRACT.md`](./FHV-EXECUTION-SERVER-REHEARSAL-CONTRACT.md)
- [`docs/plans/dee-416-ai-trader-historical-validation-operations-and-observability.md`](../plans/dee-416-ai-trader-historical-validation-operations-and-observability.md)
