# Account observation host runbook

**Owner:** Architect · **Status:** Canonical · **Linear:** DEE-1015 (executable collector), DEE-979 (host lifecycle), DEE-960 (observation core)

Operator procedure for the dedicated, credential-capable account-observation runtime
`services/ai-trader-account-observation-host/`. Every step below is **HUMAN-ONLY** and is **not**
performed by the DEE-1015 pull request.

**Related:**

- [`EXECUTION-SURFACES.md`](EXECUTION-SURFACES.md) — surface authority and permissions
- [`EXECUTION-SERVER-RUNBOOK.md`](EXECUTION-SERVER-RUNBOOK.md) — the **separate** historical execution plane
- [`docs/plans/dee-1015-account-observation-production-host-executable-collector.md`](../plans/dee-1015-account-observation-production-host-executable-collector.md)

---

## Why this is a separate runtime

`ai-trader-execution-host` refuses all credential material and admits only idle or historical one-shot
computation. Recurring account observation needs a credential-capable process, so it gets its own
runtime authority, own health port, own forbidden-key set and own master key
(`WAIA_OBSERVATION_MASTER_KEY`). The execution host is never given observation authority, and this host
is never given historical-runner, live, holdout or venue-plaintext authority.

Neither runtime can submit, cancel, amend or transfer anything. HTX transport for observation is
GET-only against an observation/metadata path allowlist, and admission requires a `readonly` key.

---

## Runtime authority

| Concern | Rule |
|---------|------|
| **Process** | Long-lived supervisor (`entrypoint.mjs`) + supervised consumer child (`scripts/trader/account-observation-collector-host.ts`) |
| **Health** | `GET /health` on `OBSERVATION_HOST_PORT` (default `8090`) — secret-free; digests and counts only |
| **Release identity** | `WAIA_IMAGE_RELEASE_SHA` must equal `WAIA_RELEASE_SHA`, both exact 40-hex |
| **Modes** | `idle` (installed proof, needs no secret) · `account-observation-recurring` |
| **Database logins** | three distinct URLs: `waia_account_observer_login`, `waia_account_observation_reader_login`, `waia_account_observation_credential_login` |
| **Secret** | `WAIA_OBSERVATION_MASTER_KEY` (base64, exactly 32 bytes), passed only to the consumer child |
| **Assignments** | digest-bound operator manifest — never request-, browser- or discovery-derived |
| **Shutdown** | `SIGTERM`/`SIGINT` forwarded to the consumer, which runs the existing bounded DEE-979 drain |
| **Capability** | read-only observation only; no order/cancel/amend/transfer/withdraw path is reachable |

### Environment

| Variable | Required in | Notes |
|----------|-------------|-------|
| `WAIA_IMAGE_RELEASE_SHA` | always | exact deployed SHA |
| `WAIA_RELEASE_SHA` | always | must equal the image SHA |
| `WAIA_OBSERVATION_HOST_MODE` | always | `idle` or `account-observation-recurring` |
| `WAIA_DEPLOYMENT_TIER` | recurring | must be `production` |
| `WAIA_OBSERVATION_OWNER_ID` | recurring | stable per-process lease owner id |
| `WAIA_OBSERVATION_ASSIGNMENT_MANIFEST` | recurring | absolute path to the manifest file |
| `WAIA_OBSERVATION_ASSIGNMENT_MANIFEST_SHA256` | recurring | expected content digest, supplied independently of the file |
| `WAIA_OBSERVATION_COLLECTOR_DATABASE_URL` | recurring | must authenticate as `waia_account_observer_login` |
| `WAIA_OBSERVATION_READER_DATABASE_URL` | recurring | must authenticate as `waia_account_observation_reader_login` |
| `WAIA_OBSERVATION_CREDENTIAL_DATABASE_URL` | recurring | must authenticate as `waia_account_observation_credential_login` |
| `WAIA_OBSERVATION_MASTER_KEY` | recurring | base64, 32 bytes |
| `OBSERVATION_HOST_PORT` | optional | default `8090` |

