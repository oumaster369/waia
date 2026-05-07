# Failure patterns (living appendix)

Append rows when incidents repeat.**Do not delete** stale rows unless superseded with a newer row referencing this id.

Format: **Id · Symptom · Root cause · Recovery · Prevent**

---

## Governance / workflow drift

| Id | Pattern |
|----|---------|
| **FP-001** | **Symptom:** Agent branch `dee-NN-*` blocked at PR because `/prepare-pr` required `feature/`. **Root cause:** tooling/docs diverged (`§` historical split). **Recovery:** Rename branch OR align command (Batch C fixed). **Prevent:** [`BRANCHING-STRATEGY.md`](BRANCHING-STRATEGY.md), synced commands. |

| **FP-002** | **Symptom:** PR lacks `pnpm build` before CI. **Root cause:** phased validation skipped. **Recovery:** Run full chain per [`../../AGENTS.md`](../../AGENTS.md) Validation + **[`PR-PROTOCOL.md`](PR-PROTOCOL.md)** before green. **Prevent:** Executor follows `/test-and-fix`. |
| **FP-003** | **Symptom:** Invented Todo status tasks; board has no `Todo`. **Root cause:** `AGENTS.md` vs Linear reality drift. **Recovery:** Align issue status to board OR amend `AGENTS` with Architect approval. **Prevent:** [`LINEAR-GOVERNANCE.md`](LINEAR-GOVERNANCE.md). |

## Migration doctrine

| **FP-004** | **Symptom:** Introducing “neutral” fake transaction façade before Postgres policy validated. **Root cause:** skipped tracker reading. **Recovery:** revert; read [`../migrations/DEE-64-TRACKER.md`](../migrations/DEE-64-TRACKER.md). **Prevent:** [`MIGRATION-GOVERNANCE.md`](MIGRATION-GOVERNANCE.md); never restate shortcuts differently. |

## Hallucination / context

| **FP-005** | **Symptom:** Agent claims Linear issue Done when Backlog. **Root cause:** stale chat context. **Recovery:** Refresh `list_issues` / Architect check. **Prevent:** Mandatory Linked issue URL in PR. |

## UX / CI

| **FP-006** | **Symptom:** Flaky Playwright masking real regression. **Root cause:** environment timing. **Recovery:** rerun isolated; stabilize test. **Prevent:** track flakes in Linear `qa` commentary. |

| **FP-007** | **Symptom:** CI fails on transient edge/host fetch (e.g. Cloudflare toolchain flake); PR unchanged. **Root cause:** infra noise. **Recovery:** one clean workflow rerun before escalating; treat repeat failures as real. **Prevent:** no standing policy beyond rerun-first heuristic — escalate only if reproducible. |

## Related

- [`EXECUTION-CONTRACT.md`](EXECUTION-CONTRACT.md)
- [`GOVERNANCE-VERSIONING.md`](GOVERNANCE-VERSIONING.md)
