import { NextResponse } from "next/server";

import type { ApiErrorEnvelope } from "@/lib/auth/json-errors";
import { getOptionalSessionUserId } from "@/lib/auth/session-user";
import {
  readProfileForSessionUser,
  updateProfileForSessionUser,
} from "@/lib/waia-core/profiles/runtime";

export const dynamic = "force-dynamic";

const LOCALE_PATTERN = /^[a-z]{2}(-[A-Z]{2})?$/;
const MAX_DISPLAY_NAME_LENGTH = 80;

type ProfileApiResponse = {
  ok: true;
  profile: {
    displayName: string;
    locale: string;
    avatarRef: string | null;
  };
};

function jsonError(code: string, message: string, status: number): NextResponse {
  const body: ApiErrorEnvelope = { error: { code, message } };
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function jsonProfile(profile: ProfileApiResponse["profile"], status = 200): NextResponse {
  const body: ProfileApiResponse = { ok: true, profile };
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

/** GET /api/profile — read the authenticated user's profile (WC-E1 S1). */
export async function GET() {
  try {
    const userId = await getOptionalSessionUserId();
    if (!userId) {
      return jsonError("UNAUTHENTICATED", "Authentication required.", 401);
    }

    const profile = await readProfileForSessionUser(userId);
    if (!profile) {
      return jsonError("PROFILE_NOT_FOUND", "Profile could not be found.", 404);
    }

    return jsonProfile(profile);
  } catch {
    return jsonError("INTERNAL_ERROR", "Something went wrong.", 500);
  }
}

type ProfilePatchBody = {
  displayName?: unknown;
  locale?: unknown;
  avatarRef?: unknown;
  settings?: unknown;
};

function parseProfilePatch(
  body: ProfilePatchBody,
): { ok: true; patch: { displayName?: string; locale?: string } } | { ok: false; message: string } {
  const hasDisplayName = body.displayName !== undefined;
  const hasLocale = body.locale !== undefined;

  if (!hasDisplayName && !hasLocale) {
    return { ok: false, message: "At least one of displayName or locale is required." };
  }

  const patch: { displayName?: string; locale?: string } = {};

  if (hasDisplayName) {
    if (typeof body.displayName !== "string") {
      return { ok: false, message: "displayName must be a string." };
    }
    const trimmed = body.displayName.trim();
    if (trimmed.length < 1 || trimmed.length > MAX_DISPLAY_NAME_LENGTH) {
      return { ok: false, message: "displayName must be between 1 and 80 characters." };
    }
    patch.displayName = trimmed;
  }

  if (hasLocale) {
    if (typeof body.locale !== "string") {
      return { ok: false, message: "locale must be a string." };
    }
    const trimmedLocale = body.locale.trim();
    if (!LOCALE_PATTERN.test(trimmedLocale)) {
      return { ok: false, message: "locale format is invalid." };
    }
    patch.locale = trimmedLocale;
  }

  return { ok: true, patch };
}

/** PATCH /api/profile — update displayName and/or locale (WC-E1 S1). */
export async function PATCH(request: Request) {
  try {
    const userId = await getOptionalSessionUserId();
    if (!userId) {
      return jsonError("UNAUTHENTICATED", "Authentication required.", 401);
    }

    let body: ProfilePatchBody;
    try {
      body = (await request.json()) as ProfilePatchBody;
    } catch {
      return jsonError("VALIDATION_ERROR", "Request body must be valid JSON.", 400);
    }

    const parsed = parseProfilePatch(body);
    if (!parsed.ok) {
      return jsonError("VALIDATION_ERROR", parsed.message, 400);
    }

    const profile = await updateProfileForSessionUser(userId, parsed.patch);
    if (!profile) {
      return jsonError("PROFILE_NOT_FOUND", "Profile could not be found.", 404);
    }

    return jsonProfile(profile);
  } catch {
    return jsonError("INTERNAL_ERROR", "Something went wrong.", 500);
  }
}
