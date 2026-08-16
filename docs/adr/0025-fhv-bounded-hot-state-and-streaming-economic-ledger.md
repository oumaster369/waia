# ADR-0025: FHV bounded hot state, streaming economic ledger, and the CI/Execution Server full-corpus boundary

**Status:** Accepted
**Date:** 2026-08-06
**Linear:** DEE-436 (parent DEE-416) — PR #452

## Context

The `fhv idhps full corpus gate` consumed its entire 125-minute step timeout on PR #452 run
`31011816726` (head `8f6298782f11adb5ac69c1402f1caacd1efa53fd`). Forensic analysis of artifact
`8937404026` established a measured, reproducible defect rather than flakiness.

**The run was alive and progressing when it was killed.** It reached 65.689% of the corpus
(4,146,944 of 6,312,960 bars) after 7,373.576 s, committing epoch 414 twenty-nine seconds before
the timeout. Memory was not a factor (RSS 478 MB against a 2.5 GiB cap) and no semantic,
economic, Guardian or reconciliation invariant failed.

**Cumulative checkpoint cost is quadratic in run length.** Each epoch performs a WAL truncate, a
full copy of `session.sqlite` into an exclusive temp file, a streaming SHA-256 over every byte, a
second copy into the epoch bundle, and an fsync — all Θ(current database size). The session
database is the only unbounded growth surface (every other checkpoint file saturates by epoch
100), growing linearly at **3,206,136 bytes per 10,000-cycle epoch (321 bytes/cycle)** from
append-only `trader_orders`, `trader_order_events` and `trader_fills`. Measured consequence:

| Epoch | `session.sqlite` | `checkpointBackupDurationMs` |
|---|---|---|
| 0 | 4,542,464 B | — (probe at 3.4 MB: 32.19 ms) |
| 413 | 1,167,781,888 B | 7,599.017 |
| 414 | 1,171,103,744 B | 7,646.919 |

Cumulative checkpoint time reached 1,597,964 ms — **21.7% of elapsed wall time and rising**.
End-to-end throughput decayed monotonically from ~1,667 cps to ~400 cps, against a canonical
floor of 877.

**Checkpoint cost is not the whole deficit.** Excluding all checkpoint time, the hot path
delivered 4,146,944 cycles in 5,775.612 s = **717.99 cps**, already 18.1% below the 877 floor.
The probe's 1.562x over-prediction decomposes exactly: checkpoint overhead 1.2767x multiplied by
hot-path shortfall 1.2232x equals 1.5617x.

**Nothing could catch it before two hours elapsed.** The GS-13 budget "gate" asserted only that a
JSON fixture literal equalled 400 and that a source file contained two identifier strings, so a
19.1x runtime breach (7,646.9 ms against 400 ms) passed silently. The canonical probe samples
4,509 cycles — 0.071% of the corpus, at the point of minimum state — and extrapolates with a flat
`totalBars / cps` model, so it structurally excludes the failure mode it gates. `MIN_THROUGHPUT_CPS
= 877` is exactly `ceil(6,312,960 / 7,200)`, the arithmetic minimum with zero margin; the probe
passed at 878.232 (+0.14%).

## Decision

**AD-1 — Bounded hot state**

`session.sqlite` retains only state required for deterministic resume: current/open orders,
current positions, frontiers (execution, accounting, identity, evidence), cursors, fencing
generation, bounded reconciliation state, and any other state proven necessary. Its size must be
bounded in run length.

Boundedness is a structural property of retained hot state over run length, not a whole-series
OLS bytes/cycle ceiling. Startup fill-up of a bounded database is not steady-state linear growth.
A conservative whole-series growth fit may remain available for projection/diagnostics; it is not
the AD-1 verdict. WP-7B and target-host throughput qualification consume one production-owned
assessor (`assessFhvBoundedHotState`) that classifies `BOUNDED`, `UNBOUNDED`, or
`INSUFFICIENT_EVIDENCE`. **BOUNDED requires a terminal/steady retained-state plateau**, not merely
any earlier high-water-mark plateau. Resumed linear growth after a plateau is `UNBOUNDED` even
when slower than the known ~320 B/cycle fast-failure signature (`FHV_UNBOUNDED_SUSTAINED_BYTES_PER_CYCLE = 256`
is a fast-fail detector, not a pass ceiling). A single SQLite page/envelope bump that then
restabilizes may remain `BOUNDED`. Insufficient terminal-plateau evidence fails closed. Tests must
not own a competing 160/280 structural threshold.

