# Scientific process observation v1

DEE-990 local diagnostic adapter. This is not a deployed monitor or scientific
receipt verifier. Never treat an external `exit-status=0` marker as completion.

## Input acquisition contract

The adapter accepts exactly seven projected Docker fields: containerId, startedAt,
finishedAt, status, exitCode, oomKilled, restartCount. Do not pass full inspect JSON,
Config, Env, labels, credentials or arbitrary journal/log text. Acquire those fields
read-only through an independently authorized collector; this module has no Docker,
SSH, database, credential or process-launch dependency.

The collector must independently bind organization/run/release/attempt to an exact
container ID and raw StartedAt using the original trusted launch record. Do not
invent an attempt UUID to satisfy the type or attach the requested org to an
unidentified container. Missing binding means UNKNOWN and no admission.

Capture observation time on reading, not from a stale progress line. Reconcile with
an explicit freshness budget and current clock. Wrapper/journal/evidence timestamps
must be the read/verification time and have the same independently verified identity.

## Normalization and refusal

Exact raw StartedAt is compared before truncating Docker nanoseconds to milliseconds.
Invalid calendar dates, time zones other than UTC Z, unsupported precision, restart
counts other than zero, mismatched container IDs, unrequested fields and malformed
types refuse. Finish-before-start and finish-after-observation are checked without
losing nanosecond ordering. An unstarted sentinel is not a real completion time.
Running default exit0 becomes null; terminal exit1 remains1 even if a wrapper says0.
Exit137/143 alone does not prove the terminating signal; retain the exit value and
do not fabricate a signal observation.

An adapter refusal yields null: the reconciler reports missing/unknown container
state rather than filling defaults. Preserve the original protected evidence for
separate diagnosis; do not log unfiltered payloads from this adapter.

## Scientific evidence remains separate

Zero container exit is EXITED_ZERO, not scientific PASS. `VERIFIED` input is allowed
only after independent canonical receipt validation for the exact attempt, including
scope, version, admission and scientific evidence requirements. A preparation row,
CLI success line, proposal count, JSON shape or digest-shaped string cannot replace
that verification. The diagnostic result always has authorityGranted=false.

Production collector wiring, canonical receipt verification, bounded journal reads,
independent review and full publication gates remain outstanding. Do not declare
the entire DEE-990 issue complete on the basis of the pure-adapter tests.

## False-success marker and append-only supersession

Host forensic identities for the 90de233a wrapper marker are recorded in
`scripts/trader/scientific-false-success-marker-v1.ts`. The marker file and log
remain on the host and are never overwritten. Tests use the exact two-byte marker
`0\n` plus log size/digest metadata.

SUCCESS still requires authoritative container terminal status AND a separately
verified immutable result receipt AND matching run/release identity. Wrapper
exit 0, attach-shell exit 0, SSH disconnect, a health endpoint, and a stale
`exit-status` file cannot promote SUCCESS. A new launch while `launch.started`
exists is refused as a duplicate start. No Docker start/stop and no automatic
retry live in this observer.
