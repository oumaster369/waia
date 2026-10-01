---
integrationIssue: DEE-1157
integrationTitle: "AI-TRADER: pin Reality V2 consumer and source content per file"
branch: dee-1157-per-file-content-pins
riskTier: T2
prPolicy: one-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation: [targeted-unit, typecheck, lint, validate-reality-v2-consumer-graph]
approvalGates: [independent-review, exact-head-ci, human-merge]
state:
  status: in-progress
  implementationPhase: per-file-pin-foundation
  productionBehaviorChanged: false
provenance:
  createdFrom: user-authorized-ai-trader-audit-2026-10-01
  authoritativeBase: 9e7a11d9188fa0a5a6c786ada747db3b341d2dac
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

Acceptance requires focused unit tests, typecheck, targeted lint, and the validator's exact pinned graph. Current canonical base observed for this implementation is `9e7a11d9188fa0a5a6c786ada747db3b341d2dac` (DEE-1151 / PR #722); the source and consumer path counts remain 163 and 150, with path digests unchanged. Queue/merge ordering remains external to this plan: DEE-1157 waits for the root's required queue items before integration. This local foundation is not committed, published, or a production behavior change.

## Local foundation checks

At the recorded base, per-file arrays contain 163 source pins and 150 consumer pins. Focused validation completed: the consumer graph unit suite passed 17/17; the graph validator reported `PASS` with unchanged source path digest `82fde5b9398211bffb94cc4355cfe5e2d78b69e2ff4180d72d86b29dd9fd89df`, source content digest `6b6e1da9aefe0579ba43e16894495dbc9fa784f6f871edff31a4d6e59286248c`, consumer path digest `7162a7765ff1c42a9b6a4446d7e7bfe48b8a18cba7d3fad4312c5f6fa4ce3578`, and consumer content digest `0a84d27994e0a48e736084972e7343a19a93ef6a3ce0e6361b554f27d42696ca`; typecheck, targeted ESLint and `git diff --check` passed. The digest values above are computed report outputs for traceability, not hardcoded pin expectations. The v2 schema gate and malformed-runtime type checks are covered by adversarial tests; the final focused suite passed 23/23 after this hardening.

## Acceptance

Accept only when the validator accepts the exact discovered source and consumer path sets against their per-file SHA-256 pins and rejects malformed/duplicate pins, missing or extra paths, same-count path substitution, and changed bytes. Preserve the existing discovery, counts, path digests, AST closure and admission checks; do not add automatic sealing or acceptance. Required local focused tests, validator, typecheck, targeted lint, canonical validation, exact-head CI and independent review must pass before integration. This prepared foundation is not published or a production behavior change.
