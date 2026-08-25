---
integrationIssue: DEE-705
integrationTitle: "Breath of WAIA operational completion + Finance Assistant"
branch: dee-705-breath-operational-completion
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr, human-production-activation]
requiredValidation: [lint, typecheck, unit, integration, security, build, e2e, canon, pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge, human-production-activation]
includedIssues:
  - id: DEE-706
    role: backend-work-package
    completionPolicy: manual-at-integration-ready
    status: implementation-complete
  - id: DEE-707
    role: ai-work-package
    completionPolicy: manual-at-integration-ready
    status: implementation-complete
  - id: DEE-708
    role: frontend-work-package
    completionPolicy: manual-at-integration-ready
    status: implementation-complete
  - id: DEE-709
    role: security-work-package
    completionPolicy: manual-at-integration-ready
    status: implementation-complete
  - id: DEE-710
    role: infra-readiness-work-package
    completionPolicy: manual-at-integration-ready
    status: implementation-complete
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: integration-ready
  currentWorkPackage: null
  completedWorkPackages: [WP-1, WP-2, WP-3, WP-4, WP-5, WP-6]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: "2026-08-24"
  blockedReason: null
  nextAction: "Obtain explicit commit/push/PR authorization, then open the single DEE-705 PR for Human review."
provenance:
  createdFrom: roadmap-batch
  gapRegistry: docs/gaps/breath-of-waia-gap-registry.md
  supersedes: null
---

# DEE-705 — Breath of WAIA operational completion + Finance Assistant

## Approved outcome

One final software integration batch completes the remaining Breath module surfaces while preserving the existing single-trunk and Human-merge boundary. The code PR never activates production, handles private keys, mutates walkthrough/production financial data, or touches AI-TRADER/Execution Server work.

The explicit single-batch rationale is Human direction to minimize PR/Merge count. All child scopes share the same Treasury tenant/auth boundary, public read model and Finance E2E flow; independent live activation remains deferred to the Human-only gate.

## Frozen ownership manifest

| Child | Ownership | Observable outcome |
|-------|-----------|--------------------|
| DEE-706 | backend | Allocation/public/watcher/assistant server contracts |
| DEE-707 | ai | Strict Finance intent planning and grounded answer contract |
| DEE-708 | frontend | Minimal fund/wallet/assistant/public UX |
| DEE-709 | security | Confirmation receipt, tenant, redaction and forbidden-action proof |
| DEE-710 | infra | DARK-by-default operational activation packet |

No unlisted child or AI-TRADER scope is admitted.

## Work packages

### WP-1 — Completion contracts and allocation exposure

- Add completion spec/gap/roadmap/plan truth.
- Serialize current fund allocation for admin and public consumers with exact micros and explicit unavailable reasons.
- Show accounting-only fund meaning without frontend recomputation.

### WP-2 — Wallet observer and explorer completion

- Complete watched-address/readiness operator surface using public addresses only.
- Add safe TronScan address/transaction URLs for canonical TRC-20 provenance.
- Add isolated scheduled Treasury watcher runner and health probe; default remains DARK.

### WP-3 — Finance Assistant planner and security boundary

- Closed English intent schema for reports and supported record creation.
- Server-only OpenAI Responses adapter with strict schema and bounded output.
- Tamper-evident, short-lived confirmation receipt bound to operator/org/action/payload.
- No model-side mutation or arbitrary tool surface.

### WP-4 — Authoritative report and audited execution tools

- Reports load typed tenant-scoped Treasury facts and include scope/as-of.
- Write previews support counterparty, account, category, project and manual transaction drafts.
- Confirmation calls existing audited services; verification/publication/watcher/custody actions remain forbidden.

### WP-5 — Minimal Finance and public UX

- Add compact assistant dialogue with report, preview, confirm and unavailable states.
- Add allocation and wallet/readiness facts without clutter.
- Preserve existing deterministic workflows when AI is disabled.

### WP-6 — Qualification and Human activation packet

- Focused unit/integration/security/isolation tests.
- Finance Playwright E2E and visible Human review on an isolated current-main runtime without financial mutation.
- Exact Human checklist for wallet public address/start block, provider secrets, R2, migration apply, first publication and watcher activation/rollback.

## Safety invariants

- TronGrid is a read-only chain data provider; TronScan links are navigation only.
- No UI/API accepts or stores a private key, mnemonic, signing material or broadcast request.
- The AI provider receives the operator instruction and the minimum schema needed to plan; authoritative report facts are supplied only for grounded response generation and exclude private evidence/contact/payment details.
- Every write requires existing admin permission plus a valid confirmation receipt; the model cannot confirm its own proposal.
- Manual transaction creation produces a draft/review-required record only.
- Financial verification, public publication, watcher enablement, fund spending and production operations remain deterministic Human actions outside the assistant tool registry.
- Secrets are referenced by environment-variable names only and never printed.

## Human production activation gate

The agent must stop and explicitly notify the Human when code qualification is complete. The Human then performs or directly authorizes:

1. Register the approved public USDT TRC-20 Treasury address and inception/start block. Never provide a private key.
2. Configure `TREASURY_WATCHER_TRONGRID_API_KEY` and an independent secondary RPC/key in the managed host; do not reuse `AI_TRADER_TRONGRID_API_KEY`.
3. Configure the Finance Assistant provider key and a dedicated confirmation-signing secret directly in the host.
4. Provision/bind the Treasury evidence R2 bucket.
5. Approve production Postgres migrations after backup and preflight.
6. Verify health/alerts with watcher still disabled, then explicitly enable the Treasury watcher.
7. Review first detected rows without verification or publication automation.
8. Approve the first reconciliation, annual-budget/publication state and public Breath release.

## Validation matrix

| Surface | Required proof |
|---------|----------------|
| Canonical docs | `pnpm validate:canon` |
| Code quality | `pnpm lint`, `pnpm typecheck`, `pnpm build` |
| Allocation/public | focused unit + Postgres integration/isolation |
| Watcher | DARK/no-op, scheduled isolation, TronGrid mapping, health/redaction |
| Assistant AI | strict schema, malformed/refusal/provider outage, prompt injection |
| Assistant security | auth, tenant, tamper, expiry, replay/idempotency, forbidden actions |
| Finance UI | focused React tests + Playwright E2E |
| PR boundary | `pnpm validate:pr-governance`; one PR to `main`; Human squash merge |

## OpenAI implementation note

Use the server-side Responses tool/function-calling pattern with strict JSON schema (`additionalProperties: false`) and deterministic application-side execution. The model proposes a typed intent; application code validates and executes only the closed registry. Ordinary Finance must remain operational when the provider is unavailable.

## Migration memory

Implementation proved that stateless signed tokens cannot prevent a distributed replay. The batch therefore adds one Postgres-only, append-only confirmation-consumption table (`0165`/`0166`) containing only user/org identifiers, intent, timestamps and SHA-256 digests—never prompts, secrets or financial field values. The unique nonce digest is the single-use authority. Production migration apply and write enablement remain separate Human gates; reports and ordinary Finance fail open independently while assistant writes fail closed.
