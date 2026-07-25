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

Do **not** place actual unknown server values in repository documentation. Bind every value on the Execution Server before running this packet.

```bash
export EXECUTION_SERVER_TARGET_SHA="<exact-main-release-sha-after-dee436>"
export FHV_RELEASE_TAG="<exact-release-tag>"
export FHV_RUN_ID="<human-approved-unique-run-id>"
export FHV_ORGANIZATION_ID="<org-uuid>"
export FHV_OPERATOR_ID="<human-operator-id>"
export FHV_SERVICE_USER="<non-root-service-user>"
export FHV_ENVIRONMENT_FILE="<absolute-path-to-environment-file>"
export FHV_ARTIFACT_ROOT="<service-user-artifact-root>"
export FHV_CHECKOUT_PARENT="<service-user-writable-checkout-parent>"
export FHV_EXPECTED_HOSTNAME="<execution-server-hostname>"
export FHV_EXPECTED_MACHINE_ID_SHA256="<sha256-of-/etc/machine-id>"
export FHV_NODE_BIN="<absolute-path-to-node>"
export FHV_COREPACK_BIN="<absolute-path-to-corepack>"
export FHV_GIT_BIN="<absolute-path-to-git>"
export FHV_PYTHON_BIN="<absolute-path-to-python3>"
export FHV_DOCKER_BIN="<absolute-path-to-docker>"
export FHV_EXPECTED_LEGACY_CONTAINER_NAME="<legacy-container-name>"
export FHV_EXPECTED_LEGACY_CONTAINER_IMAGE="<legacy-container-image>"
export FHV_ORIGIN_URL="https://github.com/oumaster369/waia.git"
export FHV_REPO_ROOT="${FHV_CHECKOUT_PARENT}/waia-${EXECUTION_SERVER_TARGET_SHA}"
export FHV_WORKING_DIRECTORY="${FHV_REPO_ROOT}"
export FHV_RUN_DIR="${FHV_ARTIFACT_ROOT}/RI-P7/fhv-ops-rehearsal/${FHV_RUN_ID}"
export FHV_RENDERED_UNITS_DIR="${FHV_REPO_ROOT}/.ops/rendered-units"
export FHV_INSTALLED_UNITS_DIR="/etc/systemd/system"
export FHV_SEAL_DESTINATION="${FHV_ARTIFACT_ROOT}/RI-P7/fhv-ops-rehearsal-seals/${FHV_RUN_ID}"
export FHV_CONTINUITY_BEFORE="${FHV_RUN_DIR}/control/fhv-t4-continuity-before.v1.json"
export FHV_CONTINUITY_AFTER="${FHV_RUN_DIR}/control/fhv-t4-continuity-after.v1.json"
export FHV_HOST_PROBE_PATH="${FHV_RUN_DIR}/control/fhv-t4-host-probe-proof.v1.json"
```

**Authorization is not issued by this packet.** A Human operator must issue **`AUTHORIZE-FHV-OPS-DEPLOY`** before any POST_AUTHORIZED step.

---

## Phase A — `PRE_AUTHORIZED_READ_ONLY_PHASE`

Read-only inspection only. **Zero filesystem mutation.** No target release checkout, no `node_modules`, no `tsx`, no `pnpm`, no manifest, render, install, deployment record, continuity, evidence, sealing, or systemd mutation.

After the DEE-436 release exists, the Human may copy `scripts/ops/fhv-t4-host-preflight.sh` from the release tree as a reviewed handoff artifact. Pre-authorization does **not** require that checkout to already exist on the server.

```bash
# A1 — exact approved origin (dependency-free)
scripts/ops/fhv-validate-origin-url.sh --origin-url "${FHV_ORIGIN_URL}"

# A2 — dependency-free host preflight (read-only stdout; no --output)
scripts/ops/fhv-t4-host-preflight.sh \
  --expected-hostname "${FHV_EXPECTED_HOSTNAME}" \
  --expected-machine-id-sha256 "${FHV_EXPECTED_MACHINE_ID_SHA256}" \
  --service-user "${FHV_SERVICE_USER}" \
  --environment-file "${FHV_ENVIRONMENT_FILE}" \
  --artifact-root "${FHV_ARTIFACT_ROOT}" \
  --checkout-parent "${FHV_CHECKOUT_PARENT}" \
  --node-bin "${FHV_NODE_BIN}" \
  --corepack-bin "${FHV_COREPACK_BIN}" \
  --git-bin "${FHV_GIT_BIN}" \
  --python-bin "${FHV_PYTHON_BIN}" \
  --docker-bin "${FHV_DOCKER_BIN}" \
  --expected-legacy-container-name "${FHV_EXPECTED_LEGACY_CONTAINER_NAME}" \
  --expected-legacy-container-image "${FHV_EXPECTED_LEGACY_CONTAINER_IMAGE}"

# A3 — host monotonic clock sample (read-only; CLOCK_BOOTTIME + boot_id)
scripts/ops/fhv-t4-host-monotonic-read.sh
```

