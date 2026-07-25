# T4 Operator Packet V5 — Human-executable FHV T4A (Model C)

**Architecture decision:** `AUTHORIZE-T4A-T4B-CONTRACT-SPLIT` · model **C** · `gate8_satisfied_by=T4A_ONLY`

**Scope:** Execution Server host runtime rehearsal (T4A) only.
**Out of scope:** T4B Worker dashboard + authenticated tunnel (`DEE-437`, Backlog).

**Execution status:** T4A **NOT EXECUTED** — this packet is the Human-executable procedure only. No live rehearsal PASS is implied by publication of DEE-436 repository closure.

Ceremony success classifications (no ambiguous aggregate PASS):

- `T4A_RESULT=PASS`
- `GATE8_RESULT=PASS`
- `T4B_RESULT=NOT_EXECUTED_SEPARATE_GATE`

Do **not** use `T4_RESULT=PASS`, `T4_AGGREGATE_RESULT=PASS`, or `DASHBOARD_RESULT=PASS`.

Use **`corepack pnpm@10`** only (never bare `pnpm`).

---

## Locus legend

| Label | Meaning |
|-------|---------|
| **WORKSTATION** | Human operator shell on the local machine holding `FHV_LOCAL_RELEASE_ROOT` |
| **SSH_STDIN** | Script bytes streamed over SSH stdin (`bash -s` / `sudo bash -s`); **zero remote script staging writes** |
| **REMOTE_ROOT** | Effective UID 0 on the Execution Server (`sudo` / root SSH session) |
| **SERVICE_USER** | Non-root FHV service user via `runuser` inside `${FHV_REPO_ROOT}/scripts/ops/fhv-t4-service-user-exec.sh` |

**Privilege model (POST only):** `REMOTE_ROOT` for systemd, Docker inspection, unit install/rollback, and bootstrap wrappers. `SERVICE_USER` for run-root evidence, package CLIs, and artifact writes. Bootstrap wrappers (`fhv-service-user-checkout.sh`, `fhv-service-user-install-deps.sh`) are `REMOTE_ROOT` callers that delegate mutation to `runuser`.

---

## Declared Human bindings

Set these on the **WORKSTATION** before Phase A. Secrets (`FHV_OPERATOR_COMMAND_SECRET`, `FHV_OBSERVER_TUNNEL_SECRET`) live in `${FHV_ENVIRONMENT_FILE}` on the Execution Server only — never in argv, never exported by the operator shell.

Do **not** place actual unknown server values in repository documentation. Bind every remote path and identity on the Execution Server before running this packet.

```bash
# --- Workstation transport ---
export EXEC_HOST="<execution-server-hostname-or-ip>"
export SSH_USER="<ssh-login-for-sudo-capable-operator>"

# --- Local release handoff (WORKSTATION only) ---
# Clean checkout of the exact released main SHA + tag (reviewed before T4A).
export FHV_LOCAL_RELEASE_ROOT="<absolute-path-to-local-waia-release-checkout>"
export EXECUTION_SERVER_TARGET_SHA="<exact-main-release-sha-after-dee436>"
export FHV_RELEASE_TAG="<exact-release-tag>"

# --- Run identity ---
export FHV_RUN_ID="<human-approved-unique-run-id>"
export FHV_ORGANIZATION_ID="<org-uuid>"
export FHV_OPERATOR_ID="<human-operator-id>"

# --- Execution Server runtime bindings (remote paths; echoed in SSH sessions) ---
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

# --- Derived (remote checkout created during POST bootstrap) ---
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

### WORKSTATION — verify local release handoff checkout

**Locus:** WORKSTATION

Before Phase A, prove `${FHV_LOCAL_RELEASE_ROOT}` is the reviewed release tree (not the Execution Server service-user checkout):

```bash
test -d "${FHV_LOCAL_RELEASE_ROOT}/scripts/ops"
test "$(git -C "${FHV_LOCAL_RELEASE_ROOT}" rev-parse HEAD)" = "${EXECUTION_SERVER_TARGET_SHA}"
test "$(git -C "${FHV_LOCAL_RELEASE_ROOT}" describe --tags --exact-match HEAD)" = "${FHV_RELEASE_TAG}"
test "$(git -C "${FHV_LOCAL_RELEASE_ROOT}" remote get-url origin)" = "${FHV_ORIGIN_URL}"
```

**Authorization is not issued by this packet.** A Human operator must issue **`AUTHORIZE-FHV-OPS-DEPLOY`** before any POST_AUTHORIZED step.

---

## Phase A — `PRE_AUTHORIZED_READ_ONLY_PHASE`

Read-only inspection only. **Zero filesystem mutation on the Execution Server.** No target release checkout, no `node_modules`, no `tsx`, no `pnpm`, no manifest, render, install, deployment record, continuity, evidence, sealing, or systemd mutation.

Scripts are streamed from `${FHV_LOCAL_RELEASE_ROOT}` over SSH stdin. Do **not** copy scripts to `/tmp` or any other remote path.

### A1 — exact approved origin (dependency-free)

**Locus:** WORKSTATION → SSH_STDIN

```bash
ssh "${SSH_USER}@${EXEC_HOST}" 'bash -s' -- \
  --origin-url "${FHV_ORIGIN_URL}" \
  < "${FHV_LOCAL_RELEASE_ROOT}/scripts/ops/fhv-validate-origin-url.sh"
