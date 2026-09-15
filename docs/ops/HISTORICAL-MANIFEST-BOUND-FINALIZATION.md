# Historical manifest-bound finalization

## Scope

This runbook describes the DEE-1013 finalization-only boundary. It does not
authorize Forecast production, proposal preparation, bootstrap, consumer
launch, terminal-receipt assembly, H5, H-OBS, admission widening, or authority
beyond the existing canonical finalizer.

The operator must supply one independently frozen O/P/R binding, its expected
SHA-256, and the exact proposal identity through separate command arguments.
The sidecar does not infer any expected release from its own checkout, `main`,
a tag, an image tag, or a default checkpoint path.

Executable/finalizer application code is loaded only from the verified R
namespace. Release `90de233a192f9b97fa2d6a1ab0c3c1ba5a72df67` is the preserved
O evidence identity and is never the executable finalizer release.

## Required artifacts

Prepare these before invocation:

1. O: a clean standalone checkout of preserved release
   `90de233a192f9b97fa2d6a1ab0c3c1ba5a72df67` and its existing private,
   read-only evidence root.
2. P: a clean standalone checkout of the exact producer release and its
   existing private, read-only Forecast evidence root.
3. R: a clean standalone checkout of the exact evaluator/finalizer release, its
   existing private, read-only evaluator evidence root, and dependencies
   installed for that exact release.
4. A canonical `waia.historical_opr_release_binding.v1` manifest owned by the
   container user with mode `0600`. Do not add proposal ID/digest or
   ratification fields to this manifest.
5. The expected manifest digest obtained through an independently controlled
   channel.
6. The exact proposal ID and proposal content digest from the DEE-1011
   preparation result.
7. One persisted authenticated Human ratification for that exact proposal, with
   action `RATIFY_FOUR_SURFACE_WF_PREDICTIVE_FOR_HISTORICAL_SIMULATION_ONLY`.
8. A private environment containing the runner-login database URL and the
   exact organization/run/release already bound by the manifest.

The CLI does not accept a ratification ID, ratification digest, or synthetic
ratification input. Ratification is discovered only from persisted
authoritative state.

## Environment exclusions

Do not set:

- `WAIA_FHV_CHECKPOINT_ROOT`;
- any WAIA/FHV builder or fallback variable;
- alternate O/P/R release, source, tree, evidence, or runtime variables;
- operator, ratification, approval, authority, or manifest authority variables.

`NODE_OPTIONS`, when present, may contain only one bounded
`--max-old-space-size` setting.

## Preflight

Before confirmation, independently verify:

- all six source/evidence roots are canonical absolute paths and immutable for
  the whole invocation;
- all three source checkouts are at their manifest commits and have no tracked
  residue;
- R equals the exact immutable image revision and the requested target SHA;
- the dataset and all evidence mounts are read-only;
- environment organization/run/release equals the manifest;
- the CLI proposal ID/digest names the exact persisted proposal;
- exactly one persisted Human ratification is bound to that proposal;
- the binding file and evidence roots are owned by the container user and are
  not group/world accessible;
- no server or historical consumer is running in the same container.

All of the following must succeed before the first scientific/database write
performed by finalization:

- O/P/R release binding;
- Git/source/tree binding;
- runtime binding;
- evidence roots;
- proposal identity;
- persisted Human ratification;
- strict resolver identity;
- frozen R finalizer API identity.

Any unresolved, ambiguous, missing, duplicate, conflicting, or mismatched
identity refuses before mutation.

## Invocation

After a Human has independently established the read-only mounts and loaded
only the reviewed finalization environment, invoke the separately mounted
sidecar from the runtime declared by R:

```bash
node --conditions=react-server \
  /opt/waia/operator/historical-finalize-only-v1.mjs \
  finalize-only \
  --release-binding /private/historical-opr-binding.v1.json \
  --binding-digest <independently-approved-sha256> \
  --proposal-id <uuid> \
  --proposal-digest <sha256>
```

The sidecar and `historical-release-binding-v1.mjs` must be mounted together.
O/P/R source and evidence roots must exist at the exact absolute paths in the
manifest. R source must contain its dependencies, but dependency/OCI
authenticity remains a separate operator attestation.

## Success and refusal

Success emits one `waia.historical_finalize_only_operator_result.v2` object. It
includes the exact proposal ID/digest, persisted ratification ID/digest,
binding digest, organization/run/R, authority ID, finalization manifest digest,
`authorityPresent: true`, and false bootstrap/consumer/terminal flags.

Any missing, ambiguous, mixed, dirty, or mismatched release/tree/source,
evidence-root, runtime, image, organization, run, proposal, ratification,
resolver, or result identity refuses. There is no repair, fallback,
current-checkout substitution, builder, synthetic ratification, or consumer
path.

After success, stop. Bootstrap, consumer launch, and terminal receipts remain
separate later gates.
