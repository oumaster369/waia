# Evidence policy

**Owner:** Architect · **Status:** Canonical · **Linear:** DEE-407 (vNext Slice E)

Classifies artifacts produced during WAIA work so agents and operators know what to commit, gitignore, archive, or keep external. Complements [`INTEGRATION-BOUNDARY-POLICY.md`](INTEGRATION-BOUNDARY-POLICY.md) §Integration-ready contract and [`docs/ops/EXECUTION-SURFACES.md`](../ops/EXECUTION-SURFACES.md).

**Related:**

- [`replay-runs/RI-P7/README.md`](../../replay-runs/RI-P7/README.md) — RI-P7 vault index
- [`replay-runs/RI-P7/m9-v2-research-campaign-org0/M9-OPERATOR-RUNBOOK.md`](../../replay-runs/RI-P7/m9-v2-research-campaign-org0/M9-OPERATOR-RUNBOOK.md) — M9 campaign evidence handling
- [`.gitignore`](../../.gitignore) — gitignore patterns with policy references

---

## Principles

1. **Git is canonical engineering memory** for accepted research evidence under `replay-runs/**`.
2. **Scratch is never committed** — promote or delete before PR readiness.
3. **Classification is explicit** — every artifact has one primary class (below).
4. **Provenance is additive** — campaign CLIs seal `runId`, `executionOrigin`, `gitSha`, `environment`, and `dbConnectionMode` in manifest frontmatter without changing pipeline or blind-holdout semantics.

---

## Taxonomy

| Class | Purpose | Typical location | Commit? |
|-------|---------|------------------|---------|
| **temp** | Ephemeral scratch while a run is in flight | Working tree, `/tmp`, unstaged copies | **No** — delete or reclassify before PR |
| **diagnostic** | Operator diagnostics from a terminated campaign (success, governed reject, or crash) | `*-campaign-operator-diagnostics.json`, `VALIDATION.md` notes | **Yes** when tied to a closed milestone |
| **forensic** | Post-incident investigation packages (timeline, root cause, reproduction) | `*-forensics*`, `M9-FORENSIC-REPORT.md`, `FINDINGS.md` | **Yes** when investigation is closed |
| **accepted experimental** | Governance-accepted research outputs not yet promoted to production knowledge | `m9-research-evidence.json`, `m9-production-knowledge-asset.json`, PKA exports, `evidence-*.json` | **Yes** — primary audit trail |
| **rejected** | Deterministic governed rejection records | `*-research-rejection-record.json`, `*-evolution-cycle-mvp.json` on reject/crash | **Yes** — documents negative results |
| **archived** | Superseded run artifacts moved under `archive/<reason>/` | `replay-runs/**/archive/**` | **Yes** — read-only reference |
| **operator forensics stash** | Local scratch copies before vault promotion | `replay-runs/**/_operator-forensics-stash/` | **No** — gitignored; promote into vault or `archive/` |
| **external** | Evidence outside the repo (host logs, Supabase advisors, Linear attachments, S3) | Operator host, SaaS consoles | **Reference only** — link from markdown execution records |

---

## Storage rules by class

### temp

- Created during active CLI runs or local debugging.
- Must not appear in integration PRs.
- If valuable, promote to **diagnostic**, **forensic**, or **accepted experimental** before merge.

### diagnostic

- Emitted by `finalizeResearchCampaignOutcomePostgres` and M9 campaign sealing.
- Pair with `M9-CAMPAIGN-EXECUTION-RECORD.md` or milestone `VALIDATION.md`.

### forensic

- Used when infrastructure or accounting defects block a campaign (e.g. transaction pooler crash — DEE-399).
- Archive packages under `archive/<date>-<slug>/` with a `README.md` explaining provenance.

### accepted experimental

- Full M9 v2 vault set: evidence, PKA, metrics export, lifecycle trace, provider fusion, decision trace, operator authorization record, campaign manifest.
- Manifest **must** include additive `frontmatter` (see §Campaign provenance).

### rejected

- Governed rejects and crash outcomes are first-class evidence — never delete to "clean up."
- `MULTI_REGIME_COVERAGE_INSUFFICIENT` and `CAMPAIGN_INFRA_DISCONNECT` records stay in vault root or `archive/` per operator runbook.

### archived

- Move superseded JSON/MD into `archive/<reason>/`; leave a root pointer in execution records.
- Do not edit archived JSON — append new runs at vault root or new archive folder.

### operator forensics stash

- Pattern: `replay-runs/**/_operator-forensics-stash/` (see [`.gitignore`](../../.gitignore)).
- Copy stash → review → promote into committed vault paths → delete stash.

### external

- Cite in markdown with date, surface, and retrieval path.
- Never paste secrets into committed evidence.

---

## Campaign provenance (M9 / discovery CLIs)

Trader campaign scripts attach additive **frontmatter** to manifests and discovery run records:

| Field | Meaning |
|-------|---------|
| `runId` | Stable run identifier (M9: `backtestRunId` from pipeline) |
| `executionOrigin` | Execution surface id per [`EXECUTION-SURFACES.md`](../ops/EXECUTION-SURFACES.md) |
| `gitSha` | Builder git SHA (`GITHUB_SHA` / `VERCEL_GIT_COMMIT_SHA` when present) |
| `environment` | `WAIA_ENV` or inferred (`ci`, `execution-server`, `development`, …) |
| `dbConnectionMode` | `session`, `transaction_fallback`, `postgres`, `sqlite`, or `none` |

Override surface explicitly on the Execution Server: `WAIA_EXECUTION_SURFACE=execution-server`.

**Non-goals:** frontmatter does not alter blind authorization scope, dataset seals, or holdout splits.

---

## Integration-ready checklist (evidence)

Before opening a PR ([`INTEGRATION-BOUNDARY-POLICY.md`](INTEGRATION-BOUNDARY-POLICY.md)):

1. No **temp** or **operator forensics stash** paths staged.
2. New **accepted experimental** / **rejected** JSON lives under the correct `replay-runs/**` vault.
3. Superseded artifacts moved to **archived** with README.
4. External-only evidence referenced from committed markdown.
5. Campaign manifests include `frontmatter` when produced by updated CLIs.

---

## Quick reference — RI-P7 vault

| Milestone vault | Primary classes |
|-----------------|-----------------|
| `m9-v2-research-campaign-org0/` | accepted experimental, rejected, diagnostic, forensic, archived |
| `m8-strategy-discovery-org0/` | accepted experimental, diagnostic |
| `closed-trade-attribution-forensics-org0/` | forensic |
| `dee-371-artifact-check/` | forensic, rejected |

Index: [`replay-runs/RI-P7/README.md`](../../replay-runs/RI-P7/README.md).

---

*Last updated: 2026-07-10 — vNext Slice E.*
