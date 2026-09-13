# Historical scientific preparation checkpoints (DEE-967)

These checkpoints preserve completed computations, not Human ratification, production admission,
or a claim of scientific qualification. The final PostgreSQL transaction, constrained runner,
tenant scope, dataset checks and all acceptance criteria remain authoritative.

## Before the next authorized run

1. Complete exact-head CI/review and obtain the required merge/production authorization.
2. Prepare a persistent host directory **outside the read-only dataset**, mode 0700, owned by
   the UID/GID of the verified immutable execution image's `waia` user. Do not assume the UID.
   Verify free disk space and inodes against package sizes before starting expensive work.
3. Pass that same directory as `--checkpoint-root` to proposal preparation and approved launch
   deployment wrappers. They bind it at `/var/lib/waia/scientific-checkpoints` and explicitly set
   `WAIA_FHV_CHECKPOINT_ROOT`. A container-layer directory is not a durable replacement.
4. Preserve the directory, including its private `.seal-key` (0600), with local protected backups.
   The key authenticates cache metadata; it is not an exchange credential or trading authority.
   Do not print, attach, upload or commit the key or cache. No production backup is performed by this PR.
5. The deploy wrapper validates storage as the image user before replacing an existing container.
   Direct CLI invocation also refuses missing/unsafe storage before scientific work.

## Reuse and failure rules

- Keys bind exact release SHA, Node version/platform/architecture, stage and actual inputs.
  Organization, corpus, package, configuration and partition identities are included by the caller.
  A changed input or release is a miss, **not** permission to rewrite an old receipt or relabel a cache.
- Completed packages use the existing streaming codec and full hydration/digest validation.
  A separately authenticated binary manifest holds the chunk inventory; the small signed JSON
  seal never embeds the full inventory. This avoids escaped whole-manifest JSON amplification.
  KM replay and WALK_FORWARD forecasts checkpoint groups of 32 anchors; terminal predictive receipts
  also persist, including negative outcomes. The groups preserve original anchor order and values.
- Publication is a file/directory fsync followed by atomic directory rename. `.partial-*` directories
  cannot be used as completed entries. They remain available for diagnosis; no automatic deletion.
- A corrupted completed entry fails closed, without silently recomputing or overwriting it. Preserve
  evidence and investigate before a separately approved recovery action.
- Repeating the same verified computation loads completed entries. An unfinished package, anchor
  group or terminal statistical trial may need recomputation; there is no per-resample checkpoint.
  Input scanning, validation and final authority checks still execute.
- This is local disk durability, not redundancy against host/disk loss. Do not promise cross-host
  recovery without a verified protected backup of the complete directory and its seal key.
  HMAC does not protect against an attacker who controls the cache owner and can read its seal key.
- Do not run multiple preparation writers for the same attempt. A concurrent publication conflict
  fails instead of replacing the winner. No automatic retry loop or second long run is introduced.

## Limits of this change

Before a full-corpus rollout, measure free bytes/inodes and reserve capacity for completed and
interrupted artifacts. Each 64-KiB package chunk is a separate fsynced file; large packages and
32-anchor batch checkpoints add disk I/O. Small tests do not prove full-corpus storage capacity
or elapsed time. The supervisor forwards only the validated checkpoint path to its child;
the same path is mandatory during runtime preflight and finalization.

The failed 8023bb19 production attempt had no such completed checkpoints in the inspected locations.
This change cannot recover that process's lost RAM or promise reuse of its uncommitted results.
No corpus thinning, K/M/B reduction, statistical threshold change, blind holdout, live trading,
private exchange credential access or migration is introduced. Scientific rejection stays rejection.

## Verification

Targeted tests cover real package hydration after a killed subprocess, exact resumed KM evidence,
non-recomputation of completed batches, input/scope mismatches, corruption and journal failure.
Small fixtures prove mechanisms, not full-corpus scientific qualification or production readiness.
