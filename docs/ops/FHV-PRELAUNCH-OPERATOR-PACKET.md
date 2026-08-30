# FHV pre-launch operator packet (post-merge of PR #466)

Copy/paste after Human squash-merge of PR #466 and creation of **one** combined release.
Do **not** run these commands during software Build. Do **not** access BLIND_HOLDOUT.
Do **not** execute DEE-540 / DEE-541 / production capital.

Mandatory trader chain is PR #465 → PR #466. PR #464 is unrelated.

## 0. Bind the combined release

```bash
export FHV_RELEASE_SHA="<combined-main-sha>"
export FHV_RELEASE_TAG="<single-combined-tag>"
export FHV_ORGANIZATION_ID="<org-uuid>"
export FHV_OPERATOR_ID="<operator-id>"
export FHV_EXECUTION_IP="<approved-candidate-ipv4>"
export FHV_EXECUTION_HOSTNAME="<approved-candidate-hostname>"
export FHV_EXECUTION_CHECKOUT="<approved-absolute-checkout-path>"
git -C "$FHV_EXECUTION_CHECKOUT" rev-parse HEAD   # must equal $FHV_RELEASE_SHA
```

## 1. EXECUTION_SERVER_PREFLIGHT (before WP3B)

Bind the approved candidate explicitly. The preflight has no fallback IP, hostname, or checkout.
SSH identity defaults to `$HOME/.ssh/waia_cherry_dee536` and can be overridden with
`FHV_EXECUTION_SERVER_SSH_IDENTITY`. Work root remains `/opt/waia/fhv-work` (XFS), and Node must be `v22.23.0`.

```bash
./scripts/ops/fhv-execution-server-preflight.sh \
  --execute \
  --release-sha "$FHV_RELEASE_SHA" \
  --expected-ip "$FHV_EXECUTION_IP" \
  --expected-hostname "$FHV_EXECUTION_HOSTNAME" \
  --expected-checkout "$FHV_EXECUTION_CHECKOUT"
# required: EXECUTION_SERVER_PREFLIGHT=PASS
```

Stop on `EXECUTION_SERVER_PREFLIGHT=BLOCKED_<REASON>`. Do not continue to WP3B.

## 2. Fresh WP3B (unchanged contract)

```bash
pnpm trader:fhv:wp3b-host-qualification -- --release-sha "$FHV_RELEASE_SHA" --out /opt/waia/fhv-work/fhv-wp3b-host-qualification.v2.json
```

## 3. Throughput qualification (not FULL_HISTORICAL)

Do **not** run `pnpm trader:fhv:run`. Use a production-path representative segment `--run-dir` that does not require DEE-537 receipts or holdout.

```bash
pnpm trader:fhv:growth-law-report -- --run-dir "<representative-run-dir>"
pnpm trader:fhv:throughput-host-qualification -- --run-dir "<representative-run-dir>"
```

## 4. T4 host preflight + aggregate HOST_QUALIFIED

```bash
# existing T4 preflight proof JSON with {"status":"PASS","hostname":"<approved-candidate-hostname>"}
pnpm trader:fhv:host-qualify -- \
  --release-sha "$FHV_RELEASE_SHA" \
  --wp3b-receipt /opt/waia/fhv-work/fhv-wp3b-host-qualification.v2.json \
  --throughput-receipt /opt/waia/fhv-work/fhv-throughput-host-qualification.v2.json \
  --t4-preflight /opt/waia/fhv-work/fhv-t4-host-preflight.json \
  --out /opt/waia/fhv-work/fhv-host-qualification-receipt.v1.json
# required: HOST_QUALIFIED
```

## 5. REAL_HTX_PREFLIGHT then real DEVELOPMENT / WALK_FORWARD

```bash
pnpm trader:fhv:real-htx-preflight -- --real-htx
# required: REAL_HTX_PREFLIGHT=PASS

pnpm trader:fhv:acquire-htx-v2 -- --real-htx --partition development --symbol BTCUSDT ...
pnpm trader:fhv:acquire-htx-v2 -- --real-htx --partition development --symbol ETHUSDT ...
pnpm trader:fhv:acquire-htx-v2 -- --real-htx --partition walk-forward --symbol BTCUSDT ...
pnpm trader:fhv:acquire-htx-v2 -- --real-htx --partition walk-forward --symbol ETHUSDT ...
```

Never acquire `blind-holdout`. HTX `amount` is base quantity; `vol` is quote turnover.

## 6. Revision-risk + pre-holdout qualification

```bash
pnpm trader:fhv:revision-risk -- --real-htx --release-sha "$FHV_RELEASE_SHA" ...
pnpm trader:fhv:pre-holdout-qualify -- ...
pnpm trader:fhv:pre-holdout-verify -- --receipt <pre-holdout-receipt>
```

## 7. RUN_ONE then RUN_TWO (DEE-538)

Distinct freeze + authorization + control-replay identities. Same combined release / dataset / TEST_ONLY policy.

```bash
pnpm trader:fhv:freeze-config -- --run-id run-one ...
pnpm trader:fhv:authorize-full -- --run-id run-one --execution-purpose CONTROL_REPLAY ...
pnpm trader:fhv:control-replay -- --run-id run-one ...
pnpm trader:fhv:watch -- --run-dir <run-one-dir>

pnpm trader:fhv:freeze-config -- --run-id run-two ...
pnpm trader:fhv:authorize-full -- --run-id run-two --execution-purpose CONTROL_REPLAY ...
pnpm trader:fhv:control-replay -- --run-id run-two ...
pnpm trader:fhv:watch -- --run-dir <run-two-dir>
```

`CONTROL_REPLAY=PASS` if and only if both runs are valid under normalized parity.

No BLIND_HOLDOUT. No DEE-540. No DEE-541. No production capital.
