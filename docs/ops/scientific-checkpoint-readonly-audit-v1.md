# Scientific checkpoint read-only audit v1

DEE-991. This procedure checks existing completed artifact bytes. It does not resume
computation, qualify a strategy, repair data, or grant execution authority.
Production use requires a separately authorized exact tool revision and directory.

## Preconditions

1. Establish that the producer exited using container identity, exit status and time;
   a wrapper's zero marker alone is insufficient. Do not stop or restart a producer
   as part of this audit. Never audit an actively changing tree.
2. Record the exact source revision, Node version, OS and architecture separately.
   Use the existing owner of the private checkpoint tree. No recursive permission
   changes, key creation, copying of keys, cache factory calls or network access.
3. Select one exact existing absolute canonical directory, not a parent or symlink.
   Directory and file permissions must exclude group/other access; expected deployed
   modes are 0700 and 0600. The existing `.seal-key` stays private and is never printed.
4. Budget one sequential pass through all completed payload bytes. There is no
   bootstrap calculation. Memory includes a bounded authenticated manifest (at most
   64 MiB serialized plus decoded inventory) and chunk buffers, not the full corpus.
   No time estimate can be inferred from file count alone.

## Invocation after authorization

From the reviewed checkout, substitute the verified directory for the placeholder:

```sh
WAIA_TRADER_CLI=1 node --import tsx --conditions=react-server scripts/trader/scientific-checkpoint-audit-cli-v1.ts --root <ABSOLUTE_PRIVATE_CHECKPOINT_DIRECTORY> --quiescent-tree
```

`--quiescent-tree` is an operator assertion, not a lock or independent proof. Some
concurrent modifications are detected, but this is not a filesystem snapshot.
Reads can change access times. The tool itself does not create an output file.

For a long remote audit, SSH stdout alone is not a durable result. Before execution,
arrange private persistent stdout/stderr and an independently queryable process exit
status outside the checkpoint tree. Restrict that runner to a read-only view of the
checkpoint directory and no network; allow output writes only to its diagnostic
directory. A disconnected SSH session means result UNKNOWN unless the original
audit's durable report and exit status can be recovered. Check the original process
before considering any repeat; never confuse repeating an authorized integrity read
with authority to restart scientific preparation. Preserve failed/unknown attempts.

## Interpretation

| Exit | Meaning | Next action |
| --- | --- | --- |
| 0 | All encountered completed entries verified | Check expected inventory and applicability separately |
| 2 | No completed entries; partials may exist | Preserve artifacts; no recovery claim |
| 1 | Audit refused | Preserve everything; investigate without repair or rerun |
| 64 | Invocation rejected | Correct arguments; no storage audit occurred |

Only one sanitized JSON report is emitted on success. Refusal emits no raw exception,
path, key or payload. Partial directories are counted, retained and excluded, not
verified. A failure aborts the pass and must not be turned into a partial PASS.

## Exact reuse boundary still requiring evidence

The v1 directory key hashes format, exact release SHA, Node/OS/architecture, stage,
and the actual canonical input. The seal records that opaque key, not an independently
recoverable full stage/input/release tuple. HMAC proves consistency with the local key,
not independent scientific validity or protection from someone possessing that key.

Do not derive an expected inventory from the same observed directories: that cannot
detect missing entries. Reconstruct expected keys from trusted original stage inputs
and runtime identity; verify this mapping against the unchanged store algorithm.
Where those inputs are unavailable, report applicability as unknown, not reusable.
Never relabel an old-SHA artifact as a new-SHA cache hit.

### Original-runtime expected-key lookup (local diagnostic API)

`deriveScientificCheckpointKeyV1` accepts an explicit original release, Node/OS/arch,
stage, kind and input. Parity tests compare it with entries actually published by
the unchanged v1 store. `inspectExpectedScientificCheckpointKeysV1` authenticates
the corresponding existing seals, reporting SEALED_KEY_MATCH or
MISSING_COMPLETED_ENTRY. Neither function invokes a builder or creates entries.
The lookup does not recheck payload integrity or establish caller-input provenance;
its report explicitly leaves those claims unproved. It is not exposed by the
integrity CLI and must not silently replace the previously approved standalone file.

