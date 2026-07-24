# T4 Operator Packet V5 — FHV T4A Host Runtime Rehearsal

Human-only operator packet for **T4A** (Execution Server host runtime rehearsal).

**Architecture decision:** `AUTHORIZE-T4A-T4B-CONTRACT-SPLIT` · model **C** · `gate8_satisfied_by=T4A_ONLY`

**T4A PASS satisfies DEE-416 Gate 8** and permits Historical Dataset Qualification.

**T4B** (Worker dashboard + authenticated tunnel) is governed by **DEE-437** (Backlog). T4B is **not** executed by this packet.

**Ceremony classifications (exact — Model C, unchanged):**

- `T4A_RESULT=PASS`
- `GATE8_RESULT=PASS`
- `T4B_RESULT=NOT_EXECUTED_SEPARATE_GATE`

Do **not** use `T4_RESULT=PASS`, `T4_AGGREGATE_RESULT=PASS`, or `DASHBOARD_RESULT=PASS`.

---

## Preconditions (not authorization)

These describe server readiness. They do **not** substitute for the separate Human gate **`AUTHORIZE-FHV-OPS-DEPLOY`**.

- DEE-436 released on `main`; mandatory `main→dev` back-sync complete
- `HOST_OS=LINUX_SYSTEMD` qualified (Ubuntu 24.04 + systemd observed)
- Fixture only: `HTR_WP03_BENCHMARK`
- No real HTX dataset; no live trading; blind holdout sealed
- Legacy container `ai-trader-execution-host` / `waia-execution-host:bp6` running (inspection only)
- `FHV_HOST_OS_QUALIFIED=true` and `FHV_COMMAND_ENFORCEMENT_ENABLED=true` present in `${FHV_ENVIRONMENT_FILE}`

**Authorization is not issued by this packet.** A Human operator must issue **`AUTHORIZE-FHV-OPS-DEPLOY`** before any POST_AUTHORIZED step.

---

## Human binding fields

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
export FHV_OBSERVER_IDENTITY_BEFORE="${FHV_RUN_DIR}/control/fhv-t4-observer-identity-before.v1.json"
export FHV_OBSERVER_IDENTITY_AFTER="${FHV_RUN_DIR}/control/fhv-t4-observer-identity-after.v1.json"
export FHV_HOST_PROBE_PATH="${FHV_RUN_DIR}/control/fhv-t4-host-probe.v1.json"
```

---

## Phase A — `PRE_AUTHORIZED_READ_ONLY_PHASE`

Read-only inspection only. **Zero filesystem mutation.** No checkout creation, manifest, render, install, deployment record, continuity, evidence, sealing, or systemd mutation.

```bash
# A1 — release/tag identity against an existing reference checkout (read-only)
scripts/ops/validate-fhv-release-identity.sh \
  --repo-path "${FHV_REFERENCE_REPO_ROOT}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}"

# A2 — reference checkout SHA guard (read-only)
scripts/ops/execution-server-preflight.sh \
  --repo-path "${FHV_REFERENCE_REPO_ROOT}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}"

# A3 — host probe baseline (read-only; no export required yet)
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

Only after **`AUTHORIZE-FHV-OPS-DEPLOY`**. Exact 32-step state machine. All run-root / evidence-writing package commands run as the service user via `scripts/ops/fhv-t4-service-user-exec.sh`. Use **`corepack pnpm@10`** only (never bare `pnpm`).

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

### Step 2 — Fresh checkout + release identity verified

```bash
git clone "<waia-origin-url>" "${FHV_REPO_ROOT}"
cd "${FHV_REPO_ROOT}"
git checkout "${EXECUTION_SERVER_TARGET_SHA}"
scripts/ops/validate-fhv-release-identity.sh \
  --repo-path "${FHV_REPO_ROOT}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}"
scripts/ops/execution-server-preflight.sh \
  --repo-path "${FHV_REPO_ROOT}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}"
```

### Step 3 — Fixture manifest materialized

```bash
cd "${FHV_REPO_ROOT}"
scripts/ops/fhv-t4-service-user-exec.sh \
  --service-user "${FHV_SERVICE_USER}" \
  --environment-file "${FHV_ENVIRONMENT_FILE}" \
  --repo-root "${FHV_REPO_ROOT}" \
  -- trader:fhv:rehearsal -- \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}" \
  --run-id "${FHV_RUN_ID}" \
  --t4-deterministic-pause \
  --fixture HTR_WP03_BENCHMARK
```

