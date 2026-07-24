# T4 Operator Packet V5 — Human-executable FHV T4A (Model C)

**Architecture decision:** `AUTHORIZE-T4A-T4B-CONTRACT-SPLIT` · model **C** · `gate8_satisfied_by=T4A_ONLY`

**Scope:** Execution Server host runtime rehearsal (T4A) only.
**Out of scope:** T4B Worker dashboard + authenticated tunnel (`DEE-437`, Backlog).

Ceremony success classifications (no ambiguous aggregate PASS):

- `T4A_RESULT=PASS`
- `GATE8_RESULT=PASS`
- `T4B_RESULT=NOT_EXECUTED_SEPARATE_GATE`

Do **not** use `T4_RESULT=PASS`, `T4_AGGREGATE_RESULT=PASS`, or `DASHBOARD_RESULT=PASS`.

Use **`corepack pnpm@10`** only (never bare `pnpm`).

---

## Declared Human bindings

Set these before Phase A. Secrets (`FHV_OPERATOR_COMMAND_SECRET`, `FHV_OBSERVER_TUNNEL_SECRET`) live in `${FHV_ENVIRONMENT_FILE}` only — never in argv, never exported by the operator shell.

```bash
export EXECUTION_SERVER_TARGET_SHA="<exact-main-release-sha-after-dee436>"
export FHV_RELEASE_TAG="<exact-release-tag>"
export FHV_RUN_ID="<human-approved-unique-run-id>"
export FHV_ORGANIZATION_ID="<org-uuid>"
export FHV_OPERATOR_ID="<human-operator-id>"
export FHV_ARTIFACT_ROOT="<service-user-artifact-root>"
export FHV_SERVICE_USER="<non-root-service-user>"
export FHV_ENVIRONMENT_FILE="/etc/waia/fhv.env"
export FHV_ORIGIN_URL="<https-origin-url-for-oumaster369/waia-without-credentials>"
export FHV_REFERENCE_REPO_ROOT="<existing-read-only-checkout-for-pre-auth-inspection>"
export FHV_CHECKOUT_PARENT="<parent-directory-for-post-auth-fresh-checkout>"
export FHV_REPO_ROOT="${FHV_CHECKOUT_PARENT}/waia-${EXECUTION_SERVER_TARGET_SHA}"
export FHV_WORKING_DIRECTORY="${FHV_REPO_ROOT}"
export FHV_RUN_DIR="${FHV_ARTIFACT_ROOT}/RI-P7/fhv-ops-rehearsal/${FHV_RUN_ID}"
export FHV_RENDERED_UNITS_DIR="${FHV_REPO_ROOT}/.ops/rendered-units"
export FHV_INSTALLED_UNITS_DIR="/etc/systemd/system"
export FHV_SEAL_DESTINATION="${FHV_ARTIFACT_ROOT}/RI-P7/fhv-ops-rehearsal-seals/${FHV_RUN_ID}"
export FHV_CONTINUITY_BEFORE="${FHV_RUN_DIR}/control/fhv-t4-continuity-before.v1.json"
export FHV_CONTINUITY_AFTER="${FHV_RUN_DIR}/control/fhv-t4-continuity-after.v1.json"
export FHV_HOST_PROBE_PATH="${FHV_RUN_DIR}/control/fhv-t4-host-probe-proof.v1.json"
test -n "${FHV_ORIGIN_URL}"
test "${FHV_ORIGIN_URL}" != *:*@*
```

**Authorization is not issued by this packet.** A Human operator must issue **`AUTHORIZE-FHV-OPS-DEPLOY`** before any POST_AUTHORIZED step.

---

## Phase A — `PRE_AUTHORIZED_READ_ONLY_PHASE`

Read-only inspection only. **Zero filesystem mutation.** No checkout creation, manifest, render, install, deployment record, continuity, evidence, sealing, or systemd mutation.