Reject executable/accessor/proxy metadata, custom iterators, invalid or duplicate
expectations. The expected list must originate independently from original launch
and data records, not the directory inventory being checked. Authentication of a
caller-supplied key alone is not a reusable-stage admission.

For the preserved 90de233a run, the actual original image reports Node v22.23.2;
the host integrity-auditor runtime was v22.23.0. Substituting the auditor's version
would generate different keys even if the scientific inputs were unchanged.

Integrity does not prove evidence can be deserialized, a negative outcome is positive,
or an interrupted terminal stage completed. `wf-predictive-terminal` publishes its
result only after its whole builder succeeds; console progress for individual
baseline comparisons is not a separate durable terminal result. New-release reuse
and avoidance of recomputation remain unproven until the independent mapping and
scientific qualification requirements are satisfied.

## Bounded package-header discovery

Append `--package-headers` to the CLI invocation to authenticate seals, manifests
and only first chunks, then project allowlisted header fields. It does not read
evidence payloads, source-corpus records or remaining replica chunks. Maximum64
packages; one bounded manifest and first chunk at a time. Existing private-path,
owner, CLI and quiescent-tree requirements still apply. Partial directories are
counted, not interpreted. No callbacks, builders, hydration, writes or key export.

Header-only exit0 means at least one authenticated package header was projected;
exit2 means no package headers were found. Neither is full payload integrity,
expected inventory, scientific qualification or reuse admission. Report format is
`waia-scientific-package-headers/v1`, distinct from the full-integrity report.
Organization identity is checked against the seal/manifest but not exported.

Never substitute observed header values for independently reconstructed expected
inputs. Different cache keys may describe identical scientific package contents:
caller input shape/defaults also participate in cache identity. Do not delete such
entries, deduplicate or infer invocation roles just from a matching content digest.

Before remote execution, discover the actual Node executable path; do not assume
`/usr/bin/node`. A rejected systemd-run command with no loaded unit/process/report
is NOT a successful audit, even if an empty systemctl projection says Result=success.

## Separately authorized saved-score diagnostic

`scientific-score-diagnostic-v1.ts` is a distinct tool, not a mode of the integrity
verifier. It needs explicit authority to read saved DEVELOPMENT source rows and
forecast evidence and apply the original scoring functions. It generates no forecasts,
replicas or bootstrap samples and never invokes qualification or a cache builder.

Authenticate the exact selected package and canonical source-prefix chunks, then
all saved evidence payloads before decoding. Reconstruct the original target grid
from DEVELOPMENT terminal returns; require its authenticated digest to match.
Original evaluation-partition digest and completed trial identities must come from
the original launch/qualification records and logs, independently of the observed
forecast inventory. Match those trial identities before reporting score results.

Invoke with `--root <EXACT_STORE> --binding <PRIVATE_JSON_FILE> --quiescent-tree`.
The binding file must be regular, private, same-owner and at most16KiB. Restrict
the one-shot process to no network and a read-only checkpoint mount, with a bounded
heap/runtime and durable private output elsewhere. No concurrent checkpoint writer.

Success reports all five original baseline score comparisons, including zero
support and non-finite differences without smoothing, truncation or point removal.
Explicitly preserve +/-Infinity/NaN as labels rather than converting them to null.
Exit0 is a diagnostic completion, NOT a scientific PASS or launch authority.
Matching original trials proves the checked binding/anchor-set identity; it is not
independent reconstruction of every cache key or admission for new-release reuse.
Source payload authenticity is not independent raw-corpus re-derivation. Reads may
update access times; no checkpoint content or seal is written. Keep failures visible.