```

### A2 — dependency-free host preflight (read-only stdout; includes CLOCK_BOOTTIME)

**Locus:** WORKSTATION → SSH_STDIN → REMOTE_ROOT

Preflight stdout JSON includes `hostMonotonicSample` with `clockSource=CLOCK_BOOTTIME`, `bootId`, and `monotonicNs`. There is **no** separate `fhv-t4-host-monotonic-read.sh` step.

```bash
ssh "${SSH_USER}@${EXEC_HOST}" 'sudo bash -s' -- \
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
  --expected-legacy-container-image "${FHV_EXPECTED_LEGACY_CONTAINER_IMAGE}" \
  < "${FHV_LOCAL_RELEASE_ROOT}/scripts/ops/fhv-t4-host-preflight.sh"
```

### STOP — `AUTHORIZE-FHV-OPS-DEPLOY`

**Do not proceed** until a Human operator issues **`AUTHORIZE-FHV-OPS-DEPLOY`**.

Before this gate: no fresh checkout, no dependency installation, no `trader:fhv:rehearsal`, no `render-units.sh --output-dir`, no `install-units.sh`, no `fhv-systemd-record-deploy.sh`, no run-root writes, no `/tmp` staging, no remote script drops.

---

## Phase B — `POST_AUTHORIZED_T4A_PHASE`

Only after **`AUTHORIZE-FHV-OPS-DEPLOY`**. Exact **32-step** state machine.

**Bootstrap rule:** Steps 1–5 stream bootstrap scripts from `${FHV_LOCAL_RELEASE_ROOT}` via SSH stdin. After checkout identity is verified (Step 4), **every** subsequent ops script path is `${FHV_REPO_ROOT}/scripts/ops/...` on the Execution Server.

Shared **SERVICE_USER** wrapper pattern (used from **REMOTE_ROOT** after Step 5):

```bash
"${FHV_REPO_ROOT}/scripts/ops/fhv-t4-service-user-exec.sh" \
  --service-user "${FHV_SERVICE_USER}" \
  --environment-file "${FHV_ENVIRONMENT_FILE}" \
  --repo-root "${FHV_REPO_ROOT}" \
  -- trader:fhv:t4:<subcommand> [args...]
```

### Step 1 — Authorization confirmed + effective root

**Locus:** WORKSTATION → REMOTE_ROOT

Human confirms **`AUTHORIZE-FHV-OPS-DEPLOY`** is issued for this `FHV_RUN_ID` and `EXECUTION_SERVER_TARGET_SHA`.

```bash
ssh "${SSH_USER}@${EXEC_HOST}" 'sudo bash -s' <<'EOF'
test "$(id -u)" -eq 0
EOF
```

### Step 2 — Strict origin validation (bootstrap stream)

**Locus:** WORKSTATION → SSH_STDIN

```bash
ssh "${SSH_USER}@${EXEC_HOST}" 'bash -s' -- \
  --origin-url "${FHV_ORIGIN_URL}" \
  < "${FHV_LOCAL_RELEASE_ROOT}/scripts/ops/fhv-validate-origin-url.sh"
