# FHV Release Identity Contract (DEE-416 / DEE-431)

Fail-closed contract for Execution Server deployment, systemd supervision, and FHV rehearsal targeting.

**Agents must not resolve or mutate `EXECUTION_SERVER_TARGET_SHA`.** Only a Human-operated official release — an explicit tag/release of an exact **`main` SHA** — establishes the next production identity.

## Symbol

| Variable | Meaning |
|----------|---------|
| `EXECUTION_SERVER_TARGET_SHA` | Full 40-character lowercase Git SHA that every active deployment/rehearsal surface must pin |

Until the next Human official release of a `main` SHA completes:

```text
EXECUTION_SERVER_TARGET_SHA=UNRESOLVED_UNTIL_NEXT_RELEASE
```

Any operational command that requires a target SHA **must fail closed** when the variable is unset, empty, abbreviated, ambiguous, or mismatched.

## Resolution (Human release gate only)

After Human creates an official release tag (workflow_dispatch or equivalent) pointing at an exact **`main` SHA**:

1. `NEW_RELEASE_SHA` = the tagged `main` commit SHA (full 40-character lowercase).
2. Set `EXECUTION_SERVER_TARGET_SHA="$NEW_RELEASE_SHA"`.
3. Prove tag peel (fail closed):

   ```bash
   test "$(git rev-parse "${RELEASE_TAG}^{commit}")" = "$NEW_RELEASE_SHA"
   ```

4. Prove GitHub Release body identifies the same full `NEW_RELEASE_SHA`.
5. Prove fresh Execution Server checkout `HEAD == EXECUTION_SERVER_TARGET_SHA`.
6. Prove rehearsal manifest `targetSha == EXECUTION_SERVER_TARGET_SHA`.
7. Prove `.ops/fhv-systemd-deployed-revision.v1.json` `releaseSha == EXECUTION_SERVER_TARGET_SHA` after successful FHV systemd deployment (see [`AI-TRADER-FHV-SYSTEMD-DEPLOYMENT-RECORD.md`](../ai-trader/AI-TRADER-FHV-SYSTEMD-DEPLOYMENT-RECORD.md)).
8. Prove legacy `.ops/deployed-revision.json` `gitSha == EXECUTION_SERVER_TARGET_SHA` when the Docker health container record is maintained separately.

A feature-branch SHA is never the production target. The production target is the **tagged `main` SHA**, not an untagged tip unless Humans deliberately choose that tip as the release identity.

**Historical note:** Dual-branch `dev` → `main` merge-commit promotion and mandatory `main` → `dev` back-sync are **retired** under single-trunk `main` (DEE-511). Do not invent Cloudflare live settings here; pin only Human-tagged `main` SHAs.

## Forbidden targets

| Identity | Classification | Rule |
|----------|----------------|------|
| Prior release SHA (e.g. previous `main` tag peel) | Historical | **Forbidden** as the next active deployment/rehearsal target |
| Feature branch head SHA | Integration-only | **Forbidden** as production/release target |
| Untagged / non-release `main` tip (unless Humans explicitly release that tip) | Not official until tagged | **Forbidden** as Execution Server target until Human release |
| Empty / abbreviated / ambiguous SHA | Invalid | **Fail closed** |

*(Historical dual-branch rows — pre-release `dev`-only SHA; post-release back-sync merge SHA — remain invalid as production targets and are not revived as active classes.)*

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
- `.ops/fhv-systemd-deployed-revision.v1.json` `releaseSha` (FHV systemd supervision — **not** the legacy Docker record alone)
- legacy `.ops/deployed-revision.json` `gitSha` (BP-6 health container — maintained separately; must not be conflated with FHV systemd record)
- GitHub Release / tag peel SHA (when release-bound)

## Historical evidence

Historical SHAs in closure reports, certification records, legacy checkout inventory, and prior release notes remain valid **as historical facts**. They must not appear in **active** deploy/rehearse/checkout instructions.

## Related documents

- [`FHV-EXECUTION-SERVER-REHEARSAL-CONTRACT.md`](FHV-EXECUTION-SERVER-REHEARSAL-CONTRACT.md)
- [`EXECUTION-SERVER-RUNBOOK.md`](EXECUTION-SERVER-RUNBOOK.md)
- [`docs/adr/0023-execution-server-ai-trader-only-execution-plane.md`](../adr/0023-execution-server-ai-trader-only-execution-plane.md)
- Regression: [`scripts/ops/validate-fhv-release-identity.sh`](../../scripts/ops/validate-fhv-release-identity.sh)