```bash
# A1 — exact Git checkout + release-tag identity (read-only; no --output)
scripts/ops/fhv-release-checkout-identity.sh \
  --repo-path "${FHV_REFERENCE_REPO_ROOT}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}" \
  --release-tag "${FHV_RELEASE_TAG}"

# A2 — reference checkout SHA guard (read-only)
scripts/ops/execution-server-preflight.sh \
  --repo-path "${FHV_REFERENCE_REPO_ROOT}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}"

# A3 — host probe baseline (read-only stdout)
scripts/ops/fhv-t4-host-probe.sh

# A4 — host monotonic clock sample (read-only; CLOCK_BOOTTIME + boot_id)
scripts/ops/fhv-t4-host-monotonic-read.sh

# A5 — environment contract flags present (read-only grep; do not source EnvironmentFile)
grep -q '^FHV_HOST_OS_QUALIFIED=true' "${FHV_ENVIRONMENT_FILE}"
grep -q '^FHV_COMMAND_ENFORCEMENT_ENABLED=true' "${FHV_ENVIRONMENT_FILE}"
```

### STOP — `AUTHORIZE-FHV-OPS-DEPLOY`

**Do not proceed** until a Human operator issues **`AUTHORIZE-FHV-OPS-DEPLOY`**.

Before this gate: no `git clone`, no `git checkout` into a new tree, no `trader:fhv:rehearsal`, no `render-units.sh --output-dir`, no `install-units.sh`, no `fhv-systemd-record-deploy.sh`, no run-root writes, no `/tmp` staging.

---

## Phase B — `POST_AUTHORIZED_T4A_PHASE`

Only after **`AUTHORIZE-FHV-OPS-DEPLOY`**. Exact 32-step state machine. All run-root / evidence-writing package commands run as the service user via `scripts/ops/fhv-t4-service-user-exec.sh`.

Shared service-user wrapper pattern:

```bash
scripts/ops/fhv-t4-service-user-exec.sh \
  --service-user "${FHV_SERVICE_USER}" \
  --environment-file "${FHV_ENVIRONMENT_FILE}" \
  --repo-root "${FHV_REPO_ROOT}" \
  -- trader:fhv:t4:<subcommand> [args...]
```

### Step 1 — Authorization confirmed

Human confirms **`AUTHORIZE-FHV-OPS-DEPLOY`** is issued for this `FHV_RUN_ID` and `EXECUTION_SERVER_TARGET_SHA`.

### Step 2 — Fresh checkout from declared origin

```bash
git clone "${FHV_ORIGIN_URL}" "${FHV_REPO_ROOT}"
cd "${FHV_REPO_ROOT}"
git checkout "${EXECUTION_SERVER_TARGET_SHA}"
```

### Step 3 — Exact HEAD and release-tag identity

```bash
scripts/ops/fhv-release-checkout-identity.sh \
  --repo-path "${FHV_REPO_ROOT}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}" \
  --release-tag "${FHV_RELEASE_TAG}"
scripts/ops/execution-server-preflight.sh \
  --repo-path "${FHV_REPO_ROOT}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}"
```

### Step 4 — Manifest materialization

```bash
cd "${FHV_REPO_ROOT}"
scripts/ops/fhv-t4-service-user-exec.sh \
  --service-user "${FHV_SERVICE_USER}" \
  --environment-file "${FHV_ENVIRONMENT_FILE}" \
  --repo-root "${FHV_REPO_ROOT}" \
  -- trader:fhv:rehearsal -- \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}" \
  --run-id "${FHV_RUN_ID}" \
  --organization-id "${FHV_ORGANIZATION_ID}" \
  --t4-deterministic-pause \
  --fixture HTR_WP03_BENCHMARK
```

### Step 5 — Immutable checkout identity proof

