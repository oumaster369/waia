# Visual regression baseline — preparation only (DEE-131)

This PR **does not** add screenshot baselines or new failing E2E assertions.

**Intent:** Document how we will implement [DEE-142](https://linear.app/deepsense) safely:

- Freeze **1–2** routes and viewport sizes before enabling `toHaveScreenshot`.
- Run against the same theme default as CI (`light` unless `dark` is explicitly part of the test harness).
- Update snapshots in dedicated PRs only (avoid churn on feature PRs).

Playwright is already a dev dependency; wiring is deferred to avoid flaky CI and unintended noise during the token rollout.
