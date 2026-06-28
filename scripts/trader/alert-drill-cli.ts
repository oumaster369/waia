/**
 * DEE-223 / BP-9 — Telegram alerting drill CLI.
 *
 * Default: dry-run when alerting secrets are not configured (safe for local dev).
 * With secrets configured: live delivery unless --dry-run is passed.
 * --send: attempt live delivery when secrets are configured.
 */

import { formatDrillBanner } from "@/lib/observability/alerting/alert-formatter";
import { runAlertDrill } from "@/lib/observability/alerting/alert-router";

function printUsage(): void {
  console.log(`BP-9 Telegram alerting drill (DEE-223)

Usage:
  pnpm trader:alert:drill [--dry-run] [--send]

Flags:
  --dry-run   Format message and emit delivery telemetry only (no Telegram HTTP)
  --send      Attempt live Telegram delivery when TELEGRAM_ALERTS_* secrets are set

Environment (all three required for live delivery):
  TELEGRAM_ALERTS_BOT_TOKEN
  TELEGRAM_ALERTS_CHAT_ID
  TELEGRAM_ALERTS_THREAD_ID`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    printUsage();
    return;
  }

  const forceDryRun = argv.includes("--dry-run");
  const forceSend = argv.includes("--send");

  if (forceDryRun && forceSend) {
    console.error("Use either --dry-run or --send, not both.");
    process.exitCode = 1;
    return;
  }

  const result = await runAlertDrill({
    dryRun: forceDryRun ? true : forceSend ? false : undefined,
  });

  console.log(formatDrillBanner(result.configured));
  console.log("--- formatted alert ---");
  console.log(result.message);
  console.log("--- delivery ---");
  console.log(
    JSON.stringify({
      configured: result.configured,
      dry_run: result.dryRun,
      outcome: result.deliveryOutcome,
    }),
  );

  if (!result.dryRun && result.deliveryOutcome !== "success") {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
