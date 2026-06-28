# DEE-223 — BP-9 Telegram Alerting Operator Runbook

**Scope:** Post-merge operator provisioning for AI-TRADER critical alert delivery to Telegram Forum **Alerts** topic.

**Secrets:** Names and purpose only — **never** commit or paste token values into the repository, PRs, Linear, logs, or telemetry.

---

## Production secret inventory (BP-9)

| Secret name | Purpose | Production location |
|-------------|---------|---------------------|
| `TELEGRAM_ALERTS_BOT_TOKEN` | Dedicated Alerts Bot API authentication for `sendMessage` | Cloudflare Worker secret (`wrangler secret put`) |
| `TELEGRAM_ALERTS_CHAT_ID` | Target forum supergroup for critical alert delivery | Cloudflare Worker secret |
| `TELEGRAM_ALERTS_THREAD_ID` | Forum **Alerts** topic thread id within supergroup | Cloudflare Worker secret |

**Excluded:** `TELEGRAM_BOT_TOKEN` (OAuth Login Widget) — alerting must not use it.

Local dev: gitignored `.dev.vars` (placeholders in `.dev.vars.example` only).

---

## 1. Create dedicated Telegram Alerts Bot

1. Open [@BotFather](https://t.me/BotFather) → `/newbot`
2. Name distinctly (e.g. `WAIA AI-TRADER Alerts`) — **not** the OAuth login bot
3. Save token as `TELEGRAM_ALERTS_BOT_TOKEN` in operator vault
4. Do **not** reuse `TELEGRAM_BOT_TOKEN`

## 2. Create (or select) Telegram Forum Group

1. Create or select a Telegram **supergroup**
2. Enable **Topics** (Forum mode)

## 3. Create **Alerts** topic

1. Create forum topic named **Alerts**
2. Record supergroup chat id → `TELEGRAM_ALERTS_CHAT_ID`
3. Record topic `message_thread_id` → `TELEGRAM_ALERTS_THREAD_ID`

## 4. Add Alerts Bot with minimum permissions

1. Add the **Alerts Bot** to the forum supergroup
2. Grant **send messages** in the **Alerts** topic only (minimum required)

## 5. Obtain secret values

Collect in operator vault only:

- `TELEGRAM_ALERTS_BOT_TOKEN`
- `TELEGRAM_ALERTS_CHAT_ID`
- `TELEGRAM_ALERTS_THREAD_ID`

## 6. Store in production Secrets Store

```bash
npx wrangler secret put TELEGRAM_ALERTS_BOT_TOKEN
npx wrangler secret put TELEGRAM_ALERTS_CHAT_ID
npx wrangler secret put TELEGRAM_ALERTS_THREAD_ID
```

## 7. Run alert drill

```bash
# Dry-run (no secrets required — safe for local dev)
pnpm trader:alert:drill --dry-run

# Live delivery (secrets required)
pnpm trader:alert:drill --send
```

Expect live message in **Alerts** topic within ~10s.

## 8. Verify successful delivery

- [ ] Drill message visible in **Alerts** topic
- [ ] Worker logs contain `waia_alert_delivery` with `outcome=success` (no secret values in lines)
- [ ] Trading / watcher paths unaffected when Telegram unreachable

## 9. Confirm health endpoint

```bash
curl -s "$ORIGIN/api/health/alerting"
# → {"configured":true,"sink":"telegram"}
```

- [ ] `configured: true` after secrets deployed
- [ ] Chat/thread ids stored in operator vault only (not repo, not Linear)

---

## Grep examples (post-deploy)

```bash
# Delivery telemetry
grep '"event":"waia_alert_delivery"'

# Successful deliveries
grep '"event":"waia_alert_delivery"' | grep '"outcome":"success"'

# Suppressed duplicates (5-minute dedupe window)
grep '"event":"waia_alert_delivery"' | grep '"outcome":"suppressed"'
```

---

## Deferred alert types (no emitter yet)

These Master Spec §20 items are **not** routed until future slices add critical emitters:

- Credential failure
- Live-vs-paper divergence
- Live-path drawdown (`risk_rejected` is info severity today)

BP-9 router is ready when those emitters land.
