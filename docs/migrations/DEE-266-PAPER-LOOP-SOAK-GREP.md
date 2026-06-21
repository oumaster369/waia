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

Optional rollup (when `rollupEveryCycles` is configured in code):

```bash
grep '"kind":"paper_loop"' paper-loop-soak.log | grep '"outcome":"rollup"'
```

---

## Related

- [DEE-170-48H-PAPER-SOAK-CLOSURE-REPORT.md](../ops/DEE-170-48H-PAPER-SOAK-CLOSURE-REPORT.md) — canonical 48h soak closure audit (DEE-170 / M7)
- [DEE-222-TRADER-TELEMETRY-SCHEMA.md](./DEE-222-TRADER-TELEMETRY-SCHEMA.md) — base envelope and `paper_loop` golden example
- [DEE-95G-RUNTIME-TELEMETRY-RUNBOOK.md](./DEE-95G-RUNTIME-TELEMETRY-RUNBOOK.md) — where stdout appears
