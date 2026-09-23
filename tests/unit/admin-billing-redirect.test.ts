import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

describe("legacy admin billing page", () => {
  it("redirects to the clients invoices tab and does not submit attestations", async () => {
    const page = await import("@/app/(trader)/admin/billing/page");
    await expect(page.default({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      "REDIRECT:/admin/clients?tab=invoices",
    );
    await expect(
      page.default({
        searchParams: Promise.resolve({ organization_id: "org-1" }),
      }),
    ).rejects.toThrow("REDIRECT:/admin/clients?tab=invoices&organization_id=org-1");
    expect(page.default.toString()).not.toContain("depositsVerified");
  });
});