```

### Step 3 — Service-user fresh checkout (bootstrap stream)

**Locus:** WORKSTATION → SSH_STDIN → REMOTE_ROOT → SERVICE_USER

```bash
ssh "${SSH_USER}@${EXEC_HOST}" 'sudo bash -s' -- \
  --service-user "${FHV_SERVICE_USER}" \
  --checkout-parent "${FHV_CHECKOUT_PARENT}" \
  --checkout-dir "waia-${EXECUTION_SERVER_TARGET_SHA}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}" \
  --release-tag "${FHV_RELEASE_TAG}" \
  --git-bin "${FHV_GIT_BIN}" \
  --python-bin "${FHV_PYTHON_BIN}" \
  --origin-url "${FHV_ORIGIN_URL}" \
  < "${FHV_LOCAL_RELEASE_ROOT}/scripts/ops/fhv-service-user-checkout.sh"
```

### Step 4 — Exact SHA / tag / origin verification (dependency-free)

**Locus:** WORKSTATION → REMOTE_ROOT

```bash
ssh "${SSH_USER}@${EXEC_HOST}" "sudo bash -s" <<EOF
test "\$(id -u)" -eq 0
"${FHV_REPO_ROOT}/scripts/ops/fhv-release-checkout-identity.sh" \
  --repo-path "${FHV_REPO_ROOT}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}" \
  --release-tag "${FHV_RELEASE_TAG}"
"${FHV_REPO_ROOT}/scripts/ops/execution-server-preflight.sh" \
  --repo-path "${FHV_REPO_ROOT}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}"
EOF
```

### Step 5 — Frozen dependency installation (bootstrap stream)

**Locus:** WORKSTATION → SSH_STDIN → REMOTE_ROOT → SERVICE_USER

```bash
ssh "${SSH_USER}@${EXEC_HOST}" 'sudo bash -s' -- \
  --service-user "${FHV_SERVICE_USER}" \
  --repo-root "${FHV_REPO_ROOT}" \
  --corepack-bin "${FHV_COREPACK_BIN}" \
  --git-bin "${FHV_GIT_BIN}" \
  --python-bin "${FHV_PYTHON_BIN}" \
  < "${FHV_LOCAL_RELEASE_ROOT}/scripts/ops/fhv-service-user-install-deps.sh"
```

### Step 6 — Manifest materialization with exact artifact root

**Locus:** WORKSTATION → REMOTE_ROOT → SERVICE_USER

```bash
ssh "${SSH_USER}@${EXEC_HOST}" "sudo bash -s" <<EOF
test "\$(id -u)" -eq 0
export REHEARSAL_JSON="\$(
  "${FHV_REPO_ROOT}/scripts/ops/fhv-t4-service-user-exec.sh" \
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
ACTUAL_RUN_DIR="\$(printf '%s' "\${REHEARSAL_JSON}" | "${FHV_PYTHON_BIN}" -c 'import json,sys; print(json.load(sys.stdin)["runDir"])')"
ACTUAL_MANIFEST_PATH="\$(printf '%s' "\${REHEARSAL_JSON}" | "${FHV_PYTHON_BIN}" -c 'import json,sys; print(json.load(sys.stdin)["manifestPath"])')"
test "\${ACTUAL_RUN_DIR}" = "${FHV_RUN_DIR}"
test "\${ACTUAL_MANIFEST_PATH}" = "${FHV_RUN_DIR}/fhv-rehearsal-manifest.v1.json"
EOF
```

### Step 7 — Immutable checkout identity proof

**Locus:** WORKSTATION → REMOTE_ROOT → SERVICE_USER

```bash
ssh "${SSH_USER}@${EXEC_HOST}" "sudo bash -s" <<EOF
test "\$(id -u)" -eq 0
"${FHV_REPO_ROOT}/scripts/ops/fhv-t4-service-user-exec.sh" \
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
EOF
```

### Step 8 — Unit render

**Locus:** WORKSTATION → REMOTE_ROOT

```bash
ssh "${SSH_USER}@${EXEC_HOST}" "sudo bash -s" <<EOF
test "\$(id -u)" -eq 0
"${FHV_REPO_ROOT}/scripts/ops/fhv-supervisor/render-units.sh" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}" \
  --working-directory "${FHV_WORKING_DIRECTORY}" \
  --service-user "${FHV_SERVICE_USER}" \
  --environment-file "${FHV_ENVIRONMENT_FILE}" \
  --fhv-run-root "${FHV_RUN_DIR}" \
  --fhv-run-id "${FHV_RUN_ID}" \
  --fhv-organization-id "${FHV_ORGANIZATION_ID}" \
  --repo-path "${FHV_REPO_ROOT}" \
  --output-dir "${FHV_RENDERED_UNITS_DIR}" \
  --node-bin "${FHV_NODE_BIN}"