**AD-2 — Streaming economic ledger**

Append-only historical economic records — the `trader_orders` historical ledger,
`trader_order_events`, `trader_fills`, and any other record proven to cause linear database
growth — persist through the existing streaming-evidence / append-only economic-ledger
architecture instead of the repeatedly snapshotted hot-state database.

Economic rows are **not** merely deleted from SQLite. The ledger remains authoritative,
reconstructable, digest-bound, fail-closed, and economically identical to the current canonical
path. Deterministic reconstruction is preserved for fills, orders, positions, exits, PnL, fees,
slippage, HWM, drawdown, accounting sequence, reason codes, source frontier and audit lineage.

**AD-3 — Preserved mechanisms**

Fill idempotency, duplicate prevention, fencing-generation takeover, stale-writer rejection,
typed WAL v2 with fsync, atomic checkpoint publication (temp → rename → fsync, `.ready`, manifest
digests), crash/resume parity, bootstrap and terminal reconciliation,
`authoritativeSemanticDigest`, `auditLineageDigest`, and **all three GS-07 phases
(`frontier_mutation`, `before_guardian`, `before_cycle_complete`) distinct and independently
fail-closed**.

**AD-4 — Migration and retirement discipline**

The change requires an additive, reversible migration or a versioned storage contract, ships
behind a configuration switch defaulting to the current path, and requires a **dual-path parity
proof** — byte-identical terminal economics between the old and new storage paths on the same
bounded fixture — before the old path may be retired.

**AD-5 — Unchanged canonical contracts**

`MIN_THROUGHPUT_CPS = 877`, `MAX_PROJECTED_FULL_CORPUS_RUNTIME_S = 7200` and
`MAX_BATCH_CYCLES = 32` are unchanged and must not be weakened. 1,000 cps remains a non-blocking
engineering target and must never become the canonical blocking floor.

**AD-6 — Checkpoint cost budget**

At 1-GB-equivalent qualification depth, per-10,000-cycle checkpoint duration must be **≤ 400 ms
(blocking)** with an engineering target of **≤ 250 ms**. The budget is enforced against measured
runtime by a cost-model gate, never by a fixture assertion.

**AD-7 — Pre-launch projection headroom**

Growth-aware projected official runtime must be **≤ 6,480 s** before any official Execution Server
full corpus is authorized. This is a pre-launch safety requirement providing 10% headroom; the
canonical terminal acceptance remains ≤ 7,200 s.

**AD-8 — CI / Execution Server boundary**

GitHub pull-request CI blocks on the bounded gate set: lint, typecheck, unit tests, tenant
isolation, structural complexity, GS-07 independent corruption injection, accounting/economic
parity, the checkpoint cost-model gate, durability fault injection, process crash/resume parity,
deep-state stability, the canonical probe with growth-aware projection, the representative
deep-corpus gate, build, e2e, artifact identity, and the release/ceremony validators.

**PR CI no longer executes the official 6,312,960-bar full corpus as a merge-blocking job.** The
capability is not deleted: the script, blocking test, harness and evidence staging all remain and
remain runnable.

Official full-corpus technical qualification moves to the approved Execution Server, after Human
squash merge → release promotion → mandatory back-sync → deployment verification → official
dataset qualification → configuration freeze → deterministic control replay → Human authorization.
It must still satisfy runtime ≤ 7,200 s, `sourceExhausted == true`,
`globalEventSequence == 6312960`, `classification == FULL_HISTORICAL_TECHNICAL_COMPLETION`,
complete identity-bound immutable evidence, and complete economic and accounting output.

**AD-9 — Two distinct readiness states**

`PR452_RECOVERY_READY_FOR_HUMAN_SQUASH_MERGE` requires exact-head bounded CI green including
build and e2e. It **does not** claim the official full corpus has run.
`AI_TRADER_FHV_OBSERVABLE_EXECUTION_SERVER_LAUNCH_PACKET_READY_FOR_HUMAN_AUTHORIZATION` is a
separate, later state. Official FHV completion is later still and must never be claimed by a PR
build.

