# FHV Release Identity Contract (DEE-416 / DEE-431)

Fail-closed contract for Execution Server deployment, systemd supervision, and FHV rehearsal targeting.

**Agents must not resolve or mutate `EXECUTION_SERVER_TARGET_SHA`.** Only a Human-operated dev → main release merge establishes the next production identity.

## Symbol

| Variable | Meaning |
|----------|---------|
| `EXECUTION_SERVER_TARGET_SHA` | Full 40-character lowercase Git SHA that every active deployment/rehearsal surface must pin |

Until the next Human-merged dev → main release completes:

```text
EXECUTION_SERVER_TARGET_SHA=UNRESOLVED_UNTIL_NEXT_RELEASE
```

Any operational command that requires a target SHA **must fail closed** when the variable is unset, empty, abbreviated, ambiguous, or mismatched.

## Resolution (Human release gate only)

After Human **Create a merge commit** merge of dev → main:

1. `NEW_RELEASE_SHA` = exact merge commit SHA on `main` produced by that merge commit.
2. Set `EXECUTION_SERVER_TARGET_SHA="$NEW_RELEASE_SHA"`.
3. Prove tag peel (fail closed):

   ```bash
   test "$(git rev-parse "${RELEASE_TAG}^{commit}")" = "$NEW_RELEASE_SHA"
   ```

4. Prove GitHub Release body identifies the same full `NEW_RELEASE_SHA`.
5. Prove fresh Execution Server checkout `HEAD == EXECUTION_SERVER_TARGET_SHA`.
6. Prove rehearsal manifest `targetSha == EXECUTION_SERVER_TARGET_SHA`.
7. Prove `deployed-revision.json` `gitSha == EXECUTION_SERVER_TARGET_SHA` after successful deployment.

A dev-branch SHA is never the production target until promoted through dev → main. After merge commit, the production target is the **main merge commit**, not the pre-release dev tip.

## Forbidden targets

| Identity | Classification | Rule |
|----------|----------------|------|
| Prior release SHA (e.g. previous `main` tag peel) | Historical | **Forbidden** as the next active deployment/rehearsal target |
| Feature branch head SHA | Integration-only | **Forbidden** as production/release target |
| Pre-release dev-only SHA | Integration-only | **Forbidden** until promoted through dev → main release |
| Post-release main → dev back-sync merge SHA | Integration ancestry | **Not automatically** a production deployment target |
| Empty / abbreviated / ambiguous SHA | Invalid | **Fail closed** |

## Required active command form (rehearsal)

```bash
pnpm trader:fhv:rehearsal -- \
  --target-sha "$EXECUTION_SERVER_TARGET_SHA" \
  --run-id "<human-approved-unique-run-id>"
```

Repository docs and runbooks must **never** embed a concrete future release SHA in active operational sections before that release exists.

## Mismatch handling

If any of these differ, stop before campaign start:

- `EXECUTION_SERVER_TARGET_SHA`
- checkout `HEAD`
- systemd unit SHA guard target
- rehearsal manifest `targetSha`
- `deployed-revision.json` `gitSha`
- GitHub Release / tag peel SHA (when release-bound)

## Historical evidence

Historical SHAs in closure reports, certification records, legacy checkout inventory, and prior release notes remain valid **as historical facts**. They must not appear in **active** deploy/rehearse/checkout instructions.

## Related documents

- [`FHV-EXECUTION-SERVER-REHEARSAL-CONTRACT.md`](FHV-EXECUTION-SERVER-REHEARSAL-CONTRACT.md)
- [`EXECUTION-SERVER-RUNBOOK.md`](EXECUTION-SERVER-RUNBOOK.md)
- [`docs/adr/0023-execution-server-ai-trader-only-execution-plane.md`](../adr/0023-execution-server-ai-trader-only-execution-plane.md)
- Regression: [`scripts/ops/validate-fhv-release-identity.sh`](../../scripts/ops/validate-fhv-release-identity.sh)
