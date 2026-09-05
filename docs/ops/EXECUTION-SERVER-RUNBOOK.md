# AI-TRADER Execution Server — operator runbook

**Owner:** Architect · **Status:** Canonical · **Linear:** DEE-406 (D1), DEE-409 (D2 tooling)  
**Scope:** AI-TRADER execution plane only — see [ADR-0023](../adr/0023-execution-server-ai-trader-only-execution-plane.md)

> **HUMAN-ONLY mutation.** Guarded scripts (`execution-server-{sync,build,deploy,rollback}.sh`) require `--confirm` on the execution host. Without `--confirm` they print the planned actions and exit 0. **Composer and agents must never pass `--confirm` or execute host mutation.**

**Related:**

- [`EXECUTION-SURFACES.md`](EXECUTION-SURFACES.md) — `execution-server` surface definition
- [DEE-339 BP-6 runbook](./DEE-339-BP6-EXECUTION-HOST-RUNBOOK.md) — health scaffold + secret boundaries
- [DEE-212 BP-7 live execution](./DEE-212-BP7-LIVE-EXECUTION-RUNBOOK.md) — Org-0 live path
- [`scripts/ops/execution-server-preflight.sh`](../../scripts/ops/execution-server-preflight.sh) — read-only stale-code guard
- [`scripts/ops/execution-server-sync.sh`](../../scripts/ops/execution-server-sync.sh) — guarded checkout pin (D2)
- [`scripts/ops/execution-server-build.sh`](../../scripts/ops/execution-server-build.sh) — guarded image build (D2)
- [`scripts/ops/execution-server-deploy.sh`](../../scripts/ops/execution-server-deploy.sh) — guarded container deploy (D2)
- [`scripts/ops/execution-server-rollback.sh`](../../scripts/ops/execution-server-rollback.sh) — guarded rollback (D2)

---

## 1. Architectural boundaries

| Boundary | Rule |
|----------|------|
| **Plane** | Execution Server = AI-TRADER execution only; this image runs the bounded Historical Simulation V2 consumer, while live trading remains separately gated |
| **Secrets** | Runtime injection at deploy; never Cloudflare Secrets Store; never in git/image |
| **Master key** | Worker uses `AI_TRADER_MASTER_KEY` via Secrets Store — Execution Server does **not** |
| **State** | Canonical app state in Supabase Postgres; host checkout is operational |
| **Code pin** | Every campaign/deploy must target an explicit full git SHA |

Reference host id (operator vault): `waia-org0-exec` / `waia-org0-execution`.

---

## 2. Deployed revision record

After every successful deploy or rollback, the operator records deployment truth in **`deployed-revision.json`** on the host (path configurable via `EXECUTION_SERVER_DEPLOYED_REVISION_PATH`).

### Schema (canonical)

```json
{
  "gitSha": "40-char-full-sha",
  "imageTag": "waia-execution-host:20260710-abc1234",
  "imageId": "sha256:64-char-lowercase-hex",
  "deployedAt": "2026-07-10T12:00:00Z",
  "operator": "human-id-or-handle",
  "previousGitSha": "optional-40-char-sha-for-rollback-chain",
  "notes": "optional free text — no secrets"
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `gitSha` | Yes | Must match `EXECUTION_SERVER_TARGET_SHA` / checkout `HEAD` at deploy time |
| `imageTag` | Yes | Docker image tag or digest reference |
| `imageId` | Yes | Immutable Docker image ID inspected after build and re-verified before and after container start |
| `deployedAt` | Yes | ISO-8601 UTC |
| `operator` | Yes | Who performed the deploy |
| `previousGitSha` | Rollback only | Prior known-good SHA |
| `notes` | No | Incident/context only — no credentials |

Guarded deploy writes the full record on `--confirm`; sync merges `gitSha`, and build records `gitSha`, `imageTag`, plus the immutable `imageId`. A tag change without a freshly inspected ID removes the stale prior ID and cannot pass deploy.

---

## 3. Sync — pin checkout to declared SHA

**Classification:** HUMAN-ONLY

**Goal:** Ensure the host monorepo `HEAD` equals the approved integration merge SHA before build, deploy, or live campaigns.

### Guarded script

On the execution host:

```bash
./scripts/ops/execution-server-sync.sh --target-sha <full-sha> \
  [--approved-ref refs/remotes/origin/main] --confirm
