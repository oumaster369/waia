import { NextResponse } from "next/server";

import { oauthCallbackResponse } from "@/lib/oauth/oauth-callback";
import { parseOauthProviderSegment } from "@/lib/oauth/provider-parse";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  const { provider: raw } = await context.params;
  const provider = parseOauthProviderSegment(raw);

  if (provider == null) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Unknown OAuth provider." } },
      { status: 404 },
    );
  }

  return oauthCallbackResponse(provider, request.url);
}