**AD-11 — Economic seal replaces terminal state as the prune frontier**

A terminal `OrderState` is **not** an economic-immutability frontier. `ORDER_TRANSITIONS` makes the
five terminal states absorbing *for state transitions*, but `recordFillSqlite` and
`recordFillProgressSqlite` guard only on parent existence — `TERMINAL_ORDER_STATES` appears in
`repository-sqlite.ts` solely inside `listOpenOrders`. The lifecycle therefore permits appending
fills and updating filled quantity / average fill price on an order that already reached FILLED,
CANCELLED, REJECTED, EXPIRED or FAILED.

The authoritative cutover is an explicit, durable, versioned **economic seal** issued only by the
epoch-commit lifecycle once the order is economically complete and reconciled, its history is
durable and digest-verified in the ledger, the owning epoch is committed, and the source frontier
proves consumption. Terminality is one input; it is never sufficient. Required order, never
reordered: ledger append → ledger verification → clean reconciliation → epoch commit → seal
publication → checkpoint durability → prune. Pruned rows without a committed seal are impossible.

**AD-12 — Order collections are canonically unordered; export sorts explicitly**

The legacy `listOrders` SQLite query has no `ORDER BY`, so its array order was implicit rowid
iteration order. That is an artifact of an undefined query order, not a domain contract, and it
cannot survive pruning because SQLite reuses rowids after `DELETE`.

Repository evidence shows every economic projection already imposes its own canonical sequence:
`sortFillEvents` orders fill events by `(executedAt, fill.id)`; historical execution cost
provenance sorts by `(fillSequence, economicsContentDigest)`; the serializer sorts strategy
evaluations by `strategySignalId` and valuation gaps lexically. The order collection is therefore
consumed as a **set**.

Terminal export orders the merged collection by **`(createdAt, id)`** — deterministic,
replay-stable, backend-independent, and totally ordered by the stable order id. Proven, not
assumed: the bounded path reproduces the accepted `semanticReproDigest`
`25b48cc85dc1bcca481f99bf08f9c20662b3c5b89bdb3c6318909e0d441a4513` exactly, together with
`authoritativeEvidenceDigest` and `accountingStateDigest`, with no reliance on implicit rowid.
The accepted digest is preserved unchanged; no fixture or expected economic value was edited.

Rejected: implicit rowid (reused after prune, and an accidental dependency); `createdAt` alone
(ties are real — many orders share a bar timestamp); a new durable ordinal column or companion
allocator (unnecessary once the collection is proven unordered, and it would add an irreversible
schema surface); a versioned export contract (unnecessary — the accepted digest is reproducible).

**AD-13 — Ledger-backed read authority and post-seal idempotency**

Terminal export reads through the `OrderRepository` seam (`listOrders`, `listEvents`, `listFills`).
A decorator merges verified sealed ledger history with bounded live SQLite state, with authority
decided exclusively by the seal registry — never terminal state, never last-write-wins, never an
implicit epoch comparison, never a silent fallback to incomplete SQLite. The ledger is verified
once per immutable snapshot and indexed once; reads are indexed lookups bounded by output size.
Conflicting overlap, scope violation, digest mismatch, identity drift and sequence gaps fail
closed under named classifications.

**AD-14 — Post-seal write authority and ledger-backed fill idempotency**

Once a sealed order's rows are pruned, the parent lookup in `recordFillSqlite` /
`recordFillProgressSqlite` no longer finds it and the `trader_fills` idempotency index is gone.
Both write paths therefore consult a run-scoped verified sealed registry before concluding the
parent is missing:

| Case | Condition | Result |
|---|---|---|
| A | Mutable SQLite parent exists | Current canonical behaviour, unchanged |
| B | Parent pruned, exact fill identity and canonical payload match sealed history | Return the canonical prior fill; no fill, event, quantity, price, inventory, portfolio or accounting mutation |
| C | Parent pruned, same fill identity, payload differs | `FillConflictError`, fail closed, no economic mutation |
| D | Parent pruned, sealed order, genuinely new fill | `EconomicSealBreachError`, run terminated through the accounting bridge as reconciliation-required; sealed history never mutated, order never silently reopened |
| E | Neither SQLite parent nor sealed order | `OrderNotFoundError` preserved |