```

Without `--confirm` the script prints the planned `git fetch` / `git checkout` / preflight steps and performs no mutation.

### Manual equivalent

1. SSH to execution host as the operator service user.
2. `cd` to the WAIA monorepo checkout (operator vault path).
3. Record the intended SHA from `origin/main`, or name an explicit fully qualified approved ref with `--approved-ref refs/...`.
4. Start from a worktree with zero tracked or untracked changes. The guarded sync fetches `origin`, proves the target commit is reachable from the approved ref, then checks out the full SHA.
5. Run read-only preflight:

```bash
EXECUTION_SERVER_TARGET_SHA=<full-sha> ./scripts/ops/execution-server-preflight.sh
```

6. Abort unless preflight proves clean `HEAD == target SHA` and approved-ref reachability.

**Do not:** `git pull` without a pinned SHA; run campaigns on dirty or ahead/behind trees.

---

## 4. Build — container + trader CLI deps

**Classification:** HUMAN-ONLY

**Goal:** Produce a runnable execution-host image containing both health service and the exact bounded Historical Simulation V2 consumer.

### Guarded script

```bash
./scripts/ops/execution-server-build.sh --target-sha <full-sha> [--image-tag waia-execution-host:YYYYMMDD-<short>] --confirm
```

Runs checkout preflight, materializes the Docker context from `git archive <target-sha>` (so ignored host residue cannot enter the image), builds with a baked `org.opencontainers.image.revision`, executes the in-image consumer-packaging preflight, checks `docker history`, and runs `pnpm install --frozen-lockfile` on `--confirm`. It records the inspected immutable Docker `imageId` with the tag and SHA; deploy refuses if the tag resolves to a different ID.

### Manual equivalent

```bash
docker build -f services/ai-trader-execution-host/Dockerfile \
  --build-arg WAIA_IMAGE_RELEASE_SHA=<full-sha> \
  -t waia-execution-host:<tag> .
docker run --rm -e WAIA_RELEASE_SHA=<full-sha> waia-execution-host:<tag> \
  node --import tsx --conditions=react-server \
  services/ai-trader-execution-host/entrypoint.mjs --preflight-image
docker history waia-execution-host:<tag>   # verify no secret ENV layers
pnpm install --frozen-lockfile
# Trader live CLIs require WAIA_TRADER_CLI=1 — set by pnpm trader:* scripts
```

Tag convention: `waia-execution-host:YYYYMMDD-<short-sha>`.

See [DEE-339 §2B](./DEE-339-BP6-EXECUTION-HOST-RUNBOOK.md) for BP-6 health scaffold acceptance.

---

## 4.1 Prepare the technical proposal — after Admin request, before Human ratification

**Classification:** HUMAN-ONLY

The Admin first records the exact run request. The execution host must then prove
the pre-holdout dataset and create the technical proposal from the same immutable
image that will execute the run. The command below does **not** ratify or launch.

```bash
./scripts/ops/execution-server-prepare-historical-proposal.sh \
  --target-sha <full-sha> \
  --image-tag waia-execution-host:<tag> \
  --proposal-env-file /path/to/operator-vault-proposal.env \
  --dataset-root /opt/waia/fhv-work \
  --confirm