```bash
scripts/ops/fhv-t4-service-user-exec.sh \
  --service-user "${FHV_SERVICE_USER}" \
  --environment-file "${FHV_ENVIRONMENT_FILE}" \
  --repo-root "${FHV_REPO_ROOT}" \
  -- trader:fhv:t4:record-checkout-identity \
  --run-root "${FHV_RUN_DIR}" \
  --run-id "${FHV_RUN_ID}" \
  --organization-id "${FHV_ORGANIZATION_ID}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}" \
  --release-tag "${FHV_RELEASE_TAG}" \
  --repo-root "${FHV_REPO_ROOT}"
```

### Step 6 — Unit render

```bash
scripts/ops/fhv-supervisor/render-units.sh \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}" \
  --working-directory "${FHV_WORKING_DIRECTORY}" \
  --service-user "${FHV_SERVICE_USER}" \
  --environment-file "${FHV_ENVIRONMENT_FILE}" \
  --fhv-run-root "${FHV_RUN_DIR}" \
  --fhv-run-id "${FHV_RUN_ID}" \
  --fhv-organization-id "${FHV_ORGANIZATION_ID}" \
  --repo-path "${FHV_REPO_ROOT}" \
  --output-dir "${FHV_RENDERED_UNITS_DIR}"
```

### Step 7 — Install preview (no mutation)

```bash
scripts/ops/fhv-supervisor/install-units.sh \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}" \
  --working-directory "${FHV_WORKING_DIRECTORY}" \
  --service-user "${FHV_SERVICE_USER}" \
  --environment-file "${FHV_ENVIRONMENT_FILE}" \
  --fhv-run-root "${FHV_RUN_DIR}" \
  --fhv-run-id "${FHV_RUN_ID}" \
  --fhv-organization-id "${FHV_ORGANIZATION_ID}" \
  --repo-path "${FHV_REPO_ROOT}" \
  --systemd-dir "${FHV_INSTALLED_UNITS_DIR}"
```

### Step 8 — Install

```bash
scripts/ops/fhv-supervisor/install-units.sh \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}" \
  --working-directory "${FHV_WORKING_DIRECTORY}" \
  --service-user "${FHV_SERVICE_USER}" \
  --environment-file "${FHV_ENVIRONMENT_FILE}" \
  --fhv-run-root "${FHV_RUN_DIR}" \
  --fhv-run-id "${FHV_RUN_ID}" \
  --fhv-organization-id "${FHV_ORGANIZATION_ID}" \
  --repo-path "${FHV_REPO_ROOT}" \
  --systemd-dir "${FHV_INSTALLED_UNITS_DIR}" \
  --confirm
```

### Step 9 — Deployment record

```bash
export FHV_RENDERED_UNIT_DIGESTS="$(
  scripts/ops/fhv-t4-rendered-unit-digests.sh --rendered-dir "${FHV_RENDERED_UNITS_DIR}"
)"
scripts/ops/fhv-systemd-record-deploy.sh \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}" \
  --release-tag "${FHV_RELEASE_TAG}" \
  --run-id "${FHV_RUN_ID}" \
  --organization-id "${FHV_ORGANIZATION_ID}" \
  --operator "${FHV_OPERATOR_ID}" \
  --service-user "${FHV_SERVICE_USER}" \
  --rendered-unit-digests "${FHV_RENDERED_UNIT_DIGESTS}" \
  --repo-path "${FHV_REPO_ROOT}" \
  --confirm
```

### Step 10 — Observed host probe + ingest