### STOP — `AUTHORIZE-FHV-OPS-DEPLOY`

**Do not proceed** until a Human operator issues **`AUTHORIZE-FHV-OPS-DEPLOY`**.

Before this gate: no fresh checkout, no dependency installation, no `trader:fhv:rehearsal`, no `render-units.sh --output-dir`, no `install-units.sh`, no `fhv-systemd-record-deploy.sh`, no run-root writes, no `/tmp` staging.

---

## Phase B — `POST_AUTHORIZED_T4A_PHASE`

Only after **`AUTHORIZE-FHV-OPS-DEPLOY`**. Exact 32-step state machine. All run-root / evidence-writing package commands run as the service user via `scripts/ops/fhv-t4-service-user-exec.sh`.

Shared service-user wrapper pattern:

```bash
export FHV_COREPACK_BIN="${FHV_COREPACK_BIN}"
scripts/ops/fhv-t4-service-user-exec.sh \
  --service-user "${FHV_SERVICE_USER}" \
  --environment-file "${FHV_ENVIRONMENT_FILE}" \
  --repo-root "${FHV_REPO_ROOT}" \
  -- trader:fhv:t4:<subcommand> [args...]
```

### Step 1 — Authorization confirmed

Human confirms **`AUTHORIZE-FHV-OPS-DEPLOY`** is issued for this `FHV_RUN_ID` and `EXECUTION_SERVER_TARGET_SHA`.

### Step 2 — Strict origin validation

```bash
scripts/ops/fhv-validate-origin-url.sh --origin-url "${FHV_ORIGIN_URL}"
```

### Step 3 — Service-user fresh checkout

```bash
scripts/ops/fhv-service-user-checkout.sh \
  --service-user "${FHV_SERVICE_USER}" \
  --checkout-parent "${FHV_CHECKOUT_PARENT}" \
  --checkout-dir "waia-${EXECUTION_SERVER_TARGET_SHA}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}" \
  --release-tag "${FHV_RELEASE_TAG}" \
  --git-bin "${FHV_GIT_BIN}" \
  --origin-url "${FHV_ORIGIN_URL}"
cd "${FHV_REPO_ROOT}"
```

### Step 4 — Exact SHA / tag / origin verification (dependency-free)

```bash
scripts/ops/fhv-release-checkout-identity.sh \
  --repo-path "${FHV_REPO_ROOT}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}" \
  --release-tag "${FHV_RELEASE_TAG}"
scripts/ops/execution-server-preflight.sh \
  --repo-path "${FHV_REPO_ROOT}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}"
```

### Step 5 — Frozen dependency installation (service user; no EnvironmentFile)

```bash
scripts/ops/fhv-service-user-install-deps.sh \
  --service-user "${FHV_SERVICE_USER}" \
  --repo-root "${FHV_REPO_ROOT}" \
  --corepack-bin "${FHV_COREPACK_BIN}"
```

### Step 6 — Manifest materialization with exact artifact root

```bash
export REHEARSAL_JSON="$(
  scripts/ops/fhv-t4-service-user-exec.sh \
    --service-user "${FHV_SERVICE_USER}" \
    --environment-file "${FHV_ENVIRONMENT_FILE}" \
    --repo-root "${FHV_REPO_ROOT}" \
    -- trader:fhv:rehearsal \
    --target-sha "${EXECUTION_SERVER_TARGET_SHA}" \
    --run-id "${FHV_RUN_ID}" \
    --organization-id "${FHV_ORGANIZATION_ID}" \
    --artifact-root "${FHV_ARTIFACT_ROOT}" \
    --t4-deterministic-pause \
    --fixture HTR_WP03_BENCHMARK
)"
ACTUAL_RUN_DIR="$(printf '%s' "${REHEARSAL_JSON}" | "${FHV_PYTHON_BIN}" -c 'import json,sys; print(json.load(sys.stdin)["runDir"])')"
ACTUAL_MANIFEST_PATH="$(printf '%s' "${REHEARSAL_JSON}" | "${FHV_PYTHON_BIN}" -c 'import json,sys; print(json.load(sys.stdin)["manifestPath"])')"
test "${ACTUAL_RUN_DIR}" = "${FHV_RUN_DIR}"
test "${ACTUAL_MANIFEST_PATH}" = "${FHV_RUN_DIR}/fhv-rehearsal-manifest.v1.json"
```

### Step 7 — Immutable checkout identity proof

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

### Step 8 — Unit render

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

### Step 9 — Install preview (no mutation)

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

### Step 10 — Install

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

### Step 11 — Deployment record

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

### Step 12 — Observed host probe ingest (stdin transport; no root-owned raw file)

