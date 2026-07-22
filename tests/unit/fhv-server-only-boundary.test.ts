import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { renderFhvSystemdUnits } from "@/lib/trader/observability/fhv-systemd-unit-renderer";

describe("FHV server-only boundary (DEE-431 R5)", () => {
  it("keeps static server-only import in db/client.ts", () => {
    const source = readFileSync(join(process.cwd(), "db/client.ts"), "utf8");
    expect(source).toContain('import "server-only";');
    expect(source).not.toContain("enforceServerOnly");
  });

  it("does not bypass server-only enforcement for WAIA_TRADER_CLI in enforce-server-only.ts", () => {
    const source = readFileSync(join(process.cwd(), "lib/enforce-server-only.ts"), "utf8");
    expect(source).not.toContain("WAIA_TRADER_CLI");
  });

  it("rejects db/client import without react-server conditions", () => {
    const result = spawnSync(
      "node",
      [
        "--import",
        "tsx",
        "-e",
        "import('./db/client.ts').then(() => process.exit(1)).catch((error) => { console.error(error.message); process.exit(2); })",
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          VITEST: undefined,
          NODE_OPTIONS: undefined,
        },
        encoding: "utf8",
      },
    );
    expect(result.status).toBe(2);
    expect(`${result.stderr}${result.stdout}`).toContain("Client Component");
  });

  it("matches systemd campaign ExecStart to pnpm trader:fhv:campaign prelude composition", () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const campaignScript = packageJson.scripts["trader:fhv:campaign"];
    expect(campaignScript).toContain("trader-cli-server-only-prelude.cjs");
    expect(campaignScript).toContain("fhv-campaign-cli.ts");

    const units = renderFhvSystemdUnits({
      schemaVersion: "fhv-systemd-unit-config/v1",
      hostOs: "linux",
      qualifiedSupervisor: "SYSTEMD",
      repoRoot: process.cwd(),
      workingDirectory: process.cwd(),
      serviceUser: "waia-fhv",
      environmentFile: "/etc/waia/fhv.env",
      targetSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      nodeBin: "/usr/bin/node",
      fhvRunRoot: "/var/lib/waia/fhv-runs/rehearsal-1",
      fhvRunId: "fhv-boundary-test",
      fhvOrganizationId: "00000000-0000-4000-8000-000000000431",
      observerPort: 8787,
    });
    expect(units.campaignUnit).toContain("trader-cli-server-only-prelude.cjs");
    expect(units.campaignUnit).toContain("fhv-campaign-cli.ts");
    expect(units.campaignUnit).toContain("WAIA_TRADER_CLI=1");
  });
});
