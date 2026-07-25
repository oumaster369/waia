# FHV Execution Server Rehearsal Contract (WP-K / DEE-424 / DEE-436)

Human-only rehearsal contract. **Agents must not connect to the Execution Server or run this rehearsal.**

See also: [`FHV-RELEASE-IDENTITY-CONTRACT.md`](FHV-RELEASE-IDENTITY-CONTRACT.md) · [`T4_OPERATOR_PACKET_V5.md`](T4_OPERATOR_PACKET_V5.md)

## T4A vs T4B (authoritative split — Human Model C)

**Human decision token:** `AUTHORIZE-T4A-T4B-CONTRACT-SPLIT` · model **C** · `gate8_satisfied_by=T4A_ONLY` · issued 2026-07-24T17:47:25Z

| Gate | Name | Scope | Blocks Historical Dataset Qualification? |
|------|------|-------|------------------------------------------|
| **T4A** | FHV Execution Server host runtime rehearsal | Exact released checkout, Linux/systemd supervisor, localhost observer, signed deterministic PAUSE@40, resumable checkpoint, signed RESUME, zero full-history rescan, canonical authoritative partial+continuation run chain, truthful systemd deployment record, disconnect/reconnect + observer restart continuity, rollback, evidence sealing | **Yes** — **T4A PASS satisfies DEE-416 Gate 8** |
| **T4B** | FHV Worker dashboard tunnel qualification | Production Cloudflare-to-Execution-Server authenticated tunnel, Worker dashboard access, Cloudflare deployment/secret binding, Access policy where selected, dashboard operational proof | **No** — separately governed (`DEE-437`); required for Worker remote control-plane qualification only |

T4B is **not implemented and not deployed** by this contract revision. Do not invent a tunnel command or dashboard URL for T4A.

Unchanged hard requirements:

- signed operator commands (`fhv-operator-command/v1`)
- observer localhost binding only
- HMAC authentication
- command nonce / idempotency protections
- checkpoint / resume requirements
- evidence requirements
- release identity
- Human-only server mutation

## Preconditions

- PR-2 FHV operations core merged to `dev`
- DEE-424 Linux/systemd repository implementation merged to `dev`
- Corrective release-identity gates merged (DEE-431)
- DEE-435 deterministic pause + systemd deployment record released
- DEE-436 T4A closure verifiers released
- Next dev → main release Human-merged; `EXECUTION_SERVER_TARGET_SHA="$NEW_RELEASE_SHA"` resolved per release identity contract
- `EXECUTION_SERVER_TARGET_SHA` preflight PASS on a **fresh clean checkout** at released SHA
- `HOST_OS=LINUX_SYSTEMD` qualified (Ubuntu 24.04 + systemd observed)
- `AUTHORIZE-FHV-OPS-DEPLOY` issued by Human operator

## Scope (T4A)

- **Non-production fixture only** (`HTR_WP03_BENCHMARK` allowlisted repository fixture)
- **No real HTX dataset**
- **No live trading**
- **Maximum runtime:** 5 minutes (**one shared budget** across pause + resume + final OK)
- **No Worker dashboard / tunnel step**

## Repository tooling (local preparation + T4A proofs)