```bash
mkdir -p "${FHV_RUN_DIR}/control"
scripts/ops/fhv-t4-host-probe.sh > "${FHV_RUN_DIR}/control/fhv-t4-host-probe-raw.v1.json"
chown "${FHV_SERVICE_USER}:${FHV_SERVICE_USER}" \
  "${FHV_RUN_DIR}/control/fhv-t4-host-probe-raw.v1.json"
scripts/ops/fhv-t4-service-user-exec.sh \
  --service-user "${FHV_SERVICE_USER}" \
  --environment-file "${FHV_ENVIRONMENT_FILE}" \
  --repo-root "${FHV_REPO_ROOT}" \
  -- trader:fhv:t4:ingest-host-probe \
  --run-root "${FHV_RUN_DIR}" \
  --run-id "${FHV_RUN_ID}" \
  --organization-id "${FHV_ORGANIZATION_ID}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}" \
  --raw-host-probe-json-path "${FHV_RUN_DIR}/control/fhv-t4-host-probe-raw.v1.json" \
  --host-probe-json-path "${FHV_HOST_PROBE_PATH}"
```

### Step 11 — Deployment proof

```bash
scripts/ops/fhv-systemd-verify-deploy.sh \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}" \
  --repo-path "${FHV_REPO_ROOT}"
scripts/ops/fhv-t4-service-user-exec.sh \
  --service-user "${FHV_SERVICE_USER}" \
  --environment-file "${FHV_ENVIRONMENT_FILE}" \
  --repo-root "${FHV_REPO_ROOT}" \
  -- trader:fhv:t4:verify-deployment \
  --run-root "${FHV_RUN_DIR}" \
  --run-id "${FHV_RUN_ID}" \
  --organization-id "${FHV_ORGANIZATION_ID}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}" \
  --release-tag "${FHV_RELEASE_TAG}" \
  --repo-root "${FHV_REPO_ROOT}" \
  --rendered-units-dir "${FHV_RENDERED_UNITS_DIR}" \
  --installed-units-dir "${FHV_INSTALLED_UNITS_DIR}" \
  --service-user "${FHV_SERVICE_USER}" \
  --working-directory "${FHV_WORKING_DIRECTORY}" \
  --environment-file "${FHV_ENVIRONMENT_FILE}" \
  --operator-id "${FHV_OPERATOR_ID}"
```

### Step 12 — PAUSE pre-arm

```bash
scripts/ops/fhv-t4-service-user-exec.sh \
  --service-user "${FHV_SERVICE_USER}" \
  --environment-file "${FHV_ENVIRONMENT_FILE}" \
  --repo-root "${FHV_REPO_ROOT}" \
  -- trader:fhv:t4:arm-pause \
  --run-root "${FHV_RUN_DIR}" \
  --run-id "${FHV_RUN_ID}" \
  --organization-id "${FHV_ORGANIZATION_ID}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}"
```

### Step 13 — Observer start + identity/health

```bash
systemctl start waia-fhv-observer.service
scripts/ops/fhv-t4-observer-systemd-identity-read.sh waia-fhv-observer.service
```

### Step 14 — Campaign start

```bash
systemctl start waia-fhv-campaign.service
```

### Step 15 — Bounded wait for pause

```bash
scripts/ops/fhv-t4-service-user-exec.sh \
  --service-user "${FHV_SERVICE_USER}" \
  --environment-file "${FHV_ENVIRONMENT_FILE}" \
  --repo-root "${FHV_REPO_ROOT}" \
  -- trader:fhv:t4:wait-paused \
  --run-root "${FHV_RUN_DIR}" \
  --run-id "${FHV_RUN_ID}" \
  --organization-id "${FHV_ORGANIZATION_ID}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}" \
  --timeout-ms 300000
```

### Step 16 — Paused proof

```bash
scripts/ops/fhv-t4-service-user-exec.sh \
  --service-user "${FHV_SERVICE_USER}" \
  --environment-file "${FHV_ENVIRONMENT_FILE}" \
  --repo-root "${FHV_REPO_ROOT}" \
  -- trader:fhv:t4:verify-paused \
  --run-root "${FHV_RUN_DIR}" \
  --run-id "${FHV_RUN_ID}" \
  --organization-id "${FHV_ORGANIZATION_ID}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}" \
  --release-tag "${FHV_RELEASE_TAG}" \
  --repo-root "${FHV_REPO_ROOT}"
```

