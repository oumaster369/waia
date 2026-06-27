# DEE-266 — Paper loop telemetry grep reference

**Type:** Operator adjunct (grep-only; no runtime).

**Scope:** AT-E9 S7 cycle-complete telemetry for paper-loop log correlation. Does not complete M7, AT-E9 FG, or DEE-209.

> **Reconciliation (2026-06-27, BP-0 / DEE-347):** Canonical engineering validation is **Accelerated Historical Replay Validation** ([DEE-337 AHR runbook](../ops/DEE-337-P5-TWO-STRATEGY-AHR-RUNBOOK.md)). This grep reference remains useful for live loop telemetry during operator runs; it is not the MVP validation gate.

---

## Capture stdout during unbounded loop

```bash
pnpm trader:paper:loop -- --org-id=<uuid> --account-key=acct-paper-loop 2>&1 | tee paper-loop.log
```

Omit `--max-cycles` for unbounded runs; stop with SIGINT/SIGTERM after the current cycle.

---

## Filter cycle-complete lines

```bash
grep '"event":"waia_trader_event"' paper-loop.log | grep '"kind":"paper_loop"' | grep '"outcome":"cycle_complete"'
```

Per-cycle correlation:

```bash
grep '"cycle_id":"test-account-state-0"' paper-loop.log
```

Critical surfacing within loop telemetry:

```bash
grep '"kind":"paper_loop"' paper-loop.log | grep '"severity":"critical"'
```

P5 two-strategy participation (DEE-337 / PR #296 `strategy_ids` on `cycle_complete`):

```bash
grep '"outcome":"cycle_complete"' paper-loop.log | grep '"strategy_ids"'
pnpm trader:paper:soak:analyze -- --log=paper-loop.log --min-hours=48
```

Optional rollup (when `rollupEveryCycles` is configured in code):

```bash
grep '"kind":"paper_loop"' paper-loop.log | grep '"outcome":"rollup"'
```

---

## Related

- [DEE-170-48H-PAPER-SOAK-CLOSURE-REPORT.md](../ops/DEE-170-48H-PAPER-SOAK-CLOSURE-REPORT.md) — historical 48h operator soak closure audit (DEE-170 / M7; superseded for canonical validation)
- [DEE-337-P5-TWO-STRATEGY-AHR-RUNBOOK.md](../ops/DEE-337-P5-TWO-STRATEGY-AHR-RUNBOOK.md) — P5 two-strategy Accelerated Historical Replay Validation operator procedure
- [DEE-222-TRADER-TELEMETRY-SCHEMA.md](./DEE-222-TRADER-TELEMETRY-SCHEMA.md) — base envelope and `paper_loop` golden example
- [DEE-95G-RUNTIME-TELEMETRY-RUNBOOK.md](./DEE-95G-RUNTIME-TELEMETRY-RUNBOOK.md) — where stdout appears