| Command | Purpose |
|---------|---------|
| `corepack pnpm@10 trader:fhv:rehearsal -- --target-sha "$EXECUTION_SERVER_TARGET_SHA" --run-id <human-approved-unique-run-id> --artifact-root "$FHV_ARTIFACT_ROOT" --t4-deterministic-pause --fixture HTR_WP03_BENCHMARK` | Prepare rehearsal manifest under `$FHV_ARTIFACT_ROOT/RI-P7/fhv-ops-rehearsal/<run-id>/` |
| `scripts/ops/fhv-validate-origin-url.sh` | Exact approved origin validator (dependency-free) |
| `scripts/ops/fhv-t4-host-preflight.sh` | PRE_AUTHORIZED dependency-free host binding verifier |
| `scripts/ops/fhv-service-user-checkout.sh` | POST_AUTHORIZED service-user fresh checkout |
| `scripts/ops/fhv-service-user-install-deps.sh` | POST_AUTHORIZED frozen lockfile install as service user |
| `scripts/ops/fhv-t4-campaign-systemd-identity-read.sh` | Completed inactive/success campaign unit identity |
| `scripts/ops/fhv-supervisor/render-units.sh` | Render `waia-fhv-campaign.service` + `waia-fhv-observer.service` (no install) |
| `scripts/ops/fhv-supervisor/install-units.sh` | **Human-only T4A** — install units with `--confirm` on Execution Server |
| `scripts/ops/fhv-supervisor/rollback-units.sh` | **Human-only T4A** — stop/disable/remove units with `--confirm` |
| `scripts/ops/fhv-systemd-record-deploy.sh` | **Human-only T4A** — write `.ops/fhv-systemd-deployed-revision.v1.json` with `--confirm` |
| `scripts/ops/fhv-systemd-verify-deploy.sh` | Verify FHV systemd deployment record matches target SHA and rehearsal identity |
| `scripts/ops/fhv-t4-host-probe.sh` | Read-only host probe JSON for rollback/ceremony verifiers |
| `corepack pnpm@10 trader:fhv:t4:status` / `arm-pause` / `resume` / `verify` | Signed T4 operator CLI (localhost observer bridge; bounded AbortSignal timeout) |
| `corepack pnpm@10 trader:fhv:t4:verify-paused` | Released paused-state verifier (`FHV_T4_PAUSED_VERIFICATION_PASS`) |
| `corepack pnpm@10 trader:fhv:t4:verify-final` | Released final-state verifier incl. canonical run-chain (`FHV_T4_FINAL_VERIFICATION_PASS`) |
| `corepack pnpm@10 trader:fhv:t4:verify-deployment` | Installed/rendered unit digest + deployment record truth |
| `corepack pnpm@10 trader:fhv:t4:verify-rollback` | Post-rollback host state (fail-closed) |
| `corepack pnpm@10 trader:fhv:t4:seal-evidence` / `verify-seal` | Evidence seal create + verify |
| `corepack pnpm@10 trader:fhv:t4:verify-ceremony` | Machine-derived T4A + Gate 8 PASS aggregation (`T4A_RESULT`, `GATE8_RESULT`; `T4B_RESULT=NOT_EXECUTED_SEPARATE_GATE`) |
| `corepack pnpm@10 trader:fhv:t4:capture-continuity-before` | Continuity snapshot before SSH disconnect |
| `corepack pnpm@10 trader:fhv:t4:capture-continuity-after` | Continuity snapshot after reconnect + observer restart |
| `corepack pnpm@10 trader:fhv:t4:verify-continuity` | Continuity digest verification (`FHV_T4_CONTINUITY_VERIFICATION_PASS`) |

Systemd units require operator-supplied:

- `WorkingDirectory` (clean checkout root — not hardcoded `/root/waia`)
- `User` (non-root service account)
- `EnvironmentFile` (operator vault path — never committed)

Both units run SHA guard (`execution-server-preflight.sh`) in `ExecStartPre`.

## Sequence (Human-operated T4A)