Bind `FHV_RUN_DIR` from stdout `[fhv-rehearsal] runDir=` and verify it equals `${FHV_ARTIFACT_ROOT}/RI-P7/fhv-ops-rehearsal/${FHV_RUN_ID}`.

### Step 4 — Systemd units rendered

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

### Step 5 — Install preview (no mutation)

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

### Step 6 — Units installed

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

### Step 7 — Deployment record written (complete identity + digests)

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

### Step 8 — Deployment verification PASS captured atomically

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

Expected: `classification=FHV_T4_DEPLOYMENT_VERIFICATION_PASS` and immutable `control/fhv-t4-deployment-proof.v1.json` written.

### Step 9 — Deterministic PAUSE pre-armed **before** campaign start

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

### Step 10 — Observer started

```bash
systemctl start waia-fhv-observer.service
```

### Step 11 — Observer health verified (machine identity)

```bash
scripts/ops/fhv-t4-observer-systemd-identity-read.sh waia-fhv-observer.service
```

Expected JSON: `"activeState":"active"`, non-zero `"mainPid"`, non-empty `"invocationId"`.

### Step 12 — Campaign started

```bash
systemctl start waia-fhv-campaign.service
```

### Step 13 — Bounded wait until cycle-40 pause

```bash
scripts/ops/fhv-t4-service-user-exec.sh \
  --service-user "${FHV_SERVICE_USER}" \
  --environment-file "${FHV_ENVIRONMENT_FILE}" \
  --repo-root "${FHV_REPO_ROOT}" \
  -- trader:fhv:t4:wait-paused \
  --run-root "${FHV_RUN_DIR}" \
  --timeout-ms 300000
```

### Step 14 — verify-paused PASS captured atomically

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

Expected: `classification=FHV_T4_PAUSED_VERIFICATION_PASS`.

### Step 15 — Signed RESUME submitted

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

### Step 16 — Bounded wait until REHEARSAL_OK

```bash
scripts/ops/fhv-t4-service-user-exec.sh \
  --service-user "${FHV_SERVICE_USER}" \
  --environment-file "${FHV_ENVIRONMENT_FILE}" \
  --repo-root "${FHV_REPO_ROOT}" \
  -- trader:fhv:t4:wait-final \
  --run-root "${FHV_RUN_DIR}" \
  --timeout-ms 300000
```

### Step 17 — verify-final PASS captured atomically

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

Expected: `classification=FHV_T4_FINAL_VERIFICATION_PASS`.

### Step 18 — continuity-before captured (observer identity + snapshot)

```bash
scripts/ops/fhv-t4-observer-systemd-identity-read.sh waia-fhv-observer.service \
  > "${FHV_OBSERVER_IDENTITY_BEFORE}"
export FHV_T4_OBSERVER_SYSTEMD_IDENTITY_JSON="$(cat "${FHV_OBSERVER_IDENTITY_BEFORE}")"
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
```

### Step 19 — Human SSH disconnect

Operator event only. Do not restart campaign. Do not mutate run-root evidence.

### Step 20 — Human SSH reconnect

Operator event only.

### Step 21 — Observer-only restart

```bash
systemctl restart waia-fhv-observer.service
```

Do **not** restart `waia-fhv-campaign.service`.

### Step 22 — Actual observer restart proven (systemd identity changed)

```bash
scripts/ops/fhv-t4-observer-systemd-identity-read.sh waia-fhv-observer.service \
  > "${FHV_OBSERVER_IDENTITY_AFTER}"
```

Required machine proof (enforced by Step 24 `verify-continuity` via embedded `observerSystemdIdentity`):

- same `bootId` in `${FHV_OBSERVER_IDENTITY_BEFORE}` and `${FHV_OBSERVER_IDENTITY_AFTER}`;
- different `invocationId`;
- different `mainPid` or `activeEnterTimestampMonotonicUs`;
- after identity `"activeState":"active"`.

### Step 23 — continuity-after captured

```bash
export FHV_T4_OBSERVER_SYSTEMD_IDENTITY_JSON="$(cat "${FHV_OBSERVER_IDENTITY_AFTER}")"
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
```

### Step 24 — Continuity verification PASS captured

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

Expected: `classification=FHV_T4_CONTINUITY_VERIFICATION_PASS`.

### Step 25 — Rollback preview

```bash
scripts/ops/fhv-supervisor/rollback-units.sh --systemd-dir "${FHV_INSTALLED_UNITS_DIR}"
scripts/ops/fhv-t4-host-probe.sh > "${FHV_HOST_PROBE_PATH}"
export FHV_T4_HOST_PROBE_JSON="$(cat "${FHV_HOST_PROBE_PATH}")"
```

