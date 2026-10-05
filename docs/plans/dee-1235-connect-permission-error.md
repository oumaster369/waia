---
integrationIssue: DEE-1235
integrationTitle: "Restore new-user HTX Read + Trade observation connection"
branch: dee-1235-observation-read-latency
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation: [targeted-unit, mounted-e2e, lint, typecheck, build, canon, pr-governance]
approvalGates: [independent-review, exact-head-ci, fresh-merge-admission]
state:
  status: implementing
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  nextAction: "Verify Read + Trade connect, encrypted persistence, deployed-posture collection and cabinet; release only the reviewed incident fix."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1235 — restore new-user HTX connection for observation

## Problem and Human scope

A newly registered user enters existing HTX Access and Secret with Read + Trade. The deployed storage gate incorrectly ties saving that verified key to enabling application trading. The dedicated collector also refuses that actual scope before decrypting. The Human explicitly requires this ordinary connection to work and explicitly forbids all trading, transfers, live enablement and interference with the existing external executor. The earlier error-only patch and Read-only replacement advice are superseded.

## Implementation

Store actual verified venue scopes in metadata version 2 with server-owned purpose `observation`. This purpose is not accepted from the request. Read and Read + Trade are allowed for observation, while forbidden/unknown scopes remain refused. Preserve legacy version-1 execution storage rules. All trade-purpose resolvers reject version 2, and older resolvers reject the unknown version. Encryption, membership, exact account identity and replacement compare-and-set remain mandatory.

The new generated `observation_read_permitted` decision validates the complete version/purpose/account/venue contract before the restricted credential role may decrypt. It retains exact legacy Read acceptance and preserves 0229 unchanged. This is decryption eligibility, not new tenant snapshot-view authority; cabinet access still checks tenant, active binding and observation revision. Self-service Connect enrolls the exact saved identity using the existing bounded configuration. Reuse the already independently reviewed Node TLS implementation for all three dedicated host pools, with certificate and hostname verification unchanged.

## Database and release sequence

0230 metadata grants are already applied in production and copied byte-identically into this branch to reconcile source history. Candidate0231 adds only the new policy function, generated decision column and one column SELECT grant; no existing credential contents, RLS policy or role membership are changed. Deferred inventory PR759 has an unmerged0231 reservation and must move to0232 before a future integration. Its payload remains unapplied; this incident does not release it.

The canonical migration baseline has a known inventory-policy gap tracked in PR759. A fresh read-only production catalog confirmed its two existing supplemental inventory SELECT policies on 5 October. Native incident tests must distinguish the canonical discovery refusal from a fixture explicitly matching that deployed posture. No fixture policy is applied to production, and this proof does not close PR759/DEE961.

Before release: exact review, applicable CI, current source/journal/privilege/policy preflight, target host/image and verified TLS, candidate-only0231 transaction, reader-first rollout using the existing service, then web with PAPER_LOOP_ENABLED=0. Preserve existing secrets, limits, assignments and unrelated bindings; change only exact release identity and reviewed code. Rollback may stop observation or revert the web while retaining the validated reader; never restore a reader that misinterprets v2 credentials or remove the decryption guard. All production changes need the applicable Human admission for this incident; general requests do not release unrelated held PRs or infrastructure.

## Acceptance

- New registration/session and entitlement lead to one submission of two keys; Read + Trade connects without a live row or live enablement.
- Truthful version-2 metadata, encrypted persistence and exact enrollment are verified with actual PostgreSQL; no keys leak into responses or logs.
- The real restricted collector discovers the new row under the observed deployed posture, validates the exact key through fixed GET routes, and produces data visible only to the same user.
- Wrong account, tenant, malformed purpose, unknown/withdraw/transfer/duplicate scopes and trade-purpose consumption fail closed.
- Mounted UI shows the connected account and observation after one submission; no automatic key resubmission or trading request.
- Native TLS, grants/RLS and revoke/replacement regression checks pass; independent review binds final source, and all applicable CI is green.
- Actual production receipt and cabinet data are required before declaring the partner recovered. Synthetic browser, injected test authentication or stored metadata alone do not prove this.

