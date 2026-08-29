---
integrationIssue: DEE-775
integrationTitle: "AI-TRADER User Surface — isolated trader.waia.life landing and auth entry"
branch: dee-775-trader-landing
riskTier: T1
prPolicy: one-pr
executionSurfaces: [local, github-pr-ci, cloudflare-preview]
requiredValidation: [focused-unit, browser-e2e, lint, typecheck, build, canon, pr-governance, independent-exact-head-review, dee-653]
approvalGates: [linear-groomed, integration-ready, independent-exact-head-review, dee-653]
state:
  status: in-review
  prNumber: 512
  prUrl: https://github.com/oumaster369/waia/pull/512
  blockedReason: null
provenance:
  authoritativeBase: f40a862b7e888507f7594bcc79c9a873fd148f9b
  createdFrom: user-authorized-ai-trader-program-controller
---

# DEE-775 — isolated Trader landing

## Outcome

`trader.waia.life` receives a minimal, accessible public entry surface with the real WAIA sign-in flow in the first viewport. The primary `waia.life` homepage remains byte-for-byte unchanged outside the root host dispatch.

## Boundaries

- Reuse the existing host resolver, session lookup, entitlement check and authentication endpoints.
- Introduce no new authentication, entitlement, trading, live or capital authority.
- Keep Trader presentation in a dedicated component tree; do not change global theme tokens or primary-homepage components.
- State the paper/live boundary truthfully and avoid performance or profit claims.

## Composition

1. Small WAIA / AI-TRADER identity line.
2. Concise product statement and restraint posture.
3. Existing email/password and configured OAuth authentication, opened in sign-in mode.
4. Minimal product principles and privacy/security/support links below the fold.

## Verification

- Unit rendering, semantic landmark, form-default and primary-homepage isolation tests.
- Existing Trader-host routing E2E extended for copy, form and signed-in redirect behavior.
- Primary landing regression test retained.
- Type, lint and production build.

## Acceptance

- Unauthenticated `trader.waia.life` renders the minimal Trader entry with the real sign-in form in the first viewport.
- Existing safe session, entitlement and redirect behavior remains authoritative; no new authentication or trading authority is introduced.
- `waia.life` continues to render its existing landing content with unchanged defaults and global visual tokens.
- Unit, host-routing browser E2E, typecheck, lint, build, canonical-doc validation, PR governance, independent exact-head review and DEE-653 all pass before squash merge.
