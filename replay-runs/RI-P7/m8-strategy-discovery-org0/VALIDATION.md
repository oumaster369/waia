# M8 Validation Record

**Linear:** DEE-383  
**Date:** 2026-07-05

## Commands

```bash
pnpm lint
pnpm typecheck
pnpm test --run tests/unit/trader-discovery-*.ts tests/unit/trader-generator-strategy-synthesizer.test.ts
pnpm test --run   # full suite
pnpm build
./scripts/linear/preflight-pr-governance.sh --body-file .cursor/pr-body-DEE-383.md
```

## Targeted regression (M1–M7 isolation)

```bash
pnpm test --run tests/unit/trader-guardian-
pnpm test --run tests/unit/trader-exits-
pnpm test --run tests/unit/trader-paper-cycle-runner.test.ts
```

## Unit coverage (M8)

| Test file | Covers |
|-----------|--------|
| `trader-discovery-no-reinforcement.test.ts` | Banned fields + comparator guard |
| `trader-discovery-evidence-ledger.test.ts` | Epistemic derive without PnL |
| `trader-discovery-hypothesis-studio.test.ts` | RQ-parent enforcement |
| `trader-discovery-candidate-comparator.test.ts` | Dimension-only ranking |
| `trader-discovery-promotion-proposal.test.ts` | Recommend-only artifact |
| `trader-generator-strategy-synthesizer.test.ts` | v0 template synthesis |

## Postgres

- Migrations 0074/0075 registered in `db/migrations_postgres/meta/_journal.json`
- Apply on target Postgres before enabling discovery CLI in staging