`recordFillProgressSqlite` resolves sealed authority **before** delegating, so an idempotent
duplicate never reaches the order UPDATE or the event append. Payload comparison reuses the
existing canonical `fillPayloadMatches`. The registry lives on the IDHPS session runtime — run
scoped, discarded with the session, never a process-global registry — and is rebuilt once per
seal publication, never per write. Lookups are O(1) indexed; nothing is re-verified or re-hashed
per write.

**AD-15 — Migration disposition: NOT_APPLICABLE**

The O3 ordering contract needs no schema change, and no other WP-6A change requires one. No
migration was created. Fresh bounded sessions, default-off legacy sessions and existing legacy
checkpoints are all unaffected: the ledger, seal log and seal manifest are new run-scoped
artifacts under the run directory, and none of them participate in the default-off path.

**AD-10 — Human-only operations**

Merge, release promotion, back-sync, Execution Server deployment or mutation, PRE_AUTH, T4/T4A
execution, official dataset qualification, and the official launch remain HUMAN-ONLY, consistent
with ADR-0023 and `INTEGRATION-BOUNDARY-POLICY.md`.

## Consequences

**Positive**

- Per-epoch checkpoint cost becomes independent of run length, removing the quadratic term.
- A checkpoint regression fails a ten-minute gate instead of a two-hour job.
- PR CI gains a bounded envelope, and `build` and `e2e` become reachable.
- Long-running campaigns run on the plane ADR-0023 designates for them.
- Negative economic results remain first-class evidence (ADR-0010, EVIDENCE-POLICY).

**Negative**

- Reconstructing terminal economics now spans the hot-state database and the streaming ledger, so
  resume and terminal reconciliation carry more surface and require the AD-4 dual-path proof.
- Merge no longer implies the official full corpus has passed; the two readiness states must be
  reported distinctly to avoid overclaiming.
- The Execution Server becomes a prerequisite for official qualification, adding an operational
  dependency to the release chain.

**Rejected alternatives**

- *Base snapshot plus per-epoch WAL increments* — removes the repeated full copy but keeps one
  physical SQLite lineage and adds replay complexity to the resume path. Deferred; AD-1/AD-2 give
  the stronger asymptotic result.
- *Relaxing the runtime contract* — only the Human may alter 877 / 7,200, and the growth law would
  still make runtime unbounded in corpus length. Rejected as a substitute for the architecture fix.
- *Raising the checkpoint interval further* — already attempted (3,997 → 10,000). It reduces
  checkpoint count but each remaining checkpoint still costs Θ(database size), so the quadratic
  term survives.

## AD-6a — Native clone, and splitting software qualification from target-host qualification

*Human decision `APPROVE_PR452_WP3B_SPLIT_SOFTWARE_CI_GATE_AND_EXECUTION_SERVER_HOST_QUALIFICATION`.*

The AD-6 contract is unchanged: a 1-GiB-equivalent checkpoint must complete its entire blocking
interval in **≤ 400 ms**, with **≤ 250 ms** as the non-blocking engineering target. What changed is
*where* that number is proven, and why.

**Two earlier findings were wrong and are corrected here.**

`copyFileSync(src, dst, COPYFILE_FICLONE)` never proved a reflink. It is documented to fall back to
a full byte copy when the filesystem cannot clone, and it returns success either way, so every
earlier `ficloneSucceeded=true` reading was unfalsifiable. Measured on APFS, that path took
530–556 ms for 1 GiB while `cp -c` cloned the same file in ~0 ms; `COPYFILE_FICLONE_FORCE` raised
`ENOSYS` because it maps to a Linux ioctl that libuv does not implement on macOS. Clone success is
now claimed only when the strict platform mechanism itself succeeds — `clonefile` via `cp -c` on
macOS, `FICLONE` via `cp --reflink=always` on Linux — and only after the destination is
independently verified. Capability is never inferred from an API returning success, from the OS
name, from a filesystem name, or from elapsed time.

