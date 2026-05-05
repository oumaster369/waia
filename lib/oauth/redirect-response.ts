import "server-only";

import { NextResponse } from "next/server";

import { OAUTH_ERROR_QUERY, type OauthErrorCode } from "@/lib/oauth/oauth-error-codes";
import { resolveOAuthPublicBaseUrl } from "@/lib/oauth/public-url";

export function oauthFailureRedirect(code: OauthErrorCode): NextResponse {
  const url = new URL("/", resolveOAuthPublicBaseUrl());
  url.searchParams.set(OAUTH_ERROR_QUERY, code);
  return NextResponse.redirect(url, 302);
}

export function oauthSuccessDashboardRedirect(): NextResponse {
  const url = new URL("/dashboard", resolveOAuthPublicBaseUrl());
  return NextResponse.redirect(url, 302);
}
