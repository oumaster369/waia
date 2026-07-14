# HTR-WP09 — Canvas runtime qualification (accepted evidence)

Accepted D-11B performance/memory qualification for the HTR-WP09 default incremental
Canvas runtime cutover, under the Human-approved **D-11B Memory Gate Amendment v1**
(2026-07-13). Promoted byte-for-byte by the Opus 4.8 Macro-C Phase B audit.

**Accepted result:** `HTR_WP09_D11B_MEMORY_AMENDMENT_V1_PASS`
**Qualification Git SHA:** `7c532f5ef2d936cff1a28a8f53e8f45d3377d0aa`
**Harness SHA-256:** `5bd9a61a5f2ed3d022f7c853f05d8e657192f4e53f08de893062ace1436c248c`
**Host fingerprint SHA-256:** `1cd9f9535e86b3f5ad13cd907f08059d5ca3650cfbf74d9120449c7355b7a774`
**Dataset SHA-256 (N2 normalized):** `e3415ffb324961ce19ce014a08d6cc3bc12bcaaba6ae380824dc7049f33a570f`

## Bundle

- `accepted-amendment-v1-attempt-1/qualification-attempt.json` — byte-identical copy of the sealed
  Amendment-v1 attempt (`sha256 = 78560485f2690ed0b7c59d6e8cfe9a5183df1f65d331f6b2b13bbbf4eea0a60c`).
- `accepted-amendment-v1-attempt-1/manifest.json` — byte-identical copy of the sealed staging manifest
  (its `manifestDigest` field == `78560485…` == `sha256(qualification-attempt.json)`).
- `PROVENANCE.json` — immutable promotion wrapper (source path, digests, binding, PASS gate table).

No raw run was regenerated. The original staging directories under
`.cursor/plans/dee-415-d11b/qualification-staging/` remain immutable.

## Attempt structure

Per dataset: 1 cold run (excluded from aggregate) + 5 warm runs (included), each in a fresh
Node process with `--expose-gc`. N1 = 64,800 bars; N2 = 129,600 bars.

## Full D-11B attempt audit trail

| Attempt | Path | Manifest digest | Status |
|---|---|---|---|
| 1 — first (invalidated) | `.cursor/plans/dee-415-d11b/qualification-staging/htr-wp09/` | `10edfeaf…d7e98` | `INVALIDATED_BY_INSTRUMENTATION_FAILURE` |
| 2 — replacement (valid FAIL) | `.cursor/plans/dee-415-d11b/qualification-staging/htr-wp09-replacement-1/` | `bff97399…c6cd` | `VALID_THRESHOLD_FAIL` under the ORIGINAL contract (rssGrowth 5,308,416 > 1,048,576) — never relabelled PASS |
| 3 — Amendment v1 (accepted PASS) | this bundle | `78560485…a60c` | `HTR_WP09_D11B_MEMORY_AMENDMENT_V1_PASS` |

Forensic annotation for attempts 1–2:
`replay-runs/RI-P7/htr-wp09-d11b-replacement-1-forensic-annotation/`
(Opus verdict: `VALID_THRESHOLD_FAIL_GATE_DEFINITION_MISALIGNED`; `HEAP_GATE_NOT_EVALUATED`).

## Amendment v1 gate summary (all PASS)

N2 barCount 129,600 · Canvas advances 129,600 · replay cycles 129,581 · max wall 150,850 ms
(≤ 1,800,000) · mean cycle 0.265 ms (≤ 13.891) · p95 cycle 0.47 ms (≤ 55.564) · runtime range
4.65% (≤ 20) · N1→N2 median wall ratio 1.958 (≤ 2.20) · p95 RSS delta 200,785,920 B (≤ 536,870,912)
· p95 heap delta 249,136,248 B (≤ 268,435,456) · **p95 post-GC live-heap delta 17,072 B (≤ 4,194,304)**
· retainedCycleResults 0 · peakBufferedProjections 32 (≤ 32) · serialized Canvas 8,687 B (≤ 262,144)
· fullHistoryRescans 0 · semantic parity EXACT · digest parity EXACT.

Diagnostic-only (retired as gates): rssGrowthFor2xN 35,291,136 B · heapGrowthFor2xN 71,044,336 B.
