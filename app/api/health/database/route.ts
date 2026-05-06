import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getWaiaRuntimeDb } from "@/db/waia-runtime-db";

export const dynamic = "force-dynamic";

/** GET /api/health/database — connectivity probe only (DEE-64B2 Slice C1). */
export async function GET() {
  const handle = await getWaiaRuntimeDb();
  if (handle.kind === "sqlite") {
    return NextResponse.json({ backend: "sqlite", ok: true });
  }
  await handle.db.execute(sql`select 1`);
  return NextResponse.json({ backend: "postgres", ok: true });
}
