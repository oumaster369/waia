# T4 Operator Packet V5 — Human-executable FHV T4A (Model C)

**Architecture decision:** `AUTHORIZE-T4A-T4B-CONTRACT-SPLIT` · model **C** · `gate8_satisfied_by=T4A_ONLY`

**Scope:** Execution Server host runtime rehearsal (T4A) only.
**Out of scope:** T4B Worker dashboard + authenticated tunnel (`DEE-437`, Backlog).

**Execution status:** T4A **NOT EXECUTED** — this packet is the Human-executable procedure only. No live rehearsal PASS is implied by publication of DEE-436 repository closure.

Use **`corepack pnpm@10`** only (never bare `pnpm`).

---

## Repository and release prerequisites

**Do not execute T4A from:**

- a PR head commit;
- a feature branch checkout;
- a synthetic merge ref;
- an untagged `dev` commit.

**Required sequence before Phase A (DEE-436 T4A + residual recovery closure):**

1. Human squash merge **PR #431** into `dev`;
2. post-merge **`dev` synchronization** and green push CI;
3. governed **`dev → main` release** through merge commit (never squash);
4. record the **exact released main SHA and tag**; perform **tag-peel verification** and confirm the peeled tag matches the recorded SHA;
5. mandatory **`main → dev` back-sync** through merge commit;
6. independent audit of the **exact Packet blob** from the **exact released SHA** (`docs/ops/T4_OPERATOR_PACKET_V5.md` at that SHA);
7. create an **exact local checkout** of the new released SHA and bind `FHV_LOCAL_RELEASE_ROOT` to it.

Only after steps 1–7 may the Human run residual recovery (if required) or begin a fresh T4A namespace.

**Never run recovery or T4A from:** a PR head, untagged `dev`, or the old failed release SHA.

---

## One-run namespace and failure policy

Require for every T4A attempt:

