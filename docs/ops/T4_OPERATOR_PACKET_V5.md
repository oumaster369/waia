# T4 Operator Packet V5 — FHV T4A Host Runtime Rehearsal

Human-only operator packet for **T4A** (Execution Server host runtime rehearsal).

**Architecture decision:** `AUTHORIZE-T4A-T4B-CONTRACT-SPLIT` · model **C** · `gate8_satisfied_by=T4A_ONLY`

**T4A PASS satisfies DEE-416 Gate 8** and permits Historical Dataset Qualification.

**T4B** (Worker dashboard + authenticated tunnel) is governed by **DEE-437** (Backlog). T4B is **not** executed by this packet.

**Ceremony classifications (exact):**

- `T4A_RESULT=PASS`
- `GATE8_RESULT=PASS`
- `T4B_RESULT=NOT_EXECUTED_SEPARATE_GATE`

Do **not** use `T4_RESULT=PASS`, `T4_AGGREGATE_RESULT=PASS`, or `DASHBOARD_RESULT=PASS`.

---

## Preconditions

- DEE-436 released on `main`; mandatory `main→dev` back-sync complete
- Human issues **`AUTHORIZE-FHV-OPS-DEPLOY`** (this packet does not issue it)
- `HOST_OS=LINUX_SYSTEMD` qualified
- Fixture only: `HTR_WP03_BENCHMARK`
- No real HTX dataset; no live trading; blind holdout sealed

---

## Identity bindings

```bash
export EXECUTION_SERVER_TARGET_SHA="<exact-main-release-sha-after-dee436>"
export FHV_RELEASE_TAG="<exact-release-tag>"
export FHV_RUN_ID="<human-approved-unique-run-id>"
export FHV_ORGANIZATION_ID="<org-uuid>"
export FHV_ARTIFACT_ROOT="<service-user-artifact-root>"
export FHV_RUN_DIR="${FHV_ARTIFACT_ROOT}/RI-P7/fhv-ops-rehearsal/${FHV_RUN_ID}"
export FHV_REPO_ROOT="<fresh-clean-checkout-at-target-sha>"
export FHV_SERVICE_USER="<non-root-service-user>"
export FHV_WORKING_DIRECTORY="${FHV_REPO_ROOT}"
export FHV_ENVIRONMENT_FILE="/etc/waia/fhv.env"
export FHV_RENDERED_UNITS_DIR="${FHV_REPO_ROOT}/.ops/rendered-units"
export FHV_INSTALLED_UNITS_DIR="/etc/systemd/system"
export FHV_SEAL_DESTINATION="${FHV_ARTIFACT_ROOT}/RI-P7/fhv-ops-rehearsal-seals/${FHV_RUN_ID}"
export FHV_CONTINUITY_BEFORE="${FHV_RUN_DIR}/control/fhv-t4-continuity-before.v1.json"
export FHV_CONTINUITY_AFTER="${FHV_RUN_DIR}/control/fhv-t4-continuity-after.v1.json"
export FHV_EVIDENCE_LIST_PATH="${FHV_RUN_DIR}/control/fhv-t4-evidence-list.v1.json"
export FHV_T4_HOST_PROBE_JSON="$(scripts/ops/fhv-t4-host-probe.sh)"
```

Secrets (`FHV_OPERATOR_COMMAND_SECRET`, `FHV_OBSERVER_TUNNEL_SECRET`) live in `FHV_ENVIRONMENT_FILE` only — never in argv.

---

## Phase 0 — Release identity (read-only until authorized)

```bash
cd "${FHV_REPO_ROOT}"
scripts/ops/validate-fhv-release-identity.sh \
  --repo-path "${FHV_REPO_ROOT}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}"
scripts/ops/execution-server-preflight.sh \
  --repo-path "${FHV_REPO_ROOT}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}"
```

---

## Phase 1 — Manifest (fixture-only, deterministic pause)

```bash
cd "${FHV_REPO_ROOT}"
corepack pnpm@10 trader:fhv:rehearsal -- \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}" \
  --run-id "${FHV_RUN_ID}" \
  --t4-deterministic-pause \
  --fixture HTR_WP03_BENCHMARK
```