### Step 26 — Rollback confirmed

```bash
scripts/ops/fhv-supervisor/rollback-units.sh \
  --systemd-dir "${FHV_INSTALLED_UNITS_DIR}" \
  --confirm
scripts/ops/fhv-t4-host-probe.sh > "${FHV_HOST_PROBE_PATH}"
export FHV_T4_HOST_PROBE_JSON="$(cat "${FHV_HOST_PROBE_PATH}")"
```

### Step 27 — Rollback verification PASS captured atomically

```bash
export FHV_T4_HOST_PROBE_JSON="$(cat "${FHV_HOST_PROBE_PATH}")"
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
```

Expected: `classification=FHV_T4_ROLLBACK_VERIFICATION_PASS` and immutable `control/fhv-t4-rollback-proof.v1.json` written.

### Step 28 — Mandatory evidence inventory created (not manual)

```bash
scripts/ops/fhv-t4-service-user-exec.sh \
  --service-user "${FHV_SERVICE_USER}" \
  --environment-file "${FHV_ENVIRONMENT_FILE}" \
  --repo-root "${FHV_REPO_ROOT}" \
  -- trader:fhv:t4:build-evidence-inventory \
  --run-root "${FHV_RUN_DIR}" \
  --repo-root "${FHV_REPO_ROOT}" \
  --rendered-units-dir "${FHV_RENDERED_UNITS_DIR}" \
  --continuity-before "${FHV_CONTINUITY_BEFORE}" \
  --continuity-after "${FHV_CONTINUITY_AFTER}" \
  --host-probe-json-path "${FHV_HOST_PROBE_PATH}"
```

Builder fails closed when any mandatory artifact is missing.

### Step 29 — Complete evidence sealed

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
  --continuity-after "${FHV_CONTINUITY_AFTER}"
```

### Step 30 — Seal verified

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
  --seal-destination "${FHV_SEAL_DESTINATION}"
```

Expected: `classification=FHV_T4_EVIDENCE_SEAL_VERIFICATION_PASS`.

### Step 31 — Ceremony verifies persisted proof artifacts

Ceremony reads immutable deployment proof, rollback proof, continuity snapshots, and sealed evidence — **not** live installed unit files.

```bash
export FHV_T4_HOST_PROBE_JSON="$(cat "${FHV_HOST_PROBE_PATH}")"
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

### Step 32 — Ceremony emits T4A / Gate 8 PASS only after every proof passes

Required stdout fields (machine-derived; never manually assigned):

```
T4A_RESULT=PASS
GATE8_RESULT=PASS
T4B_RESULT=NOT_EXECUTED_SEPARATE_GATE
PAUSE_RESULT=REHEARSAL_PAUSED_AT_CYCLE_40
RESUME_RESULT=REHEARSAL_OK
FULL_HISTORY_RESCAN_DELTA=0
CANONICAL_RUN_CHAIN_RESULT=PASS
DEPLOYMENT_RECORD_RESULT=PASS
ALERT_POLICY_RESULT=PASS
LEGACY_CONTAINER_RESULT=PASS
CONTINUITY_RESULT=PASS
ROLLBACK_RESULT=PASS
EVIDENCE_SEAL_RESULT=PASS
```

Any failure suppresses all PASS fields. Do not use `|| true` on mandatory assertions.

---

## Explicit exclusions

- No Worker dashboard access
- No Cloudflare Tunnel
- No invented endpoints
- No bare `pnpm` (use `corepack pnpm@10` only)
- No inline TypeScript or `node -e` in operator steps
- No secrets in argv or operator-shell exports
- No filesystem writes before `AUTHORIZE-FHV-OPS-DEPLOY`
- No unbounded busy-wait or sleep for pause/final terminals
- No manually assigned PASS fields
- No evidence sealing before rollback proof (Steps 25–27 precede Steps 28–30)
- No campaign restart during continuity (observer-only restart)

---

## Related documents

- [`FHV-EXECUTION-SERVER-REHEARSAL-CONTRACT.md`](FHV-EXECUTION-SERVER-REHEARSAL-CONTRACT.md)
- [`FHV-RELEASE-IDENTITY-CONTRACT.md`](FHV-RELEASE-IDENTITY-CONTRACT.md)
- [`FHV-OPERATIONS-RUNBOOK.md`](FHV-OPERATIONS-RUNBOOK.md)
- [`docs/plans/dee-436-fhv-t4a-operator-closure.md`](../plans/dee-436-fhv-t4a-operator-closure.md)
