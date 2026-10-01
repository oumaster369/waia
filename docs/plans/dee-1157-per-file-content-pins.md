---
integrationIssue: DEE-1157
integrationTitle: "AI-TRADER: pin Reality V2 consumer and source content per file"
branch: dee-1157-per-file-content-pins
riskTier: T2
prPolicy: one-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation: [targeted-unit, typecheck, lint, validate-reality-v2-consumer-graph]
approvalGates: [independent-review, exact-head-ci, standing-user-technical-merge-authorization]
state:
  status: in-progress
  implementationPhase: prepared-for-pr-on-integrated-main
  productionBehaviorChanged: false
provenance:
  createdFrom: user-authorized-ai-trader-audit-2026-10-01
  authoritativeBase: d9c9f051954776cdeb3122950eebc012e7c9aee4
  supersedes: null
---

# DEE-1157 — per-file Reality V2 source and consumer pins

## Purpose and bounded change

The Reality V2 whole-repository validator currently checks source and consumer content through one aggregate digest per discovered path set. This change replaces only those two hardcoded aggregate content pins with canonical sorted `{path, sha256}` entries, one compact entry per line. It keeps discovery roots/additions/extensions, expected counts, sorted path digests, AST connector-reference closure, rule closure, dispositions and all existing admission/security checks unchanged.

The inventory schema is explicitly versioned `reality-v2-source-consumer-inventory/v2`; the validator rejects v1 aggregate-only and unknown schemas, with no fallback. It also requires `contentPins` arrays. The validator must fail closed if a pin entry is malformed, has a duplicate path, uses a non-lowercase/non-64-hex digest, or if the pinned path set differs from the exact discovered path set. It hashes each discovered file's actual bytes independently. Same-count path substitution therefore fails even where counts remain equal; a source edit reports the individual mismatching path. The old aggregate content digest may still be emitted as a computed report value, but it is no longer a pinned acceptance expectation. No CI auto-seal, auto-accept, rule mutation or Reality admission change is allowed.

## Files and checks

- `scripts/trader/validate-reality-v2-consumer-graph.ts`: exact-v2 schema gate plus pure per-file pin checker with injected byte reader; apply it to source and consumer closures while retaining computed aggregate report digests.
- `docs/ai-trader/reality-v2-source-consumer-inventory.json`: set the v2 schema and replace the two aggregate source/consumer content pins with exact per-file content arrays. Preserve every other inventory field and derived path set.
- `tests/unit/trader-reality-v2-consumer-graph.test.ts`: remove the consumer aggregate digest golden assertion and retain a report-shape assertion; cover changed bytes, missing pin vs missing discovered file, extra discovered caller vs stale extra pin, same-count replacement, duplicates and malformed entries without touching a shared fixture map.

The publication base is actual main `d9c9f051954776cdeb3122950eebc012e7c9aee4`, after PR722, PR721 and PR714 merged. The inventory retains 163 source paths, 150 consumer paths and 26 connector references. Three existing pin entries were refreshed for the two inherited reviewed paths `execution/v2/recovery-postgres.ts` and `account-observation/credential-read-boundary.ts`. No path, rule or discovery boundary changed.

## Validation and integration

Full local lint, typecheck and build passed. The focused graph suite passes 23/23, including malformed schemas/pins and mutation/deletion/addition/duplicate-path controls. The validator accepts all313 actual byte pins. Independent review accepted the original implementation and prepared-base pin refresh. Rebase from prepared PR714 head to its actual squash merge preserves the whole source tree; publication metadata is updated separately. Exact-head GitHub CI remains required before merge. Full unit validation is CI-owned and is not duplicated locally.

The user's standing authorization covers technical PR and checked merge. This does not grant live trading, production migration, source admission or automatic content resealing. Rollback is a normal reviewed revert of this bounded validator/inventory change.

## Acceptance

Accept only when the validator accepts the exact discovered source and consumer path sets against their per-file SHA-256 pins and rejects malformed/duplicate pins, missing or extra paths, same-count path substitution, and changed bytes. Preserve the existing discovery, counts, path digests, AST closure and admission checks; do not add automatic sealing or acceptance. Required local focused tests, validator, typecheck, targeted lint, canonical validation, exact-head CI and independent review must pass before integration. No production runtime behavior changes; publication and merge status belong to the linked PR and Linear issue.
