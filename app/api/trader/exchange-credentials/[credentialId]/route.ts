import { NextResponse } from "next/server";

import {
  createProductionConnectDeps,
  handleExchangeCredentialDelete,
} from "@/lib/trader/credentials/connect-handler";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ credentialId: string }> },
) {
  const { credentialId } = await context.params;
  const result = await handleExchangeCredentialDelete(credentialId, createProductionConnectDeps());
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "private, no-store" },
  });
}