Bind `FHV_RUN_DIR` from CLI output `[fhv-rehearsal] runDir=`.

---

## Phase 2 — Systemd render (no install until authorized)

```bash
scripts/ops/fhv-supervisor/render-units.sh \
  --repo-root "${FHV_REPO_ROOT}" \
  --output-dir "${FHV_RENDERED_UNITS_DIR}" \
  --working-directory "${FHV_WORKING_DIRECTORY}" \
  --service-user "${FHV_SERVICE_USER}" \
  --environment-file "${FHV_ENVIRONMENT_FILE}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}" \
  --run-id "${FHV_RUN_ID}" \
  --organization-id "${FHV_ORGANIZATION_ID}"
```

**STOP** until Human issues `AUTHORIZE-FHV-OPS-DEPLOY`.

---

## Phase 3 — Install (Human-only, after authorization)

Preview (no mutation):

```bash
scripts/ops/fhv-supervisor/install-units.sh \
  --rendered-dir "${FHV_RENDERED_UNITS_DIR}" \
  --installed-dir "${FHV_INSTALLED_UNITS_DIR}"
```

Confirmed install:

```bash
scripts/ops/fhv-supervisor/install-units.sh \
  --rendered-dir "${FHV_RENDERED_UNITS_DIR}" \
  --installed-dir "${FHV_INSTALLED_UNITS_DIR}" \
  --confirm
scripts/ops/fhv-systemd-record-deploy.sh --confirm
scripts/ops/fhv-systemd-verify-deploy.sh
cd "${FHV_REPO_ROOT}"
corepack pnpm@10 trader:fhv:t4:verify-deployment \
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
  --environment-file "${FHV_ENVIRONMENT_FILE}"
```

---

## Phase 4 — Observer + campaign (one shared 300000 ms budget)

Ensure `FHV_HOST_OS_QUALIFIED=true` and `FHV_COMMAND_ENFORCEMENT_ENABLED=true` in `${FHV_ENVIRONMENT_FILE}`.

Start observer and campaign via systemd. Pre-arm deterministic pause:

```bash
cd "${FHV_REPO_ROOT}"
corepack pnpm@10 trader:fhv:t4:arm-pause \
  --run-root "${FHV_RUN_DIR}" \
  --run-id "${FHV_RUN_ID}" \
  --organization-id "${FHV_ORGANIZATION_ID}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}"
corepack pnpm@10 trader:fhv:t4:verify-paused \
  --run-root "${FHV_RUN_DIR}" \
  --run-id "${FHV_RUN_ID}" \
  --organization-id "${FHV_ORGANIZATION_ID}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}"
```

After deterministic pause at cycle 40:

```bash
corepack pnpm@10 trader:fhv:t4:verify-paused \
  --run-root "${FHV_RUN_DIR}" \
  --run-id "${FHV_RUN_ID}" \
  --organization-id "${FHV_ORGANIZATION_ID}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}"
corepack pnpm@10 trader:fhv:t4:resume \
  --run-root "${FHV_RUN_DIR}" \
  --run-id "${FHV_RUN_ID}" \
  --organization-id "${FHV_ORGANIZATION_ID}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}"
corepack pnpm@10 trader:fhv:t4:verify-final \
  --run-root "${FHV_RUN_DIR}" \
  --run-id "${FHV_RUN_ID}" \
  --organization-id "${FHV_ORGANIZATION_ID}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}"
```

---

## Phase 5 — Continuity (disconnect / reconnect / observer restart)

Before SSH disconnect:

```bash
cd "${FHV_REPO_ROOT}"
corepack pnpm@10 trader:fhv:t4:capture-continuity-before \
  --run-root "${FHV_RUN_DIR}" \
  --run-id "${FHV_RUN_ID}" \
  --organization-id "${FHV_ORGANIZATION_ID}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}" \
  --repo-root "${FHV_REPO_ROOT}" \
  --output "${FHV_CONTINUITY_BEFORE}"
```

Human: SSH disconnect → reconnect → restart observer only.

After reconnect + observer restart:

