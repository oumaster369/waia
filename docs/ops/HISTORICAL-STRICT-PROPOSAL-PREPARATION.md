# Historical strict proposal preparation

## Scope

This runbook describes the DEE-1011 proposal-preparation boundary only. It does
not authorize Forecast production, proposal ratification, finalization,
bootstrap, consumer launch, admission, or authority.

The operator must supply one independently frozen O/P/R binding and its expected
SHA-256 through separate command arguments. The preparation sidecar does not
infer any expected release from its own checkout, `main`, a tag, an image tag,
or a default checkpoint path.

## Required artifacts

Prepare these before invocation:

1. O: a clean standalone checkout of preserved release
   `90de233a192f9b97fa2d6a1ab0c3c1ba5a72df67` and its existing private,
   read-only evidence root.
2. P: a clean standalone checkout of the exact producer release and its
   existing private, read-only Forecast evidence root.
3. R: a clean standalone checkout of the exact evaluator/proposal release, its
   existing private, read-only evaluator evidence root, and dependencies
   installed for that exact release.
4. A canonical `waia.historical_opr_release_binding.v1` manifest owned by the
   container user with mode `0600`.
5. The expected manifest digest obtained through an independently controlled
   channel.
6. A private proposal environment file containing the existing technical
   proposal inputs and runner-login database URL.

Each namespace binding contains:

- exact release commit SHA;
- exact Git tree SHA;
- canonical absolute source root;
- sorted, non-overlapping covered-source paths plus SHA-256 and file count;
- exact runtime tuple;
- canonical absolute evidence root and SHA-256 identity of its existing
  32-byte `.seal-key`.

The proposal organization, run, and release are part of the same manifest.
Proposal release must equal R. O, P, and R release identities must be distinct.

The manifest is canonical one-line JSON with a trailing newline. Produce it
with `serializeHistoricalOprBindingManifestV1`; do not hand-edit it after its
digest is approved. The self-digest is only an integrity field. The separately
supplied `--binding-digest` is the trusted immutable pin.

## Environment exclusions

Do not set:

- `WAIA_FHV_CHECKPOINT_ROOT`;
- any WAIA/FHV builder or fallback variable;
- alternate O/P/R release, source, tree, evidence, or runtime variables;
- operator, ratification, approval, authority, or manifest authority variables.

The strict path exposes no scientific checkpoint store or builder callback.
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
- the proposal environment organization/run/release equals the manifest;
- the binding file and evidence roots are owned by the container user and are
  not group/world accessible;
- no server or historical consumer is running in the same container.

The verifier checks these identities again inside the selected R runtime before
loading any application module.

## Invocation

The legacy `execution-server-prepare-historical-proposal.sh` command is not the
DEE-1011 strict entrypoint because it installs the older checkpoint-store
context. Do not use it for this historical proposal.

After a Human has independently established the read-only mounts and loaded
only the reviewed proposal environment, invoke the separately mounted sidecar
from the runtime declared by R:

```bash
node --conditions=react-server \
  /opt/waia/operator/historical-prepare-proposal-v1.mjs \
  prepare-proposal \
  --release-binding /private/historical-opr-binding.v1.json \
  --binding-digest <independently-approved-sha256>
```

The sidecar and `historical-release-binding-v1.mjs` must be mounted together.
O/P/R source and evidence roots must exist at the exact absolute paths in the
manifest. R source must contain its dependencies, but dependency/OCI
authenticity remains a separate operator attestation and is not inferred from
the source manifest.

## Success and refusal

Success emits one
`waia.historical_strict_proposal_preparation_result.v1` object. It includes the
proposal ID/digest, exact run identity, binding digest, strict resolver
contract, `authorityGranted: false`, and `finalizationInvoked: false`.

Any missing, ambiguous, mixed, dirty, or mismatched release/tree/source,
evidence-root, runtime, image, organization, run, resolver, or result identity
refuses. There is no repair, fallback, current-checkout substitution, builder,
or synthetic evidence path.

After success, stop. Human ratification and the dependent finalization issue
remain separate gates.
