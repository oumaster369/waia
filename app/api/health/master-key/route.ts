import { NextResponse } from "next/server";

import { createMasterKeyProvider } from "@/lib/trader/security/create-master-key-provider";

export const dynamic = "force-dynamic";

/** GET /api/health/master-key — DEE-220 production crypto readiness probe (DEE-352 Step 2). */
export async function GET() {
  const provider = await createMasterKeyProvider();
  return NextResponse.json({
    configured: provider.isProductionReady() || provider.getCurrentKeyVersion().length > 0,
    productionReady: provider.isProductionReady(),
    keyVersion: provider.getCurrentKeyVersion(),
  });
}