```bash
corepack pnpm@10 trader:fhv:t4:capture-continuity-after \
  --run-root "${FHV_RUN_DIR}" \
  --run-id "${FHV_RUN_ID}" \
  --organization-id "${FHV_ORGANIZATION_ID}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}" \
  --repo-root "${FHV_REPO_ROOT}" \
  --output "${FHV_CONTINUITY_AFTER}"
corepack pnpm@10 trader:fhv:t4:verify-continuity \
  --before "${FHV_CONTINUITY_BEFORE}" \
  --after "${FHV_CONTINUITY_AFTER}" \
  --run-root "${FHV_RUN_DIR}" \
  --run-id "${FHV_RUN_ID}" \
  --organization-id "${FHV_ORGANIZATION_ID}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}"
```

Expected: `classification=FHV_T4_CONTINUITY_VERIFICATION_PASS`

---

## Phase 6 — Evidence seal

Build `${FHV_EVIDENCE_LIST_PATH}` listing every mandatory evidence file (absolute + relative paths).

```bash
cd "${FHV_REPO_ROOT}"
corepack pnpm@10 trader:fhv:t4:seal-evidence \
  --run-root "${FHV_RUN_DIR}" \
  --run-id "${FHV_RUN_ID}" \
  --organization-id "${FHV_ORGANIZATION_ID}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}" \
  --release-tag "${FHV_RELEASE_TAG}" \
  --seal-destination "${FHV_SEAL_DESTINATION}" \
  --evidence-list "${FHV_EVIDENCE_LIST_PATH}"
corepack pnpm@10 trader:fhv:t4:verify-seal \
  --run-root "${FHV_RUN_DIR}" \
  --run-id "${FHV_RUN_ID}" \
  --organization-id "${FHV_ORGANIZATION_ID}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}" \
  --release-tag "${FHV_RELEASE_TAG}" \
  --seal-destination "${FHV_SEAL_DESTINATION}"
```

---

## Phase 7 — Rollback

Preview:

```bash
scripts/ops/fhv-supervisor/rollback-units.sh
export FHV_T4_HOST_PROBE_JSON="$(scripts/ops/fhv-t4-host-probe.sh)"
```

Confirmed rollback:

```bash
scripts/ops/fhv-supervisor/rollback-units.sh --confirm
cd "${FHV_REPO_ROOT}"
corepack pnpm@10 trader:fhv:t4:verify-rollback \
  --run-root "${FHV_RUN_DIR}" \
  --run-id "${FHV_RUN_ID}" \
  --organization-id "${FHV_ORGANIZATION_ID}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}" \
  --repo-root "${FHV_REPO_ROOT}"
```

---

## Phase 8 — Ceremony (machine-derived T4A + Gate 8)

```bash
cd "${FHV_REPO_ROOT}"
export FHV_T4_HOST_PROBE_JSON="$(scripts/ops/fhv-t4-host-probe.sh)"
corepack pnpm@10 trader:fhv:t4:verify-ceremony \
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
  --seal-destination "${FHV_SEAL_DESTINATION}" \
  --continuity-before "${FHV_CONTINUITY_BEFORE}" \
  --continuity-after "${FHV_CONTINUITY_AFTER}"
```

**Required stdout fields:**

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

---

## Explicit exclusions

- No Worker dashboard access
- No Cloudflare Tunnel
- No invented endpoints
- No bare `pnpm` (use `corepack pnpm@10` only)
- No inline TypeScript or `node -e`
- No secrets in argv
- No filesystem writes before `AUTHORIZE-FHV-OPS-DEPLOY`
- No `|| true` on mandatory assertions
- No manually assigned PASS fields

---

## Related documents

- [`FHV-EXECUTION-SERVER-REHEARSAL-CONTRACT.md`](FHV-EXECUTION-SERVER-REHEARSAL-CONTRACT.md)
- [`FHV-RELEASE-IDENTITY-CONTRACT.md`](FHV-RELEASE-IDENTITY-CONTRACT.md)
- [`FHV-OPERATIONS-RUNBOOK.md`](FHV-OPERATIONS-RUNBOOK.md)
- [`docs/plans/dee-436-fhv-t4a-operator-closure.md`](../plans/dee-436-fhv-t4a-operator-closure.md)