- a **globally unique `FHV_RUN_ID`**;
- a **fresh dedicated `FHV_T4A_LOCAL_STATE_DIR`** (never reuse a prior run's workstation state directory);
- no reuse of remote run directory or seal destination for a new attempt;
- **no deletion, replacement, truncation, or manual repair** of evidence artifacts;
- **no rerunning a completed phase** for the same run identity;
- on any **nonzero exit**, **missing exact ceremony classification**, **binding mismatch**, **existing-target refusal**, or **incomplete ceremony** → **immediate STOP** and **evidence preservation**;
- **no improvised cleanup or retry** — open a new run identity only after governance review.

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
export FHV_T4A_LOCAL_STATE_DIR="<absolute-path-to-fresh-workstation-t4a-state>"

# --- Local release handoff (WORKSTATION only) ---
# Clean checkout of the exact released main SHA + tag (reviewed before T4A).
export FHV_LOCAL_RELEASE_ROOT="<absolute-path-to-local-waia-release-checkout>"
export EXECUTION_SERVER_TARGET_SHA="<exact-main-release-sha-after-dee436>"
export FHV_RELEASE_TAG="<exact-release-tag>"

# --- Run identity (globally unique per attempt) ---
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

---

## PRE_AUTH procedure

Before Phase A, on the **WORKSTATION**, explicitly clear any stale authorization:

```bash
unset FHV_T4A_AUTHORIZATION
chmod +x "${FHV_LOCAL_RELEASE_ROOT}/scripts/ops/fhv-t4a-operator.sh"
"${FHV_LOCAL_RELEASE_ROOT}/scripts/ops/fhv-t4a-operator.sh" verify-local-release
"${FHV_LOCAL_RELEASE_ROOT}/scripts/ops/fhv-t4a-operator.sh" pre-auth
```

Require **exact zero-exit** classifications:

```text
classification=FHV_T4A_LOCAL_RELEASE_VERIFY_OK
classification=FHV_T4A_PREAUTH_OK
```

Human authorization for POST phases must be based on the **immutable PRE_AUTH receipt**, including:

- exact SHA / tag / binding identity;
- `rejectedCommandCount=0`;
- `mutatingCommandCount=0`;
- observed host facts from preflight;
- **`supervisorResidualClassification=FHV_T4A_SUPERVISOR_RESIDUAL_SAFE`** and bound **`supervisorResidualStateDigest`**.

If PRE_AUTH reports **`FHV_T4A_SUPERVISOR_RESIDUAL_BLOCKED_*`**, do **not** proceed. Use the governed residual recovery procedure below, then re-run **`pre-auth`**.

**Authorization is not issued by this packet.** A Human operator must issue **`AUTHORIZE-FHV-OPS-DEPLOY`** before POST phases.

---

## Residual supervisor recovery (Human-only, before fresh PRE_AUTH)

When a prior failed T4A run left **`waia-fhv-observer.service`** or **`waia-fhv-campaign.service`** enabled/active, use this **separate** recovery gate. It is **not** PRE_AUTH and **not** `AUTHORIZE-FHV-OPS-DEPLOY`.

**Implementation vs evidence separation (mandatory):**

| Binding | Purpose |
|---------|---------|
| `FHV_LOCAL_RELEASE_ROOT` + `EXECUTION_SERVER_TARGET_SHA` + `FHV_RELEASE_TAG` | **Audited recovery implementation** — workstation checkout that contains `fhv-t4-supervisor-residual-recovery.sh` |
| `FHV_T4A_RESIDUAL_RECOVERY_FAILED_*` | **Immutable failed-run evidence** — never used to fetch executable recovery code |

Recovery script bytes MUST come from the audited implementation SHA only. The failed SHA/tag/run bindings select which residual units must match before stop/disable.

1. Verify local implementation release and set failed-run evidence bindings (example):

```bash
export FHV_LOCAL_RELEASE_ROOT="<absolute-path-to-audited-main-release-checkout>"
export EXECUTION_SERVER_TARGET_SHA="<exact-audited-main-release-sha>"
export FHV_RELEASE_TAG="<exact-audited-release-tag>"
export FHV_T4A_RESIDUAL_RECOVERY_FAILED_RUN_ID="fhv-t4a-20260727t125110z-03d2b13"
export FHV_T4A_RESIDUAL_RECOVERY_FAILED_TARGET_SHA="03d2b1311b4e01bd469f6393bdde0c8aafab7da5"
export FHV_T4A_RESIDUAL_RECOVERY_FAILED_RELEASE_TAG="v2026.07.27.03d2b13"
"${FHV_LOCAL_RELEASE_ROOT}/scripts/ops/fhv-t4a-operator.sh" verify-local-release
```

2. Preview (read-only, zero mutations):

```bash
"${FHV_LOCAL_RELEASE_ROOT}/scripts/ops/fhv-t4a-operator.sh" residual-recovery-preview
```

Require: `classification=FHV_T4A_RESIDUAL_RECOVERY_PREVIEW_OK` and immutable workstation receipt **`fhv-t4a-residual-recovery-preview-receipt.v1.json`** with `mutatingCommandCount=0`, bound `beforeStateDigest`, and `unitIdentityClassification=FHV_T4A_RESIDUAL_UNIT_IDENTITY_MATCH`.

3. Human issues **`AUTHORIZE-FHV-T4A-RESIDUAL-UNIT-RECOVERY`** only after reviewing the preview receipt digest, then mutating recovery:

```bash
export FHV_T4A_RESIDUAL_RECOVERY_AUTHORIZATION="AUTHORIZE-FHV-T4A-RESIDUAL-UNIT-RECOVERY"
"${FHV_LOCAL_RELEASE_ROOT}/scripts/ops/fhv-t4a-operator.sh" residual-recovery
```

Require: `classification=FHV_T4A_RESIDUAL_RECOVERY_OK` and immutable final receipt **`fhv-t4a-residual-recovery-receipt.v1.json`** linking the preview receipt digest and confirm-attempt marker.

4. **STOP.** Do not chain into PRE_AUTH or T4A in the same session. Start a **fresh** run namespace and re-run **`verify-local-release`** → **`pre-auth`**.

Recovery stops/disables only the two allowlisted FHV units whose embedded identity matches the bound failed run, preserves unit files and all failed checkout/run/evidence, refuses replay before remote mutation, and revalidates preview-bound before-state immediately before confirm.

---

## Phase A — `PRE_AUTHORIZED_READ_ONLY_PHASE`

Read-only inspection only. **Zero filesystem mutation on the Execution Server.** Invoked by **`fhv-t4a-operator.sh pre-auth`** (after **`verify-local-release`**).

Semantic steps (operator-owned): **`fhv-validate-origin-url.sh`** exact approved origin validation; **`fhv-t4-host-preflight.sh`** dependency-free host preflight with embedded `hostMonotonicSample` / `CLOCK_BOOTTIME` sample; **`fhv-t4-supervisor-residual-state-read.sh`** read-only supervisor residual-state proof for **`waia-fhv-observer.service`** and **`waia-fhv-campaign.service`**; **`sudo -n`** probe; canonical legacy container name **`ai-trader-execution-host`** and image **`waia-execution-host:bp6`**.

---

## STOP — `AUTHORIZE-FHV-OPS-DEPLOY`

**Do not proceed** until a Human operator issues **`AUTHORIZE-FHV-OPS-DEPLOY`**.

---

## Phase B — `POST_AUTHORIZED_T4A_PHASE`

Only after **`AUTHORIZE-FHV-OPS-DEPLOY`**. Exact **32-step** state machine owned by **`fhv-t4a-operator.sh`**.

**Bootstrap rule:** Steps 2–5 stream bootstrap scripts from committed git objects via SSH stdin (`git show "${EXECUTION_SERVER_TARGET_SHA}:<path>"`). After checkout identity is verified (Step 4), every subsequent ops script path is `${FHV_REPO_ROOT}/scripts/ops/...` on the Execution Server.

Step 4 exact identity call (operator-enforced; **`--git-bin`** and **`--python-bin`** required):

```bash
"${FHV_REPO_ROOT}/scripts/ops/fhv-release-checkout-identity.sh" \
  --repo-path "${FHV_REPO_ROOT}" \
  --target-sha "${EXECUTION_SERVER_TARGET_SHA}" \
  --release-tag "${FHV_RELEASE_TAG}" \
  --git-bin "${FHV_GIT_BIN}" \
  --python-bin "${FHV_PYTHON_BIN}"
```

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
| 6–13 | Manifest, units, deployment proof | POST — Step 10 installs units **disabled** (`--skip-enable`) |
| 14–17 | Observer **enable+start**, qualification, pause arm | POST |
| **18–21** | **Campaign enable+start, wait/verify paused, RESUME + root enforcement** | POST |
| **22–26** | **Wait/verify final, completed wait/identity, continuity-before** | POST → disconnect |
| 27 | Human disconnect/reconnect narrative | WORKSTATION only |
| 28–32 | Observer restart qualification, continuity-after, rollback, seal, ceremony | reconnect-finalize |

**Steps 18–21:** campaign start; bounded **`trader:fhv:t4:wait-paused`** with **`--timeout-ms 300000`**; signed **`trader:fhv:t4:resume`**; root-only **`fhv-t4-resume-campaign-root.sh`** enforcement proof.

**Steps 22–26:** bounded **`trader:fhv:t4:wait-final`**; completed campaign wait via identity-aware **`fhv-t4-campaign-wait-completed.sh`**; completed campaign identity read via **`fhv-t4-campaign-systemd-identity-read.sh`**; **`trader:fhv:t4:capture-continuity-before`**.

After Steps 1–26:

```bash
export FHV_T4A_AUTHORIZATION="AUTHORIZE-FHV-OPS-DEPLOY"
"${FHV_LOCAL_RELEASE_ROOT}/scripts/ops/fhv-t4a-operator.sh" post-auth-before-disconnect
```

---

## Disconnect / reconnect procedure

After **`post-auth-before-disconnect`**, require:

```text
classification=AWAITING_HUMAN_DISCONNECT_RECONNECT
```

The Human performs the disconnect/reconnect narrative (Step 27). A **new workstation shell** must restore the **exact same approved bindings** and the **exact authorization literal**:

```bash
export FHV_T4A_AUTHORIZATION="AUTHORIZE-FHV-OPS-DEPLOY"
# restore all bindings from the audited release checkout section above
"${FHV_LOCAL_RELEASE_ROOT}/scripts/ops/fhv-t4a-operator.sh" post-reconnect-finalize
```

**Do not rerun** after disconnect:

- `verify-local-release`;
- `pre-auth`;
- `post-auth-before-disconnect`.

The final phase must terminate with:

```text
classification=FHV_T4A_POST_RECONNECT_FINALIZE_OK
```

Step 30 uses **`trader:fhv:t4:capture-continuity-after`**. Step 32 uses **`trader:fhv:t4:verify-ceremony`** and forwards real stdout classifications only.

---

## Exact ceremony results (presence alone is insufficient)

Step 32 stdout must contain **exactly** these key/value pairs with **exact values**:

```text
T4A_RESULT=PASS
GATE8_RESULT=PASS
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
T4B_RESULT=NOT_EXECUTED_SEPARATE_GATE
```

Do **not** use aggregate PASS aliases (`T4_RESULT`, `T4_AGGREGATE_RESULT`, `DASHBOARD_RESULT`).

Missing fields, empty fields, unexpected values, duplicate contradictory fields, or forbidden aggregate fields → **STOP** and preserve evidence.

The POST-finalize receipt **`ceremonyClassifications`** must match this exact matrix.

---

## Evidence preservation

Preserve without modification:

- exact released SHA / tag / run identity;
- complete workstation trace (`FHV_T4A_WORKSTATION_TRACE_PATH`);
- all four phase receipts (local-release, pre-auth, post-before, post-finalize);
- remote run directory (`FHV_RUN_DIR`);
- continuity snapshots and continuity verification proof;
- observer qualification proofs (pre-campaign and post-restart);
- deployment and rollback host-probe proofs;
- rollback proof;
- inventory, seal manifest, and seal root.

On any failure: **STOP**, preserve all artifacts, do not retry under the same run identity.

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