EOF
```

### Step 9 — Install preview (no mutation)

**Locus:** WORKSTATION → REMOTE_ROOT

```bash
ssh "${SSH_USER}@${EXEC_HOST}" "sudo bash -s" <<EOF
test "\$(id -u)" -eq 0
"${FHV_REPO_ROOT}/scripts/ops/fhv-supervisor/install-units.sh" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}" \
  --working-directory "${FHV_WORKING_DIRECTORY}" \
  --service-user "${FHV_SERVICE_USER}" \
  --environment-file "${FHV_ENVIRONMENT_FILE}" \
  --fhv-run-root "${FHV_RUN_DIR}" \
  --fhv-run-id "${FHV_RUN_ID}" \
  --fhv-organization-id "${FHV_ORGANIZATION_ID}" \
  --repo-path "${FHV_REPO_ROOT}" \
  --systemd-dir "${FHV_INSTALLED_UNITS_DIR}" \
  --node-bin "${FHV_NODE_BIN}"
EOF
```

### Step 10 — Install

**Locus:** WORKSTATION → REMOTE_ROOT

```bash
ssh "${SSH_USER}@${EXEC_HOST}" "sudo bash -s" <<EOF
test "\$(id -u)" -eq 0
"${FHV_REPO_ROOT}/scripts/ops/fhv-supervisor/install-units.sh" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}" \
  --working-directory "${FHV_WORKING_DIRECTORY}" \
  --service-user "${FHV_SERVICE_USER}" \
  --environment-file "${FHV_ENVIRONMENT_FILE}" \
  --fhv-run-root "${FHV_RUN_DIR}" \
  --fhv-run-id "${FHV_RUN_ID}" \
  --fhv-organization-id "${FHV_ORGANIZATION_ID}" \
  --repo-path "${FHV_REPO_ROOT}" \
  --systemd-dir "${FHV_INSTALLED_UNITS_DIR}" \
  --node-bin "${FHV_NODE_BIN}" \
  --confirm
EOF
```

### Step 11 — Deployment record

**Locus:** WORKSTATION → REMOTE_ROOT

```bash
ssh "${SSH_USER}@${EXEC_HOST}" "sudo bash -s" <<EOF
test "\$(id -u)" -eq 0
export FHV_RENDERED_UNIT_DIGESTS="\$(
  "${FHV_REPO_ROOT}/scripts/ops/fhv-t4-rendered-unit-digests.sh" --rendered-dir "${FHV_RENDERED_UNITS_DIR}"
)"
"${FHV_REPO_ROOT}/scripts/ops/fhv-systemd-record-deploy.sh" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}" \
  --release-tag "${FHV_RELEASE_TAG}" \
  --run-id "${FHV_RUN_ID}" \
  --organization-id "${FHV_ORGANIZATION_ID}" \
  --operator "${FHV_OPERATOR_ID}" \
  --service-user "${FHV_SERVICE_USER}" \
  --rendered-unit-digests "\${FHV_RENDERED_UNIT_DIGESTS}" \
  --repo-path "${FHV_REPO_ROOT}" \
  --confirm