```

The mode-`0600` proposal env file uses the constrained
`waia_historical_runner_login` URI and contains the exact organization/run,
dataset and receipt paths, symbol/horizon, initial record/cycle extent, starting
cash/default modeled quantity and preregistered economics variables required by
`trader:historical:v2:prepare-proposal`. Mount the dataset root read-only at the
same absolute path recorded by those variables. The runtime preflight rejects an
owner/service-role URI, private exchange credentials, live flags and blind
holdout authority.

PASS is the printed proposal ID and digest. Open the Admin review, compare its
exact SHA/run/extent/four surfaces and `NONE/NONE/FORBIDDEN` boundary, then perform
the explicit Human ratification. Only after ratification proceed to §5.

---

## 5. Deploy — runtime with operator secrets

**Classification:** HUMAN-ONLY

**Goal:** Run the execution-host container and inject runtime secrets from operator vault — never from repo or Cloudflare.

### Guarded script

```bash
./scripts/ops/execution-server-deploy.sh \
  --target-sha <full-sha> \
  --image-tag waia-execution-host:<tag> \
  --operator <human-id> \
  --secrets-env-file /path/to/operator-vault.env \
  --dataset-root /opt/waia/fhv-work \
  --confirm
```

On `--confirm`: verifies baked/runtime SHA identity, verifies that the env selects the dedicated constrained database LOGIN, replaces the container, waits until the consumer has verified both `session_user` and `current_user`, proves it is `running` or `completed` through `/health`, rejects an immediate restart, and writes `deployed-revision.json`.

### Manual equivalent

```bash
docker run -d \
  --name ai-trader-execution-host \
  --restart unless-stopped \
  -p 8080:8080 \
  --mount type=bind,src=/opt/waia/fhv-work,dst=/opt/waia/fhv-work,readonly \
  -e EXECUTION_HOST_PORT=8080 \
  -e WAIA_RELEASE_SHA=<full-sha> \
  --env-file /path/to/operator-vault.env \
  waia-execution-host:<tag>
```

| Rule | Detail |
|------|--------|
| Restart policy | `unless-stopped` |
| Port | `EXECUTION_HOST_PORT` (default 8080) |
| Secrets | Mode `0600` env file from host KMS; only the constrained runner URI and durable run identity are passed to the child |
| Forbidden | `ENV` secrets in Dockerfile; Cloudflare Secrets Store on host |

The env file for this bounded lane contains only `DATABASE_URL_POSTGRES_SESSION`,
`WAIA_HISTORICAL_ORGANIZATION_ID`, and `WAIA_HISTORICAL_RUN_ID`. The database URI
must authenticate as `waia_historical_runner_login`; owner, `postgres`,
`service_role`, private exchange credentials, live flags, capital authority and
blind-holdout controls are refused or never forwarded to the consumer.

### One-time constrained database LOGIN provisioning

Run this as a Human database operator from a secure terminal. The command is a
no-op without `--confirm`; neither URL nor password is written to git or image.
The script converts the password to a SCRAM verifier before issuing SQL.

```bash
WAIA_POSTGRES_ADMIN_SESSION_URL='<temporary-admin-session-uri>' \
WAIA_HISTORICAL_RUNNER_DB_PASSWORD='<random-32+-character-secret>' \
node scripts/ops/provision-historical-runner-login.mjs --confirm
```

Store a separate `DATABASE_URL_POSTGRES_SESSION` for
`waia_historical_runner_login` in the host vault, then unset both provisioning
variables. The LOGIN is `NOINHERIT`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`,
`NOREPLICATION`, `NOBYPASSRLS`, connection-limited, and is a member only of
`waia_historical_runner`. Runtime explicitly verifies `session_user` before
`SET ROLE`, then verifies `current_user` after downgrade.

After deploy: write/update `deployed-revision.json` (§2).

---

## 6. Health — liveness and readiness

**Classification:** Read-only checks (AUTO for agents when plan explicitly requires verification)

### Liveness (BP-6 minimum)

```bash
curl -sf http://127.0.0.1:8080/health
# Expect status=ok, exact releaseSha/imageReleaseSha and
# consumer.mode=historical-v2-ratified-one-shot with state=running|completed
```

### Readiness (operator checklist before live path)

