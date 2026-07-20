# DEE-340 — Operator Console UX Backlog (Post-MVP)

**Linear:** [DEE-340](https://linear.app/deepsense/issue/DEE-340) · **Source ceremony:** HC-3 (L2 manual billing gate) · **Date captured:** 2026-06-29  
**Status:** Backlog only — **no implementation authorized** by this document  
**Scope:** Post-MVP improvements to the AI-TRADER Operator Console (`/admin/*` on the trader host)

> Observations below were discovered during the **real production HC-3 operator ceremony** on Org-0 / `htx-spot-1`. They do not block BP-10 launch authorization. They inform future UX work after MVP seal.

---

## Purpose

Capture friction, manual steps, and missing affordances so the Operator Console exposes **current system state** instead of requiring the operator to remember IDs, paste UUIDs, or interpret raw JSON.

**Out of scope for this backlog document:** runtime changes, billing logic changes, HC-4/L3 execution.

---

## Billing — organization & account discovery

| ID | Observation | Expected improvement |
|----|-------------|----------------------|
| B-1 | Organization selector lists all orgs; operator must know which org has billing activity | Show **only organizations with connected exchange accounts** (or badge/filter) |
| B-2 | Exchange account id (`htx-spot-1`) must be typed manually | **Automatic exchange account discovery** from org credentials / connected accounts |
| B-3 | Manual **Exchange Account ID** field is error-prone | **Remove manual entry** when exactly one account exists; dropdown when multiple |
| B-4 | Operator must know invoice UUID to act | **Automatic invoice discovery** on load — no blank state after org + account selected |
| B-5 | Invoice id is a free-text field | **Invoice list** with selectable rows instead of manual Invoice ID entry |
| B-6 | All invoices shown as raw JSON blob | Separate views: **Pending (DRAFT + approved-not-issued) / Issued / Paid** |
| B-7 | Status not visible at a glance | **Status badges** (`DRAFT`, approval pending, cooling-off, `ISSUED`, `PAID`, disputed) |
| B-8 | Actionable invoices buried in list order | **Sort actionable first** (DRAFT billable → pending approval → cooling-off → issued unpaid) |

---

## Billing — cooling-off UX

| ID | Observation | Expected improvement |
|----|-------------|----------------------|
| C-1 | After Approve, operator must mentally track 15-minute wait | **Countdown timer** to `coolingOffUntil` |
| C-2 | No remaining time displayed | Show **remaining time** (mm:ss) on billing detail |
| C-3 | Cooling-off purpose not explained in UI | Inline **explanation of purpose** (ADR-0011 governance; prevents mistaken Issue) |
| C-4 | Issue button may appear clickable during cooling-off | **Disable Issue** until elapsed; tooltip with `coolingOffUntil` |
| C-5 | Approve may remain enabled incorrectly after approval | **Disable Approve** when pending approval exists; enable **Cancel pending** |
| C-6 | No visual sense of ceremony progress | **Visual progress** indicator: Draft → Approved → Cooling-off → Issued |
| C-7 | Operator navigates away during wait with no anchor | **Safe navigation** — banner persists “Issuance approved; Issue available after …” on return |

---

## Operator workflow — ceremony guidance

| ID | Observation | Expected improvement |
|----|-------------|----------------------|
| W-1 | HC-3 is a multi-step ceremony; console is a flat JSON panel | **Guided step-by-step wizard** aligned to ADR-0008 checklist (Steps 0–6) |
| W-2 | No indication of current ceremony stage | **Progress indicator** — current stage highlighted (e.g. “Step 4: Cooling-off”) |
| W-3 | Operator must cross-reference external checklist doc | Embed **current ceremony stage** and next allowed action in-console |
| W-4 | Approve / Issue are single-click with no confirmation | **Better confirmations** — summary of fee, period, attestations before irreversible steps |
| W-5 | Success feedback is a one-line string | **Better success feedback** — structured toast/panel with timestamps and next step |
| W-6 | Errors are generic API messages | **Better error explanations** — map codes (`ISSUANCE_COOLING_OFF_NOT_ELAPSED`, etc.) to operator actions |

---

## Console usability — cognitive load

| ID | Observation | Expected improvement |
|----|-------------|----------------------|
| U-1 | Load billing requires manual org + account + invoice id | **Remove unnecessary manual actions** — auto-load on org/account select |
| U-2 | Raw JSON dumps increase cognitive load | Structured **read panels** (line items, HWM, period, approval metadata) |
| U-3 | Operator must remember id prefixes for evidence | Surface **id prefixes** in UI labels; copy-to-clipboard for evidence package |
| U-4 | System state is discovered by operator, not presented | **Expose current system state** — invoice status, dispute, HWM, period closure in summary header |
| U-5 | Review panel for disputes is easy to miss | Prominent **dispute / blockers** callout before Approve and Issue |
| U-6 | Attestations are implicit (all sent `true` on Approve click) | Explicit **attestation checklist UI** with per-item affirm before Approve (ADR-0008) |

---

## Cross-cutting (all admin surfaces)

| ID | Observation | Expected improvement |
|----|-------------|----------------------|
| X-1 | Pattern repeats on other admin pages (manual ids, JSON-only) | Shared **Admin ReadReviewActionShell** enhancements — apply billing learnings globally |
| X-2 | No link from billing to related period / HWM / audit | **Deep links** to reporting period detail, HWM ledger view, filtered audit stream |
| X-3 | Evidence capture for closure reports is manual | **Export evidence package** button (non-secret shapes only) for Composer handoff |

---

## HC-3 ceremony evidence (why this backlog exists)

Production HC-3 on 2026-06-29 succeeded using `/admin/billing` with manual id entry and raw JSON. The governed path works; UX did not block correctness. This backlog records what would reduce operator burden for **HC-4**, recurring billing periods, and post-MVP operations.

---

## References

- [DEE-340-BP10-L2-HC3-OPERATOR-CHECKLIST.md](DEE-340-BP10-L2-HC3-OPERATOR-CHECKLIST.md) — ceremony executed
- [DEE-340-BP10-LAUNCH-CLOSURE-REPORT.md](DEE-340-BP10-LAUNCH-CLOSURE-REPORT.md) §3 — HC-3 evidence
- [ADR-0008 — Manual billing gate](../adr/0008-manual-billing-gate.md)
- [ADR-0011 — Single Operator Governance Model](../adr/0011-single-operator-governance-model.md)
- Admin billing surface: `app/(trader)/admin/billing/page.tsx`

---

**STOP:** Backlog only. Do not implement from this document without a separate Linear issue and Architect approval.