EOF
```

### Step 12 — Observed host probe ingest (stdin transport; no root-owned raw file)

**Locus:** WORKSTATION → REMOTE_ROOT → SERVICE_USER

```bash
ssh "${SSH_USER}@${EXEC_HOST}" "sudo bash -s" <<EOF
test "\$(id -u)" -eq 0
export FHV_T4_HOST_PROBE_JSON="\$("${FHV_REPO_ROOT}/scripts/ops/fhv-t4-host-probe.sh")"
"${FHV_REPO_ROOT}/scripts/ops/fhv-t4-service-user-exec.sh" \
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
EOF
```

### Step 13 — Deployment proof

**Locus:** WORKSTATION → REMOTE_ROOT → SERVICE_USER

```bash
ssh "${SSH_USER}@${EXEC_HOST}" "sudo bash -s" <<EOF
test "\$(id -u)" -eq 0
"${FHV_REPO_ROOT}/scripts/ops/fhv-systemd-verify-deploy.sh" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}" \
  --repo-path "${FHV_REPO_ROOT}"
"${FHV_REPO_ROOT}/scripts/ops/fhv-t4-service-user-exec.sh" \
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
EOF
```

### Step 14 — Observer start

**Locus:** WORKSTATION → REMOTE_ROOT

```bash
ssh "${SSH_USER}@${EXEC_HOST}" "sudo bash -s" <<EOF
test "\$(id -u)" -eq 0
systemctl start waia-fhv-observer.service
EOF
```

### Step 15 — Bounded observer active wait + identity + health

**Locus:** WORKSTATION → REMOTE_ROOT → SERVICE_USER

```bash
ssh "${SSH_USER}@${EXEC_HOST}" "sudo bash -s" <<EOF
test "\$(id -u)" -eq 0
"${FHV_REPO_ROOT}/scripts/ops/fhv-t4-observer-wait-active.sh" waia-fhv-observer.service 60000
export FHV_T4_OBSERVER_SYSTEMD_IDENTITY_JSON="\$(
  "${FHV_REPO_ROOT}/scripts/ops/fhv-t4-observer-systemd-identity-read.sh" waia-fhv-observer.service
)"
"${FHV_REPO_ROOT}/scripts/ops/fhv-t4-service-user-exec.sh" \
  --service-user "${FHV_SERVICE_USER}" \
  --environment-file "${FHV_ENVIRONMENT_FILE}" \
  --repo-root "${FHV_REPO_ROOT}" \
  -- trader:fhv:t4:status \
  --run-root "${FHV_RUN_DIR}" \
  --run-id "${FHV_RUN_ID}" \
  --organization-id "${FHV_ORGANIZATION_ID}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}"
unset FHV_T4_OBSERVER_SYSTEMD_IDENTITY_JSON
EOF
```

### Step 16 — Signed PAUSE pre-arm

**Locus:** WORKSTATION → REMOTE_ROOT → SERVICE_USER

```bash
ssh "${SSH_USER}@${EXEC_HOST}" "sudo bash -s" <<EOF
test "\$(id -u)" -eq 0
"${FHV_REPO_ROOT}/scripts/ops/fhv-t4-service-user-exec.sh" \
  --service-user "${FHV_SERVICE_USER}" \
  --environment-file "${FHV_ENVIRONMENT_FILE}" \
  --repo-root "${FHV_REPO_ROOT}" \
  -- trader:fhv:t4:arm-pause \
  --run-root "${FHV_RUN_DIR}" \
  --run-id "${FHV_RUN_ID}" \
  --organization-id "${FHV_ORGANIZATION_ID}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}"
