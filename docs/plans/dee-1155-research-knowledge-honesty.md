---
integrationIssue: DEE-1155
integrationTitle: "AI-TRADER: prevent coverage-only evidence from implying research qualification"
branch: dee-1155-research-knowledge-honesty
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, postgres-ci, github-pr-ci]
requiredValidation: [targeted-knowledge-unit, targeted-fold-unit, targeted-builder-unit, typecheck, lint, build, postgres-integration, exact-head-ci]
approvalGates: [independent-review, exact-head-ci, human-merge]
state:
  status: in-progress
  currentWorkPackage: integration-readiness
  completedWorkPackages: [implementation, focused-unit-readiness]
  remainingWorkPackages: [combined-postgres-ci, independent-review, exact-head-ci, merge]
  prNumber: null
  prUrl: null
  blockedReason: null
  nextAction: "Integrate the historical evaluation-context dependency, then complete combined exact-head validation and review."
provenance:
  createdFrom: user-authorized-ai-trader-audit-2026-10-01
  authoritativeBase: a20bfcce288dd96948aa01102b7467945812116e
  supersedes: null
---

# DEE-1155 — research pipeline knowledge honesty

## Contract

A completed research pipeline and multi-regime coverage are observational facts. They do not establish predictive performance. Until a durable, independently qualified result is part of the pipeline contract, research-pipeline output must not create a verified knowledge edge, statistical confidence/strength claim, blind-validated production knowledge asset, or maturation lifecycle state.

The pipeline continues recording completion events, coverage labels, validation history, and negative outcomes. Its edge is descriptive (`observed_by_research_pipeline`), explicitly unverified, and carries neutral `0.0000` confidence and strength. The production knowledge asset distinguishes sufficient coverage without qualification (`research_pipeline_coverage_only`, lifecycle `creation`) from missing required regime coverage (`research_pipeline_validation_failed`, lifecycle `creation`). Historical reason values remain part of the type so existing serialized assets remain readable. MKB classification treats both legacy `validated_by_research_pipeline` and new observational relations as observation-only (or stale/ineligible under existing rules), even if a historical raw row says verified. No stored row, digest, or version is rewritten. This is not a claim that such rows exist in production.

The asset builder is the enforcement boundary for current research callers. Legacy confidence, verified, reason, and lifecycle input fields remain accepted for source compatibility, but are not authority and cannot promote an asset. Both campaign callers now pass explicit neutral zero-confidence, zero-strength and unverified values; their separately named coverage checks, manifest fields and failure gates remain unchanged. Event confidence remains `1.0000` because it describes that the completion event occurred, not an edge prediction.

No threshold, synthetic approval flag, or caller-controlled qualification path is introduced. A future promotion path requires a durable qualification record and a separately scoped change. Fitted-parameter identity (DEE-1152) is independent and remains unresolved by this change.

## Validation

Focused negative regression: evidence with sufficient regime coverage and negative after-cost blind outcomes remains coverage-only, creation-state, zero-confidence, and unverified even when callers request `edgeVerified`, `maturation`, and `research_pipeline_blind_validated`. The 29 focused tests pass; four fail meaningfully against the former production behavior. Local lint, typecheck, and build pass.

The cumulative synthetic PostgreSQL acceptance requires DEE-1158's historical evaluation context correction. On a fresh isolated database, the exact three DEE-1158 production files were temporarily composed with this patch, pinned, and restored after the run: eight tests pass with zero skipped. This is not standalone acceptance of DEE-1155 against the old cursor behavior. The native fixtures retain real content-bound DEE-540 one-shot authorization; an already-consumed opening refuses. Positive lineage is checked before replacing only a backtest reference to prove fabrication refusal. Both pipeline execution and evidence assembly use the canonical historical cost authority. Complete coverage with negative results persists only an unverified observation. None of these synthetic results qualifies a strategy or opens real historical holdout data. Integrate DEE-1158 first and rerun the applicable native CI on the combined source.

## Acceptance

Accept only when sufficient coverage with negative after-cost evidence remains observational, unverified, zero-confidence and creation-state even when callers request verification or maturation; historical serialized values remain readable and derived eligibility stays observation-only; completion, coverage and negative evidence remain recorded; and native PostgreSQL parity exercises the actual authorized pipeline and writer paths without fabricated metrics or bypassed authorization. The focused unit suites, typecheck, lint, build, exact-head CI and independent review must pass. This work does not qualify a strategy or complete DEE-1152 fitted-parameter identity.