Expected: `classification=FHV_T4_PAUSED_VERIFICATION_PASS` and immutable paused proof written.

### Step 17 — Signed RESUME

```bash
scripts/ops/fhv-t4-service-user-exec.sh \
  --service-user "${FHV_SERVICE_USER}" \
  --environment-file "${FHV_ENVIRONMENT_FILE}" \
  --repo-root "${FHV_REPO_ROOT}" \
  -- trader:fhv:t4:resume \
  --run-root "${FHV_RUN_DIR}" \
  --run-id "${FHV_RUN_ID}" \
  --organization-id "${FHV_ORGANIZATION_ID}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}"
```

### Step 18 — Bounded wait for final

```bash
scripts/ops/fhv-t4-service-user-exec.sh \
  --service-user "${FHV_SERVICE_USER}" \
  --environment-file "${FHV_ENVIRONMENT_FILE}" \
  --repo-root "${FHV_REPO_ROOT}" \
  -- trader:fhv:t4:wait-final \
  --run-root "${FHV_RUN_DIR}" \
  --run-id "${FHV_RUN_ID}" \
  --organization-id "${FHV_ORGANIZATION_ID}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}" \
  --timeout-ms 300000
```

### Step 19 — Final proof

```bash
scripts/ops/fhv-t4-service-user-exec.sh \
  --service-user "${FHV_SERVICE_USER}" \
  --environment-file "${FHV_ENVIRONMENT_FILE}" \
  --repo-root "${FHV_REPO_ROOT}" \
  -- trader:fhv:t4:verify-final \
  --run-root "${FHV_RUN_DIR}" \
  --run-id "${FHV_RUN_ID}" \
  --organization-id "${FHV_ORGANIZATION_ID}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}" \
  --release-tag "${FHV_RELEASE_TAG}" \
  --repo-root "${FHV_REPO_ROOT}"
```

### Step 20 — Continuity-before (observer + campaign)

```bash
export FHV_T4_OBSERVER_SYSTEMD_IDENTITY_JSON="$(
  scripts/ops/fhv-t4-observer-systemd-identity-read.sh waia-fhv-observer.service
)"
export FHV_T4_CAMPAIGN_SYSTEMD_IDENTITY_JSON="$(
  scripts/ops/fhv-t4-observer-systemd-identity-read.sh waia-fhv-campaign.service
)"
scripts/ops/fhv-t4-service-user-exec.sh \
  --service-user "${FHV_SERVICE_USER}" \
  --environment-file "${FHV_ENVIRONMENT_FILE}" \
  --repo-root "${FHV_REPO_ROOT}" \
  -- trader:fhv:t4:capture-continuity-before \
  --run-root "${FHV_RUN_DIR}" \
  --run-id "${FHV_RUN_ID}" \
  --organization-id "${FHV_ORGANIZATION_ID}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}" \
  --repo-root "${FHV_REPO_ROOT}" \
  --output "${FHV_CONTINUITY_BEFORE}"
unset FHV_T4_OBSERVER_SYSTEMD_IDENTITY_JSON
unset FHV_T4_CAMPAIGN_SYSTEMD_IDENTITY_JSON
```

### Step 21 — Human disconnect/reconnect narrative event

Operator narrative only. Do not restart campaign. Do not mutate run-root evidence.
Narrative events are **not** machine proof and must not be hardcoded as CLI prerequisites.

### Step 22 — Observer-only restart

```bash
systemctl restart waia-fhv-observer.service
```

Do **not** restart `waia-fhv-campaign.service`.

### Step 23 — Continuity-after (observer + campaign)