EOF
```

Expected arm result: `executed`.

### Step 17 — Pre-arm verification (campaign start impossible before this passes)

**Locus:** WORKSTATION → REMOTE_ROOT → SERVICE_USER

```bash
ssh "${SSH_USER}@${EXEC_HOST}" "sudo bash -s" <<EOF
test "\$(id -u)" -eq 0
"${FHV_REPO_ROOT}/scripts/ops/fhv-t4-service-user-exec.sh" \
  --service-user "${FHV_SERVICE_USER}" \
  --environment-file "${FHV_ENVIRONMENT_FILE}" \
  --repo-root "${FHV_REPO_ROOT}" \
  -- trader:fhv:t4:verify \
  --run-root "${FHV_RUN_DIR}" \
  --run-id "${FHV_RUN_ID}" \
  --organization-id "${FHV_ORGANIZATION_ID}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}"
EOF
```

### Step 18 — Campaign start

**Locus:** WORKSTATION → REMOTE_ROOT

```bash
ssh "${SSH_USER}@${EXEC_HOST}" "sudo bash -s" <<EOF
test "\$(id -u)" -eq 0
systemctl start waia-fhv-campaign.service
EOF
```

### Step 19 — Bounded wait for pause

**Locus:** WORKSTATION → REMOTE_ROOT → SERVICE_USER

```bash
ssh "${SSH_USER}@${EXEC_HOST}" "sudo bash -s" <<EOF
test "\$(id -u)" -eq 0
"${FHV_REPO_ROOT}/scripts/ops/fhv-t4-service-user-exec.sh" \
  --service-user "${FHV_SERVICE_USER}" \
  --environment-file "${FHV_ENVIRONMENT_FILE}" \
  --repo-root "${FHV_REPO_ROOT}" \
  -- trader:fhv:t4:wait-paused \
  --run-root "${FHV_RUN_DIR}" \
  --run-id "${FHV_RUN_ID}" \
  --organization-id "${FHV_ORGANIZATION_ID}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}" \
  --timeout-ms 300000
EOF
```

### Step 20 — Paused proof

**Locus:** WORKSTATION → REMOTE_ROOT → SERVICE_USER

```bash
ssh "${SSH_USER}@${EXEC_HOST}" "sudo bash -s" <<EOF
test "\$(id -u)" -eq 0
"${FHV_REPO_ROOT}/scripts/ops/fhv-t4-service-user-exec.sh" \
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
EOF
```

Expected: `classification=FHV_T4_PAUSED_VERIFICATION_PASS` and immutable paused proof written.

### Step 21 — Signed RESUME

**Locus:** WORKSTATION → REMOTE_ROOT → SERVICE_USER

```bash
ssh "${SSH_USER}@${EXEC_HOST}" "sudo bash -s" <<EOF
test "\$(id -u)" -eq 0
"${FHV_REPO_ROOT}/scripts/ops/fhv-t4-service-user-exec.sh" \
  --service-user "${FHV_SERVICE_USER}" \
  --environment-file "${FHV_ENVIRONMENT_FILE}" \
  --repo-root "${FHV_REPO_ROOT}" \
  -- trader:fhv:t4:resume \
  --run-root "${FHV_RUN_DIR}" \
  --run-id "${FHV_RUN_ID}" \
  --organization-id "${FHV_ORGANIZATION_ID}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}"
EOF
```

### Step 22 — Bounded wait for final

**Locus:** WORKSTATION → REMOTE_ROOT → SERVICE_USER

```bash
ssh "${SSH_USER}@${EXEC_HOST}" "sudo bash -s" <<EOF
test "\$(id -u)" -eq 0
"${FHV_REPO_ROOT}/scripts/ops/fhv-t4-service-user-exec.sh" \
  --service-user "${FHV_SERVICE_USER}" \
  --environment-file "${FHV_ENVIRONMENT_FILE}" \
  --repo-root "${FHV_REPO_ROOT}" \
  -- trader:fhv:t4:wait-final \
  --run-root "${FHV_RUN_DIR}" \
  --run-id "${FHV_RUN_ID}" \
  --organization-id "${FHV_ORGANIZATION_ID}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}" \
  --timeout-ms 300000