Consequently the earlier conclusion that 400 ms at 1 GiB is *physically impossible* was also false.
It rested on the copy cost that the fake reflink was hiding. With a real clone the snapshot is
O(1) — 1.8–3.9 ms measured — and the only size-proportional work left is the mandatory SHA-256.

**The contract is host-class dependent, and hosted CI cannot satisfy it.** GitHub Actions run
[31098325969](https://github.com/oumaster369/waia/actions/runs/31098325969) probed both pinned
standard macOS classes. Both proved strict native clone on APFS, and both failed the budget purely
on hashing speed:

| Host | Clone | Snapshot | SHA-256 | Total (3 measured) |
|---|---|---|---|---|
| Reference workstation | proven | 1.8–3.9 ms | 385–389 ms | 394.5 / 399.0 / 400.5 ms |
| `macos-15` (M1 Virtual, 3 vCPU) | proven | 2.6–3.8 ms | 730–775 ms | 735.0 / 781.2 / 750.2 ms |
| `macos-15-intel` (i7-8700B) | proven | 4.2–9.9 ms | 2729–2980 ms | 3007.2 / 2777.3 / 2742.8 ms |

Meeting 400 ms at 1 GiB requires roughly **2.8 GB/s sustained single-stream SHA-256**. No standard
GitHub-hosted runner delivers half of that, and hashing one stream is single-threaded, so larger
runner classes do not help. Ubuntu runners fail earlier still: ext4 cannot reflink at all.

**Decision.** Pull-request CI remains merge-blocking for *software correctness* and runs on the
existing hosted runners: production code path, truthful capability classification, clone/fallback
byte and digest equivalence, mutation isolation, durability presence, crash and resume behavior,
economic and semantic parity, cost decomposition, and the artificial-delay negative test. It also
computes and emits the target-host requirement (`requiredSingleStreamSha256BytesPerSecond`,
`maximumAllowedNonHashMilliseconds`, `requiredNativeCloneCapability`,
`requiredFilesystemSemantics`, `requiredCompleteCheckpointMilliseconds = 400`).

To keep runner speed from deciding correctness, the blocking measurement is normalized: checkpoint
cost is expressed in **hash-equivalent passes**, meaning multiples of one SHA-256 pass over the
same bytes as measured on that same host. A clone-based checkpoint sits near 1.0 everywhere; a
reintroduced full copy lands near 2.0 and the old clone-then-rehash shape near 3.0. A slow host
stays green; a structural regression fails everywhere.

The absolute 1-GiB / 400 ms measurement moves to `pnpm trader:fhv:wp3b-host-qualification`, a
mandatory fail-closed **post-release Execution Server preflight** that emits an identity-bound
receipt classified as `EXECUTION_SERVER_WP3B_HOST_QUALIFIED`,
`EXECUTION_SERVER_WP3B_HOST_NOT_QUALIFIED`, or `EXECUTION_SERVER_WP3B_HOST_EVIDENCE_INVALID`. The
official full-corpus run must not start unless the receipt is `QUALIFIED`.

**No self-hosted runner is required for PR merge readiness.** Nothing here changes the 1-GiB depth,
the 400 ms budget, the 250 ms target, SHA-256 identity, checkpoint contents, durability, atomicity,
crash safety, economic or semantic output, 877 cps, 7,200 s, `MAX_BATCH_CYCLES=32`, or the
6,480-second pre-launch projection requirement.

**The launch gate is derived from configuration, never from the environment.** An intermediate
revision gated the receipt on `FHV_OFFICIAL_LAUNCH === "1"`, which inverted the safety property: an
operator who simply forgot the variable would silently bypass host qualification on the real
campaign. The gate now lives inside the launch path, immediately after the dataset qualification
receipt is validated, and `requiresWp3bTargetHostQualification` classifies from validated facts —
`boundedFixture`, dataset qualification mode, execution purpose, and above all whether `maxCycles`
is absent. An unbounded official run may still carry a synthetic scale authority to bind
`targetCycleCount`, so authority presence proves nothing; only an explicit cycle cap makes a run
bounded. Bounded fixtures, synthetic probes, process-parity runs and PRE_AUTH bootstrap therefore
proceed without a receipt they could never produce, while `FHV_OFFICIAL_LAUNCH`,
`FHV_SKIP_WP3B_LAUNCH_GATE`, `NODE_ENV`, `CI` and `GITHUB_ACTIONS` cannot weaken the official path.
The receipt itself is validated on every axis its writer binds — schema, self-digest, release
identity, proven native clone, 1-GiB depth, every measured iteration within 400 ms, durability
inside the timer, and negative-test validity — so a receipt that claims QUALIFIED while
contradicting its own evidence fails closed.

**WP-3B v2 host qualification for release `b6ad57373c4c51152321f656ff814628212627e4`
(`v2026.08.15.b6ad57373c4c`) was Human-run and classified
`EXECUTION_SERVER_WP3B_HOST_QUALIFIED`.** That receipt is bound to that exact SHA. A later repair
release is a different code identity and is not WP3B-qualified by the b6ad573 receipt. Throughput
qualification remains unresolved. Requalification is required whenever the host, filesystem,
storage, Node version, or code release SHA changes; rollback is to refuse launch, since the gate
has no weaker passing state.

## AD-6b — Splitting throughput CI observation from absolute target-host performance qualification

*Human decision `APPROVE_PR452_SPLIT_CANONICAL_THROUGHPUT_CI_GATE_AND_EXECUTION_SERVER_ABSOLUTE_PERFORMANCE_QUALIFICATION`.*

The throughput contract is unchanged: **877 cps** minimum, **7,200 s** canonical terminal maximum,
**6,480 s** growth-aware pre-launch maximum, **1,000 cps** as a non-blocking engineering target, and
`MAX_BATCH_CYCLES=32`. What changed — exactly as in AD-6a — is *where* absolute wall speed is
authoritative, and why.

PR452 CI run [31154319950](https://github.com/oumaster369/waia/actions/runs/31154319950) failed the
canonical probe on `ubuntu-24.04-arm` with `cps=874.006` and `projected_runtime_s=7223.0` — a flat
absolute wall-speed extrapolation, 3 cps under the floor. Every software and structural gate in the
same run was GREEN. This is a **qualification-surface defect, not an engine-correctness defect**: a
hosted VM's clock cannot decide whether the target Execution Server can finish the corpus in time.

**Decision.** The canonical probe still runs in PR CI and still reports its true absolute
measurements — `cps`, `projectedRuntimeS`, and an explicit `absoluteHostClassification`
(`FHV_ABSOLUTE_HOST_877_7200_PASS`/`FAIL`). Those values are never falsified or hidden. But the
merge-blocking signal is now the **software gate** (`ciSoftwareGatePass` / `ciGateClassification`):
the probe must execute the production path with a coherent workload classification, reach a
non-trivial checkpoint, and satisfy the disk-feasibility bound. The canonical absolute evaluator
`evaluateFhvOfficialScaleTimeFeasibility` still returns `pass=false` for `cps=874.006` /
`7223.0 s`; it is simply no longer the hosted-runner merge gate. A regression test locks that exact
measurement to `false`.

The absolute performance proof moves to `pnpm trader:fhv:throughput-host-qualification`, a
fail-closed **post-release Execution Server preflight** that consumes the production-path growth-law
report (never a synthetic CPU microbenchmark) and emits an identity-bound receipt classified as
`EXECUTION_SERVER_FHV_THROUGHPUT_QUALIFIED`, `EXECUTION_SERVER_FHV_THROUGHPUT_NOT_QUALIFIED`, or
`EXECUTION_SERVER_FHV_THROUGHPUT_EVIDENCE_INVALID`. A QUALIFIED receipt requires, fail-closed: exact
clean checkout HEAD (not `FHV_RELEASE_SHA` alone), an **execution-time producer binding** proving
the code HEAD, physical/runtime host identity, run identity, and qualifier-owned sampler contract
that generated the progress JSONL. The binding is captured when the representative run starts
(`fhv-throughput-producer-binding/v2`): producer HEAD, tracked-tree clean, `runId`, resolved
`runDir`, hostname/platform/arch/CPU model/logical CPU count/exact Node version, and — when the
canonical Linux files are readable — SHA-256 of `/etc/machine-id` bytes (same as T4
`sha256sum /etc/machine-id`) plus T4-normalized `/proc/sys/kernel/random/boot_id`. Receipt `host`
is copied from that execution-time identity; live `os.hostname()` / `cpus()` / `process.version` at
report time cannot re-label Host-A evidence as a Host-B receipt (`FHV_THROUGHPUT_PRODUCER_HOST_MISMATCH`
/ `FHV_THROUGHPUT_PRODUCER_RUNTIME_MISMATCH`). Copied evidence trees cannot silently relabel
`runDir` (`FHV_THROUGHPUT_PRODUCER_RUNDIR_MISMATCH`). The digest chain is producer-binding digest →
progress JSONL byte digest → growth-law report self-digest → throughput receipt self-digest, with
`runId` bound through the final receipt. Target-host identity, independently counted progress
samples and distinct `checkpointCount` observations, production-owned `BOUNDED` hot-state
classification (terminal plateau; not whole-series OLS), a `FLAT` hot-path stability verdict from
equal work-mass cumulative `globalEventSequence` versus checkpoint-excluded hot time
(`elapsedSeconds - cumulativeCheckpointDurationMs/1000`; assessor
`fhv-hot-path-stability-assessor/v2`), invariant to legal evidence-window subdivision when both
representations meet the canonical sampler minima, with insufficient or malformed cumulative
evidence failing closed. The 10% degradation cap is unchanged. Per-sampler-window CPS remains
diagnostic only and must not control the authoritative verdict. Readers fail closed on an
unsupported assessor version. The Cherry host is not special-cased. Qualification also requires
an available growth-aware projection within **6,480 s**. Malformed or unbound evidence is
`EVIDENCE_INVALID`; valid
evidence that misses the performance/structure contract is `NOT_QUALIFIED`. The receipt embeds and
validates the canonical 877/7200/6480 constants **and the full sampler contract fields** so a weaker
contract cannot pass through a schema-consistent file. Unbound v1 receipts cannot qualify a new launch.
No environment variable — `NODE_ENV`, `CI`, `GITHUB_ACTIONS`, `FHV_IDHPS_PROGRESS_INTERVAL_MS`, or any
skip flag — can weaken it.

**The official unbounded launch now requires both target-host receipts.** Alongside the WP-3B
checkpoint receipt, the launch path requires a valid throughput receipt (`--throughput-host-
qualification-receipt-path`) before consuming authorization. The gate is configuration-derived via
the same `requiresWp3bTargetHostQualification` classification, so bounded fixtures, synthetic
probes, process-parity runs and PRE_AUTH bootstrap never require a receipt they cannot produce. The
official full corpus still has its **7,200 s** terminal acceptance; 6,480 s is the pre-launch margin.

**Throughput qualification remains unresolved.** WP3B v2 PASS on `b6ad57373c4c51152321f656ff814628212627e4`
does not close DEE-536 and does not qualify a later repair SHA. No official full corpus has run.

## AD-6c — Two-phase checkpoint authority, and splitting blocking capture from destination verification

*Human decision `APPROVE_DEE_536_TWO_PHASE_CHECKPOINT_AUTHORITY_IMPLEMENTATION` (DEE-536).*

The AD-6 contract is unchanged: destination identity remains SHA-256 of the published destination
`session.sqlite` bytes; qualification depth remains **1 GiB**; the blocking capture budget remains
**≤ 400 ms** with engineering target **≤ 250 ms**; durability, atomicity, and crash safety are
unchanged; `MIN_THROUGHPUT_CPS = 877`, terminal maximum **7,200 s**, pre-launch maximum **6,480 s**,
and `MAX_BATCH_CYCLES = 32` are unchanged and must not be weakened. Source hashing remains forbidden
as checkpoint identity.

What changes is *when* destination SHA-256 runs relative to the blocking capture interval, and
*what* may be treated as resume authority.

**Two-phase checkpoint authority.** Boundary N produces `PROVISIONAL_DURABLE` state plus live
speculative N+1 cycles. `PROVISIONAL_DURABLE` is never resume authority, journal authority, claim
authority, or a retention/prune frontier. Authority requires destination SHA-256 of the exact
provisional dest inode, valid fencing, sealed epoch-N evidence promoted to its canonical directory,
a resume-complete post-commit IDHPS composite bound into the verified bundle, then
`EXECUTION_CHECKPOINT` / `EPOCH_COMMIT` / launch journal / claim.

**GATE 1 — blocking capture latency.** The ≤ 400 ms budget (≤ 250 ms target) at 1 GiB times the
complete synchronous work required before cycle execution can continue: fail-closed WAL `TRUNCATE`,
strict native FICLONE, provisional destination durability, sidecar capture, frozen IDHPS snapshot,
live IDHPS working-set rotation, evidence N seal in place, opening the N+1 speculative evidence
writer, canonical WAL freeze bookkeeping, and verifier submission. GATE 1 does not include
off-main-thread destination file traversal.

**GATE 2 — destination verification / authority liveness.** Destination SHA-256 of the cloned dest
bytes runs on a Worker Thread. It remains a mandatory prerequisite to authority. A SHA mismatch
never promotes. GATE 2 liveness is derived from canonical cadence / minimum throughput
(`checkpointEveryCycles / 877 cps`). Runtime backlog ≤ 1 remains the safety mechanism.

**One WP3B receipt, two mandatory axes.** Official launch still consumes a single identity-bound
receipt (`fhv-wp3b-host-qualification/v2`). Classification is
`EXECUTION_SERVER_WP3B_HOST_QUALIFIED` only if `gate1BlockingCapture` and
`gate2DestinationVerification` both PASS. No environment variable may bypass either axis.

Moving destination SHA outside GATE 1 does **not** weaken or remove SHA. A provisional checkpoint
is never authority.

**WAL.** Canonical `execution.wal.ndjson` freezes through `EPOCH_COMMIT` N. Recovery truncates to
the physical end of the journal-authoritative `EPOCH_COMMIT` (not `payload.walEndOffset`).

**IDHPS.** Frozen N is detached from live N+1. Durable Step 10 is not run on live at provisional
freeze. The verified checkpoint binds the post-commit frozen-N composite before journal authority.

**Evidence.** An active epoch evidence writer is never relocated. Active writers live at
`evidence/.speculative/epoch-K/generation-G/` for their entire lifetime. Sealed inactive evidence N
is promoted to `evidence/epoch-N/generation-G` before journal N.

**Retention.** Only journal-authoritative canonical epochs count. Provisional and orphan
`epoch-X` where X > journal last committed epoch never displace verified recovery points.

## Links

- PR [#452](https://github.com/oumaster369/waia/pull/452) — DEE-436 / DEE-416
- [ADR-0010 Strategy Validation Gate](0010-strategy-validation-gate.md) — historical replay proves plumbing, not edge
- [ADR-0021 Deterministic research replay clock and state isolation](0021-deterministic-research-replay-clock-and-state-isolation.md)
- [ADR-0022 Content-bound operator authorization and idempotent dataset lifecycle](0022-content-bound-operator-authorization-and-idempotent-dataset-lifecycle.md)
- [ADR-0023 Execution Server as AI-TRADER-only execution plane](0023-execution-server-ai-trader-only-execution-plane.md)
- [`../ai-trader/AI-TRADER-TARGET-ARCHITECTURE.md`](../ai-trader/AI-TRADER-TARGET-ARCHITECTURE.md) — Execution Server owns long-running campaigns
- [`../waia-governance/INTEGRATION-BOUNDARY-POLICY.md`](../waia-governance/INTEGRATION-BOUNDARY-POLICY.md) — HUMAN-ONLY operations
- [`../../lib/trader/observability/fhv-checkpoint-cost-model.ts`](../../lib/trader/observability/fhv-checkpoint-cost-model.ts) — AD-6 enforcement
- [`../../lib/trader/observability/fhv-bounded-hot-state.ts`](../../lib/trader/observability/fhv-bounded-hot-state.ts) — AD-1 production boundedness assessor
- [`../../lib/trader/observability/fhv-throughput-receipt.ts`](../../lib/trader/observability/fhv-throughput-receipt.ts) — AD-6b throughput host-qualification receipt
- [`../../scripts/ops/fhv-throughput-host-qualification.ts`](../../scripts/ops/fhv-throughput-host-qualification.ts) — AD-6b Execution Server throughput preflight
- [`../../lib/trader/observability/fhv-growth-law.ts`](../../lib/trader/observability/fhv-growth-law.ts) — AD-7 projection