## Validation and exclusions

Focused tests, fresh Next build, mounted Chromium, actual isolated PG17, typecheck/lint/canon/graphs and applicable PR CI. Do not repeat full local unit. No order, cancellation, stop edit, transfer, leverage/mode change, live activation, external executor change, unrelated research/scoring, or frozenPR762/Overview integration. Parents remain open until their full acceptance.

## Post-release observer compatibility correction, 5 October

PR765 is merged as09f053 and its Web connection fix is deployed. Actual observer deployment revealed two differences from its former image that the repository did not contain: Node could not resolve the bare preload module path, and the complete HTX spot balance list exceeded the order/history row budget and response cap. Historical snapshots contained1693 assets; the former image used a10000 raw-row and1MiB bound.

This bounded follow-up makes the supervisor preload and consumer paths absolute and gives the unpaginated spot balance endpoint its own10000-row/1MiB limits. Every row remains strictly validated, duplicate buckets are refused, decimal arithmetic stays exact, and excessive responses fail as a whole. No silent skipping of malformed rows is restored. Other endpoint/page limits, signed GET allowlist, per-read admission, credentials, database privileges and TLS are unchanged. No migration, new infrastructure or web feature is included.

Validation adds actual child preload resolution from a foreign working directory and a1693-asset synthetic response above262144 bytes, with exact amounts, over-limit refusal and unchanged order pagination. Retain all existing security/binding tests. Actual host snapshots and tenant cabinet remain required for recovery; do not claim partner acceptance from synthetic data. The production artifact must record exact source/patch identity; no untracked image-only source edits.

The bounded production diagnostic confirmed3398 rows/280388 bytes, all amounts valid and no duplicate buckets. Twelve rows use six Han currency identifiers, matching the public HTX currency catalog exactly (1699 assets). The parser explicitly permits bounded lowercase Latin/digit/Han identifiers, preserves these balances, and still rejects whitespace, controls and malformed rows. The previous image silently skipped those six assets; that incomplete behavior is not restored.

## Regular observation latency correction, 5 October

PR766 is merged as a220e774 and its strict complete-balance parser is deployed. Actual recurring observation still alternates successful reads and TIMEOUT. A bounded same-key diagnostic measured each current-binding database authorization at498–545ms; each financial GET performs fresh three-request venue admission both before and after the read. Five immutable transaction setup statements currently pay five separate round trips for each of these checks. Batch only these ordered static statements in a single simple-protocol message; retain the separate parameterized tenant scope query, every fresh current-binding check, all role/RLS restrictions and unchanged3s/1s/5s database timeouts. No caching or authorization relaxation is introduced.

A separate public TLS-only comparison reproduced an independent network defect on the actual host: Node22 default250ms address-family connection attempts failed4/4, with IPv4 attempts timing out and IPv6 unavailable;1000ms attempts passed4/4 with verified TLS1.3 in722–755ms. Set Node's supported1000ms address-family attempt option only on the dedicated observation child. The parent, other services, TLS verification, endpoint allowlist, total10s read deadline, key admission, pool sizes and configuration identities remain unchanged. No retry loop or new exchange request is added.

Validate the exact production-path latency with one bounded GET-only diagnostic using the changed source and ordinary protected adapters, no snapshot writes. Native PostgreSQL tests must check effective role/read-only/scope/timeouts, abort-on-setting-error and clean pooled reuse. Existing host tests must execute a child with the packaged arguments/preload and inspect its actual setting. Run targeted regressions, type/lint/build/canon/graphs and fresh exact-head CI; do not repeat prior full unit locally. Release only the source-qualified existing observer image after independent review. Require repeated fresh current-binding production observations across all existing accounts before claiming stable recovery; partner connection and cabinet acceptance remain separately unconfirmed.
