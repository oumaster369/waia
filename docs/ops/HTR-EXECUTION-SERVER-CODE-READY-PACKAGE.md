# HTR Execution Server — Code-Ready Package (Option A)

**Owner:** Architect · **Linear:** DEE-415 · **Work package:** HTR-WP23  
**Decision:** `APPROVE-HTR-EXECSERVER: option-a-code-ready` (D-19)  
**Mode:** `option-a-code-ready` — manifests, contracts, and operator instructions only

> **Not deployed.** This package makes the Execution Server **ready for Human-operated deployment** after `CERTIFY-HTR-READY`. HTR Phase A must not mutate any execution host.

## Package identity

| Field | Value |
|-------|-------|
| Schema | `htr-execution-server-code-ready-package/v1` |
| Package ID | `HTR-WP23-EXECUTION-SERVER-CODE-READY` |
| Implementation | `lib/trader/readiness/htr-execution-server-package.ts` |

Run `buildHtrExecutionServerPackageManifest()` to produce the canonical manifest at build/validation time.

---

## 1. Attestations (mandatory)

| Attestation | Phase-A value |
|-------------|---------------|
| `actualServerMutation` | PROHIBITED |
| `holdoutRead` | PROHIBITED |
| `blindHoldoutStatus` | SEALED_NOT_ACCESSED |
| `datasetAcquisitionRequiredBeforeActualFhv` | true |
| `deploymentQualificationDeferred` | true |

Agents and Composer must **never** pass `--confirm` to guarded Execution Server scripts.

---

## 2. Resource assumptions

Baseline execution host profile (operator vault — adjust per capacity evidence):

| Resource | Minimum |
|----------|---------|
| Memory | 16 GB |
| Disk | 256 GB |
| Network egress | HTX market data + Postgres session-mode only |

---

## 3. Command references

| ID | Classification | Path | Purpose |
|----|----------------|------|---------|
| `preflight-read-only` | READ_ONLY | `scripts/ops/execution-server-preflight.sh` | Stale-code guard |
| `sync-human-only` | HUMAN_ONLY_MUTATION | `scripts/ops/execution-server-sync.sh` | Pin checkout SHA |
| `build-human-only` | HUMAN_ONLY_MUTATION | `scripts/ops/execution-server-build.sh` | Build container |
| `deploy-human-only` | HUMAN_ONLY_MUTATION | `scripts/ops/execution-server-deploy.sh` | Deploy container |
| `htr-readiness-preflight` | READ_ONLY | `scripts/trader/historical-readiness-preflight.ts` | FHV contract pinning |

Full deploy topology: [`EXECUTION-SERVER-RUNBOOK.md`](./EXECUTION-SERVER-RUNBOOK.md)

---

## 4. Checkpoint and evidence paths

| Path | Role |
|------|------|
| `.cursor/plans/dee-415-wp23/evidence-staging/<SHA>/` | Phase-A staging (WORK commit evidence) |
| `replay-runs/RI-P7/htr-wp23-readiness-package/` | Phase-B promoted evidence (must not exist pre-promotion) |

Evidence integrity: `waia.htr.evidence-integrity.v2` (manifest + sidecar digests)

Harness: `lib/trader/readiness/htr-readiness-evidence-harness.ts`

---

## 5. Pinned contracts in package

| Contract | Pin source |
|----------|------------|
| FHV Run Contract v0 | `htr-fhv-run-contract-v0.ts` → digest in manifest |
| Operator report schema | `htr-operator-report/v1` |
| D-20 drawdown policy | `htr-wp16-d20-drawdown/v1` (via FHV contract) |
| Cost model | `waia.trader.cost-model.v1` · 10/5 bps |
| Dataset manifest digest | WP12 semantic digest `fd7d4895…` (template — real HTX TBD) |

---

## 6. Required Human confirmation tokens

Before actual FHV execution (post-certification):

1. `CERTIFY-HTR-READY`
2. `APPROVE-HTR-FHV-DATASET-SOURCE`
3. `APPROVE-HTR-EXECSERVER-PACKAGE-MODE:option-a-code-ready`

Preflight may optionally verify token presence via `--candidate-json` companion flow in Phase B.

---

## 7. Holdout no-read attestation

The package attests that blind holdout (`2025-01-01 … 2025-12-31`) remains `SEALED_NOT_ACCESSED` throughout HTR. Holdout access requires a separate operator procedure in the Full Historical Validation Program — not this package.

---

## 8. Validation

```bash
pnpm vitest run tests/unit/trader-wp23-execution-server-package.test.ts
pnpm trader:htr:readiness:preflight -- --self-test
```

Manifest digest must remain stable across identical builds (`computeHtrExecutionServerPackageDigest()`).

---

## 9. Gap ownership

| Gap | Phase-A | Phase-B closure |
|-----|---------|-----------------|
| HTR-GAP-042 | OPEN — package exists | Close with promoted evidence |
| HTR-GAP-028 | OPEN — preflight exists | Close with negative matrix + CLI evidence |

Deployment qualification remains **out of scope** for DEE-415.
