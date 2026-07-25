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
export FHV_LOCAL_NODE_BIN="<absolute-path-to-workstation-node>"
export FHV_LOCAL_GIT_BIN="<absolute-path-to-workstation-git>"
export FHV_LOCAL_SSH_BIN="<absolute-path-to-workstation-ssh>"
export FHV_T4A_LOCAL_STATE_DIR="<absolute-path-to-workstation-t4a-state>"

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
export FHV_SYSTEMCTL_BIN="<absolute-path-to-systemctl>"
export FHV_SYSTEMD_ANALYZE_BIN="<absolute-path-to-systemd-analyze>"
export FHV_EXPECTED_LEGACY_CONTAINER_NAME="ai-trader-execution-host"
export FHV_EXPECTED_LEGACY_CONTAINER_IMAGE="waia-execution-host:bp6"
export FHV_ORIGIN_URL="https://github.com/oumaster369/waia.git"
export FHV_T4A_WORKSTATION_TRACE_PATH="${FHV_T4A_LOCAL_STATE_DIR}/fhv-t4a-operator-trace.jsonl"

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
export FHV_POST_ROLLBACK_HOST_PROBE_PATH="${FHV_RUN_DIR}/control/fhv-t4-post-rollback-host-probe-proof.v1.json"
```

### WORKSTATION — canonical operator phases

**Locus:** WORKSTATION

The released Human operator surface is **`scripts/ops/fhv-t4a-operator.sh`**. It owns the exact workstation→Execution Server state machine. Do **not** retype low-level SSH blocks — invoke these phases only.

Transport: SSH **BatchMode** + **`sudo -n`** (noninteractive). Bootstrap bytes are streamed from **`git show "${EXECUTION_SERVER_TARGET_SHA}:<path>"`** (committed object), never from a dirty working tree.

```bash
chmod +x "${FHV_LOCAL_RELEASE_ROOT}/scripts/ops/fhv-t4a-operator.sh"
"${FHV_LOCAL_RELEASE_ROOT}/scripts/ops/fhv-t4a-operator.sh" verify-local-release
"${FHV_LOCAL_RELEASE_ROOT}/scripts/ops/fhv-t4a-operator.sh" pre-auth
```

**Authorization is not issued by this packet.** A Human operator must issue **`AUTHORIZE-FHV-OPS-DEPLOY`** before POST phases.

---

## Phase A — `PRE_AUTHORIZED_READ_ONLY_PHASE`

Read-only inspection only. **Zero filesystem mutation on the Execution Server.** Invoked by **`fhv-t4a-operator.sh pre-auth`** (after **`verify-local-release`**).

Semantic steps (operator-owned): **`fhv-validate-origin-url.sh`** exact approved origin validation; **`fhv-t4-host-preflight.sh`** dependency-free host preflight with embedded `hostMonotonicSample` / `CLOCK_BOOTTIME` sample; **`sudo -n`** probe; canonical legacy container name **`ai-trader-execution-host`** and image **`waia-execution-host:bp6`**. Step 32 ceremony verification uses **`trader:fhv:t4:verify-ceremony`** and forwards real stdout classifications only.

---

## STOP — `AUTHORIZE-FHV-OPS-DEPLOY`

**Do not proceed** until a Human operator issues **`AUTHORIZE-FHV-OPS-DEPLOY`**.

---

## Phase B — `POST_AUTHORIZED_T4A_PHASE`

Only after **`AUTHORIZE-FHV-OPS-DEPLOY`**. Exact **32-step** state machine owned by **`fhv-t4a-operator.sh`**. Workstation CLI phases: **`post-auth-before-disconnect`** (Steps 1–26 through continuity-before), human disconnect narrative (Step 27), then **`post-reconnect-finalize`** (Steps 28–32).

**Bootstrap rule:** Steps 2–5 stream bootstrap scripts from committed git objects via SSH stdin. After checkout identity is verified (Step 4), every subsequent ops script path is `${FHV_REPO_ROOT}/scripts/ops/...` on the Execution Server.

Step 4 exact identity call (operator-enforced; **`--git-bin`** and **`--python-bin`** required):

```bash
"${FHV_REPO_ROOT}/scripts/ops/fhv-release-checkout-identity.sh" \
  --repo-path "${FHV_REPO_ROOT}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}" \
  --release-tag "${FHV_RELEASE_TAG}" \
  --git-bin "${FHV_GIT_BIN}" \
  --python-bin "${FHV_PYTHON_BIN}"
```

**RESUME root handoff:** after signed **`trader:fhv:t4:resume`** returns **`status=accepted`**, the operator invokes root-only **`scripts/ops/fhv-t4-resume-campaign-root.sh`** to start **`waia-fhv-campaign.service`** and write **`fhv-t4-resume-enforcement-proof.v1.json`**. Completed campaign wait uses identity-aware **`fhv-t4-campaign-wait-completed.sh`** (accepts active/deactivating for the same invocation). Step 26 continuity capture uses **`trader:fhv:t4:capture-continuity-before`** before the human disconnect narrative. Step 30 uses **`trader:fhv:t4:capture-continuity-after`**. Step 25 reads completed campaign identity via **`fhv-t4-campaign-systemd-identity-read.sh`**. Bounded waits use **`trader:fhv:t4:wait-paused`** and **`trader:fhv:t4:wait-final`** with **`--timeout-ms 300000`** plus full run identity flags.

**Service-user wrapper** (requires **`--node-bin`** and **`--corepack-bin`**; strict EnvironmentFile parser — never shell **`source`**):

```bash
"${FHV_REPO_ROOT}/scripts/ops/fhv-t4-service-user-exec.sh" \
  --service-user "${FHV_SERVICE_USER}" \
  --environment-file "${FHV_ENVIRONMENT_FILE}" \
  --repo-root "${FHV_REPO_ROOT}" \
  --node-bin "${FHV_NODE_BIN}" \
  --corepack-bin "${FHV_COREPACK_BIN}" \
  -- trader:fhv:t4:<subcommand> [args...]
```

### Semantic 32-step sequence (operator trace)

| Step | Name | Phase boundary |
|------|------|----------------|
| 1 | Authorization + effective root | POST start |
| 2–5 | Bootstrap origin/checkout/identity/deps | SSH stdin streams |
| 6–13 | Manifest, units, deployment proof | POST |
| 14–17 | Observer start, qualification, pause arm | POST |
| 18–21 | Campaign, pause/final proofs, RESUME + root enforcement | POST |
| 22–26 | Final proof, completed wait, continuity-before | POST → **`AWAITING_HUMAN_DISCONNECT_RECONNECT`** |
| 27 | Human disconnect/reconnect narrative | WORKSTATION only |
| 28–32 | Observer restart qualification, continuity-after, rollback, seal, ceremony | reconnect-finalize phase |

After Steps 1–26 (through **`trader:fhv:t4:capture-continuity-before`**), invoke POST operator phases:

```bash
export FHV_T4A_AUTHORIZATION="AUTHORIZE-FHV-OPS-DEPLOY"
"${FHV_LOCAL_RELEASE_ROOT}/scripts/ops/fhv-t4a-operator.sh" post-auth-before-disconnect
# Human disconnect/reconnect narrative (Step 27) — no CLI
"${FHV_LOCAL_RELEASE_ROOT}/scripts/ops/fhv-t4a-operator.sh" post-reconnect-finalize
```

Ceremony stdout must include:

- `T4A_RESULT=PASS`
- `GATE8_RESULT=PASS`
- `T4B_RESULT=NOT_EXECUTED_SEPARATE_GATE`
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