```bash
export FHV_T4_OBSERVER_SYSTEMD_IDENTITY_JSON="$(
  scripts/ops/fhv-t4-observer-systemd-identity-read.sh waia-fhv-observer.service
)"
export FHV_T4_CAMPAIGN_SYSTEMD_IDENTITY_JSON="$(
  scripts/ops/fhv-t4-observer-systemd-identity-read.sh waia-fhv-campaign.service
)"
scripts/ops/fhv-t4-service-user-exec.sh \
  --service-user "${FHV_SERVICE_USER}" \
  --environment-file "${FHV_ENVIRONMENT_FILE}" \
  --repo-root "${FHV_REPO_ROOT}" \
  -- trader:fhv:t4:capture-continuity-after \
  --run-root "${FHV_RUN_DIR}" \
  --run-id "${FHV_RUN_ID}" \
  --organization-id "${FHV_ORGANIZATION_ID}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}" \
  --repo-root "${FHV_REPO_ROOT}" \
  --output "${FHV_CONTINUITY_AFTER}"
unset FHV_T4_OBSERVER_SYSTEMD_IDENTITY_JSON
unset FHV_T4_CAMPAIGN_SYSTEMD_IDENTITY_JSON
```

### Step 24 — Continuity verification proof

```bash
scripts/ops/fhv-t4-service-user-exec.sh \
  --service-user "${FHV_SERVICE_USER}" \
  --environment-file "${FHV_ENVIRONMENT_FILE}" \
  --repo-root "${FHV_REPO_ROOT}" \
  -- trader:fhv:t4:verify-continuity \
  --before "${FHV_CONTINUITY_BEFORE}" \
  --after "${FHV_CONTINUITY_AFTER}" \
  --run-root "${FHV_RUN_DIR}" \
  --run-id "${FHV_RUN_ID}" \
  --organization-id "${FHV_ORGANIZATION_ID}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}"
```

Expected: `classification=FHV_T4_CONTINUITY_VERIFICATION_PASS` and immutable continuity-verification proof written.

### Step 25 — Rollback preview

```bash
scripts/ops/fhv-supervisor/rollback-units.sh --systemd-dir "${FHV_INSTALLED_UNITS_DIR}"
```

### Step 26 — Rollback

```bash
scripts/ops/fhv-supervisor/rollback-units.sh \
  --systemd-dir "${FHV_INSTALLED_UNITS_DIR}" \
  --confirm
```

### Step 27 — Rollback proof

Do **not** overwrite the immutable deployment-time host-probe proof. Capture a live
post-rollback observation into the parent shell only for `verify-rollback`.

```bash
export FHV_T4_HOST_PROBE_JSON="$(scripts/ops/fhv-t4-host-probe.sh)"
scripts/ops/fhv-t4-service-user-exec.sh \
  --service-user "${FHV_SERVICE_USER}" \
  --environment-file "${FHV_ENVIRONMENT_FILE}" \
  --repo-root "${FHV_REPO_ROOT}" \
  -- trader:fhv:t4:verify-rollback \
  --run-root "${FHV_RUN_DIR}" \
  --run-id "${FHV_RUN_ID}" \
  --organization-id "${FHV_ORGANIZATION_ID}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}" \
  --repo-root "${FHV_REPO_ROOT}"
unset FHV_T4_HOST_PROBE_JSON
```

### Step 28 — Mandatory evidence inventory

```bash
scripts/ops/fhv-t4-service-user-exec.sh \
  --service-user "${FHV_SERVICE_USER}" \
  --environment-file "${FHV_ENVIRONMENT_FILE}" \
  --repo-root "${FHV_REPO_ROOT}" \
  -- trader:fhv:t4:build-evidence-inventory \
  --run-root "${FHV_RUN_DIR}" \
  --run-id "${FHV_RUN_ID}" \
  --organization-id "${FHV_ORGANIZATION_ID}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}" \
  --repo-root "${FHV_REPO_ROOT}" \
  --rendered-units-dir "${FHV_RENDERED_UNITS_DIR}" \
  --continuity-before "${FHV_CONTINUITY_BEFORE}" \
  --continuity-after "${FHV_CONTINUITY_AFTER}" \
  --host-probe-json-path "${FHV_HOST_PROBE_PATH}"
```

