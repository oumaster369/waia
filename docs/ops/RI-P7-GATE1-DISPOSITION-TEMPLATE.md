# RI-P7 — Architect Gate 1 Disposition Template

**Status:** Template only — **HC-3.5 NOT EXECUTED**  
**Authority:** [RI-P7 execution plan](../../.cursor/plans/ri_p7_execution_d2ccef43.plan.md) · [Product Constitution](../AI-TRADER-PRODUCT-CONSTITUTION.md) §5.2

> Production Knowledge Assets are **immutable**. This disposition records human research confidence **without** editing sealed PKA JSON.

---

## When to use

After Track A evidence + PKA + campaign manifest are reviewed (P7-S4 complete), the Architect records Gate 1 disposition **before** authorizing HC-3.5 operator ceremony.

---

## HumanKnowledgeDisposition v1 (copy to operator vault)

Save as `replay-runs/RI-P7/human-knowledge-disposition-track-a.json`:

```json
{
  "schemaVersion": "waia.trader.human-knowledge-disposition.v1",
  "knowledgeId": "<from campaign-manifest.json Track A>",
  "researchConfidenceBand": "solid",
  "dispositionAt": "<ISO-8601>",
  "dispositionBy": "architect",
  "rationale": "Track A mean_reversion_v0 research evidence and PKA reviewed; regime coverage satisfied on HTX data; HC-3.5 ceremony authorized."
}
```

**Allowed `researchConfidenceBand` values:** `speculative` | `preliminary` | `solid` | `compelling`

---

## Gate 1 checklist (Architect)

| # | Check | PASS |
|---|-------|------|
| 1 | Track A `ResearchEvidenceDocument` v2 provenance valid | |
| 2 | Track A PKA sealed; `knowledgeId` matches manifest | |
| 3 | Immutability: PKA file unchanged after seal | |
| 4 | Disposition references `knowledgeId`; PKA not edited | |
| 5 | Promotion rehearsal PASS (paper + research evidence) | |
| 6 | HC-3.5 checklist Steps 1b + 1c documented | |

**On PASS:** Record Linear comment on RI-P7 issue; authorize operator to begin HC-3.5 Steps 0–7.

**STOP:** Do **not** execute HC-3.5 inside Composer. Do **not** proceed to HC-4 until §3.5 sealed.

---

## Related

| Document | Role |
|----------|------|
| [RI-P7 Evidence Campaign Runbook](RI-P7-EVIDENCE-CAMPAIGN-RUNBOOK.md) | Operator vault layout + CLI |
| [HC-3.5 Operator Checklist](DEE-340-BP10-L2.5-HC3.5-OPERATOR-CHECKLIST.md) | Ceremony Steps 1b/1c |
| [Launch Closure Report §3.5](DEE-340-BP10-LAUNCH-CLOSURE-REPORT.md) | Evidence ledger |