Refused outright: `AI_TRADER_MASTER_KEY`, `AI_TRADER_MASTER_KEY_MODE`, any venue plaintext key,
`WAIA_TRADER_LIVE_ENABLED`, `WAIA_LIVE_TRADING_ENABLED`, `WAIA_BLIND_HOLDOUT_ENABLED`,
`WAIA_EXECUTION_HOST_MODE`, `WAIA_HISTORICAL_RUN_ID`, `WAIA_FHV_CHECKPOINT_ROOT`, `DATABASE_URL*`, and a
non-empty `NODE_OPTIONS`. A refusal is `OBSERVATION_HOST_REFUSED:<code>` on stderr with a non-zero exit,
before any listener, database connection or credential access.

---

## The assignment manifest

One JSON file, at most 64 KiB, authored and reviewed by a Human, then digested. It binds every
assignment to an exact organization, credential, exchange account, credential revision, configuration
revision, symbol set, HTX host and reader/coverage limits.

```json
{
  "schemaVersion": "waia.account_observation_assignment_manifest.v1",
  "releaseSha": "<40-hex deployed SHA>",
  "host": "api.huobi.pro",
  "intervalMs": 60000,
  "iterationTimeoutMs": 45000,
  "openTimeoutMs": 10000,
  "shutdownTimeoutMs": 15000,
  "assignments": [
    {
      "organizationId": "<uuid>",
      "credentialId": "<uuid>",
      "exchangeAccountId": "<numeric HTX account id>",
      "credentialRevision": "1",
      "configurationRevision": "<exact observation configuration revision>",
      "symbols": ["BTCUSDT"],
      "pollIntervalMs": 60000,
      "maxBackoffMs": 300000,
      "readTimeoutMs": 10000,
      "leaseTtlMs": 180000,
      "readerLimits": { "maxPages": 2, "maxOrders": 200, "maxWindowMs": 86400000 }
    }
  ],
  "contentSha256": "<sha256 of the key-sorted manifest without contentSha256>"
}
```

The digest is over the canonical, key-sorted JSON of every field except `contentSha256`, so reformatting
or reordering the file does not change its identity. The runtime refuses the manifest unless the declared
digest, the independently supplied expected digest and the recomputed digest all agree, and unless
`releaseSha` matches the deployed release. Duplicate accounts, duplicate credentials, revision
mismatches, unsupported hosts and out-of-envelope symbols or coverage are all refused. Passing the
manifest never manufactures database currentness: the merged DEE-960 assignment source still re-checks
every binding against live state, and a revoked or substituted credential still fails closed.

Compute the digest with the same canonicalization the runtime uses:

```bash
WAIA_TRADER_CLI=1 node --import tsx --require ./scripts/trader/trader-cli-server-only-prelude.cjs \
  --conditions=react-server -e '
    const { accountObservationManifestDigest } = await import("./lib/trader/account-observation/assignment-manifest.ts");
    const { readFileSync } = await import("node:fs");
    const { contentSha256: _ignored, ...body } = JSON.parse(readFileSync(process.argv[1], "utf8"));
    console.log(accountObservationManifestDigest(body));
  ' /absolute/path/to/manifest.json
```

---

## Ceremony order (HUMAN-ONLY)

Nothing here is part of the DEE-1015 PR. Stop at the first refusal.

1. **Read-only preflight.** Confirm the intended production journal state and that exact H2 step `0205`
   is admissible against the then-current live journal and predecessor. If it is not, stop — that
   decision is a separate governance step, not a runbook workaround.
2. **Provision the three observation LOGIN identities with the reviewed operator.** No ad-hoc or
   handwritten SQL is used for these recurring runtime identities. Migration `0205` supplies the
   collector and reader parents; migration `0210` supplies the credential parent. The operator
   creates LOGIN identities only and derives all data authority from exact parent membership:

| Purpose | LOGIN identity | NOLOGIN parent authority |
|---------|----------------|--------------------------|
| Collector | `waia_account_observer_login` | `waia_account_observer` (0205) |
| Reader | `waia_account_observation_reader_login` | `waia_account_observation_reader` (0205) |
| Credential | `waia_account_observation_credential_login` | `waia_account_observation_credential` (0210) |