### Step 29 — Seal

```bash
scripts/ops/fhv-t4-service-user-exec.sh \
  --service-user "${FHV_SERVICE_USER}" \
  --environment-file "${FHV_ENVIRONMENT_FILE}" \
  --repo-root "${FHV_REPO_ROOT}" \
  -- trader:fhv:t4:seal-evidence \
  --run-root "${FHV_RUN_DIR}" \
  --run-id "${FHV_RUN_ID}" \
  --organization-id "${FHV_ORGANIZATION_ID}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}" \
  --release-tag "${FHV_RELEASE_TAG}" \
  --seal-destination "${FHV_SEAL_DESTINATION}" \
  --service-user "${FHV_SERVICE_USER}" \
  --rendered-units-dir "${FHV_RENDERED_UNITS_DIR}" \
  --continuity-before "${FHV_CONTINUITY_BEFORE}" \
  --continuity-after "${FHV_CONTINUITY_AFTER}" \
  --host-probe-json-path "${FHV_HOST_PROBE_PATH}"
```

### Step 30 — Seal verification

```bash
scripts/ops/fhv-t4-service-user-exec.sh \
  --service-user "${FHV_SERVICE_USER}" \
  --environment-file "${FHV_ENVIRONMENT_FILE}" \
  --repo-root "${FHV_REPO_ROOT}" \
  -- trader:fhv:t4:verify-seal \
  --run-root "${FHV_RUN_DIR}" \
  --run-id "${FHV_RUN_ID}" \
  --organization-id "${FHV_ORGANIZATION_ID}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}" \
  --release-tag "${FHV_RELEASE_TAG}" \
  --seal-destination "${FHV_SEAL_DESTINATION}" \
  --service-user "${FHV_SERVICE_USER}"
```

### Step 31 — Ceremony

```bash
scripts/ops/fhv-t4-service-user-exec.sh \
  --service-user "${FHV_SERVICE_USER}" \
  --environment-file "${FHV_ENVIRONMENT_FILE}" \
  --repo-root "${FHV_REPO_ROOT}" \
  -- trader:fhv:t4:verify-ceremony \
  --run-root "${FHV_RUN_DIR}" \
  --run-id "${FHV_RUN_ID}" \
  --organization-id "${FHV_ORGANIZATION_ID}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}" \
  --release-tag "${FHV_RELEASE_TAG}" \
  --repo-root "${FHV_REPO_ROOT}" \
  --rendered-units-dir "${FHV_RENDERED_UNITS_DIR}" \
  --installed-units-dir "${FHV_INSTALLED_UNITS_DIR}" \
  --service-user "${FHV_SERVICE_USER}" \
  --working-directory "${FHV_WORKING_DIRECTORY}" \
  --environment-file "${FHV_ENVIRONMENT_FILE}" \
  --operator-id "${FHV_OPERATOR_ID}" \
  --seal-destination "${FHV_SEAL_DESTINATION}" \
  --continuity-before "${FHV_CONTINUITY_BEFORE}" \
  --continuity-after "${FHV_CONTINUITY_AFTER}"
```

### Step 32 — Success classification

Ceremony stdout must include:

- `T4A_RESULT=PASS`
- `GATE8_RESULT=PASS`
- `T4B_RESULT=NOT_EXECUTED_SEPARATE_GATE`
- `PAUSE_RESULT=REHEARSAL_PAUSED_AT_CYCLE_40`
- `CONTINUITY_RESULT=PASS`

---

## Mutation classification

- No filesystem writes before `AUTHORIZE-FHV-OPS-DEPLOY`
- No secrets in argv or operator-shell exports
- No bare `pnpm`
- No unbounded waits
- No manually assigned PASS without immutable prerequisite proofs
- No required assertion followed by `|| true`
- Campaign deadline uses Linux `CLOCK_BOOTTIME` (not `Date.now()`)