| Check | Pass criterion |
|-------|----------------|
| SHA match | `./scripts/ops/execution-server-preflight.sh` exit 0 |
| `deployed-revision.json` | `gitSha` equals target SHA |
| Postgres egress | Worker `GET /api/health/database` returns `backend: postgres` before live-enable ([DEE-339 §6](./DEE-339-BP6-EXECUTION-HOST-RUNBOOK.md)) |
| Env on host | Dedicated-login `DATABASE_URL_POSTGRES_SESSION` + exact historical organization/run identity from vault |
| Ratified launch | One child finalizes the exact Human-approved proposal, bootstraps and queues the bounded run, then claims it; health stays degraded until that durable claim |
| Single consumer | Only the ratified one-shot entrypoint is packaged; one child per container and the durable PostgreSQL advisory lease prevent a second claimant |
| Terminal restart | A previously `COMPLETED` lifecycle is reported healthy without another consume attempt or restart loop |
| Graceful shutdown | `docker stop` → SIGTERM forwarded to consumer → DB session/lease close |

Agents may run **read-only** preflight and `curl /health` only when the integration plan lists `execution-server` validation.

---

## 7. Rollback — redeploy prior known-good revision

**Classification:** HUMAN-ONLY

**Goal:** Restore the last known-good image + SHA without improvising from unmerged branches.

### Guarded script

```bash
./scripts/ops/execution-server-rollback.sh \
  --operator <human-id> \
  [--notes "incident context"] \
  [--secrets-env-file /path/to/operator-vault.env] \
  --confirm
```

Reads `previousGitSha` and `imageTag` from `deployed-revision.json` when overrides are omitted. On `--confirm`: syncs checkout, redeploys prior image, checks `/health`, and rewrites `deployed-revision.json`.

### Manual equivalent

1. Read `deployed-revision.json` → identify `previousGitSha` and prior `imageTag` (or operator vault backup).
2. Stop current container: `docker stop ai-trader-execution-host`.
3. Sync checkout to `previousGitSha` (§3).
4. If image missing locally, rebuild from that SHA (§4) or pull from operator registry.
5. Deploy prior image (§5).
6. Write new `deployed-revision.json` with rolled-back `gitSha`, updated `deployedAt`/`operator`, and `notes` describing incident.
7. Re-run health checks (§6).

**Do not:** roll forward with unreviewed code during an incident without Architect approval.

---

## 8. SSH and host recovery

**Classification:** HUMAN-ONLY

### SSH access

| Item | Guidance |
|------|----------|
| Host | `waia-org0-exec` (operator DNS/IP in vault) |
| Keys | Backup operator SSH private keys off-repo; restore before account migration |
| Access | Single-tenant Org-0 path; restrict to operator group |

### Reboot recovery

1. Verify Docker daemon: `systemctl status docker`
2. Confirm container auto-starts (`unless-stopped`): `docker ps`
3. If container absent, redeploy from `deployed-revision.json` image tag — do not auto-pull `latest`.
4. Run §6 health checks before resuming live campaigns.

### Long-running jobs

For FHV rehearsal and campaign supervision on qualified Linux hosts, use **systemd units** (`waia-fhv-campaign.service`, `waia-fhv-observer.service`) rendered and installed via guarded tooling under [`scripts/ops/fhv-supervisor/`](../../scripts/ops/fhv-supervisor/). See [`FHV-EXECUTION-SERVER-REHEARSAL-CONTRACT.md`](FHV-EXECUTION-SERVER-REHEARSAL-CONTRACT.md) and [`FHV-RELEASE-IDENTITY-CONTRACT.md`](FHV-RELEASE-IDENTITY-CONTRACT.md).

**Release identity:** `EXECUTION_SERVER_TARGET_SHA` is unresolved until the next Human dev → main release. Never pin a prior release SHA or feature branch head SHA in active deploy/rehearse commands.

Legacy note: `tmux` or `nohup` may still be used for non-FHV long CLIs until explicitly retired; **FHV campaigns must not use tmux/nohup as the production supervisor** on qualified Linux/systemd hosts.

### FHV systemd supervisor tooling (DEE-424)

