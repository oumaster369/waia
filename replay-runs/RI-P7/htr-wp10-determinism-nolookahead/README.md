# HTR-WP10 determinism + no-lookahead qualification

Evidence for deterministic default replay session (HTR-WP10).

## Reproduce

```bash
pnpm test --run tests/unit/trader-wp10-default-session-determinism.test.ts \
  tests/unit/trader-wp10-clock-injection.test.ts \
  tests/unit/trader-wp10-order-id-determinism.test.ts \
  tests/unit/trader-wp10-lifecycle-determinism.test.ts \
  tests/unit/trader-wp10-digest-stability.test.ts \
  tests/unit/trader-wp10-no-lookahead.test.ts
```

## Manifest digest

`fa5def3786dd85fe790c5623c09d76f31b9b67c866409e8fa8ae1ad91274926b`
