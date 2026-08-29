import { NextResponse } from "next/server";

import { moduleOrigin } from "@/lib/hosts/config";
import { HTX_CONNECT_ERROR_CODES } from "@/lib/trader/credentials/connect-api.types";
import {
  createProductionConnectDeps,
  handleExchangeCredentialDelete,
} from "@/lib/trader/credentials/connect-handler";

export const dynamic = "force-dynamic";

export function isCredentialMutationSameOrigin(request: Request): boolean {
  const rawOrigin = request.headers.get("origin")?.trim();
  if (!rawOrigin) return false;

  try {
    const parsedOrigin = new URL(rawOrigin);
    if (parsedOrigin.origin !== rawOrigin.replace(/\/$/, "")) return false;
    const allowedOrigins = new Set([
      new URL(request.url).origin,
      moduleOrigin("trader"),
    ]);
    return allowedOrigins.has(parsedOrigin.origin);
  } catch {
    return false;
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ credentialId: string }> },
) {
  if (!isCredentialMutationSameOrigin(request)) {
    return NextResponse.json(
      {
        error: {
          code: HTX_CONNECT_ERROR_CODES.CSRF_INVALID,
          message: "Request origin is not allowed.",
        },
      },
      { status: 403, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  const { credentialId } = await context.params;
  const result = await handleExchangeCredentialDelete(credentialId, createProductionConnectDeps());
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "private, no-store" },
  });
}