EOF
```

### Step 23 — Final proof

**Locus:** WORKSTATION → REMOTE_ROOT → SERVICE_USER

```bash
ssh "${SSH_USER}@${EXEC_HOST}" "sudo bash -s" <<EOF
test "\$(id -u)" -eq 0
"${FHV_REPO_ROOT}/scripts/ops/fhv-t4-service-user-exec.sh" \
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
EOF
```

### Step 24 — Bounded wait for completed campaign unit

**Locus:** WORKSTATION → REMOTE_ROOT

After `REHEARSAL_OK`, wait until the campaign unit is inactive/success with terminal proof present. Do **not** capture systemd identity before this wait completes.

```bash
ssh "${SSH_USER}@${EXEC_HOST}" "sudo bash -s" <<EOF
test "\$(id -u)" -eq 0
"${FHV_REPO_ROOT}/scripts/ops/fhv-t4-campaign-wait-completed.sh" \
  waia-fhv-campaign.service 120000 "${FHV_RUN_DIR}" REHEARSAL_OK
EOF
```

### Step 25 — Completed campaign systemd identity capture

**Locus:** WORKSTATION → REMOTE_ROOT

Capture completed identity (inactive/success), not active observer identity.

```bash
ssh "${SSH_USER}@${EXEC_HOST}" "sudo bash -s" <<EOF
test "\$(id -u)" -eq 0
"${FHV_REPO_ROOT}/scripts/ops/fhv-t4-campaign-systemd-identity-read.sh" waia-fhv-campaign.service
EOF
```

### Step 26 — Continuity-before (observer active + completed campaign)

**Locus:** WORKSTATION → REMOTE_ROOT → SERVICE_USER

```bash
ssh "${SSH_USER}@${EXEC_HOST}" "sudo bash -s" <<EOF
test "\$(id -u)" -eq 0
export FHV_T4_OBSERVER_SYSTEMD_IDENTITY_JSON="\$(
  "${FHV_REPO_ROOT}/scripts/ops/fhv-t4-observer-systemd-identity-read.sh" waia-fhv-observer.service
)"
export FHV_T4_CAMPAIGN_SYSTEMD_IDENTITY_JSON="\$(
  "${FHV_REPO_ROOT}/scripts/ops/fhv-t4-campaign-systemd-identity-read.sh" waia-fhv-campaign.service
)"
"${FHV_REPO_ROOT}/scripts/ops/fhv-t4-service-user-exec.sh" \
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
EOF
```

### Step 27 — Human disconnect/reconnect narrative event

**Locus:** WORKSTATION (narrative only)

Operator narrative only. Do not restart campaign. Do not mutate run-root evidence.
Narrative events are **not** machine proof and must not be hardcoded as CLI prerequisites.

### Step 28 — Observer-only restart

**Locus:** WORKSTATION → REMOTE_ROOT

```bash
ssh "${SSH_USER}@${EXEC_HOST}" "sudo bash -s" <<EOF
test "\$(id -u)" -eq 0
systemctl restart waia-fhv-observer.service
EOF
```

Do **not** restart `waia-fhv-campaign.service`.

### Step 29 — Observer active wait + identity + health (post-restart)

**Locus:** WORKSTATION → REMOTE_ROOT → SERVICE_USER

```bash
ssh "${SSH_USER}@${EXEC_HOST}" "sudo bash -s" <<EOF
test "\$(id -u)" -eq 0
"${FHV_REPO_ROOT}/scripts/ops/fhv-t4-observer-wait-active.sh" waia-fhv-observer.service 60000
export FHV_T4_OBSERVER_SYSTEMD_IDENTITY_JSON="\$(
  "${FHV_REPO_ROOT}/scripts/ops/fhv-t4-observer-systemd-identity-read.sh" waia-fhv-observer.service
)"
"${FHV_REPO_ROOT}/scripts/ops/fhv-t4-service-user-exec.sh" \
  --service-user "${FHV_SERVICE_USER}" \
  --environment-file "${FHV_ENVIRONMENT_FILE}" \
  --repo-root "${FHV_REPO_ROOT}" \
  -- trader:fhv:t4:status \
  --run-root "${FHV_RUN_DIR}" \
  --run-id "${FHV_RUN_ID}" \
  --organization-id "${FHV_ORGANIZATION_ID}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}"
