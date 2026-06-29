import { NextResponse } from "next/server";

import { runAlertDrill } from "@/lib/observability/alerting/alert-router";

export const dynamic = "force-dynamic";

/** POST /api/health/alerting/drill — BP-9 safe Telegram drill on Worker (DEE-223 / DEE-352 Step 7). */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const forceDryRun =
    url.searchParams.get("dry_run") === "1" || url.searchParams.get("dry_run") === "true";
  const forceSend = url.searchParams.get("send") === "1" || url.searchParams.get("send") === "true";

  if (forceDryRun && forceSend) {
    return NextResponse.json({ error: "Use either dry_run or send, not both." }, { status: 400 });
  }

  const result = await runAlertDrill({
    dryRun: forceDryRun ? true : forceSend ? false : undefined,
  });

  const ok = result.deliveryOutcome === "success" || result.deliveryOutcome === "dry_run";

  return NextResponse.json(
    {
      configured: result.configured,
      dry_run: result.dryRun,
      outcome: result.deliveryOutcome,
      sink: "telegram",
      alert_type: "paper_loop_critical",
      drill: true,
    },
    { status: ok ? 200 : 503 },
  );
}
