# HTR-WP04 validation

- Command: `pnpm trader:replay:evidence-recovery`
- Fixture digest verified before run
- FULL vs STREAM_ONLY parity: evidenceDigest=true, metrics=true
- Retained PaperCycleResult objects (STREAM_ONLY): 0
- Peak buffered projections: 32 (max batch 32)
- Boundedness at multiple cycle counts: 81→32, 40→32
- Evidence provenance: gitSha=b3abe7b9483be9b54752d5dfb38b29155c7a891d, dirtyTree=true
