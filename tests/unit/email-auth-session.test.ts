import { afterEach, describe, expect, it, vi } from "vitest";

import { establishEmailAuthSession, parseAuthOkResponse } from "@/lib/landing/email-auth-session";

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