| Script | Purpose | `--confirm` effect |
|--------|---------|-------------------|
| [`fhv-supervisor/render-units.sh`](../../scripts/ops/fhv-supervisor/render-units.sh) | Render unit files locally | N/A (read-only render) |
| [`fhv-supervisor/install-units.sh`](../../scripts/ops/fhv-supervisor/install-units.sh) | Install allowlisted units | copy to `/etc/systemd/system`, `daemon-reload`, `enable` |
| [`fhv-supervisor/rollback-units.sh`](../../scripts/ops/fhv-supervisor/rollback-units.sh) | Remove allowlisted units | `stop`, `disable`, remove unit files |

Without `--confirm`: print planned actions and exit — **no mutation**. Agents must never pass `--confirm`.

### T4 legacy checkout preservation policy (Human-only)

When provisioning a fresh checkout on the Execution Server:

1. Move the entire stale checkout (including untracked files) to a timestamped legacy directory **outside** the new working tree.
2. Do **not** inspect, copy, or reuse ignored/secret files automatically.
3. Do **not** delete untracked legacy entries during preservation.
4. Treat old RI-P7 artifacts as legacy evidence only — not rehearsal inputs.
5. Clone/sync a **clean** checkout at `"$EXECUTION_SERVER_TARGET_SHA"` (resolved only after dev → main release); verify SHA guard + clean tree.
6. Keep the legacy BP-6 health container (`waia-execution-host:bp6`) running until separately authorized cutover.
7. Write `deployed-revision.json` only after successful deployment.
8. Preserve rollback route via guarded rollback scripts.

Do not record host IPs, SSH aliases, or secret paths in repository files.

---

## 9. Human-only boundaries (summary)

| Action | Who | Agent |
|--------|-----|-------|
| Sync checkout to SHA | Human operator | **Never** |
| Docker build on host | Human operator | **Never** |
| Deploy / restart container | Human operator | **Never** |
| Rollback | Human operator | **Never** |
| SSH / reboot recovery | Human operator | **Never** |
| Inject runtime secrets | Human operator | **Never** |
| Live trading / `trader:live:*` on host | Human operator | **Never** |
| Read-only preflight | Human or agent (plan-listed) | **Allowed** |
| `curl /health` | Human or agent (plan-listed) | **Allowed** |

Encoded in [`INTEGRATION-BOUNDARY-POLICY.md`](../waia-governance/INTEGRATION-BOUNDARY-POLICY.md) §HUMAN-ONLY.

---

## 10. Slice D2 guarded tooling

| Script | Purpose | `--confirm` effect |
|--------|---------|-------------------|
| [`execution-server-sync.sh`](../../scripts/ops/execution-server-sync.sh) | Pin checkout to SHA | `git fetch` + `git checkout` + preflight; merge `gitSha` in `deployed-revision.json` |
| [`execution-server-build.sh`](../../scripts/ops/execution-server-build.sh) | Build image + CLI deps | `docker build`, `pnpm install`; merge `imageTag` in `deployed-revision.json` |
| [`execution-server-deploy.sh`](../../scripts/ops/execution-server-deploy.sh) | Run container | `docker run`, `/health` check; write full `deployed-revision.json` |
| [`execution-server-rollback.sh`](../../scripts/ops/execution-server-rollback.sh) | Restore prior revision | sync + redeploy + `/health`; rewrite `deployed-revision.json` |

All scripts support `--dry-run` and `--help`. **Without `--confirm`:** print planned actions and exit 0 — no mutation. Composer authors dry-run-test locally; **never** pass `--confirm` against the live host.

---

## 11. Operator sign-off block (deploy / rollback)

| Field | Value |
|-------|-------|
| Action | deploy / rollback |
| Target git SHA | |
| Image tag | |
| Operator | |
| Preflight exit code | |
| `/health` status | |
| `deployed-revision.json` updated | yes / no |
| Date (UTC) | |

---

*Last updated: 2026-07-10 — vNext Slice D2 (guarded tooling).*
