import { afterEach, describe, expect, it, vi } from "vitest";

import {
  establishEmailAuthSession,
  establishEmailSignInOnly,
  establishEmailSignUpOnly,
  parseAuthOkResponse,
  parseNeedsEmailConfirmation,
} from "@/lib/landing/email-auth-session";

describe("parseAuthOkResponse", () => {
  it("accepts valid ok envelope", () => {
    expect(parseAuthOkResponse({ ok: true, redirect: "/dashboard" })).toEqual({
      ok: true,
      redirect: "/dashboard",
    });
  });

  it("rejects malformed bodies", () => {
    expect(parseAuthOkResponse(null)).toBeNull();
    expect(parseAuthOkResponse({ ok: false })).toBeNull();
    expect(parseAuthOkResponse({ ok: true, redirect: 1 })).toBeNull();
  });

  it("rejects unsafe redirect strings", () => {
    expect(parseAuthOkResponse({ ok: true, redirect: "//evil.example/x" })).toBeNull();
    expect(parseAuthOkResponse({ ok: true, redirect: "https://evil/x" })).toBeNull();
    expect(parseAuthOkResponse({ ok: true, redirect: "\t/dashboard" })).toBeNull();
  });

  it("rejects ok body when email confirmation is required", () => {
    expect(
      parseAuthOkResponse({
        ok: true,
        needsEmailConfirmation: true,
        redirect: "/dashboard",
      }),
    ).toBeNull();
  });
});

describe("parseNeedsEmailConfirmation", () => {
  it("detects Supabase confirmation envelope", () => {
    expect(parseNeedsEmailConfirmation({ ok: true, needsEmailConfirmation: true })).toBe(true);
    expect(parseNeedsEmailConfirmation({ ok: true, redirect: "/dashboard" })).toBe(false);
    expect(parseNeedsEmailConfirmation(null)).toBe(false);
  });
});

describe("establishEmailSignInOnly", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns success when sign-in returns ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true, redirect: "/dashboard" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const r = await establishEmailSignInOnly({ email: "a@b.co", password: "password12" });
    expect(r).toEqual({ outcome: "success", redirectPath: "/dashboard" });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/api/auth/sign-in", expect.any(Object));
  });
});

describe("establishEmailSignUpOnly", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns success when sign-up returns ok without calling sign-in", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true, redirect: "/dashboard" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const r = await establishEmailSignUpOnly({
      email: "a@b.co",
      password: "password12",
      fullName: "Ada Lovelace",
    });
    expect(r).toEqual({ outcome: "success", redirectPath: "/dashboard" });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/api/auth/sign-up", expect.any(Object));
  });

  it("returns needsEmailConfirmation when sign-up succeeds without session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: true,
            needsEmailConfirmation: true,
            redirect: "/dashboard",
          }),
          {
            status: 201,
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    );

    const r = await establishEmailSignUpOnly({
      email: "a@b.co",
      password: "password12",
      fullName: "Ada Lovelace",
    });
    expect(r).toEqual({ outcome: "needsEmailConfirmation" });
  });
});

describe("establishEmailAuthSession", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns success when sign-in returns ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true, redirect: "/dashboard" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const r = await establishEmailAuthSession({
      email: "a@b.co",
      password: "password12",
    });
    expect(r).toEqual({ outcome: "success", redirectPath: "/dashboard" });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("does not call sign-up when sign-in returns 200 with an unsafe redirect body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true, redirect: "//evil.example" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const r = await establishEmailAuthSession({
      email: "a@b.co",
      password: "password12",
    });
    expect(r.outcome).toBe("failure");
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("falls back to sign-up when sign-in does not succeed", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: { code: "INVALID_CREDENTIALS" } }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ ok: true, redirect: "/dashboard" }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          }),
        ),
    );

    const r = await establishEmailAuthSession({
      email: "a@b.co",
      password: "password12",
    });
    expect(r.outcome).toBe("success");
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it("returns needsEmailConfirmation when sign-up requires email verification", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: { code: "INVALID_CREDENTIALS" } }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              ok: true,
              needsEmailConfirmation: true,
              redirect: "/dashboard",
            }),
            {
              status: 201,
              headers: { "Content-Type": "application/json" },
            },
          ),
        ),
    );

    const r = await establishEmailAuthSession({
      email: "a@b.co",
      password: "password12",
    });
    expect(r).toEqual({ outcome: "needsEmailConfirmation" });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it("returns failure when both calls fail", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("nope", { status: 401 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: { code: "EMAIL_TAKEN" } }), {
            status: 409,
            headers: { "Content-Type": "application/json" },
          }),
        ),
    );

    const r = await establishEmailAuthSession({
      email: "a@b.co",
      password: "password12",
    });
    expect(r.outcome).toBe("failure");
  });
});
