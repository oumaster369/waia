---
integrationIssue: DEE-777
integrationTitle: "AI-TRADER User Surface — tenant-scoped Trader Dashboard V2"
branch: dee-777-trader-dashboard-v2
riskTier: T1
prPolicy: one-pr
executionSurfaces: [local, github-pr-ci, cloudflare-preview]
requiredValidation: [focused-unit, browser-e2e, lint, typecheck, build, canon, pr-governance, independent-exact-head-review, dee-653]
approvalGates: [linear-groomed, integration-ready, independent-exact-head-review, dee-653]
state:
  status: in-review
  prNumber: 511
  prUrl: https://github.com/oumaster369/waia/pull/511
  blockedReason: null
provenance:
  authoritativeBase: 8ada56024db1f67f43530d3701fe9141273e46e7
  createdFrom: user-authorized-ai-trader-program-controller
---

# DEE-777 — Trader user Dashboard V2

## Objective

Replace the narrow HTX workspace with a tenant-scoped user observation dashboard. The dashboard
may display only data returned by existing user-authorized APIs. It must not expose operator,
administrator, live-enable, kill-switch, strategy-promotion, or capital authority.

## Frozen invariants

- Session and Trader entitlement remain enforced by `app/(trader)/layout.tsx`.
- Credential, balance, position, and trade reads remain scoped by the server-side organization
  resolved from the authenticated session; the browser never supplies an organization id.
- HTX secrets are write-only and are never rendered or returned.
- Missing read models are represented as `unavailable`, never inferred from adjacent data.
- Snapshot timing is expressed only as the persisted timestamp and factual age. No unversioned
  freshness or staleness threshold is introduced.
- Forecast, Decision, Risk, Guardian, Execution, Reality, runtime mode, and drift panels are
  read-only. Until tenant-scoped APIs exist they must state that no verified read model is
  available.
- No action in this issue enables live trading, changes capital, or exercises admin authority.

## Admitted files

- `app/(trader)/trader/page.tsx`
- `components/trader/trader-workspace.tsx`
- `tests/unit/trader-dashboard-v2.test.tsx`
- `tests/e2e/trader.spec.ts`
- `docs/plans/dee-777-trader-dashboard-v2.md`
- `docs/plans/dee-777-trader-dashboard-v2.execution-manifest.json`

## Verification

- Focused component tests cover unavailable, old, invalid, future and connected snapshot states
  and absence of authority.
- Existing entitlement E2E remains green and asserts the dashboard landmarks.
- Typecheck, lint, build, and the repository governance gates pass.

## Acceptance

- An authenticated, entitled Trader user receives a tenant-scoped observation dashboard sourced
  only from existing server-authorized APIs.
- Empty, invalid, future-dated and populated snapshots render factual unavailable or age states;
  no unversioned freshness threshold is introduced.
- The browser cannot select organization scope and no HTX secret is returned or rendered.
- Forecast, Decision, Risk, Guardian, Execution, Reality, runtime-mode and drift areas remain
  explicitly unavailable until verified tenant-scoped read models exist.
- The dashboard grants no operator, administrator, live-enable, kill-switch, strategy-promotion
  or capital authority.
- Focused unit tests, browser E2E, typecheck, lint, build, canonical-doc validation, PR governance,
  independent exact-head review and DEE-653 all pass before squash merge.
