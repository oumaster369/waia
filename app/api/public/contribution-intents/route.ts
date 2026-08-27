import { NextResponse } from "next/server";

import { disposeWaiaRuntimeDb, getWaiaRuntimeDb } from "@/db/waia-runtime-db";
import { getOptionalSessionUserId } from "@/lib/auth/session-user";
import { readProfileForSessionUser } from "@/lib/waia-core/profiles/runtime";
import {
  ContributionIntentError,
  createContributionPaymentIntent,
} from "@/lib/waia-core/treasury/contributions/payment-intents";
import { isValidTronAddress } from "@/lib/treasury-admin/explorer";

export const dynamic = "force-dynamic";

function error(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return error("ORIGIN_MISMATCH", "Cross-origin contribution requests are not allowed.", 403);
  }
  const userId = await getOptionalSessionUserId();
  if (!userId) return error("UNAUTHENTICATED", "Sign in to create a named contribution.", 401);

  const address = process.env.WAIA_PUBLIC_SUPPORT_USDT_TRC20_ADDRESS?.trim() ?? "";
  if (!isValidTronAddress(address)) {
    return error(
      "SUPPORT_ADDRESS_UNAVAILABLE",
      "The official support address is unavailable.",
      503,
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return error("INVALID_JSON", "Request body must be valid JSON.", 400);
  }

  const profile = await readProfileForSessionUser(userId);
  if (!profile) return error("PROFILE_UNAVAILABLE", "Your WAIA profile is unavailable.", 409);

  let runtime;
  try {
    runtime = await getWaiaRuntimeDb();
    if (runtime.kind !== "postgres") {
      return error("TREASURY_BACKEND_UNAVAILABLE", "Named contributions are unavailable.", 503);
    }
    const intent = await createContributionPaymentIntent({
      db: runtime.db,
      userId,
      displayName: profile.displayName,
      amount: body.amount,
      publicSiteUrl: body.publicSiteUrl,
      twinProfileUrl: body.twinProfileUrl,
      consentPublicIdentity: body.consentPublicIdentity,
      receivingAddress: address,
    });
    return NextResponse.json(
      { intent },
      { status: 201, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (caught) {
    if (caught instanceof ContributionIntentError) {
      return error(
        caught.code,
        caught.message,
        caught.code === "TOO_MANY_ACTIVE_INTENTS" ? 429 : 400,
      );
    }
    return error("CONTRIBUTION_INTENT_FAILED", "Could not prepare payment instructions.", 500);
  } finally {
    await disposeWaiaRuntimeDb(runtime);
  }
}
