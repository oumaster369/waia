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
| **FP-008** | **Symptom:** Agent finishes `/test-and-fix` green but stops with a dirty working tree, requiring a follow-up prompt to commit, push, update Linear, and prepare PR readiness. **Root cause:** the commit step between green validation and PR readiness was implicit in `AGENTS.md` "Default completion"; agents conservatively halted instead of committing. **Recovery:** Architect prompts a manual commit + push + Linear update, or invokes `/prepare-pr` after a manual commit. **Prevent:** [`../../AGENTS.md`](../../AGENTS.md) "Safe auto-advance after green validation" + [`../../.cursor/commands/test-and-fix.md`](../../.cursor/commands/test-and-fix.md) explicit commit step. Auto-advance is bounded by enumerated preconditions; auto-merge and scope expansion remain forbidden. |
| **FP-010** | **Symptom:** After a release, `main` shows as ahead of / diverged from `dev` and release PRs hit history conflicts. **Root cause:** release-promotion and/or `main → dev` back-sync PRs were **squash-merged** (or skipped); squash cannot preserve the second parent, so `main` never becomes an ancestor of `dev`. **Recovery:** open a `dee-<NN>-release-back-sync-*` PR (`git merge --no-ff origin/main`) and merge it with **"Create a merge commit"**; verify `git merge-base --is-ancestor origin/main origin/dev` (see [`POST-MERGE-PROTOCOL.md`](POST-MERGE-PROTOCOL.md)). **Prevent:** [`BRANCHING-STRATEGY.md`](BRANCHING-STRATEGY.md) merge-by-class table — release/back-sync PRs must use merge commits, never squash; agents recommend the back-sync immediately after every promotion. |

## Migration doctrine

| **FP-004** | **Symptom:** Introducing “neutral” fake transaction façade before Postgres policy validated. **Root cause:** skipped tracker reading. **Recovery:** revert; read [`../migrations/DEE-64-TRACKER.md`](../migrations/DEE-64-TRACKER.md). **Prevent:** [`MIGRATION-GOVERNANCE.md`](MIGRATION-GOVERNANCE.md); never restate shortcuts differently. |

## Hallucination / context

| **FP-005** | **Symptom:** Agent claims Linear issue Done when Backlog. **Root cause:** stale chat context. **Recovery:** Refresh `list_issues` / Architect check. **Prevent:** Mandatory Linked issue URL in PR. |

| **FP-009** | **Symptom:** PR merges against wrong `DEE-NN` (branch/title id ≠ issue scope); wrong issue closed Done. **Root cause:** branch number reused without `get_issue`; Linear GitHub linkback trusts PR title. **Recovery:** Revert wrong issue to Todo; create canonical issue; cross-link — see [`LINEAR-ID-COLLISION-RECOVERY.md`](LINEAR-ID-COLLISION-RECOVERY.md). **Prevent:** `/groom` scope check; PR title must match groomed issue; disallow `dee-NN` branch without Linear confirmation. |

## UX / CI

| **FP-006** | **Symptom:** Flaky Playwright masking real regression. **Root cause:** environment timing. **Recovery:** rerun isolated; stabilize test. **Prevent:** track flakes in Linear `qa` commentary. |

| **FP-007** | **Symptom:** CI fails on transient edge/host fetch (e.g. Cloudflare toolchain flake); PR unchanged. **Root cause:** infra noise. **Recovery:** one clean workflow rerun before escalating; treat repeat failures as real. **Prevent:** no standing policy beyond rerun-first heuristic — escalate only if reproducible. |

## Related

- [`EXECUTION-CONTRACT.md`](EXECUTION-CONTRACT.md)
- [`GOVERNANCE-VERSIONING.md`](GOVERNANCE-VERSIONING.md)
