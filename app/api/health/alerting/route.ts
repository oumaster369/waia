import { NextResponse } from "next/server";

import { isAlertingEnabled } from "@/lib/observability/alerting/config";

export const dynamic = "force-dynamic";

/** GET /api/health/alerting — BP-9 Telegram alerting configuration probe (DEE-223). */
export async function GET() {
  return NextResponse.json({
    configured: isAlertingEnabled(),
    sink: "telegram",
  });
}
