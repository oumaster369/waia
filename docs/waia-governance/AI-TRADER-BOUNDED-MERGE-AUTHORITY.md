# AI-TRADER bounded merge authority

**Owner:** Human Architect · **Status:** Program-scoped amendment · **Linear:** DEE-653

This amendment delegates routine squash-merge handling for the Human-ratified AI-TRADER Step 0–22 implementation DAG to the acting Program Controller. It does not grant architectural, semantic, production, capital, holdout, or security sovereignty and does not replace the broader future controller in DEE-553/580.

The DEE-653 PR that creates this authority remains Human-merge-only. The delegation becomes effective only after that PR is Human-reviewed and squash-merged to `main`.

## Eligible PR

A Program Controller may squash-merge an AI-TRADER implementation PR only when every item below is true for the exact immutable PR head SHA:

1. The work is either one atomic node in the DEE-601 Step 0–22 DAG or one Human-ratified Integration Batch whose frozen manifest contains only atomic Step 0–22 child nodes. Every delivered issue contract is complete and all applicable Linear blockers are Done.
2. Branch, base, title, body, risk tier, one-integration-issue/one-PR boundary, and PR-governance preflight are valid. A multi-issue PR additionally satisfies the full frozen Integration Train contract in [`INTEGRATION-BOUNDARY-POLICY.md`](INTEGRATION-BOUNDARY-POLICY.md); an `Includes` list alone is ineligible.
3. Required local validation and every required GitHub check, including tenant isolation and security checks when applicable, are green on that head.
4. An independent adversarial reviewer has inspected the diff and evidence and reports no unresolved actionable finding, dissent, ambiguity, or acceptance-criteria shortfall. The implementer cannot self-attest this condition.
5. The diff matches the approved issue scope, changes no Human-only surface below, weakens no test or gate, and has a bounded rollback (normally a revert PR).
6. The merge itself causes no production/live external effect. Squash merge is the configured method.
7. Immediately before merge, the controller re-reads the head SHA, base SHA, mergeability, required checks, review state, and Linear blockers. Any change invalidates prior admission and requires a fresh proof.

Missing, stale, contradictory, or unavailable evidence is a denial, never an inference. Green CI alone is insufficient authority.

## Integration Train admission

The Human-approved batching mechanism changes PR granularity only; it grants no new authority over the included work. For a train, all ordinary conditions above apply to the exact cumulative head and the controller must additionally prove:

1. The manifest existed as an admitted pre-implementation inventory, is now frozen, passes machine validation, and its digest plus base/head/independent-review head match current PR state.
2. Every included child is independently traceable to reviewed integrated commits, actual files, acceptance evidence, and tests. Every deferred/excluded child has `completionClaimed: false`.
3. No more than two isolated child tasks ran concurrently. Parallel pairs were dependency-free and declared no overlap, competing migration, shared canonical identity, shared authority schema, or mutual invalidation risk; all other work was serialized.
4. Cumulative targeted checks passed after each child admission. The complete diff was frozen before the final PR's authoritative governance, full unit, Postgres/integration, tenant-isolation, build, E2E, canon, FHV, and every other applicable exact-head gate, plus final adversarial review. A non-applicable gate needs an evidence-backed `n/a`; it is never silently omitted for speed.
5. All included children share one coherent risk tier and Human-gate class. T4 or any reserved Human-only surface below denies train admission. T3 still requires the existing exact issue-level Human scope pre-authorization.
6. Final integration and merge are serialized. Immediately before squash merge, a fresh `origin/main` fetch proves current base/head, manifest closure, zero findings, all child acceptance evidence, all required exact-head checks, and current Linear blockers.

A material base, head, manifest, or included-child change invalidates affected CI/review/admission evidence. A blocked child may be removed only before PR publication by removing its diff, moving it to the deferred manifest with no completion claim, and repeating affected cumulative checks. If reviewability, risk/gate coherence, or rollback independence fails, split before PR.

## Risk envelope

- T0–T2 may qualify when all admission conditions hold and the change is non-semantic and non-reserved.
- T3 may qualify only when the owning Linear issue contains explicit Human pre-authorization for the exact architecture/scope and the PR introduces no new ambiguity or reserved operation.
- T4 never qualifies.

## Human-only gates

The Program Controller must not merge a PR that changes or performs any of the following:

- Step 0–22 canon, Product Constitution, authority ownership, governance authority, or acceptance criteria after evidence appears;
- unresolved semantic/architectural choice or a scope expansion beyond the ratified issue;
- DEE-540/541 official one-shot blind-holdout authorization, access, reveal, execution, or verdict;
- strategy/package/account promotion or Human re-attestation;
- Org-0 or external-client live-capital promotion, first-live enable, or capital-envelope widening;
- production secrets, security exceptions, destructive production/data operations, production deploys, or production release tags;
- Execution Server sync, creation, build, deploy, rollback, SSH recovery, or live operation;
- branch protection, required-check, tenant-isolation, test, security, or evidence-gate weakening.

No Integration Train declaration can convert any item in this list into controller authority. A governance amendment that changes this document cannot rely on its own unmerged text for admission and remains Human-merge-only under the current base policy.

These remain explicit Human actions even when adjacent implementation code is eligible.

## Merge and reconciliation receipt

For an admitted PR, record in the PR or Linear closeout:

- Linear issue; PR URL; exact pre-merge head and base SHAs;
- required-check result and independent-review result;
- admission result and confirmation that no Human-only surface is present;
- resulting squash/main SHA and rollback path;
- post-merge proof that the resulting SHA is contained in `origin/main`;
- Linear terminal state for the Integration Batch issue and, for a train, proof that only exact-head-delivered manifest children were closed while deferred/excluded children remained truthful;
- the next dependency-unblocked DAG node.

If merge or post-merge verification fails, stop, preserve evidence, and escalate. Do not start the next node on assumed integration.
