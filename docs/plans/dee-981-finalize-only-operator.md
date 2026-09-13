---
integrationIssue: DEE-981
integrationTitle: "Pinned finalize-only operator boundary before historical bootstrap"
branch: dee-981-finalize-only-operator
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [focused-unit, source-contract, lint, typecheck, build, independent-review]
approvalGates: [separate-operator-artifact-delivery, separate-finalization-execution]
state:
  status: integration-ready
  currentWorkPackage: null
  completedWorkPackages: [WP-1, WP-2]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  blockedReason: null
provenance:
  authoritativeBase: 5aee44883454551760c889129577615737aa5b80
  frozenScientificRelease: 90de233a192f9b97fa2d6a1ab0c3c1ba5a72df67
  createdFrom: user-authorized-remaining-local-release-work
---

# DEE-981 — finalize-only operator, not archive or trading readiness

## Acceptance

Separate operator artifact verifies exact frozen source before loading it and invokes only
its actual approved-proposal finalizer. Reuse existing constrained LOGIN, pool, checkpoint,
environment authority and cleanup guards. No caller Human identity, fake ratification,
manual manifest authority, bootstrap, queue, claim or consumer invocation. Successful result
means finalization returned and this driver did not call bootstrap; nothing more.

## WP-1 — explicit operator composition

New standalone script(s) under scripts/ops or scripts/trader and focused tests. The unit job
checkout fetches history so frozen-source proof also runs in CI; no existing gate is removed
or skipped. Preserve immutable
scientific release and existing runtime source. Pin source bytes and image/release contract
before imports, require explicit finalize-only action, refuse unsafe authority/environment.
Reuse real finalizer checks and checkpoint context, no alternate scientific path. Sanitize
receipt/error output, preserve cleanup/cancellation. Do not claim image authenticity from
an environment variable alone; operator must independently attest immutable image digest.

## WP-2 — validation and handoff

Targeted synthetic tests for pin/env/config refusal, cleanup/cancellation, no autostart and
no bootstrap invocation; verify against real frozen source exports and packaged layout.
Lint/typecheck/build/canon; independent exact-diff review. No production execution or science.

### Local evidence and preserved failures

Implemented separately mounted `scripts/ops/historical-finalize-only-v1.mjs`, mandatory
native Node suite and Vitest bridge. Twelve focused Vitest cases pass, including the bridge
that executes ten Node cases. The source proof materializes 2,033 original Git-S files,
checks their fingerprint and imports the actual frozen APIs with TCP connections denied;
it does not call the finalizer, open a DB client or calculate scientific results.
Synthetic cases cover scope, pool/LOGIN/checkpoint composition, cancellation, guard/context
failure cleanup, invocation/source refusal and bounded diagnostics. The frozen runtime
parser and error formatter are exercised by the import-only test.

Initial real import smoke failed `ERR_REQUIRE_CYCLE_MODULE` with ESM-only registration.
Fixed with CJS plus ESM registration, sequential imports and CJS default-export normalization;
the real import test is mandatory in CI. Full unit checkout history is required for Git-S
proof; a shallow checkout is not silently skipped. Initial local build failed sandbox
`listen EPERM 127.0.0.1`; rerun with local-port permission passed without code change.
Final typecheck, scoped lint, build, canonical validation and diff-check pass. Full lint:
zero errors, 307 existing warnings. Authoritative exact-head full CI remains pending.

Independent final source/test/CI delta review found no proven P1/P2 within this package.
Reviewed driver blob `b3b809cc22fd4e10c728b0387ff75b638bc1cac7`, native suite
`222cb77bbcd814797278515349f2e8943e7993e3`, Vitest bridge
`6f66143d88478214eb711b48406b4e05b2ae21d2`, unit CI
`b18346aeccdb5b903141bacd7674246548519bbd`.

### Operator handoff, not activation

Do not replace the S image or source tree with this branch. Delivery must mount this
separately versioned artifact alongside independently attested S image/dependencies and
immutable source. Only an explicitly authorized clean-environment operator process may call
`finalize-only`; supervised mode remains `idle`. The exact S runtime parser supplies the
constrained session URL, organization, run and checkpoint configuration. No Human actor or
manifest is accepted from the caller. Preserve bounded progress and redacted diagnostic output
in the authorized private journal. `FINALIZER_RETURNED` is not readiness or historical PASS.

## Explicit limits

Initial finalization can perform FINALIZATION_REPLAY; compatible cache use is checked by
existing implementation, not guaranteed. Existing authority can avoid rematerialization.
Finalizer releases its run lock before return. A later archive tool must reacquire the canonical
lock, prove no run progress and export a consistent dependency-complete snapshot. This driver
does not establish that barrier, export/restore data, or prove independent repeat.
Cancellation is cooperative and may wait for frozen database reservation/lock acquisition.
The import smoke uses worktree dependencies with unchanged tsx/postgres versions; it is not
an attestation of production Node, dependencies or OCI image. Environment SHA fields alone
cannot provide that attestation. Preloaded Node code executes before this script's guards;
the operator launcher must independently enforce a clean environment and immutable mounts.

Delivery/mounting/invocation require separately authorized operator action. Existing default
managed entrypoint remains unchanged. No production/DB/science calls, migrations, credentials,
venue, capital, holdout or user WIP changes during local development. DEE-920 stays open.