```bash
export FHV_T4_HOST_PROBE_JSON="$(scripts/ops/fhv-t4-host-probe.sh)"
scripts/ops/fhv-t4-service-user-exec.sh \
  --service-user "${FHV_SERVICE_USER}" \
  --environment-file "${FHV_ENVIRONMENT_FILE}" \
  --repo-root "${FHV_REPO_ROOT}" \
  -- trader:fhv:t4:ingest-host-probe \
  --run-root "${FHV_RUN_DIR}" \
  --run-id "${FHV_RUN_ID}" \
  --organization-id "${FHV_ORGANIZATION_ID}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}" \
  --host-probe-json-path "${FHV_HOST_PROBE_PATH}"
unset FHV_T4_HOST_PROBE_JSON
```

### Step 13 — Deployment proof

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

### Step 14 — Observer start

```bash
systemctl start waia-fhv-observer.service
```

### Step 15 — Bounded observer active wait + identity + health

```bash
scripts/ops/fhv-t4-observer-wait-active.sh waia-fhv-observer.service 60000
export FHV_T4_OBSERVER_SYSTEMD_IDENTITY_JSON="$(
  scripts/ops/fhv-t4-observer-systemd-identity-read.sh waia-fhv-observer.service
)"
scripts/ops/fhv-t4-service-user-exec.sh \
  --service-user "${FHV_SERVICE_USER}" \
  --environment-file "${FHV_ENVIRONMENT_FILE}" \
  --repo-root "${FHV_REPO_ROOT}" \
  -- trader:fhv:t4:status \
  --run-root "${FHV_RUN_DIR}" \
  --run-id "${FHV_RUN_ID}" \
  --organization-id "${FHV_ORGANIZATION_ID}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}"
unset FHV_T4_OBSERVER_SYSTEMD_IDENTITY_JSON
```

### Step 16 — Signed PAUSE pre-arm

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

Expected arm result: `executed`.

### Step 17 — Pre-arm verification (campaign start impossible before this passes)

```bash
scripts/ops/fhv-t4-service-user-exec.sh \
  --service-user "${FHV_SERVICE_USER}" \
  --environment-file "${FHV_ENVIRONMENT_FILE}" \
  --repo-root "${FHV_REPO_ROOT}" \
  -- trader:fhv:t4:verify \
  --run-root "${FHV_RUN_DIR}" \
  --run-id "${FHV_RUN_ID}" \
  --organization-id "${FHV_ORGANIZATION_ID}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}"
```

### Step 18 — Campaign start

```bash
systemctl start waia-fhv-campaign.service
```

### Step 19 — Bounded wait for pause

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

### Step 20 — Paused proof

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

### Step 21 — Signed RESUME

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

### Step 22 — Bounded wait for final

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

### Step 23 — Final proof

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

### Step 24 — Completed campaign systemd identity capture

After `REHEARSAL_OK`, the campaign unit is expected to be inactive/success. Capture completed identity, not active observer identity.

```bash
scripts/ops/fhv-t4-campaign-systemd-identity-read.sh waia-fhv-campaign.service
```

### Step 25 — Continuity-before (observer active + completed campaign)

```bash
export FHV_T4_OBSERVER_SYSTEMD_IDENTITY_JSON="$(
  scripts/ops/fhv-t4-observer-systemd-identity-read.sh waia-fhv-observer.service
)"
export FHV_T4_CAMPAIGN_SYSTEMD_IDENTITY_JSON="$(
  scripts/ops/fhv-t4-campaign-systemd-identity-read.sh waia-fhv-campaign.service
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

### Step 26 — Human disconnect/reconnect narrative event

Operator narrative only. Do not restart campaign. Do not mutate run-root evidence.
Narrative events are **not** machine proof and must not be hardcoded as CLI prerequisites.

### Step 27 — Observer-only restart

```bash
systemctl restart waia-fhv-observer.service
```

Do **not** restart `waia-fhv-campaign.service`.

### Step 28 — Continuity-after (observer active + completed campaign unchanged)

```bash
export FHV_T4_OBSERVER_SYSTEMD_IDENTITY_JSON="$(
  scripts/ops/fhv-t4-observer-systemd-identity-read.sh waia-fhv-observer.service
)"
export FHV_T4_CAMPAIGN_SYSTEMD_IDENTITY_JSON="$(
  scripts/ops/fhv-t4-campaign-systemd-identity-read.sh waia-fhv-campaign.service
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

### Step 29 — Continuity verification proof

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

### Step 30 — Rollback preview

```bash
scripts/ops/fhv-supervisor/rollback-units.sh --systemd-dir "${FHV_INSTALLED_UNITS_DIR}"
```

### Step 31 — Rollback

```bash
scripts/ops/fhv-supervisor/rollback-units.sh \
  --systemd-dir "${FHV_INSTALLED_UNITS_DIR}" \
  --confirm
```

### Step 32 — Rollback proof, inventory, seal, ceremony

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
- T4A campaign deadline uses Linux `CLOCK_BOOTTIME` host-monotonic proof (not `Date.now()` verdict)
- Completed campaign continuity uses inactive/success systemd identity (not active MainPID > 0)
