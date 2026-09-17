import fs from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  traderHost: true,
  entitled: true,
  ensureSelfService: vi.fn(async () => mocks.entitled),
}));

vi.mock("@/lib/hosts/resolve", () => ({
  isModuleHost: (_input: unknown, module: string) => module === "trader" && mocks.traderHost,
  buildModuleUrl: (module: string, routePath: string) =>
    `https://${module}.waia.invalid${routePath}`,
}));

vi.mock("@/lib/trader/self-service-access", () => ({
  ensureTraderSelfServiceAccessForUser: mocks.ensureSelfService,
}));

import { resolvePostAuthRedirect } from "@/lib/auth/post-auth-redirect";

const request = () =>
  new Request("https://trader.waia.invalid/api/auth/sign-in", { method: "POST" });

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("DEE-1019 trader-host admission entry points", () => {
  beforeEach(() => {
    mocks.traderHost = true;
    mocks.entitled = true;
    mocks.ensureSelfService.mockClear();
  });

  it("admits an authenticated trader-host session and lands it in /trader", async () => {
    await expect(resolvePostAuthRedirect(request(), "user-1")).resolves.toBe("/trader");
    expect(mocks.ensureSelfService).toHaveBeenCalledTimes(1);
    expect(mocks.ensureSelfService).toHaveBeenCalledWith("user-1");
  });

  it("keeps a refused admission off the trader workspace", async () => {
    mocks.entitled = false;

    await expect(resolvePostAuthRedirect(request(), "user-2")).resolves.toBe(
      "https://primary.waia.invalid/dashboard",
    );
  });

  it("never admits from a non-trader host", async () => {
    mocks.traderHost = false;

    await expect(resolvePostAuthRedirect(request(), "user-3")).resolves.toBe("/dashboard");
    expect(mocks.ensureSelfService).not.toHaveBeenCalled();
  });

  it("wires admission only into trader-host entry points, never into protected API gates", () => {
    expect(readSource("app/page.tsx")).toContain("ensureTraderSelfServiceAccessForUser");
    expect(readSource("lib/auth/post-auth-redirect.ts")).toContain(
      "ensureTraderSelfServiceAccessForUser",
    );

    for (const gate of [
      "lib/trader/access-gate.ts",
      "lib/trader/runtime-provisioning.ts",
      "lib/trader/account-observation/route.ts",
      "lib/trader/credentials/connect-handler.ts",
    ]) {
      expect(readSource(gate)).not.toContain("self-service-access");
    }
  });
});