```bash
WAIA_POSTGRES_ADMIN_SESSION_URL=<administrative session URL> \
WAIA_OBSERVATION_COLLECTOR_DB_PASSWORD=<>=32 chars, distinct> \
WAIA_OBSERVATION_READER_DB_PASSWORD=<>=32 chars, distinct> \
WAIA_OBSERVATION_CREDENTIAL_DB_PASSWORD=<>=32 chars, distinct> \
pnpm trader:observation:provision-logins --confirm
```

   Without `--confirm` the operator is a no-op. Only the SCRAM verifier reaches SQL; the plaintext
   passwords are never logged, echoed or stored by the operator. Every identity is created and then
   re-read as `LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION` with
   `CONNECTION LIMIT 2`, exactly one membership in its own parent with `ADMIN FALSE, INHERIT FALSE,
   SET TRUE`, no object ownership and no direct table, column, schema or function grant. Database
   `CONNECT` is the only tolerated direct privilege, and must be granted separately if the
   deployment revokes it from `PUBLIC`. Exact retry is idempotent; a conflicting, overprivileged or
   foreign-membership role is refused rather than repaired. The collector login still holds no
   INSERT on `trader_account_collection_state`, and neither the collector nor the reader can read
   credential ciphertext.
3. **Deploy the exact merged app SHA**, then build and run the observation image at the same SHA:

```bash
docker build -f services/ai-trader-account-observation-host/Dockerfile \
  --build-arg WAIA_IMAGE_RELEASE_SHA=<sha> -t waia-account-observation-host:<sha> .
```

4. **Prove installed identity first** — start in `idle` and confirm `GET /health` reports
   `status: "installed"`, `observationReady: false` and the exact release SHA. Also run the packaging
   and runtime preflights:

```bash
node services/ai-trader-account-observation-host/entrypoint.mjs --preflight-image
node services/ai-trader-account-observation-host/entrypoint.mjs --preflight-runtime
```

5. **Create the HTX key as `readonly` only** — no `trade`, transfer or withdrawal permission. Store the
   ciphertext through the existing credential path; plaintext never reaches this repository, a request
   body or a log.
6. **Inject secrets**: `WAIA_OBSERVATION_MASTER_KEY` and the three database URLs, through the operator
   KMS path used for off-Cloudflare hosts — not the Cloudflare Secrets Store binding.
7. **Author, review and digest the manifest** for the exact approved assignment.
8. **Verify provisioning without writing**, then provision the single collection-state row:

```bash
DATABASE_URL_POSTGRES_SESSION=<provisioning session URL> \
pnpm trader:observation:provision-state \
  --manifest /absolute/path/to/manifest.json \
  --expected-manifest-sha256 <64-hex> \
  --expected-release-sha <40-hex> \
  --organization-id <uuid> \
  --credential-id <uuid> \
  --exchange-account-id <numeric> \
  --verify-only
```

Re-run without `--verify-only` and with `--confirm-exact-assignment <organizationId>:<credentialId>:<exchangeAccountId>`
to insert. The operator attests its own elevated authority, attests that the collector and reader roles
remain least-privileged, is idempotent on an exact existing row, and refuses any conflicting row rather
than rewriting authority. It issues exactly one `INSERT` and never `UPDATE`, `DELETE` or `TRUNCATE`, and
never touches observation history. It must be run with the provisioning session login, never the
recurring collector login. Keep the canonical JSON receipt it prints as ceremony evidence.

9. **Start the collector** in `account-observation-recurring` mode and confirm `GET /health` reports
   `status: "ok"`, `observationReady: true`, the expected assignment count and the exact manifest digest.
10. **Verify observed behavior**: automatic tenant and Admin SSE parity, reconnect, polling fallback,
    credential revoke, process restart, stale-state truth, and zero venue writes.

---

## Operating the running host

| Situation | Action |
|-----------|--------|
| Graceful stop | send `SIGTERM`; the consumer completes the bounded DEE-979 drain and releases its lease |
| Manifest change | stop, replace the file, update `WAIA_OBSERVATION_ASSIGNMENT_MANIFEST_SHA256`, restart — the runtime never reloads a manifest in place |
| Release change | rebuild and restart at the new exact SHA; a mismatched manifest `releaseSha` is refused |
| Consumer failure | the supervisor drains and exits non-zero so the orchestrator restarts a clean process; health never claims a collector that is not running |
| Credential revoked | observation fails closed for that assignment; re-provisioning a credential is a Human step |
| Rollback | stop the host. Observation is read-only, so stopping removes all activity; no venue or capital state exists to unwind |

Health is deliberately secret-free: it reports service name, release SHAs, mode, collector state,
assignment count, manifest digest and exit code. No decrypted credential, key, database URL or venue
response is ever logged.
