# DEE-266 — Paper loop soak grep reference

**Type:** Operator adjunct (grep-only; no runtime).

**Scope:** AT-E9 S7 cycle-complete telemetry for soak log correlation. Does not complete M7, AT-E9 FG, or DEE-209.

---

## Capture stdout during unbounded loop

```bash
pnpm trader:paper:loop -- --org-id=<uuid> --account-key=acct-paper-loop 2>&1 | tee paper-loop-soak.log
```

Omit `--max-cycles` for unbounded runs; stop with SIGINT/SIGTERM after the current cycle.

---

## Filter cycle-complete lines

```bash
grep '"event":"waia_trader_event"' paper-loop-soak.log | grep '"kind":"paper_loop"' | grep '"outcome":"cycle_complete"'
```

Per-cycle correlation:

```bash
grep '"cycle_id":"test-account-state-0"' paper-loop-soak.log
```

Critical surfacing within loop telemetry:

```bash
grep '"kind":"paper_loop"' paper-loop-soak.log | grep '"severity":"critical"'
```

P5 two-strategy participation (DEE-337 / PR #296 `strategy_ids` on `cycle_complete`):

```bash
grep '"outcome":"cycle_complete"' paper-loop-soak.log | grep '"strategy_ids"'
pnpm trader:paper:soak:analyze -- --log=paper-loop-soak.log --min-hours=48
```

Optional rollup (when `rollupEveryCycles` is configured in code):

```bash
grep '"kind":"paper_loop"' paper-loop-soak.log | grep '"outcome":"rollup"'
```

---

## Related

- [DEE-170-48H-PAPER-SOAK-CLOSURE-REPORT.md](../ops/DEE-170-48H-PAPER-SOAK-CLOSURE-REPORT.md) — canonical 48h soak closure audit (DEE-170 / M7)
- [DEE-337-P5-TWO-STRATEGY-PAPER-SOAK-RUNBOOK.md](../ops/DEE-337-P5-TWO-STRATEGY-PAPER-SOAK-RUNBOOK.md) — P5 two-strategy soak operator procedure
- [DEE-222-TRADER-TELEMETRY-SCHEMA.md](./DEE-222-TRADER-TELEMETRY-SCHEMA.md) — base envelope and `paper_loop` golden example
- [DEE-95G-RUNTIME-TELEMETRY-RUNBOOK.md](./DEE-95G-RUNTIME-TELEMETRY-RUNBOOK.md) — where stdout appears