unset FHV_T4_OBSERVER_SYSTEMD_IDENTITY_JSON
EOF
```

### Step 30 — Continuity-after (observer active + completed campaign unchanged)

**Locus:** WORKSTATION → REMOTE_ROOT → SERVICE_USER

```bash
ssh "${SSH_USER}@${EXEC_HOST}" "sudo bash -s" <<EOF
test "\$(id -u)" -eq 0
export FHV_T4_OBSERVER_SYSTEMD_IDENTITY_JSON="\$(
  "${FHV_REPO_ROOT}/scripts/ops/fhv-t4-observer-systemd-identity-read.sh" waia-fhv-observer.service
)"
export FHV_T4_CAMPAIGN_SYSTEMD_IDENTITY_JSON="\$(
  "${FHV_REPO_ROOT}/scripts/ops/fhv-t4-campaign-systemd-identity-read.sh" waia-fhv-campaign.service
)"
"${FHV_REPO_ROOT}/scripts/ops/fhv-t4-service-user-exec.sh" \
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
EOF
```

### Step 31 — Continuity verification proof

**Locus:** WORKSTATION → REMOTE_ROOT → SERVICE_USER

```bash
ssh "${SSH_USER}@${EXEC_HOST}" "sudo bash -s" <<EOF
test "\$(id -u)" -eq 0
"${FHV_REPO_ROOT}/scripts/ops/fhv-t4-service-user-exec.sh" \
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
EOF
```

Expected: `classification=FHV_T4_CONTINUITY_VERIFICATION_PASS` and immutable continuity-verification proof written.

### Step 32 — Rollback preview, rollback, proof, inventory, seal, ceremony

**Locus:** WORKSTATION → REMOTE_ROOT → SERVICE_USER

```bash
ssh "${SSH_USER}@${EXEC_HOST}" "sudo bash -s" <<EOF
test "\$(id -u)" -eq 0
"${FHV_REPO_ROOT}/scripts/ops/fhv-supervisor/rollback-units.sh" --systemd-dir "${FHV_INSTALLED_UNITS_DIR}"
"${FHV_REPO_ROOT}/scripts/ops/fhv-supervisor/rollback-units.sh" \
  --systemd-dir "${FHV_INSTALLED_UNITS_DIR}" \
  --confirm

export FHV_T4_HOST_PROBE_JSON="\$("${FHV_REPO_ROOT}/scripts/ops/fhv-t4-host-probe.sh")"
"${FHV_REPO_ROOT}/scripts/ops/fhv-t4-service-user-exec.sh" \
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

"${FHV_REPO_ROOT}/scripts/ops/fhv-t4-service-user-exec.sh" \
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

"${FHV_REPO_ROOT}/scripts/ops/fhv-t4-service-user-exec.sh" \
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

"${FHV_REPO_ROOT}/scripts/ops/fhv-t4-service-user-exec.sh" \
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

"${FHV_REPO_ROOT}/scripts/ops/fhv-t4-service-user-exec.sh" \
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
EOF
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
- No remote script staging writes in PRE_AUTH or bootstrap streams (SSH stdin only)
- No secrets in argv or operator-shell exports
- No bare `pnpm`
- No unbounded waits
- No manually assigned PASS without immutable prerequisite proofs
- No required assertion followed by `|| true`
- T4A campaign deadline uses Linux `CLOCK_BOOTTIME` host-monotonic proof (not `Date.now()` verdict); preflight embeds the sample via `hostMonotonicSample`
- Completed campaign continuity uses inactive/success systemd identity (not active MainPID > 0)

---

## PR lifecycle — Linear DEE-436

**Linear:** `DEE-436`

**Linear completion:** keep-open

**Linear completion reason:** remains open until Human squash merge, corrected dev-to-main release, mandatory main-to-dev back-sync, independent audit of the exact released T4_OPERATOR_PACKET_V5, and successful separately authorized T4A Execution Server evidence.
