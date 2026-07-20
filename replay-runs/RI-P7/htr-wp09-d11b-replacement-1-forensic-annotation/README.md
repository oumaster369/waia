# HTR-WP09 D-11B replacement attempt — forensic evidence-accounting annotation

This directory records an **audit annotation only**. It does **not** replace, regenerate, or modify the
sealed qualification evidence under:

- `.cursor/plans/dee-415-d11b/qualification-staging/htr-wp09/` (first attempt — invalidated by instrumentation)
- `.cursor/plans/dee-415-d11b/qualification-staging/htr-wp09-replacement-1/` (replacement attempt — valid FAIL)

## Why the prior result remains FAIL under its original contract

The replacement D-11B attempt (manifest digest `bff973996…`) is permanently classified as a **VALID THRESHOLD
FAIL** under the original Human-approved D-11B contract (`max2xMemoryGrowthBytes = 1,048,576` applied to
pre-GC RSS peak growth). The independently recomputed breach is `rssGrowthFor2xN = 5,308,416 B`. This result
must never be retroactively relabelled PASS.

## Why the evidence-accounting defect does not invalidate that attempt

The approved measurement contract defined both `rssGrowthFor2xN` and `heapGrowthFor2xN`, but the harness at
`bc9cb46` evaluated only RSS growth in threshold gating (`HEAP_GATE_NOT_EVALUATED`). The correct heap growth
was `39,796,120 B` (the Composer report's `40,733,120 B` was wrong). Evaluating the omitted heap gate would
have added a second failure, not removed the RSS failure. The attempt is therefore **not invalidated**; the
sealed failure list is **incomplete** but the terminal FAIL classification is correct.

## Why the amendment applies prospectively only

Human decision `AUTHORIZE-HTR-D11B-MEMORY-GATE-AMENDMENT-V1` (2026-07-13) retires the pre-GC cross-N peak
growth acceptance gate and introduces a post-GC live-heap retained-state gate. That amendment governs **new**
qualification attempts only. It does not rewrite historical audit records or reclassify prior sealed evidence.

## Sealed evidence integrity

Neither sealed evidence directory was modified during the forensic audit or this annotation. Raw observations,
manifest digests, and git/harness bindings in the sealed bundles remain the authoritative record for their
respective attempts.