1. **Resolve release identity:** after Human dev → main release merge, set `EXECUTION_SERVER_TARGET_SHA` to the exact new `main` release merge SHA. Verify tag peel and GitHub Release identify the same full SHA. Fail closed if unresolved. On the host, verify with `scripts/ops/fhv-release-checkout-identity.sh` (HEAD + tag peel + clean tracked tree) and `scripts/ops/execution-server-preflight.sh` (exact HEAD). Do **not** treat `validate-fhv-release-identity.sh` as a Git checkout verifier.
2. **Legacy preservation (when contract-required):** if an old checkout exists and relocation is mandatory for the chosen fresh distinct path, inventory + timestamped move once; never delete untracked legacy files. If the new checkout path is already distinct and relocation is not mandatory, leave the historical checkout untouched and record that decision.
3. Provision **fresh clean checkout** from `${FHV_ORIGIN_URL}` at `"$EXECUTION_SERVER_TARGET_SHA"`; verify clean tracked tree + SHA/tag identity PASS; then record immutable checkout-identity proof under the run-root as the service user.
4. Prepare rehearsal manifest with `--t4-deterministic-pause`; derive `FHV_RUN_DIR` from artifact root + run ID; bind `runDir`/`manifestPath` from CLI output.
5. Render and install qualified **systemd** units only (`waia-fhv-campaign`, `waia-fhv-observer`) with `--confirm`. Prove installed digests equal rendered digests via `trader:fhv:t4:verify-deployment`.
6. Pin `fhv-alert-policy/v1` digest from rehearsal manifest.
7. Start observer; verify active/health; arm signed PAUSE@40; verify pre-arm proof; then start campaign under **one shared 300000ms host-monotonic (CLOCK_BOOTTIME) deadline** bound to an immutable start marker + host boot ID (`Date.now` / `startedAtUtc` are informational only).
8. Verify with released surfaces only:
   - Bounded `fhv-operator-status/v1` under 256 KiB
   - `trader:fhv:t4:verify-paused` after deterministic pause at cycle 40
   - Signed `RESUME_FROM_CHECKPOINT`
   - `trader:fhv:t4:verify-final` (canonical run-chain via `validateFhvCanonicalRunChainCompletion`, `fullHistoryRescanDelta===0`, `REHEARSAL_OK`)
9. Capture continuity-before (observer + campaign systemd identities) → Human SSH disconnect/reconnect narrative → **observer-only restart** → continuity-after → `trader:fhv:t4:verify-continuity` must emit `FHV_T4_CONTINUITY_VERIFICATION_PASS` and write the continuity-verification proof. Campaign InvocationID/MainPID/activation identity must remain unchanged.
10. Seal evidence via `trader:fhv:t4:seal-evidence` then `trader:fhv:t4:verify-seal`.
11. Rollback with preview proof then `--confirm`; `trader:fhv:t4:verify-rollback`.
12. `trader:fhv:t4:verify-ceremony` for machine-derived T4A + Gate 8 fields (`T4A_RESULT=PASS`, `GATE8_RESULT=PASS`, `T4B_RESULT=NOT_EXECUTED_SEPARATE_GATE`).
13. Keep legacy health container `waia-execution-host:bp6` running until separately authorized cutover.

**Not in T4A:** Worker dashboard via authenticated tunnel (T4B / `DEE-437`).

## Rollback

- Preview first — prove no systemd state mutation
- `scripts/ops/fhv-supervisor/rollback-units.sh --confirm`
- Preserve append-only ledgers and FHV evidence
- Deployment record disposition: **PRESERVED**
- Fail closed on residual process or unknown systemd state (`|| true` forbidden on required final assertions)

## Historical evidence

| Fact | SHA / note |
|------|------------|
| Previous released `main` (pre DEE-424 release) | `1744301f6ed31c754b183634daa37372a7d898cb` |
| Legacy Execution Server checkout (Human preflight) | `6faea4eeeec5cae50ba025e59ade4117c77131df` |
| DEE-424 feature head (squash source, not a release target) | `dfb7b87c31450e1c494da84acaf5d5582f4daa4d` |
| DEE-424 dev squash merge | `2f6b164b732ac33275dd47a943fc06467d61be5e` |
| DEE-435 release (deterministic pause + systemd record) | `d4c0cf8f6f338fb4efa66679d1137bf26aa1adbd` |

These identities are historical records only. **Do not** use them as active deployment or rehearsal targets after a newer release supersedes them.

## Status

**NOT EXECUTED** — repository T4A operator surface closed under DEE-436; awaiting Human release of DEE-436, mandatory back-sync, independent V5 packet review, then `AUTHORIZE-FHV-OPS-DEPLOY` for T4A.
